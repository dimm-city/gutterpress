import * as fs from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import git from "isomorphic-git";
import { resolveChromiumExecutable } from "./chromium";
import { execCapture } from "./exec";
import { detectProjectSource } from "./project-source";
import { hasUncommittedChanges } from "./source-provider";
// PACKAGE_META is a static package.json import — see version.ts's header for
// why (the compiled `--compile` binary must never read package.json off
// disk at runtime).
import { PACKAGE_META } from "./version";

type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

type PdfxFingerprintConfig = {
  requestedFlavor: "x1a" | "x3" | null;
  resolvedFlavor: "x1a" | "x3";
  iccPath: string | null;
  stripAnnotations: boolean | null;
};

export type BuildFingerprintInput = {
  command: "build";
  outputDir: string;
  sourceDir?: string;
  args: Record<string, unknown>;
  pdfx: PdfxFingerprintConfig;
};

const FINGERPRINT_FILENAME = "build-fingerprint.json";
const VERSION_TIMEOUT_MS = 4000;

function toJsonValue(value: unknown): JsonValue {
  if (value === null) return null;

  const t = typeof value;
  if (t === "string" || t === "number" || t === "boolean") {
    return value as string | number | boolean;
  }

  if (Array.isArray(value)) {
    return value.map((v) => toJsonValue(v));
  }

  if (t === "object") {
    const out: Record<string, JsonValue> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const entry = (value as Record<string, unknown>)[key];
      if (entry !== undefined) {
        out[key] = toJsonValue(entry);
      }
    }
    return out;
  }

  return String(value);
}

function stableJsonStringify(value: JsonValue): string {
  return `${JSON.stringify(toJsonValue(value), null, 2)}\n`;
}

/**
 * Best-effort spawn+capture: resolves `null` instead of throwing on any
 * failure (missing binary, non-zero exit, or timeout) since a fingerprint
 * field is optional metadata, never worth failing a build over. Delegates
 * to exec.ts's shared `execCapture` for the actual spawn/timeout/settled-
 * guard logic — see exec.ts's docstring for why that's a single
 * implementation now instead of one of four parallel copies.
 */
async function runCapture(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string } | null> {
  try {
    return await execCapture(cmd, args, { cwd, timeoutMs: VERSION_TIMEOUT_MS });
  } catch {
    return null;
  }
}

async function getFirstLineVersion(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<string | null> {
  const result = await runCapture(cmd, args, cwd);
  if (!result) return null;

  const line = `${result.stdout}\n${result.stderr}`
    .split(/\r?\n/)
    .map((s) => s.trim())
    .find((s) => s.length > 0);

  return line ?? null;
}

/**
 * Resolve the fingerprint's `sourceRevision` block via the pure-JS
 * `isomorphic-git` provider layer (CLAUDE.md §7) — NEVER the system `git`
 * binary. Tries `sourceDir` then `process.cwd()`, same fallback order and
 * graceful-null degradation the old `git rev-parse`-spawning implementation
 * had, but now works identically whether or not a `git` executable exists on
 * the host (arch finding #20).
 *
 * `detectProjectSource` (project-source.ts, pure `node:fs`) finds the repo
 * root for BOTH "this dir IS the repo" and "this dir is a subfolder of an
 * enclosing repo" the same way `git rev-parse --show-toplevel` did.
 * `hasUncommittedChanges` (source-provider.ts) is the lock-free dirty check:
 * a `WORKDIR`-vs-`STAGE` walk PLUS a `STAGE`-vs-`HEAD` compare, matching
 * `git status --porcelain`'s notion of dirty (a `git add`-ed but uncommitted
 * change still counts). This is provenance, not the hot sync path, so the
 * extra HEAD-tree compare is acceptable here — the sync surface's
 * `hasPendingChanges` deliberately stays WORKDIR-vs-STAGE only.
 */
async function getGitRevision(sourceDir?: string): Promise<{
  root: string;
  commit: string;
  shortCommit: string;
  dirty: boolean;
} | null> {
  const candidateDirs = [sourceDir, process.cwd()].filter((v): v is string => Boolean(v));
  const seen = new Set<string>();

  for (const dir of candidateDirs) {
    const abs = path.resolve(dir);
    if (seen.has(abs)) continue;
    seen.add(abs);

    const source = await detectProjectSource(abs);
    if (source.type !== "local-git-folder") continue;
    const gitRoot = source.repoRoot;

    let commit: string;
    try {
      commit = await git.resolveRef({ fs, dir: gitRoot, ref: "HEAD" });
    } catch {
      continue; // a repo with no commits yet — nothing to fingerprint
    }

    let dirty: boolean;
    try {
      dirty = await hasUncommittedChanges(gitRoot);
    } catch {
      continue;
    }

    return {
      root: gitRoot,
      commit,
      shortCommit: commit.slice(0, 7),
      dirty,
    };
  }

  return null;
}

async function getToolVersions(): Promise<Record<string, string | null>> {
  // Record the resolved Chromium PATH, but do NOT spawn it for `--version`:
  // on Windows `chrome.exe --version` launches a visible browser window instead
  // of printing+exiting, so fingerprinting after a build popped a stray Chrome
  // window. gs/qpdf are CLI tools and print+exit safely. (See the same fix in
  // diagnostics.ts.)
  const chromiumPath = await resolveChromiumExecutable();

  const [gsVersion, qpdfVersion] = await Promise.all([
    getFirstLineVersion("gs", ["--version"]),
    getFirstLineVersion("qpdf", ["--version"]),
  ]);

  return {
    "print-md": PACKAGE_META.version,
    bun: (process.versions as Record<string, string | undefined>).bun ?? null,
    node: process.versions.node,
    "puppeteer-core": PACKAGE_META.dependencies["puppeteer-core"] ?? null,
    // pagedjs is a devDependency (its runtime form is the vendored polyfill);
    // fall back to dependencies so a future re-promotion still records it.
    pagedjs:
      PACKAGE_META.devDependencies.pagedjs ??
      PACKAGE_META.dependencies.pagedjs ??
      null,
    ghostscript: gsVersion,
    qpdf: qpdfVersion,
    // Path, not version — recording the version would require spawning the GUI.
    chromium: chromiumPath ?? null,
  };
}

function sanitizeArgs(args: Record<string, unknown>): Record<string, JsonValue> {
  const out: Record<string, JsonValue> = {};
  const keys = Object.keys(args);

  const hasKebabEquivalent = (key: string): boolean => {
    const kebab = key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    return kebab !== key && keys.includes(kebab);
  };

  for (const key of keys.sort()) {
    if (hasKebabEquivalent(key)) {
      continue;
    }
    const value = args[key];
    if (value !== undefined) {
      out[key] = toJsonValue(value);
    }
  }

  return out;
}

export async function writeBuildFingerprint(input: BuildFingerprintInput): Promise<string> {
  const outputDir = path.resolve(input.outputDir);
  const outPath = path.join(outputDir, FINGERPRINT_FILENAME);

  const [tools, sourceRevision] = await Promise.all([
    getToolVersions(),
    getGitRevision(input.sourceDir),
  ]);

  const payload: JsonValue = {
    schemaVersion: 1,
    command: input.command,
    commandArgs: sanitizeArgs(input.args),
    keyConfig: {
      pdfx: {
        requestedFlavor: input.pdfx.requestedFlavor,
        resolvedFlavor: input.pdfx.resolvedFlavor,
        iccPath: input.pdfx.iccPath,
        stripAnnotations: input.pdfx.stripAnnotations,
      },
      outputDir,
    },
    sourceRevision,
    tools,
  };

  await mkdir(outputDir, { recursive: true });
  await writeFile(outPath, stableJsonStringify(payload), "utf8");
  return outPath;
}

import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { resolveChromiumExecutable } from "./chromium";
// Static JSON import — Bun inlines this at bundle time so the compiled
// binary doesn't try to read package.json off disk (where it resolves to
// `/package.json` via `import.meta.dir` inside `/$bunfs/`).
import packageJson from "../../package.json";

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

type PackageMeta = {
  version: string;
  dependencies: Record<string, string>;
};

const FINGERPRINT_FILENAME = "build-fingerprint.json";
const VERSION_TIMEOUT_MS = 4000;

const PACKAGE_META: PackageMeta = {
  version: (packageJson as { version?: string }).version ?? "unknown",
  dependencies:
    (packageJson as { dependencies?: Record<string, string> }).dependencies ??
    {},
};

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

function runCapture(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ stdout: string; stderr: string } | null> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      env: process.env,
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve(null);
    }, VERSION_TIMEOUT_MS);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(null);
    });

    child.on("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      resolve(null);
    });
  });
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

    const root = await runCapture("git", ["rev-parse", "--show-toplevel"], abs);
    if (!root) continue;

    const gitRoot = root.stdout.trim();
    if (!gitRoot) continue;

    const commit = await runCapture("git", ["rev-parse", "HEAD"], gitRoot);
    const shortCommit = await runCapture(
      "git",
      ["rev-parse", "--short", "HEAD"],
      gitRoot
    );
    const status = await runCapture(
      "git",
      ["status", "--porcelain", "--untracked-files=no"],
      gitRoot
    );

    if (!commit || !shortCommit || !status) {
      continue;
    }

    return {
      root: gitRoot,
      commit: commit.stdout.trim(),
      shortCommit: shortCommit.stdout.trim(),
      dirty: status.stdout.trim().length > 0,
    };
  }

  return null;
}

async function getToolVersions(): Promise<Record<string, string | null>> {
  const chromiumPath = resolveChromiumExecutable();

  const [gsVersion, qpdfVersion, chromiumVersion] = await Promise.all([
    getFirstLineVersion("gs", ["--version"]),
    getFirstLineVersion("qpdf", ["--version"]),
    chromiumPath ? getFirstLineVersion(chromiumPath, ["--version"]) : Promise.resolve(null),
  ]);

  return {
    "print-md": PACKAGE_META.version,
    bun: Bun.version,
    node: process.versions.node,
    playwright: PACKAGE_META.dependencies.playwright ?? null,
    pagedjs: PACKAGE_META.dependencies.pagedjs ?? null,
    ghostscript: gsVersion,
    qpdf: qpdfVersion,
    chromium: chromiumVersion,
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

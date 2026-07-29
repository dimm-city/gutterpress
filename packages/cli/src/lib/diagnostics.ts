/**
 * System diagnostics — surfaces tool availability + versions for the
  * desktop's Help/About dialog and the `gutterpress doctor` CLI command.
 *
 * Reuses `resolveChromiumExecutable`, `findTool`, and `isToolAvailable` for
 * tool detection. Install-hint copy lives in `./install-hints.ts` — the
 * single source of truth also consumed by build-runner.ts's preflight and
 * chromium.ts's `requireChromiumExecutable` — not duplicated here. Probes
 * are run in parallel; total wall time is dominated by the slowest
 * `--version` invocation (~50-200ms per tool that's present, ~5ms per tool
 * that's missing).
 */

import { platform, arch, release } from "node:os";
import { resolveChromiumExecutable } from "./chromium";
import { resolveGhostscript } from "./ghostscript";
import { findTool, isToolAvailable } from "./tool-probe";
import { execCapture } from "./exec";
import { INSTALL_HINTS as CANONICAL_INSTALL_HINTS, fullInstallHint } from "./install-hints";
import { PACKAGE_VERSION } from "./version";
import { defaultConfigDir } from "./remote-auth/token-store";

export interface ToolStatus {
  /**
   * Stable machine id for this tool, independent of the human-readable
   * `name`/`bin` display strings (e.g. "chromium", "gs", "qpdf"). Consumers
   * that need to single out a specific tool (the desktop's doctor route
   * excludes the bundled-Chromium entry from the "external tools" list) MUST
   * match on this field, not on `bin`/`name` — those are presentation text
   * and can be reworded without notice (UX L10).
   */
  id: string;
  name: string;
  /** The canonical CLI/binary name being probed (gs, qpdf, etc). */
  bin: string;
  /** True if the binary is resolvable on PATH or via fixed-path scan. */
  found: boolean;
  /** Absolute path on disk if found. */
  path?: string;
  /** First line of `<bin> --version` output if found and the call succeeded. */
  version?: string;
  /**
   * What features depend on this tool.
   * "required" — the feature breaks without it
   * "optional" — the feature degrades / skips gracefully
   */
  usedBy: Array<{ feature: string; severity: "required" | "optional" }>;
  /** Multi-line, per-platform install hint. Always present. */
  installHint: string;
}

export interface SystemDiagnostics {
  /** Gutterpress lib version */
  libVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: ToolStatus[];
  /** Existing CLI config/credential directory; reporting it never relocates data. */
  configDir: string;
  /** Path to the docs page with deeper info. */
  docsUrl: string;
}

const INSTALL_HINTS: Record<keyof typeof CANONICAL_INSTALL_HINTS, string> = {
  chromium: `${fullInstallHint("chromium")}\nOr set CHROMIUM_PATH=/path/to/chrome`,
  gs: `${fullInstallHint("gs")}\nOr set GHOSTSCRIPT_PATH=/path/to/ghostscript`,
  qpdf: fullInstallHint("qpdf"),
};

const TOOLS_TO_PROBE: Array<{
  id: string;
  bin: string;
  name: string;
  hintKey: keyof typeof INSTALL_HINTS;
  usedBy: ToolStatus["usedBy"];
}> = [
  {
    id: "gs",
    bin: "gs",
    name: "Ghostscript",
    hintKey: "gs",
    usedBy: [
      { feature: "PDF/X CMYK conversion (build --format pdfx)", severity: "required" },
      { feature: "validate: pdf.print.ink-coverage, asset.image-tac", severity: "optional" },
    ],
  },
  {
    id: "qpdf",
    bin: "qpdf",
    name: "qpdf",
    hintKey: "qpdf",
    usedBy: [
      { feature: "PDF/X annotation stripping (build --format pdfx)", severity: "required" },
      { feature: "validate: PDF/X OutputIntent + metadata checks", severity: "optional" },
    ],
  },
];

// Hard 2s ceiling — a broken binary that hangs shouldn't block the dialog.
const GET_VERSION_TIMEOUT_MS = 2000;

// Delegates to exec.ts's shared execCapture (see its docstring for why this
// is one implementation instead of one of four parallel copies). Note this
// now requires a zero exit code to report a version string — gs/qpdf both
// exit 0 on `--version` — whereas the old bespoke spawn here ignored the
// exit code entirely and would happily surface stderr from a failing
// invocation as if it were a version string.
async function getVersion(bin: string, args: string[] = ["--version"]): Promise<string | undefined> {
  try {
    const { stdout, stderr } = await execCapture(bin, args, { timeoutMs: GET_VERSION_TIMEOUT_MS });
    const combined = (stdout || stderr).trim();
    return combined.split(/\r?\n/)[0]?.trim() || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Probe every external tool the lib could spawn and return a structured
 * report. Safe to call repeatedly; the slowest path is ~200ms when every
 * tool is present (one `--version` per tool, in parallel).
 */
export async function getSystemDiagnostics(): Promise<SystemDiagnostics> {
  const libVersion = PACKAGE_VERSION;

  // Chromium gets its own special probe (uses the existing resolver, not just PATH).
  // NOTE: do NOT spawn the browser to read its version — on Windows `chrome.exe
  // --version` launches a visible browser window instead of printing+exiting,
  // which made opening the desktop's Help/About dialog pop a new Chrome instance.
  // The browser is a GUI app, so we report only its presence + path. (The desktop
  // surfaces its own bundled Chromium version separately via process.versions.)
  const chromiumPath = await resolveChromiumExecutable();
  const chromiumVersion = undefined;

  const chromium: ToolStatus = {
    id: "chromium",
    name: "Chromium-based browser",
    bin: "chrome / chromium / msedge",
    found: !!chromiumPath,
    path: chromiumPath,
    version: chromiumVersion,
    usedBy: [
      { feature: "Save PDF (every PDF render)", severity: "required" },
    ],
    installHint: INSTALL_HINTS.chromium!,
  };

  const ghostscriptPath = await resolveGhostscript();
  const tools: ToolStatus[] = await Promise.all(
    TOOLS_TO_PROBE.map(async (t): Promise<ToolStatus> => {
      if (t.id === "gs") {
        return {
          id: t.id,
          name: t.name,
          bin: t.bin,
          found: !!ghostscriptPath,
          path: ghostscriptPath,
          version: ghostscriptPath ? await getVersion(ghostscriptPath) : undefined,
          usedBy: t.usedBy,
          installHint: INSTALL_HINTS[t.hintKey]!,
        };
      }
      const [path, available] = await Promise.all([
        findTool(t.bin),
        isToolAvailable(t.bin),
      ]);
      const found = available || !!path;
      const version = found ? await getVersion(t.bin) : undefined;
      return {
        id: t.id,
        name: t.name,
        bin: t.bin,
        found,
        path,
        version,
        usedBy: t.usedBy,
        installHint: INSTALL_HINTS[t.hintKey]!,
      };
    })
  );

  return {
    libVersion,
    platform: {
      os: platform(),
      arch: arch(),
      release: release(),
      node: process.versions.node,
    },
    tools: [chromium, ...tools],
    configDir: defaultConfigDir(),
    docsUrl: "https://github.com/dimm-city/gutterpress/blob/main/examples/gutterpress-user-guide/08-system-setup.md",
  };
}

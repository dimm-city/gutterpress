/**
 * System diagnostics — surfaces tool availability + versions for the
 * viewer's Help/About dialog and the (planned) `print-md doctor` CLI.
 *
 * Reuses `resolveChromiumExecutable`, `findTool`, and `isToolAvailable`
 * so install-hint copy stays in one place. Probes are run in parallel;
 * total wall time is dominated by the slowest `--version` invocation
 * (~50-200ms per tool that's present, ~5ms per tool that's missing).
 */

import { spawn } from "node:child_process";
import { platform, arch, release } from "node:os";
import { resolveChromiumExecutable } from "./chromium";
import { findTool, isToolAvailable } from "./tool-probe";

export interface ToolStatus {
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
  /** print-md lib version */
  libVersion: string;
  platform: { os: string; arch: string; release: string; node: string };
  tools: ToolStatus[];
  /** Path to the docs page with deeper info. */
  docsUrl: string;
}

const INSTALL_HINTS: Record<string, string> = {
  chromium:
    "Install Google Chrome, Chromium, or Microsoft Edge:\n" +
    "  macOS:   brew install --cask google-chrome\n" +
    "  Ubuntu:  sudo apt install -y chromium-browser\n" +
    "  Windows: https://www.google.com/chrome/  (Edge is auto-detected if pre-installed)\n" +
    "Or set CHROMIUM_PATH=/path/to/chrome",
  gs:
    "Install Ghostscript:\n" +
    "  macOS:   brew install ghostscript\n" +
    "  Ubuntu:  sudo apt install -y ghostscript\n" +
    "  Windows: https://www.ghostscript.com/releases/gsdnld.html  (or: choco install ghostscript)",
  qpdf:
    "Install qpdf:\n" +
    "  macOS:   brew install qpdf\n" +
    "  Ubuntu:  sudo apt install -y qpdf\n" +
    "  Windows: choco install qpdf  (or: https://github.com/qpdf/qpdf/releases)",
};

const TOOLS_TO_PROBE: Array<{
  bin: string;
  name: string;
  hintKey: keyof typeof INSTALL_HINTS;
  usedBy: ToolStatus["usedBy"];
}> = [
  {
    bin: "gs",
    name: "Ghostscript",
    hintKey: "gs",
    usedBy: [
      { feature: "PDF /Creator metadata stamp", severity: "optional" },
      { feature: "PDF/X CMYK conversion (build --format pdfx)", severity: "required" },
      { feature: "validate: pdf.print.ink-coverage, asset.image-tac", severity: "optional" },
    ],
  },
  {
    bin: "qpdf",
    name: "qpdf",
    hintKey: "qpdf",
    usedBy: [
      { feature: "PDF/X annotation stripping (build --format pdfx)", severity: "required" },
      { feature: "validate: PDF/X OutputIntent + metadata checks", severity: "optional" },
    ],
  },
];

async function getVersion(bin: string, args: string[] = ["--version"]): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const p = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    p.stdout.on("data", (c) => { stdout += c.toString(); });
    p.stderr.on("data", (c) => { stderr += c.toString(); });
    p.on("error", () => resolve(undefined));
    p.on("exit", () => {
      const combined = (stdout || stderr).trim();
      const first = combined.split(/\r?\n/)[0]?.trim();
      resolve(first || undefined);
    });
    // Hard 2s ceiling — a broken binary that hangs shouldn't block the dialog.
    setTimeout(() => p.kill("SIGKILL"), 2000);
  });
}

let cachedLibVersion: string | undefined;
async function readLibVersion(): Promise<string> {
  if (cachedLibVersion) return cachedLibVersion;
  try {
    const { readFile } = await import("node:fs/promises");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // bun build emits the diagnostics code into a bundled chunk whose depth in
    // dist/ is not fixed (dist/index.js, dist/api/index.js, or dist/chunk-*.js),
    // so a hard-coded "../.." overshoots. Walk up from the running module and
    // return the version of the FIRST package.json named "@dimm-city/print-md".
    let dir = dirname(fileURLToPath(import.meta.url));
    for (let i = 0; i < 6; i++) {
      try {
        const pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf-8")) as {
          name?: string;
          version?: string;
        };
        if (pkg.name === "@dimm-city/print-md" && pkg.version) {
          cachedLibVersion = pkg.version;
          return cachedLibVersion;
        }
      } catch {
        // no package.json here (or unreadable) — keep walking up
      }
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
    cachedLibVersion = "unknown";
  } catch {
    cachedLibVersion = "unknown";
  }
  return cachedLibVersion;
}

/**
 * Probe every external tool the lib could spawn and return a structured
 * report. Safe to call repeatedly; the slowest path is ~200ms when every
 * tool is present (one `--version` per tool, in parallel).
 */
export async function getSystemDiagnostics(): Promise<SystemDiagnostics> {
  const libVersion = await readLibVersion();

  // Chromium gets its own special probe (uses the existing resolver, not just PATH).
  // NOTE: do NOT spawn the browser to read its version — on Windows `chrome.exe
  // --version` launches a visible browser window instead of printing+exiting,
  // which made opening the viewer's Help/About dialog pop a new Chrome instance.
  // The browser is a GUI app, so we report only its presence + path. (The viewer
  // surfaces its own bundled Chromium version separately via process.versions.)
  const chromiumPath = await resolveChromiumExecutable();
  const chromiumVersion = undefined;

  const chromium: ToolStatus = {
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

  const tools: ToolStatus[] = await Promise.all(
    TOOLS_TO_PROBE.map(async (t): Promise<ToolStatus> => {
      const [path, available] = await Promise.all([
        findTool(t.bin),
        isToolAvailable(t.bin),
      ]);
      const found = available || !!path;
      const version = found ? await getVersion(t.bin) : undefined;
      return {
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
    docsUrl: "https://github.com/dimm-city/print-md/blob/main/examples/print-md-user-guide/08-system-setup.md",
  };
}

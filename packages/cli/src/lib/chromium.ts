import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findTool } from "./tool-probe";
import { INSTALL_HINTS } from "./install-hints";

// A function, not a constant: the env overrides are read at call time.
const systemPaths = (): string[] => [
  // Explicit override always wins. CHROMIUM_PATH is THE documented variable
  // (User Guide ch. 7, docs/docker.md, the CLI's own error messages).
  process.env.CHROMIUM_PATH,
  // Deprecated alias, kept only because the user guide documented it while
  // puppeteer-core was the launcher. Nothing in this repo sets it; new setups
  // should use CHROMIUM_PATH.
  process.env.PUPPETEER_EXECUTABLE_PATH,
  // Linux
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  // macOS (Intel + Apple Silicon)
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/opt/homebrew/bin/chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
  // Windows — Chrome
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : undefined,
  // Windows — Microsoft Edge (the only Chromium-based browser pre-installed
  // on stock Windows, so users without Chrome installed shouldn't have to
  // download anything to render a PDF).
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Microsoft\\Edge\\Application\\msedge.exe`
    : undefined,
  // Windows — Brave
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\BraveSoftware\\Brave-Browser\\Application\\brave.exe`
    : undefined,
].filter(Boolean) as string[];

/**
 * Chromium-compatible binary names to probe on PATH if no fixed location hits.
 * Order is "most likely to be a Gutterpress-suitable Chromium" first.
 */
const PATH_CANDIDATES: string[] = [
  "google-chrome",
  "google-chrome-stable",
  "chromium",
  "chromium-browser",
  "chrome",
  // Windows .exe variants — where.exe accepts these explicitly
  "chrome.exe",
  "msedge",
  "msedge.exe",
  "brave",
  "brave-browser",
  "brave.exe",
  "vivaldi",
  "vivaldi-stable",
  "vivaldi.exe",
  "opera",
  "opera-stable",
  "opera.exe",
];

/**
 * Returns the path to a system Chrome/Chromium binary, or undefined if none found.
 *
 * Resolution order:
 *   1. CHROMIUM_PATH env var (PUPPETEER_EXECUTABLE_PATH is a deprecated alias)
 *   2. Hard-coded standard install paths (Chrome / Edge / Brave / Chromium
 *      on Linux, macOS, Windows)
 *   3. PATH probe via `which` / `where.exe` for common binary names
 *      (catches Scoop, Chocolatey, Homebrew, portable installs, and any
 *      Chromium variant the user added to PATH manually)
 *
 * This is the ONE resolver: the launcher (`engine/shared/cdp.ts`'s
 * `launchChromium`), the build preflight, the fingerprint and `doctor` all
 * use it, so the binary they report is the binary that runs.
 *
 * Prefer requireChromiumExecutable() for build paths that cannot continue
 * without it — it surfaces a multi-line install-instructions error.
 */
export async function resolveChromiumExecutable(): Promise<string | undefined> {
  // 1+2: fixed paths.
  for (const candidate of systemPaths()) {
    if (existsSync(candidate)) return candidate;
  }
  // 3: PATH probe.
  for (const candidate of PATH_CANDIDATES) {
    const found = await findTool(candidate);
    if (found) return found;
  }
  return undefined;
}

/**
 * Like resolveChromiumExecutable() but throws with actionable install instructions
 * when no Chrome/Chromium is found on the system.
 */
export async function requireChromiumExecutable(): Promise<string> {
  const found = await resolveChromiumExecutable();
  if (found) return found;

  throw new Error(
    [
      "No Chrome / Chromium / Edge binary found. Gutterpress needs a Chromium-based browser to render PDFs.",
      "",
      "Install one of:",
      INSTALL_HINTS.chromium.body,
      "",
      "Or point to an existing install:",
      "  CHROMIUM_PATH=/path/to/chrome gutterpress build ...",
      "",
      "The Gutterpress desktop app uses its own bundled browser for BOTH",
      // No doc path here on purpose — `docs/adr/0002` is not published in the
      // repo (the ADR lives in the gitignored `.reviews/`), so a user of the
      // shipped binary cannot open it.
      "PDF export and needs no separate install.",
      "This message is about the CLI, which does need one.",
    ].join("\n")
  );
}

/**
 * The name of the snap this browser executable launches, or undefined when it
 * is not a snap. A snap is confined: it gets a private `/tmp` and may read only
 * non-hidden files under the user's home (not `~/snap`, except its own
 * folder), so a page staged anywhere else renders unstyled (#501). Not
 * detected: Flatpak browsers.
 *
 * `/snap/bin/<name>` is a symlink to the `snap` launcher, so the name comes
 * from the path as given (`/snap/bin/<name>` or `/snap/<name>/...`), the real
 * path, or the target of Ubuntu's `/usr/bin/chromium-browser` shim (a small
 * script ending in `exec /snap/bin/<name>`). A bare launcher link falls back to
 * the link's own name.
 */
export function snapNameOf(executable: string): string | undefined {
  let real = executable;
  try {
    real = realpathSync(executable);
  } catch {
    // Unresolvable: judge by the path as given.
  }
  const fromPath = (p: string): string | undefined => {
    const m = /^\/snap\/(?:bin\/)?([^/]+)/.exec(p.replaceAll("\\", "/"));
    return m && m[1] !== "bin" ? m[1] : undefined;
  };
  const found = fromPath(executable) ?? fromPath(real) ?? snapWrapperTarget(real);
  if (found) return found;
  if (["snap", "snapd"].includes(path.basename(real))) return path.basename(executable);
  return undefined;
}

function snapWrapperTarget(file: string): string | undefined {
  try {
    if (statSync(file).size > 16 * 1024) return undefined;
    const text = readFileSync(file, "utf8");
    if (!text.startsWith("#!")) return undefined;
    return /\bexec\s+\/snap\/bin\/([\w.-]+)/.exec(text)?.[1];
  } catch {
    return undefined;
  }
}

/**
 * Can a confined (snap) browser read files in `dir`? Home access covers
 * everything under `$HOME` except hidden top-level entries and `~/snap`; the
 * snap's own `~/snap/<snapName>/` is readable.
 */
export function isSnapReadable(dir: string, home: string = os.homedir(), snapName?: string): boolean {
  const rel = path.relative(path.resolve(home), path.resolve(dir));
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return false;
  const [top, second] = rel.split(path.sep);
  if (top!.startsWith(".")) return false;
  if (top === "snap") return snapName !== undefined && second === snapName;
  return true;
}

/**
 * Where a build's scratch directory (the staged book.html, stylesheets and
 * fonts the browser reads) goes when the destination is not our own `dist/`:
 * the OS temp dir, or for a snap browser the snap's own data folder, which it
 * can always read and which never touches the book.
 */
export function chooseScratchParent(opts: {
  snapName?: string;
  tmpDir?: string;
  home?: string;
}): string {
  if (!opts.snapName) return opts.tmpDir ?? os.tmpdir();
  return path.join(opts.home ?? os.homedir(), "snap", opts.snapName, "common");
}

/** The warning for a snap browser that cannot read the build's scratch dir, or undefined when it can. */
export function snapUnreadableWarning(workDir: string, snapName: string | undefined, home?: string): string | undefined {
  if (!snapName || isSnapReadable(workDir, home, snapName)) return undefined;
  return (
    `The browser is a snap (${snapName}) and cannot read ${workDir}: the pages will render unstyled. ` +
    `Build a book folder under your home directory, or set CHROMIUM_PATH to a ` +
    `non-snap Chrome/Chromium (see docs/installing.md).`
  );
}

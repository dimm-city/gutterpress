import { existsSync } from "node:fs";
import { findTool } from "./tool-probe";
import { INSTALL_HINTS } from "./install-hints";

const SYSTEM_PATHS: string[] = [
  // CI / Docker env vars (checked first — explicit override always wins)
  process.env.CHROMIUM_PATH,
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
 *   1. CHROMIUM_PATH / PUPPETEER_EXECUTABLE_PATH env vars
 *   2. Hard-coded standard install paths (Chrome / Edge / Brave / Chromium
 *      on Linux, macOS, Windows)
 *   3. PATH probe via `which` / `where.exe` for common binary names
 *      (catches Scoop, Chocolatey, Homebrew, portable installs, and any
 *      Chromium variant the user added to PATH manually)
 *
 * Prefer requireChromiumExecutable() for build paths that cannot continue
 * without it — it surfaces a multi-line install-instructions error.
 */
export async function resolveChromiumExecutable(): Promise<string | undefined> {
  // 1+2: fixed paths.
  for (const candidate of SYSTEM_PATHS) {
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
      "The Gutterpress desktop app's Paged.js PDF export uses its own bundled",
      "browser and needs no separate install. --engine native PDF export (CLI",
      "or desktop) always drives a separate, external Chromium — see docs/adr/0002.",
    ].join("\n")
  );
}

import { existsSync } from "node:fs";

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
].filter(Boolean) as string[];

/**
 * Returns the path to a system Chrome/Chromium binary, or undefined if none found.
 * Prefer requireChromiumExecutable() for build paths that cannot continue without it.
 */
export function resolveChromiumExecutable(): string | undefined {
  for (const candidate of SYSTEM_PATHS) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

/**
 * Like resolveChromiumExecutable() but throws with actionable install instructions
 * when no Chrome/Chromium is found on the system.
 */
export function requireChromiumExecutable(): string {
  const found = resolveChromiumExecutable();
  if (found) return found;

  throw new Error(
    [
      "No Chrome / Chromium / Edge binary found. print-md needs a Chromium-based browser to render PDFs.",
      "",
      "Install one of:",
      "  macOS:   brew install --cask google-chrome",
      "  Ubuntu:  sudo apt install -y chromium-browser",
      "  Windows: https://www.google.com/chrome/   (or use Microsoft Edge — auto-detected if installed in the default location)",
      "",
      "Or point to an existing install:",
      "  CHROMIUM_PATH=/path/to/chrome print-md build ...",
    ].join("\n")
  );
}

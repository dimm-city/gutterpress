import { existsSync } from "node:fs";

/**
 * Resolve a usable Chromium executable.
 * Checks env var, common Linux/macOS paths. Returns undefined if none found.
 */
export function resolveChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.CHROMIUM_PATH,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter(Boolean) as string[];

  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return undefined;
}

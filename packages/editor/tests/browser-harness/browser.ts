import { existsSync } from "node:fs";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { chromium, type Browser } from "playwright-core";

/**
 * SFE-P1b Lane A — launches REAL Chromium via `playwright-core` (harness
 * requirement 3): "try default resolution first (PLAYWRIGHT_BROWSERS_PATH
 * is set), fall back to executablePath under /opt/pw-browsers ... never run
 * playwright install." `playwright-core` itself is not declared in
 * `packages/editor/package.json` — it is a root workspace devDependency
 * that resolves from `packages/editor` via bun's hoisting (verified live
 * against the exact installed 0.0.2-84 runtime environment before writing
 * this file), so no duplicate devDependency is added here (package.json
 * wiring note: "do NOT duplicate deps that hoist").
 *
 * The harness "must FAIL with a clear environment error if Chromium cannot
 * launch — never skip silently" (AP-20). `launchHarnessBrowser` throws,
 * carrying BOTH failure messages, when neither the default resolution nor
 * the `/opt/pw-browsers` fallback works; there is no code path that returns
 * successfully without a real, launched Chromium instance.
 */
export async function launchHarnessBrowser(): Promise<Browser> {
  let defaultLaunchError: unknown;
  try {
    return await chromium.launch({ headless: true });
  } catch (error) {
    defaultLaunchError = error;
  }

  const fallbackExecutable = findFallbackChromiumExecutable();
  if (!fallbackExecutable) {
    throw new Error(
      "browser harness: Chromium launch failed via default playwright-core resolution, " +
        "and no fallback executable was found under " +
        `${browsersBaseDir()} (never run "playwright install" to fix this — see this ` +
        "harness's own header comment). Default resolution error: " +
        describeError(defaultLaunchError),
    );
  }

  try {
    return await chromium.launch({ headless: true, executablePath: fallbackExecutable });
  } catch (fallbackError) {
    throw new Error(
      "browser harness: Chromium launch failed via BOTH default playwright-core resolution " +
        `AND the fallback executablePath (${fallbackExecutable}). ` +
        `Default resolution error: ${describeError(defaultLaunchError)} ` +
        `Fallback error: ${describeError(fallbackError)}`,
    );
  }
}

function browsersBaseDir(): string {
  return process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
}

/**
 * Finds a real Chromium executable under `PLAYWRIGHT_BROWSERS_PATH`
 * (default `/opt/pw-browsers`), the exact directory this run's Recorded
 * facts name. Checks the `chromium` convenience symlink first, then scans
 * for a versioned `chromium-<revision>` directory containing
 * `chrome-linux/chrome` — the shape actually installed there (verified
 * live) — so this does not hardcode one revision number that a future
 * browser-cache refresh would silently break.
 */
function findFallbackChromiumExecutable(): string | undefined {
  const base = browsersBaseDir();
  if (!existsSync(base)) return undefined;

  const symlinkCandidate = join(base, "chromium");
  if (existsSync(symlinkCandidate)) return symlinkCandidate;

  let entries: string[];
  try {
    entries = readdirSync(base);
  } catch {
    return undefined;
  }

  for (const entry of entries) {
    if (!entry.startsWith("chromium-")) continue;
    const candidate = join(base, entry, "chrome-linux", "chrome");
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

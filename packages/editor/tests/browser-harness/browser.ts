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
 * SFE-P1b repair (G-12/AP-20 — "a gate that exists but is never invoked is
 * the same as no gate at all"): a THIRD fallback tier below tries a fixed
 * list of system Chrome/Chromium install paths. This is what lets
 * `bun run test:browser` run in CI: GitHub's hosted `ubuntu-latest` runner
 * image ships Google Chrome preinstalled at `/usr/bin/google-chrome-stable`
 * (the same binary `.github/workflows/ci.yml`'s `test`/`desktop-test` jobs
 * already point Puppeteer at) — this sandbox's `/opt/pw-browsers` tier
 * covers local/dev-container runs where playwright-core's own download was
 * pre-seeded, and this third tier covers CI, where it is not. Still never
 * `playwright install` — every candidate here is either an existing env
 * override or a fixed path checked with `existsSync`, never a download.
 *
 * The harness "must FAIL with a clear environment error if Chromium cannot
 * launch — never skip silently" (AP-20). `launchHarnessBrowser` throws,
 * carrying every failure message, when none of the three tiers works;
 * there is no code path that returns successfully without a real, launched
 * Chromium instance.
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
        `no fallback executable was found under ${browsersBaseDir()}, and no system ` +
        `Chrome/Chromium was found among ${SYSTEM_CHROMIUM_PATHS.join(", ")} or the ` +
        'CHROMIUM_PATH/PUPPETEER_EXECUTABLE_PATH env vars (never run "playwright install" ' +
        "to fix this — see this harness's own header comment). Default resolution error: " +
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

/**
 * Fixed system Chrome/Chromium install locations, checked as the LAST
 * fallback tier (after `/opt/pw-browsers`) — Linux-only, matching the
 * `ubuntu-latest` GitHub Actions runner image this harness's CI invocation
 * runs on (see `.github/workflows/ci.yml`'s `test`/`desktop-test` jobs,
 * which already rely on `/usr/bin/google-chrome-stable` being present
 * there). Mirrors the Linux entries of `packages/cli/src/lib/chromium.ts`'s
 * `SYSTEM_PATHS` — duplicated rather than imported, since `packages/editor`
 * does not depend on `packages/cli` (D4) and this harness is test-only code.
 */
const SYSTEM_CHROMIUM_PATHS: readonly string[] = [
  "/usr/bin/google-chrome-stable",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
];

function browsersBaseDir(): string {
  return process.env["PLAYWRIGHT_BROWSERS_PATH"] ?? "/opt/pw-browsers";
}

/**
 * Finds a fallback Chromium executable, tried in order after playwright-
 * core's own default resolution fails:
 *
 *   1. `PLAYWRIGHT_BROWSERS_PATH` (default `/opt/pw-browsers`) — this run's
 *      Recorded facts name this directory; checks the `chromium`
 *      convenience symlink first, then scans for a versioned
 *      `chromium-<revision>` directory containing `chrome-linux/chrome` —
 *      the shape actually installed there (verified live) — so this does
 *      not hardcode one revision number that a future browser-cache
 *      refresh would silently break.
 *   2. `CHROMIUM_PATH` / `PUPPETEER_EXECUTABLE_PATH` env vars — an explicit
 *      override always wins when set, matching
 *      `packages/cli/src/lib/chromium.ts`'s own resolution order and the
 *      env var `.github/workflows/ci.yml`'s `test`/`desktop-test` jobs
 *      already populate for the same runner Chrome.
 *   3. `SYSTEM_CHROMIUM_PATHS` — fixed install locations, covering CI where
 *      neither of the above is set but the runner image ships Chrome
 *      preinstalled.
 */
function findFallbackChromiumExecutable(): string | undefined {
  const base = browsersBaseDir();
  if (existsSync(base)) {
    const symlinkCandidate = join(base, "chromium");
    if (existsSync(symlinkCandidate)) return symlinkCandidate;

    let entries: string[] = [];
    try {
      entries = readdirSync(base);
    } catch {
      entries = [];
    }

    for (const entry of entries) {
      if (!entry.startsWith("chromium-")) continue;
      const candidate = join(base, entry, "chrome-linux", "chrome");
      if (existsSync(candidate)) return candidate;
    }
  }

  const envOverride = process.env["CHROMIUM_PATH"] || process.env["PUPPETEER_EXECUTABLE_PATH"];
  if (envOverride && existsSync(envOverride)) return envOverride;

  for (const candidate of SYSTEM_CHROMIUM_PATHS) {
    if (existsSync(candidate)) return candidate;
  }

  return undefined;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

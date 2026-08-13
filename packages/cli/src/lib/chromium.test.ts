/**
 * ARCH finding #49: `chromium.ts` (Chromium discovery — the thing most likely
 * to fail on a non-technical author's machine) had no direct tests.
 *
 * These tests exercise the full discovery matrix — env-var override, the
 * fixed-path scan, and the PATH probe fallback — WITHOUT requiring a real
 * Chromium/Chrome/Edge/Brave install: `node:fs`'s `existsSync` and
 * `./tool-probe`'s `findTool` are `spyOn`-replaced (never `mock.module`,
 * which — per `build-runner.browser-lifecycle.test.ts` — leaks across the
 * whole shared test run) and always restored in `afterEach`.
 *
 * `SYSTEM_PATHS` is built ONCE at module-load time from `process.env`
 * (chromium.ts:5-39), so tests that vary `CHROMIUM_PATH` / `PUPPETEER_EXECUTABLE_PATH`
 * / `LOCALAPPDATA` must re-import a fresh module instance AFTER setting the
 * env var — a plain `import("./chromium")` would hit Bun's module cache and
 * silently reuse the first test's env snapshot. `freshChromium()` below
 * busts that cache with a per-call query string.
 */
import { test, expect, spyOn, afterEach, describe } from "bun:test";
import * as fs from "node:fs";
import * as toolProbe from "./tool-probe";
import { INSTALL_HINTS } from "./install-hints";

type ExistsSyncSpy = ReturnType<typeof spyOn<typeof fs, "existsSync">>;
type FindToolSpy = ReturnType<typeof spyOn<typeof toolProbe, "findTool">>;

let existsSyncSpy: ExistsSyncSpy | undefined;
let findToolSpy: FindToolSpy | undefined;

const ENV_KEYS = ["CHROMIUM_PATH", "PUPPETEER_EXECUTABLE_PATH", "LOCALAPPDATA"] as const;
const savedEnv: Record<(typeof ENV_KEYS)[number], string | undefined> = {
  CHROMIUM_PATH: undefined,
  PUPPETEER_EXECUTABLE_PATH: undefined,
  LOCALAPPDATA: undefined,
};

function snapshotEnv(): void {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
}

function restoreEnv(): void {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
}

let bust = 0;
/**
 * Re-import chromium.ts as a brand-new module instance so its module-load-time
 * `SYSTEM_PATHS` array picks up whatever `process.env` looks like right now.
 */
async function freshChromium(): Promise<typeof import("./chromium")> {
  bust += 1;
  return import(`./chromium.ts?bust=${bust}`);
}

/** Install existsSync/findTool spies that report "nothing exists" by default. */
function installSpies(opts?: {
  existsFor?: Set<string>;
  findToolResult?: (candidate: string) => string | undefined;
}): void {
  const existsFor = opts?.existsFor ?? new Set<string>();
  existsSyncSpy = spyOn(fs, "existsSync").mockImplementation(
    ((p: unknown) => existsFor.has(String(p))) as typeof fs.existsSync
  );
  findToolSpy = spyOn(toolProbe, "findTool").mockImplementation(
    (async (candidate: string) => opts?.findToolResult?.(candidate)) as typeof toolProbe.findTool
  );
}

afterEach(() => {
  existsSyncSpy?.mockRestore();
  findToolSpy?.mockRestore();
  existsSyncSpy = undefined;
  findToolSpy = undefined;
  restoreEnv();
});

describe("resolveChromiumExecutable — fixed-path probe", () => {
  test("returns undefined when nothing exists and nothing is on PATH", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies();
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBeUndefined();
  });

  test("finds a hard-coded Linux path via existsSync without touching PATH", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies({ existsFor: new Set(["/usr/bin/chromium-browser"]) });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/usr/bin/chromium-browser");
    expect(findToolSpy).not.toHaveBeenCalled();
  });

  test("fixed-path scan stops at the FIRST match in declared order", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    // Both exist — google-chrome is declared before chromium, so it must win.
    installSpies({ existsFor: new Set(["/usr/bin/google-chrome", "/usr/bin/chromium"]) });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/usr/bin/google-chrome");
  });

  test("LOCALAPPDATA-derived Windows paths only appear when LOCALAPPDATA is set", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    process.env.LOCALAPPDATA = "C:\\Users\\Author\\AppData\\Local";
    const expectedPath =
      "C:\\Users\\Author\\AppData\\Local\\Google\\Chrome\\Application\\chrome.exe";
    installSpies({ existsFor: new Set([expectedPath]) });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe(expectedPath);
  });

  test("without LOCALAPPDATA, existsSync is never probed with a literal 'undefined' path segment", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies();
    const { resolveChromiumExecutable } = await freshChromium();

    await resolveChromiumExecutable();

    const probedPaths = (existsSyncSpy!.mock.calls as unknown as [string][]).map(([p]) => p);
    expect(probedPaths.every((p) => !p.includes("undefined"))).toBe(true);
  });
});

describe("resolveChromiumExecutable — CHROMIUM_PATH / PUPPETEER_EXECUTABLE_PATH env vars", () => {
  test("CHROMIUM_PATH is checked and used when it exists on disk", async () => {
    snapshotEnv();
    process.env.CHROMIUM_PATH = "/opt/my-custom-chrome/chrome";
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    installSpies({ existsFor: new Set(["/opt/my-custom-chrome/chrome"]) });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/opt/my-custom-chrome/chrome");
  });

  test("PUPPETEER_EXECUTABLE_PATH is used when CHROMIUM_PATH is unset", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    process.env.PUPPETEER_EXECUTABLE_PATH = "/opt/puppeteer-chrome/chrome";
    installSpies({ existsFor: new Set(["/opt/puppeteer-chrome/chrome"]) });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/opt/puppeteer-chrome/chrome");
  });

  test("CHROMIUM_PATH wins over PUPPETEER_EXECUTABLE_PATH when both exist (explicit override always wins)", async () => {
    snapshotEnv();
    process.env.CHROMIUM_PATH = "/opt/chromium-path/chrome";
    process.env.PUPPETEER_EXECUTABLE_PATH = "/opt/puppeteer-path/chrome";
    installSpies({
      existsFor: new Set(["/opt/chromium-path/chrome", "/opt/puppeteer-path/chrome"]),
    });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/opt/chromium-path/chrome");
  });

  test("an env var pointing at a nonexistent path is skipped, falling through to the fixed-path scan", async () => {
    snapshotEnv();
    process.env.CHROMIUM_PATH = "/does/not/exist/chrome";
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    installSpies({ existsFor: new Set(["/usr/bin/chromium"]) });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/usr/bin/chromium");
  });
});

describe("resolveChromiumExecutable — PATH probe fallback", () => {
  test("falls through to the PATH probe when no fixed path matches", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies({
      findToolResult: (candidate) => (candidate === "chromium" ? "/snap/bin/chromium-on-path" : undefined),
    });
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBe("/snap/bin/chromium-on-path");
  });

  test("PATH probe tries candidates in the documented priority order and stops at the first hit", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies({
      findToolResult: (candidate) => (candidate === "chromium" ? "/found/via/path" : undefined),
    });
    const { resolveChromiumExecutable } = await freshChromium();

    await resolveChromiumExecutable();

    const calledWith = findToolSpy!.mock.calls.map((c) => c[0]);
    // google-chrome and google-chrome-stable are probed (and miss) before
    // chromium, which is where our fake PATH has a hit — probing stops there.
    expect(calledWith).toEqual(["google-chrome", "google-chrome-stable", "chromium"]);
  });

  test("returns undefined when the fixed-path scan AND the PATH probe both miss every candidate", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies();
    const { resolveChromiumExecutable } = await freshChromium();

    const result = await resolveChromiumExecutable();

    expect(result).toBeUndefined();
    // Every documented PATH candidate was tried, in order, before giving up.
    const calledWith = findToolSpy!.mock.calls.map((c) => c[0]);
    expect(calledWith).toEqual([
      "google-chrome",
      "google-chrome-stable",
      "chromium",
      "chromium-browser",
      "chrome",
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
    ]);
  });
});

describe("requireChromiumExecutable — error message quality", () => {
  test("returns the same path resolveChromiumExecutable would find, without throwing", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies({ existsFor: new Set(["/usr/bin/google-chrome-stable"]) });
    const { requireChromiumExecutable } = await freshChromium();

    await expect(requireChromiumExecutable()).resolves.toBe("/usr/bin/google-chrome-stable");
  });

  test("throws an actionable error when nothing is found anywhere", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies();
    const { requireChromiumExecutable } = await freshChromium();

    await expect(requireChromiumExecutable()).rejects.toThrow();
  });

  test("the thrown message names CHROMIUM_PATH as the override and includes the shared install hints", async () => {
    snapshotEnv();
    delete process.env.CHROMIUM_PATH;
    delete process.env.PUPPETEER_EXECUTABLE_PATH;
    delete process.env.LOCALAPPDATA;
    installSpies();
    const { requireChromiumExecutable } = await freshChromium();

    try {
      await requireChromiumExecutable();
      throw new Error("expected requireChromiumExecutable to throw");
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain("CHROMIUM_PATH=/path/to/chrome");
      // Sourced from the single INSTALL_HINTS registry (ARCH finding #15) —
      // not a hand-copied duplicate that could drift.
      expect(message).toContain(INSTALL_HINTS.chromium.body);
      // The desktop app renders with its own bundled Electron Chromium (it
      // injects `engineBrowser`; see packages/desktop/electron/engine-browser.ts),
      // so this message is about the CLI. It must say so rather than imply the
      // desktop needs a separate browser installation too.
      expect(message).toContain("uses its own bundled browser for");
      expect(message).toContain("PDF export");
      expect(message).toContain("This message is about the CLI");
      expect(message).not.toContain("always drives a separate, external Chromium");
      expect(message).not.toContain("undefined");
    }
  });
});

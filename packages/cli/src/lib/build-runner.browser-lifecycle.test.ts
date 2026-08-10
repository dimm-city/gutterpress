/**
 * Browser-lifecycle guard (finding #50): the pooled headless Chromium must be
 * closed on EVERY runBuild() exit — success or failure — once it has been
 * prewarmed, not only on the success tail. Before the fix, `closeBrowser()`
 * lived inside `finalizeBuild`, the success-only tail, so a quality-gate
 * failure (or any throw between the prewarm and the strategy's `finish()`)
 * leaked the prewarmed browser.
 *
 * `./chromium` and `./browser-pool` are spied on (not `mock.module`-replaced)
 * so this exercises runBuild's own try/finally wiring without launching a
 * real Chromium — the fix under test is control flow, not the browser pool's
 * internals (those are covered by browser-pool's own tests). `mock.module`
 * replaces the module in Bun's shared resolution registry for the whole test
 * run (every file, not just this one), which broke the OTHER build-runner
 * test files that need the real browser-pool/chromium — `spyOn` + explicit
 * `mockRestore()` in `afterEach` patches only the already-linked export
 * bindings and always leaves them exactly as found for the next test file.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as browserPool from "./browser-pool.ts";
import * as chromium from "./chromium.ts";
import type { EngineBrowser } from "./build-runner.ts";

// A fake native EngineBrowser (mirrors the desktop's engineBrowser seam) that
// never touches the pooled/external Chromium, so this exercises the "the
// pool was never used" path without launching a real engine build.
const fakeEngineBrowser = async (): Promise<EngineBrowser> => {
  throw new Error("engine build should not reach the browser in this test");
};

const { runBuild } = await import("./build-runner.ts");

let prewarmBrowserMock: ReturnType<typeof spyOn>;
let getBrowserMock: ReturnType<typeof spyOn>;
let closeBrowserMock: ReturnType<typeof spyOn>;
let resolveChromiumMock: ReturnType<typeof spyOn>;
let requireChromiumMock: ReturnType<typeof spyOn>;

function installMocks(): void {
  prewarmBrowserMock = spyOn(browserPool, "prewarmBrowser").mockImplementation(() => {});
  getBrowserMock = spyOn(browserPool, "getBrowser").mockImplementation(async () => {
    throw new Error("getBrowser should not be called in this test");
  });
  closeBrowserMock = spyOn(browserPool, "closeBrowser").mockImplementation(async () => {});
  // Report Chromium as present so runBuild's willPaginateInChromium branch
  // prewarms, without ever actually spawning a browser (getBrowser is only
  // reached by the real render path, which quality-gate failures never get
  // to in this test).
  resolveChromiumMock = spyOn(chromium, "resolveChromiumExecutable").mockImplementation(
    async () => "/fake/chromium"
  );
  requireChromiumMock = spyOn(chromium, "requireChromiumExecutable").mockImplementation(
    async () => "/fake/chromium"
  );
}

afterEach(() => {
  prewarmBrowserMock.mockRestore();
  getBrowserMock.mockRestore();
  closeBrowserMock.mockRestore();
  resolveChromiumMock.mockRestore();
  requireChromiumMock.mockRestore();
});

async function makeBrokenLintProject(): Promise<{ dir: string; outDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-browser-leak-in-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-browser-leak-out-"));
  await writeFile(
    join(dir, "manifest.yaml"),
    "title: Leak Test\nstyles:\n  - broken.css\n",
    "utf-8"
  );
  // Missing closing brace -> postcss CssSyntaxError -> lint severity "error"
  // -> runLint returns { ok: false } -> runQualityGates throws BuildError,
  // AFTER prewarmBrowser() has already fired.
  await writeFile(join(dir, "broken.css"), "body { color: red;\n", "utf-8");
  await writeFile(join(dir, "chapter-01.md"), "# Hello\n", "utf-8");
  return { dir, outDir };
}

test("runBuild closes the prewarmed browser when a quality gate throws before pagination", async () => {
  installMocks();
  const { dir, outDir } = await makeBrokenLintProject();
  try {
    await expect(
      runBuild({
        inputDir: dir,
        format: "pdf",
        outDir,
        skipLint: false,
        skipPreValidate: true,
        rawArgs: {},
      })
    ).rejects.toThrow(/CSS lint failed/);

    // The browser was prewarmed (this build would have paginated in
    // Chromium) — proving the failure happened AFTER the prewarm, not before
    // it (a before-prewarm failure wouldn't exercise the fix at all).
    expect(prewarmBrowserMock).toHaveBeenCalledTimes(1);
    // getBrowser (the real render/pagination step) was never reached — the
    // lint gate failed first.
    expect(getBrowserMock).not.toHaveBeenCalled();
    // And yet the pool was still closed: the try/finally around runBuild's
    // pipeline runs on the throw, not just on the old success-only tail.
    expect(closeBrowserMock).toHaveBeenCalledTimes(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("runBuild skips the pool entirely when an engineBrowser is injected (desktop's shape), yet still closes it exactly once", async () => {
  installMocks();
  const { dir, outDir } = await makeBrokenLintProject();
  try {
    // An injected engineBrowser (the desktop's Electron host) skips the
    // Chromium preflight AND the pool entirely — willPaginateInChromium is
    // false, so prewarmBrowser/getBrowser are never called. This proves the
    // finally's closeBrowser() call is unconditional (a safe no-op matching
    // the pool's own idempotent behavior).
    await expect(
      runBuild({
        inputDir: dir,
        format: "pdf",
        outDir,
        skipLint: false,
        skipPreValidate: true,
        engineBrowser: fakeEngineBrowser,
        rawArgs: {},
      })
    ).rejects.toThrow(/CSS lint failed/);

    expect(prewarmBrowserMock).not.toHaveBeenCalled();
    expect(getBrowserMock).not.toHaveBeenCalled();
    expect(closeBrowserMock).toHaveBeenCalledTimes(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("runBuild does NOT close the browser when keepBrowserAlive is set", async () => {
  installMocks();
  const { dir, outDir } = await makeBrokenLintProject();
  try {
    await expect(
      runBuild({
        inputDir: dir,
        format: "pdf",
        outDir,
        skipLint: false,
        skipPreValidate: true,
        keepBrowserAlive: true,
        rawArgs: {},
      })
    ).rejects.toThrow(/CSS lint failed/);

    expect(prewarmBrowserMock).toHaveBeenCalledTimes(1);
    expect(closeBrowserMock).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

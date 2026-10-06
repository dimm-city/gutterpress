/**
 * Browser-lifecycle guard: the engine browser `runBuild` starts
 * for a pdf build must be closed on EVERY exit — success or failure — not only
 * on the success tail. Before the fix, the close lived inside `finalizeBuild`,
 * the success-only tail, so a quality-gate failure (or any throw between the
 * launch and the strategy's `finish()`) leaked the pre-launched Chromium.
 *
 * `engine/shared/cdp.ts`'s `launchChromium` and `./chromium` are spied on
 * (not `mock.module`-replaced) so this exercises runBuild's own try/finally
 * wiring without launching a real Chromium — the fix under test is control
 * flow, not the launcher's internals. `mock.module` replaces the module in
 * Bun's shared resolution registry for the whole test run (every file, not
 * just this one), which broke the OTHER build-runner test files that need the
 * real launcher/resolver — `spyOn` + explicit `mockRestore()` in `afterEach`
 * patches only the already-linked export bindings and always leaves them
 * exactly as found for the next test file.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as cdp from "../engine/shared/cdp.ts";
import * as chromium from "./chromium.ts";
import type { EngineBrowser } from "./build-runner.ts";

const { runBuild } = await import("./build-runner.ts");

/** A fake engine Browser that counts closes and refuses to open a page. */
function fakeBrowser(): { browser: EngineBrowser; closes: () => number } {
  let closes = 0;
  const browser = {
    wsUrl: "test://fake",
    version: `Chrome/${cdp.REQUIRED_MILESTONE}.0.0.0`,
    milestone: cdp.REQUIRED_MILESTONE,
    newPage: async () => {
      throw new Error("engine build should not reach the browser in this test");
    },
    close: async () => {
      closes++;
    },
  } as unknown as EngineBrowser;
  return { browser, closes: () => closes };
}

let launchMock: ReturnType<typeof spyOn>;
let resolveChromiumMock: ReturnType<typeof spyOn>;
let requireChromiumMock: ReturnType<typeof spyOn>;

function installMocks(launched: EngineBrowser): void {
  launchMock = spyOn(cdp, "launchChromium").mockImplementation(async () => launched);
  // Report Chromium as present so preflight passes without ever spawning one.
  resolveChromiumMock = spyOn(chromium, "resolveChromiumExecutable").mockImplementation(
    async () => "/fake/chromium"
  );
  requireChromiumMock = spyOn(chromium, "requireChromiumExecutable").mockImplementation(
    async () => "/fake/chromium"
  );
}

afterEach(() => {
  launchMock.mockRestore();
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
  // Missing closing brace -> postcss CssSyntaxError -> source.stylelint
  // reports an error-severity finding -> pre-build validation fails ->
  // runQualityGates throws BuildError, AFTER the launch has already fired.
  await writeFile(join(dir, "broken.css"), "body { color: red;\n", "utf-8");
  await writeFile(join(dir, "chapter-01.md"), "# Hello\n", "utf-8");
  return { dir, outDir };
}

test("runBuild closes the pre-launched browser when a quality gate throws before pagination", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeBrokenLintProject();
  try {
    await expect(
      runBuild({
        inputDir: dir,
        format: "pdf",
        outDir,
        rawArgs: {},
      })
    ).rejects.toThrow(/Pre-build validation failed/);

    // The launch fired (this build would have paginated in Chromium) —
    // proving the failure happened AFTER it, not before (a before-launch
    // failure wouldn't exercise the fix at all).
    expect(launchMock).toHaveBeenCalledTimes(1);
    // And the browser was still closed, exactly once: the try/finally around
    // runBuild's pipeline runs on the throw, not just on the success tail.
    expect(launched.closes()).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("runBuild uses an injected engineBrowser (the desktop's shape) in the launcher's place, and still closes it exactly once", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const injected = fakeBrowser();
  let factoryCalls = 0;
  const { dir, outDir } = await makeBrokenLintProject();
  try {
    await expect(
      runBuild({
        inputDir: dir,
        format: "pdf",
        outDir,
        engineBrowser: async () => {
          factoryCalls++;
          return injected.browser;
        },
        rawArgs: {},
      })
    ).rejects.toThrow(/Pre-build validation failed/);

    // The host's factory replaces the launcher outright — one browser, one
    // owner, one close.
    expect(factoryCalls).toBe(1);
    expect(launchMock).not.toHaveBeenCalled();
    expect(injected.closes()).toBe(1);
    expect(launched.closes()).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

async function makeValidProject(prefix: string): Promise<{ dir: string; outDir: string }> {
  const dir = await mkdtemp(join(tmpdir(), `${prefix}-in-`));
  const outDir = await mkdtemp(join(tmpdir(), `${prefix}-out-`));
  await writeFile(join(dir, "manifest.yaml"), "title: Launch Test\n", "utf-8");
  await writeFile(join(dir, "chapter-01.md"), "# Hello\n", "utf-8");
  return { dir, outDir };
}

test("runBuild never launches a browser for an html build", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-browser-html");
  try {
    // An html build paginates in the reader's browser, not at build time, so
    // it must complete without touching Chromium.
    await runBuild({ inputDir: dir, format: "html", outDir, rawArgs: {} });
    expect(launchMock).not.toHaveBeenCalled();
    expect(launched.closes()).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a launch failure surfaces as a BuildError after the gates, and nothing is left to close", async () => {
  installMocks(fakeBrowser().browser);
  launchMock.mockImplementation(async () => {
    throw new Error("The Gutterpress engine requires Chromium 148+; found Chrome/120.0.0.0 at /fake/chromium.");
  });
  const { dir, outDir } = await makeValidProject("gutterpress-browser-launch");
  try {
    await expect(
      runBuild({ inputDir: dir, format: "pdf", outDir, rawArgs: {} })
    ).rejects.toThrow(/Could not launch a Chromium browser for the PDF build: .*requires Chromium 148\+/);
    expect(launchMock).toHaveBeenCalledTimes(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

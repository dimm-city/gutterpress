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
import { mkdtemp, readdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readdirSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import * as fingerprint from "./build-fingerprint.ts";
import { log } from "../utils/logger";
import * as cdp from "../engine/shared/cdp.ts";
import * as chromium from "./chromium.ts";
import * as engine from "./engine.ts";
import { PDFDocument } from "pdf-lib";
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

test("the browser is closed as soon as the PDF is made, before anything after it, and not closed twice", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-browser-early");
  let closesWhenPdfMade = -1;
  let closesAtNextStep = -1;
  const render = spyOn(engine, "buildNativePdf").mockImplementation(async (_html, outPdf) => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    await writeFile(outPdf, await doc.save());
    closesWhenPdfMade = launched.closes();
    return [];
  });
  // The next thing a plain PDF build does once the PDF exists: publish it.
  const realFingerprint = fingerprint.writeBuildFingerprint;
  const stamp = spyOn(fingerprint, "writeBuildFingerprint").mockImplementation(async (input) => {
    closesAtNextStep = launched.closes();
    return realFingerprint(input);
  });
  try {
    await runBuild({ inputDir: dir, format: "pdf", outDir, skipPreValidate: true, rawArgs: {} });
    expect(closesWhenPdfMade).toBe(0);
    expect(closesAtNextStep).toBe(1);
    // The `finally` backstop must not close it a second time.
    expect(launched.closes()).toBe(1);
  } finally {
    render.mockRestore();
    stamp.mockRestore();
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

/** A project build's work dir sits beside its output folder: `dist/.<slug>-build-<hex>`. */
const workDirsSync = (dir: string): string[] =>
  readdirSync(join(dir, "dist")).filter((n) => n.startsWith(".") && n.includes("-build-"));
const workDirs = async (dir: string): Promise<string[]> => workDirsSync(dir);

const settle = (ms = 400) => new Promise((r) => setTimeout(r, ms));

test("aborting the signal mid-render stops the build at once: CANCELED, browser closed once, no work dir left", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-browser-cancel");
  const ctl = new AbortController();
  // A render that never finishes, like a long book mid-pagination.
  const render = spyOn(engine, "buildNativePdf").mockImplementation(() => {
    setTimeout(() => ctl.abort(), 50);
    return new Promise(() => {});
  });
  try {
    const started = Date.now();
    const failure = await runBuild({ inputDir: dir, format: "pdf", skipPreValidate: true, signal: ctl.signal, rawArgs: {} })
      .then(() => undefined, (e: unknown) => e as { code?: string; exitCode?: number });
    expect(failure?.code).toBe("CANCELED");
    expect(failure?.exitCode).toBe(130);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(launched.closes()).toBe(1);
    expect(await workDirs(dir)).toEqual([]);
  } finally {
    render.mockRestore();
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
}, 15_000);

test("a signal that is already aborted never starts the render", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-browser-precancel");
  const render = spyOn(engine, "buildNativePdf");
  try {
    const failure = await runBuild({ inputDir: dir, format: "pdf", signal: AbortSignal.abort(), rawArgs: {} })
      .then(() => undefined, (e: unknown) => e as { code?: string });
    expect(failure?.code).toBe("CANCELED");
    expect(render).not.toHaveBeenCalled();
    expect(launchMock).not.toHaveBeenCalled();
  } finally {
    render.mockRestore();
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a cancel during the markdown render leaves no work dir, not even once the abandoned work would have finished", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-cancel-render");
  // Staging an image is what used to put the work dir back after the cancel.
  await writeFile(join(dir, "chapter-01.md"), "# Hello\n\n![pic](pic.png)\n", "utf-8");
  await writeFile(join(dir, "pic.png"), Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==", "base64"));
  const ctl = new AbortController();
  let existedAtAbort: string[] = [];
  // renderChaptersToFile has just written book.html; asset staging is next.
  const success = spyOn(log, "success").mockImplementation((message: string) => {
    if (message.startsWith("Wrote ") && !ctl.signal.aborted) {
      existedAtAbort = workDirsSync(dir);
      ctl.abort();
    }
  });
  try {
    const failure = await runBuild({ inputDir: dir, format: "pdf", skipPreValidate: true, signal: ctl.signal, rawArgs: {} })
      .then(() => undefined, (e: unknown) => e as { code?: string });
    expect(failure?.code).toBe("CANCELED");
    expect(existedAtAbort.length).toBe(1);
    // runBuild has settled: nothing may come back afterwards.
    expect(await workDirs(dir)).toEqual([]);
    await settle();
    expect(await workDirs(dir)).toEqual([]);
    expect(launched.closes()).toBe(1);
  } finally {
    success.mockRestore();
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a cancel after the PDF is made leaves the previous output exactly as it was", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-cancel-keep");
  const render = spyOn(engine, "buildNativePdf").mockImplementation(async (_html, outPdf) => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    await writeFile(outPdf, await doc.save());
    return [];
  });
  const ctl = new AbortController();
  try {
    await runBuild({ inputDir: dir, format: "pdf", skipPreValidate: true, rawArgs: {} });
    const before = (await readdir(join(dir, "dist"), { recursive: true })).sort();
    expect(before.some((n) => n.endsWith(".pdf"))).toBe(true);
    await writeFile(join(dir, "dist", "previous-marker.txt"), "keep me");
    const withMarker = (await readdir(join(dir, "dist"), { recursive: true })).sort();

    // The second build is stopped right after its PDF exists, before it publishes:
    // the browser is closed as soon as the PDF is made.
    const close = launched.browser.close.bind(launched.browser);
    launched.browser.close = async () => {
      await close();
      ctl.abort();
    };
    const failure = await runBuild({ inputDir: dir, format: "pdf", skipPreValidate: true, signal: ctl.signal, rawArgs: {} })
      .then(() => undefined, (e: unknown) => e as { code?: string });
    expect(failure?.code).toBe("CANCELED");
    await settle();
    expect((await readdir(join(dir, "dist"), { recursive: true })).sort()).toEqual(withMarker);
    expect(await workDirs(dir)).toEqual([]);
  } finally {
    render.mockRestore();
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("a cancel that arrives once publishing has begun does not undo it: the output is complete and the build succeeds", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-cancel-late");
  const render = spyOn(engine, "buildNativePdf").mockImplementation(async (_html, outPdf) => {
    const doc = await PDFDocument.create();
    doc.addPage([100, 100]);
    await writeFile(outPdf, await doc.save());
    return [];
  });
  const ctl = new AbortController();
  const realFingerprint = fingerprint.writeBuildFingerprint;
  // finalizeBuild is writing the fingerprint: the output is being published.
  const fp = spyOn(fingerprint, "writeBuildFingerprint").mockImplementation(async (input) => {
    ctl.abort();
    return realFingerprint(input);
  });
  try {
    const result = await runBuild({ inputDir: dir, format: "pdf", skipPreValidate: true, signal: ctl.signal, rawArgs: {} });
    expect(result).toBeDefined();
    const names = await readdir(join(dir, "dist", "launch-test"));
    expect(names.some((n) => n.endsWith(".pdf"))).toBe(true);
    expect(names).toContain("build-fingerprint.json");
    expect(await workDirs(dir)).toEqual([]);
  } finally {
    fp.mockRestore();
    render.mockRestore();
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("an abort during preflight is a CANCELED BuildError, not a raw AbortError, and launches nothing", async () => {
  const launched = fakeBrowser();
  installMocks(launched.browser);
  const { dir, outDir } = await makeValidProject("gutterpress-cancel-preflight");
  const ctl = new AbortController();
  // Preflight probes for Chromium: the abort lands there, after runBuild's first check.
  resolveChromiumMock.mockImplementation(async () => {
    ctl.abort();
    return "/fake/chromium";
  });
  try {
    const failure = await runBuild({ inputDir: dir, format: "pdf", signal: ctl.signal, rawArgs: {} })
      .then(() => undefined, (e: unknown) => e as Error & { code?: string; exitCode?: number });
    expect(failure?.name).toBe("BuildError");
    expect(failure?.code).toBe("CANCELED");
    expect(failure?.exitCode).toBe(130);
    expect(launchMock).not.toHaveBeenCalled();
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

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
import type { PdfRenderInput } from "./pagination.ts";
import * as browserPool from "./browser-pool.ts";
import * as chromium from "./chromium.ts";

// A minimal but structurally valid PDF (mirrors build-runner.staging.test.ts)
// so pdf-lib's /Creator stamp loads it cleanly.
const MINIMAL_PDF =
  "%PDF-1.4\n" +
  "1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n" +
  "2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n" +
  "3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\n" +
  "xref\n0 4\n0000000000 65535 f \n0000000009 00000 n \n" +
  "0000000052 00000 n \n0000000101 00000 n \n" +
  "trailer<</Size 4/Root 1 0 R>>\nstartxref\n170\n%%EOF\n";

const fakeRenderer = async ({ outPdf }: PdfRenderInput): Promise<void> => {
  await writeFile(outPdf, MINIMAL_PDF, "latin1");
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

test("runBuild closes the browser exactly once on a successful build, even when the pool was never used", async () => {
  installMocks();
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-browser-ok-in-"));
  const outDir = await mkdtemp(join(tmpdir(), "gutterpress-browser-ok-out-"));
  try {
    await writeFile(join(dir, "manifest.yaml"), "title: Browser Lifecycle\n", "utf-8");
    await writeFile(join(dir, "chapter-01.md"), "# Hello\n", "utf-8");

    const result = await runBuild({
      inputDir: dir,
      format: "pdf",
      outDir,
      skipLint: true,
      skipPreValidate: true,
      // An injected renderer skips the Chromium preflight AND the pool
      // entirely (renderHtmlToPdf calls it directly) — willPaginateInChromium
      // is false, so prewarmBrowser/getBrowser are never called. This proves
      // the finally's closeBrowser() call is unconditional (a safe no-op
      // matching the pool's own idempotent behavior), exactly like the old
      // success-path call in finalizeBuild was — just now running from one
      // structural close point instead of a side effect on the success tail.
      pdfRenderer: fakeRenderer,
      rawArgs: {},
    });

    expect(result.pdfPath).not.toBeNull();
    expect(prewarmBrowserMock).not.toHaveBeenCalled();
    expect(getBrowserMock).not.toHaveBeenCalled();
    expect(closeBrowserMock).toHaveBeenCalledTimes(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
    await rm(outDir, { recursive: true, force: true });
  }
});

test("runBuild prewarms the pool for a native build even with an injected pdfRenderer", async () => {
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
        // The desktop's shape: it always injects a renderer, but a native
        // build ignores it and paginates in the pooled Chromium
        // (engine.ts's buildNativePdf -> browser-pool's getBrowser), so the
        // prewarm must not be suppressed by the injected renderer.
        engine: "native",
        pdfRenderer: fakeRenderer,
        rawArgs: {},
      })
    ).rejects.toThrow(/CSS lint failed/);

    expect(prewarmBrowserMock).toHaveBeenCalledTimes(1);
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

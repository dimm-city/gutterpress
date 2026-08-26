/**
 * In CI, a missing external binary must FAIL — never silently skip.
 *
 * 32 test files in this package gate themselves on `resolveChromiumExecutable()`
 * or `resolveRasterizer()` and fall back to `test.skip` when one is absent. That
 * is right on a contributor's laptop, which may have neither. It is wrong in CI,
 * where the same fallback turns a degraded environment into a green build that
 * has quietly stopped asserting anything.
 *
 * This repo has been bitten by exactly that shape twice:
 *
 *   - `build-runner.orchestration.test.ts` skipped 12 assertions on EVERY CI run
 *     for months, because its gate's premise was false. The suite reported green
 *     the whole time (#159).
 *   - `page-background-chromium-bug.canary.test.ts` is the executable removal
 *     trigger for the `@page` background workaround — the one thing that goes red
 *     the day Chromium fixes the bug so we delete the shim instead of entrenching
 *     it. It self-skips on a missing Chromium *or* Ghostscript. A skipped removal
 *     trigger is indistinguishable, from CI's output, from a passing one.
 *
 * qpdf is the same shape: `pdfx-markers.integration.test.ts` AND
 * `pdfx-metadata.integration.test.ts` both gate on `findTool("qpdf")` and
 * self-skip when it's absent, so CI installing qpdf is the only thing
 * standing between "the PDF/X success paths are exercised against real qpdf
 * output" and "they silently never run again."
 *
 * One assertion here protects all 32 files at once, which is why this is not
 * repeated in each of them.
 */
import { describe, expect, test } from "bun:test";
import { resolveChromiumExecutable } from "../lib/chromium.ts";
import { findTool } from "../lib/tool-probe.ts";
import { resolveRasterizer } from "./testkit.ts";

// GitHub Actions, and most other CI, set CI=true. Locally this is unset and the
// whole suite is skipped — a laptop without Ghostscript is not a broken build.
const inCi = process.env.CI === "true" || process.env.CI === "1";
const ciOnly = inCi ? describe : describe.skip;

ciOnly("CI environment preconditions", () => {
  test("Chromium resolves — without it, every print/raster suite silently skips", async () => {
    const chromium = await resolveChromiumExecutable();
    expect(
      chromium,
      "No Chromium resolved in CI. Every suite gated on resolveChromiumExecutable() " +
        "has stopped asserting, including the @page-background removal-trigger canary, " +
        "and the build is green anyway. Fix the runner's Chrome install or " +
        "PUPPETEER_EXECUTABLE_PATH — do not silence this test.",
    ).toBeTruthy();
  });

  test("Ghostscript resolves — without it, every PDF-raster suite silently skips", async () => {
    const rasterizer = await resolveRasterizer();
    expect(
      rasterizer,
      "No Ghostscript resolved in CI. Every suite that rasterises a PDF to compare " +
        "pixels has stopped asserting, including the @page-background removal-trigger " +
        "canary, and the build is green anyway. Fix the runner's Ghostscript install — " +
        "do not silence this test.",
    ).toBeTruthy();
  });

  test("qpdf resolves — without it, the PDF/X success-path suites silently skip", async () => {
    const qpdf = await findTool("qpdf");
    expect(
      qpdf,
      "No qpdf resolved in CI. pdfx-markers.integration.test.ts's and " +
        "pdfx-metadata.integration.test.ts's real-qpdf success-path coverage for " +
        "pdf.print.pdfx-markers and pdf.print.pdfx-metadata has stopped asserting, " +
        "and the build is green anyway. Fix the runner's qpdf install — do not " +
        "silence this test.",
    ).toBeTruthy();
  });
});

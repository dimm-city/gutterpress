/**
 * `--engine native` — thin bridge from `packages/cli`'s PDF build to the
 * Gutterpress engine at `src/engine/` (promoted 2026-08-06 from the
 * `spike/folio` integration spike — see `spike/folio/MIGRATION.md` "Step 3
 * — integration spike results" for the blast-radius findings this module
 * resolves: the engine is now an ordinary in-package module, not a relative
 * cross-directory import out of a non-workspace directory, and it ships in
 * both the source checkout and the compiled binary).
 *
 * Deliberately bypasses `./pagination.ts`'s `renderHtmlToPdf` / `PdfRenderer`
 * seam: that function's HTTP staging (`paginationOverlays`) always injects
 * the Paged.js polyfill into the served HTML, even when a custom renderer is
 * given, and even with no polyfill-tag marker present — `pagedjs.ts`'s
 * `patchHtmlStringForPagedjs` falls back to injecting it before `</head>`
 * regardless (deliberate, per finding #22: a doc that merely CONTAINS the
 * word "pagedjs" must not silently skip loading it). Measured: driving the
 * engine's own Chromium at a Paged.js-staged URL let Paged.js re-paginate the
 * DOM out from under the engine's fragmentation mid-navigation — output
 * dropped from 61pp / 9,699 words to 6pp / 754 words, no error thrown. So this
 * module calls the engine directly on the plain `book.html` FILE (no HTTP
 * staging, no overlay, no polyfill of any kind) instead of going through
 * `renderHtmlToPdf`.
 *
 * The engine drives its OWN Chromium via `src/engine/shared/cdp.ts`'s raw-CDP
 * `launchChromium()`, entirely separate from `./browser-pool.ts` (puppeteer-
 * core, connection pooling, warm-reuse across preview rebuilds) — a real
 * finding from the integration spike, still true after the promotion and not
 * addressed by it. `build-runner.ts` skips its own Chromium preflight/prewarm
 * for `engine: "native"` builds for the same reason.
 */
import { writeFile } from "node:fs/promises";
import { build } from "../engine/compiler/build.ts";
import { BuildError } from "./build-error.ts";

/**
 * Render `htmlFile` to `outPdf` via the Gutterpress engine. No HTTP staging,
 * no Paged.js polyfill, no `browser-pool.ts` — the engine launches and closes
 * its own Chromium process per call (see module doc comment for why).
 */
export async function buildNativePdf(htmlFile: string, outPdf: string): Promise<void> {
  let result: Awaited<ReturnType<typeof build>>;
  try {
    result = await build({ input: htmlFile });
  } catch (err) {
    throw new BuildError(
      `--engine native failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  await writeFile(outPdf, result.bytes);
}

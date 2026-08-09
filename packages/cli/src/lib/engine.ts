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
 * The engine used to drive its OWN Chromium via `src/engine/shared/cdp.ts`'s
 * raw-CDP `launchChromium()` per build, entirely separate from
 * `./browser-pool.ts` (puppeteer-core, connection pooling, warm-reuse across
 * preview rebuilds) — measured ~2x wall clock vs the Paged.js path (7.1s vs
 * 3.6s mean on the user guide) because every native build paid a full cold
 * Chromium launch. It now reuses the SAME pooled/pre-warmed browser: this
 * module gets `browser-pool.ts`'s puppeteer `Browser`, hands its
 * `wsEndpoint()` to `cdp.ts`'s `connectChromium()` (the mirror image of
 * `launchChromium()` — same version pin, same `Session` machinery, but it
 * attaches instead of spawning), and passes the resulting engine `Browser` in
 * as `build()`'s `opts.browser`. `build()` already had this seam (`opts.browser`
 * / `ownsBrowser`, used by the dev server) — it never closes a browser it did
 * not launch, so lifecycle stays owned by `browser-pool.ts`'s
 * `closeBrowser()`, same as the Paged.js path. `build-runner.ts` pre-warms the
 * pool for `engine: "native"` builds the same way it does for Paged.js.
 */
import { writeFile } from "node:fs/promises";
import { build, type BuildDiagnostic } from "../engine/compiler/build.ts";
import { connectChromium } from "../engine/shared/cdp.ts";
import { getBrowser } from "./browser-pool.ts";
import { RENDER_TIMEOUT_MS } from "./pagination.ts";
import { BuildError } from "./build-error.ts";

/** The subset of `BuildOptions` that has a manifest/CLI source today (B.12). */
export interface NativePdfOptions {
  title?: string;
  author?: string;
  signature?: number;
}

/**
 * Render `htmlFile` to `outPdf` via the Gutterpress engine. No HTTP staging,
 * no Paged.js polyfill — but the pooled/pre-warmed Chromium IS reused (see
 * module doc comment): this module never launches or closes a browser itself.
 *
 * Returns the build's author-facing diagnostics so the caller can surface
 * them (the desktop Problems panel, the CLI's own output). Dropping them here
 * is what made the engine's print-quality audits invisible in every real
 * build path — they only ever reached the engine dev CLI.
 */
export async function buildNativePdf(
  htmlFile: string,
  outPdf: string,
  options: NativePdfOptions = {},
): Promise<BuildDiagnostic[]> {
  let result: Awaited<ReturnType<typeof build>>;
  try {
    const pooled = await getBrowser(RENDER_TIMEOUT_MS);
    const engineBrowser = await connectChromium(pooled.wsEndpoint());
    try {
      result = await build({ input: htmlFile, browser: engineBrowser, ...options });
    } finally {
      // Drops OUR websocket only (connectChromium's close never touches the
      // pooled browser). Without this, every build in a long-lived process
      // (preview server, desktop) leaks one CDP connection.
      await engineBrowser.close();
    }
  } catch (err) {
    throw new BuildError(
      `--engine native failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
  await writeFile(outPdf, result.bytes);
  return result.diagnostics;
}

/**
 * `--engine native` — thin bridge from `packages/cli`'s PDF build to the
 * Gutterpress engine at `src/engine/` (promoted 2026-08-06 from the
 * `folio` integration spike — see `docs/engine-history/MIGRATION.md` "Step 3
 * — integration spike results" for the blast-radius findings this module
 * resolves: the engine is now an ordinary in-package module, not a relative
 * cross-directory import out of a non-workspace directory, and it ships in
 * both the source checkout and the compiled binary).
 *
 * This module calls the engine directly on the plain `book.html` FILE — no
 * HTTP staging, no overlay, no pagination polyfill of any kind (the Paged.js
 * pipeline this used to deliberately bypass was deleted along with Paged.js
 * itself — native-only-migration-plan.md Phase 6).
 *
 * The engine used to drive its OWN Chromium via `src/engine/shared/cdp.ts`'s
 * raw-CDP `launchChromium()` per build, entirely separate from
 * `./browser-pool.ts` (puppeteer-core, connection pooling, warm-reuse across
 * preview rebuilds) — measured ~2x wall clock vs reusing the pool (7.1s vs
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
import {
  connectChromium,
  assertMilestone,
  type Browser as EngineBrowser,
} from "../engine/shared/cdp.ts";
import { getBrowser, RENDER_TIMEOUT_MS } from "./browser-pool.ts";
import { BuildError } from "./build-error.ts";

export type { EngineBrowser };

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
 *
 * `getEngineBrowser` is an optional injected factory, mirroring the
 * `pdfRenderer` seam `build-runner.ts` already has for the Paged.js leg: when
 * omitted (the CLI's default), this module gets `browser-pool.ts`'s pooled
 * puppeteer browser and attaches `cdp.ts`'s `connectChromium()` to it, same as
 * always. When supplied (the desktop, over its own Electron `BrowserWindow` —
 * see `packages/desktop/electron`'s engine-browser module), that browser is
 * used directly instead — no pooled/external Chromium involved at all. Either
 * way this function owns closing whatever browser it ends up with: the pooled
 * path because `connectChromium`'s close only drops OUR websocket (never the
 * pool), and the injected path because the desktop hands over a browser built
 * fresh for exactly this one build (`newPage()` -> one window per build), so
 * nothing else is going to close it.
 */
export async function buildNativePdf(
  htmlFile: string,
  outPdf: string,
  options: NativePdfOptions = {},
  getEngineBrowser?: () => Promise<EngineBrowser>,
): Promise<BuildDiagnostic[]> {
  let result: Awaited<ReturnType<typeof build>>;
  try {
    const engineBrowser = getEngineBrowser
      ? await getEngineBrowser()
      : await connectChromium((await getBrowser(RENDER_TIMEOUT_MS)).wsEndpoint());
    // The pooled path gets its milestone floor enforced inside
    // `connectChromium`; an INJECTED browser never goes through it, so the
    // floor would otherwise be unenforced on exactly the host that supplies
    // its own Chromium (the desktop). Same assertion, same message — the
    // rule belongs to the Browser contract, not to how it was obtained.
    if (getEngineBrowser) {
      try {
        assertMilestone(engineBrowser.version, "(host-supplied browser)");
      } catch (e) {
        await engineBrowser.close();
        throw e;
      }
    }
    try {
      result = await build({ input: htmlFile, browser: engineBrowser, ...options });
    } finally {
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

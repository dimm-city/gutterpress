/**
 * SECTION D SPIKE — NOT a production seam.
 *
 * Bridges `packages/cli`'s PDF build to the Folio compiler living at
 * `spike/folio/src/compiler/build.ts`. This is a relative cross-directory
 * import out of a path that is NOT a Bun workspace member (see root
 * `package.json`'s `workspaces` — only `packages/*`) and is NOT published.
 * It works from a source checkout (`bun packages/cli/src/cli.ts`) but CANNOT
 * be part of the `bun build --compile` binary or the desktop app: neither
 * ships `spike/` in its artifact, and `spike/folio` has its own CDP/Chromium
 * launcher (`shared/cdp.ts`) entirely separate from `browser-pool.ts`.
 *
 * Deliberately bypasses `./pagination.ts`'s `renderHtmlToPdf` / `PdfRenderer`
 * seam: that function's HTTP staging (`paginationOverlays`) always injects
 * the Paged.js polyfill into the served HTML, even when a custom renderer is
 * given, and even with no polyfill-tag marker present — `pagedjs.ts`'s
 * `patchHtmlStringForPagedjs` falls back to injecting it before `</head>`
 * regardless (deliberate, per finding #22: a doc that merely CONTAINS the
 * word "pagedjs" must not silently skip loading it). Measured: driving
 * Folio's own Chromium at a Paged.js-staged URL let Paged.js re-paginate the
 * DOM out from under Folio's fragmentation mid-navigation — output dropped
 * from 61pp / 9,699 words to 6pp / 754 words, no error thrown. So this
 * module calls Folio directly on the plain `book.html` FILE (no HTTP
 * staging, no overlay, no polyfill of any kind) instead of going through
 * `renderHtmlToPdf`. A real (non-spike) integration would need this same
 * split formalized, not patched over — see MIGRATION.md "Step 3 —
 * integration spike results".
 */
import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { BuildError } from "./build-error.ts";

// Relative import out of the workspace — see module doc comment above.
const FOLIO_BUILD_PATH = path.resolve(
  import.meta.dirname,
  "../../../../spike/folio/src/compiler/build.ts"
);

/**
 * Render `htmlFile` to `outPdf` via the Folio compiler. No HTTP staging, no
 * Paged.js polyfill, no `browser-pool.ts` — Folio launches and closes its
 * own Chromium process per call (see module doc comment for why).
 */
export async function buildFolioPdf(htmlFile: string, outPdf: string): Promise<void> {
  if (!existsSync(FOLIO_BUILD_PATH)) {
    throw new BuildError(
      `--engine folio is a spike-only flag: it needs the Folio compiler at ${FOLIO_BUILD_PATH}, ` +
        `which only exists in a source checkout of the gutterpress repo. ` +
        `It is not available in the compiled binary or an installed package.`
    );
  }
  // Deliberately untyped: a `typeof import("../../../../spike/folio/...")`
  // cast (tried first) pulls spike/folio's ENTIRE module graph into
  // packages/cli's `tsc --noEmit` program, which then fails under
  // packages/cli's stricter tsconfig (spike/folio's own tsconfig is looser —
  // e.g. no `noUncheckedIndexedAccess`). That mismatch is itself a Step 3
  // finding — see MIGRATION.md. `any` avoids it but gives up type safety
  // across the boundary entirely, which a real integration could not accept.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mod: any = await import(FOLIO_BUILD_PATH);
  const result = await mod.build({ input: htmlFile });
  await writeFile(outPdf, result.bytes);
}

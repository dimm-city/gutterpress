# Migration: the native engine is now the default (2026-08-09)

> [!IMPORTANT]
> **Overtaken by events, 2026-08-10 — there is no longer a second engine.**
> This guide was written for the one-day window in which native became the
> *default* and Paged.js remained *selectable*. Phase 6 of
> [`docs/native-only-migration-plan.md`](../native-only-migration-plan.md)
> deleted Paged.js the next day, so in 0.10.0 the native engine is the **only**
> engine. `engine: "paged"`, `engineStyles.paged`, and `--engine paged` are
> still *parsed* — an old `manifest.yaml` will not hard-fail — but they are
> ignored: the build emits one deprecation warning and paginates natively
> regardless. They are scheduled for removal one release after 0.10.0.
>
> The reason to read on is the **[known author-visible
> differences](#known-author-visible-differences)** below: if you are upgrading
> a book from 0.8.x, that list is what your pages will do differently, and
> there is no `engine: paged` escape hatch from any of it.

Starting with this release, a book with **no `engine:` key at all** builds and
previews with the **native engine**, not Paged.js.

If your `manifest.yaml` doesn't set `engine:`, your next build will look
different. Read on before you build.

## What changed

| | Before this release | 0.10.0 |
|---|---|---|
| No `engine:` key | Paged.js | **Native** |
| `engine: "native"` | Native | Native (unchanged) |
| `engine: "paged"` | Paged.js | **Native**, plus a one-line deprecation warning |
| `--engine paged` | Paged.js for that run | **Native**, plus the same warning |

**`--format html` changed too.** The engine choice used to be baked into the
exported `book.html`: the paged leg shipped the Paged.js polyfill `<script>`
and its runtime stylesheet, the native leg shipped neither (the Gutterpress
engine never loads a client-side polyfill). Measured at the time on a book with
no `engine:` key, the exported `book.html` went from 329 `paged`-matching
occurrences to 4. Since the Phase 6 deletion no Paged.js polyfill ships under
any setting at all. If you post-process or self-host `book.html` and depended
on the polyfill being present, that dependency has to go: the export now ships
Gutterpress's own viewer bundle instead (`engine/gutterpress-viewer.js`, one
`<script>` tag injected before `</head>`), and the browser paginates with that
on load.

## There is no switching back

`engine: paged` no longer selects anything — see the banner at the top of this
file. Delete the key from `manifest.yaml` (and any `engineStyles.paged` list)
to silence the deprecation warning; the entries in a `engineStyles.paged` list
are not applied, so anything a book still needs from them belongs in `styles`
or `engineStyles.native`.

## Known author-visible differences

These are **deliberate, spec-based divergences**, not bugs — Chromium's
native print pagination is the CSS standards baseline; Paged.js was a
polyfill that didn't always match the spec. The full field-notes list, with
the reasoning and fixes, is `docs/native-engine-styling-guide.md`; this is the
short version. (The measured evidence behind each divergence was collected in
`docs/native-engine-acceptance-gate.md`, which was deleted after the migration
completed; the surviving measurements are in
[`docs/engine-history/DIFFERENCES.md`](../engine-history/DIFFERENCES.md) and
[`COMPARISON.md`](../engine-history/COMPARISON.md).)

- **Margin boxes cannot `transform: rotate()` or `box-shadow`, and cannot
  read `counter(page)`.** Rotated or shadowed chrome in a page margin (a
  corner sticker, a drop-shadowed folio chip) must be flattened to a
  square, unshadowed version. The CSS linter warns when it sees one of
  these inside a margin box.
- **`counter-reset: page` does not work natively.** Page numbers are
  computed and injected by the engine itself (`shared/synthesis.ts`), not
  read from a CSS counter you reset. If your book relied on a
  `counter-reset: page N` trick to start numbering partway through, it
  needs a different approach — and if that trick was already silently
  broken under Paged.js, native won't "fix" it either; check your actual
  printed folios.
- **Standalone block images default to `width: fit-content` (bounded,
  non-upscaling), not `width: auto` or `width: 100%`.** A large plate
  scales down to fit its content box; a small icon is left at its natural
  size. If you previously worked around Paged.js by setting an explicit
  pixel `width` on every image, you can usually remove it — but any image
  still sized with `width: auto` should get an explicit `width` (native's
  whole-document shrink-to-fit is driven by an image's *intrinsic* pixel
  width when nothing else bounds it; `max-width: 100%` alone does not stop
  this).
- **Full-bleed art bleeds on the native engine too (fixed 2026-08-09).**
  Core's full-bleed rule carries `page: gp-full-bleed` plus a core-owned
  `@page gp-full-bleed { margin-left: 0; margin-right: 0; }`, alongside a
  `--pagedjs-margin-*` out-dent that was kept for the Paged.js leg at the
  time. Native honours the named page (content box = sheet, so nothing has to
  out-dent — no shrink-to-fit trigger); Paged.js ignored the named page and
  kept using the out-dent, so its output was unchanged.

  **Where this lives now (0.10.0).** The class is `.gp-bleed` — the old
  `.full-bleed` name was removed with the rest of the pre-`gp-*` vocabulary
  (see [`2026-08-gp-image-classes.md`](./2026-08-gp-image-classes.md)) — and
  its rule, with the `@page gp-full-bleed` it needs, lives in
  `gutterpress-css.ts`'s `GUTTERPRESS_CSS`. The `--pagedjs-margin-*` out-dent
  was deleted along with Paged.js. `markdown-it-paged.js` no longer exists
  either: it was absorbed as `markers.js` and `PAGED_CSS` was renamed
  `MARKER_CSS` (see [`2026-08-gp-marker-classes.md`](./2026-08-gp-marker-classes.md)).
  Read the `.full-bleed`/`PAGED_CSS` names below as `.gp-bleed`/`MARKER_CSS`.

  **`MARKER_CSS` also zeroes the body margin now (2026-08-09 review pass),
  and that part is not full-bleed-specific.** The named page alone was
  not enough: `width: 100%` resolves against the BODY box, and the UA
  default `body { margin: 8px }` survives native print (Paged.js's polisher
  drops it), so on a book with no body reset of its own the art stopped 8px
  short of each edge. MEASURED at 300dpi on a real `--engine native` build,
  6×4in sheet, 0.75in margins, no author body rule: ink on the bleed page
  spanned **0.080–5.917in** before, **0.000–6.000in** after. The same reset
  also removes an 8px-per-side inset that native was applying to EVERY page
  of such a book relative to the paged leg (the non-bleed page's text run
  moved from 0.840–2.920in to 0.757–2.837in, exactly matching paged).
  `MARKER_CSS` is injected before author CSS (`assemble.ts`), so a book that
  wants a body margin still just declares one. Page counts re-measured
  after the reset: `/tmp/fbtest/book` 2pp, field-guide 34pp, design-guide
  53pp — all unchanged; the Paged.js leg was unchanged too (it already had
  no body margin). Regression-tested in
  `packages/cli/src/lib/markdown/marker-css-full-bleed.test.ts`.

  If your book already
  had the workaround below in its own CSS, it's now redundant (harmless —
  same values) and can be removed:

  ```css
  /* no longer needed — core does this now */
  .gp-bleed { page: gp-full-bleed; }
  @page gp-full-bleed { margin-left: 0; margin-right: 0; }
  ```

  **This can change your page count.** Turning on true bleed for an image
  that does not already fill its page forces the CSS-spec-mandated break
  AFTER the image too (its used `page` reverts to `auto` for whatever
  follows), pushing that following content to a fresh sheet instead of
  sharing the (previously non-bleeding) image's page. Measured: adding one
  full-bleed image mid-chapter to a 53-page book went from 54pp (old,
  non-bleeding behavior) to 55pp (fixed, bleeding behavior) — a genuine +1
  page, not a no-op. If your book doesn't use `.gp-bleed` at all, nothing
  changes (measured: field-guide and design-guide, as shipped, are
  unaffected).

  **New known gap, documented not fixed:** on the bleed page, native's
  running head/folio move onto the trim line (margin boxes are positioned
  by the page's own now-zero margins). If you need to keep them, suppress
  the ones that would land on the trim edge, scoped to core's named page:

  ```css
  @page gp-full-bleed {
    @top-center { content: none; }
    @bottom-center { content: none; }
  }
  ```

- **A named-page (`page:`) transition forces a page break, per spec.**
  Paged.js does not reliably do this. If a book used a `page:` change to
  apply margin overrides on the SAME page as preceding content (relying on
  Paged.js's gap here), native will insert the break the spec requires —
  usually the more correct result (a genuinely full-bleed image, for
  example), but it can change your page count.
- **`page: chapter-start` (or any named page) suppresses margin chrome on
  every sheet of a multi-sheet run it applies to, not just the first one**,
  when the CSS says so at every fragment. If a book's design intent was
  "blank chrome on the opener only, normal chrome on its continuation
  pages," write that as two named pages (an opener name and a body name),
  not one name reused across the run.
- **The whole-document shrink-to-fit trap.** Any single box that extends
  past its page's content box — on any page, anywhere in the book — shrinks
  the ENTIRE document's print scale, not just that page. The build's width
  check flags the offending element and page by default; treat that error
  as blocking, not cosmetic.
- **The native engine requires an external Chromium at a minimum version**
  (`REQUIRED_MILESTONE` in `engine/shared/cdp.ts`) for PDF export — a
  dependency Paged.js's polyfill-in-the-page approach did not have. The
  desktop app's bundled Electron Chromium may not meet this floor yet; the
  preflight check fails fast with an actionable message (which Chromium to
  point at) rather than partway through a build.

## Not affected

- Crop marks, bleed, PDF/X output, and imposition are unchanged — these are
  permanent print-production tooling regardless of engine.
- Manifest keys themselves: no key was renamed or removed for this change.
  `engine:` and `engineStyles.paged` still parse; as of the Phase 6 deletion
  they are ignored rather than honoured (deprecation warning), and are
  scheduled for removal one release after 0.10.0.
- Live preview hot-reload: native's plain full reload was measured faster
  than Paged.js's incremental splice on real books, so switching should not
  make your edit-to-preview loop slower.

## See also

- [`docs/native-engine-styling-guide.md`](../native-engine-styling-guide.md) — the full field-notes list of native engine gotchas and fixes.
- [`docs/native-only-migration-plan.md`](../native-only-migration-plan.md) — how the migration was sequenced, including the Phase 6 deletion that removed Paged.js entirely.
- [`docs/engine-history/`](../engine-history/) — the spike-era measurements and the design rules each engine defect forced.

# Migration: the native engine is now the default (2026-08-09)

Parity between the native Gutterpress engine and the Paged.js pipeline was
ruled proven on 2026-08-08 (`docs/native-engine-acceptance-gate.md`). Starting
with this release, a book with **no `engine:` key at all** builds and
previews with the **native engine**, not Paged.js. `engine: "paged"` still
works — it just now needs to be written explicitly, and it logs a one-line
deprecation notice when it is.

If your `manifest.yaml` doesn't set `engine:`, your next build will look
different. Read on before you build.

## What changed

| | Before this release | Now |
|---|---|---|
| No `engine:` key | Paged.js | **Native** |
| `engine: "native"` | Native | Native (unchanged) |
| `engine: "paged"` | Paged.js | Paged.js, plus a one-line deprecation notice |

`--engine paged` / `--engine native` on the CLI still override the manifest
for a single invocation, same as before.

**`--format html` changes too.** The engine choice is baked into the exported
`book.html`: the paged leg ships the Paged.js polyfill `<script>` and its
runtime stylesheet, the native leg ships neither (the Gutterpress engine never
loads a client-side polyfill). Measured on a book with no `engine:` key: the
exported `book.html` goes from 329 `paged`-matching occurrences to 4 (a
`/* markdown-it-paged */` comment and three `--pagedjs-margin-*` references
in the `.full-bleed` rule — see the `.full-bleed` bullet below). If you
post-process or self-host `book.html` and
depended on the polyfill being present, set `engine: paged` explicitly.

## How to switch back

Add this to `manifest.yaml` if you need to stay on Paged.js for now:

```yaml
engine: paged
```

There is no time limit forcing you off it today, but `paged` is deprecated
and will eventually be removed (see `docs/native-only-migration-plan.md`).
Treat this as a good time to start the switch, not as something to defer
indefinitely.

## Known author-visible differences

These are **deliberate, spec-based divergences**, not bugs — Chromium's
native print pagination is the CSS standards baseline; Paged.js is a
polyfill that doesn't always match the spec (see
`docs/native-engine-acceptance-gate.md` for the measured evidence behind
each one). The full field-notes list, with the reasoning and fixes, is
`docs/native-engine-styling-guide.md`; this is the short version.

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
- **`.full-bleed` now bleeds on the native engine too (fixed 2026-08-09).**
  Core's `.full-bleed` rule (`markdown-it-paged.js`'s `PAGED_CSS`) now
  carries `page: gp-full-bleed` plus a core-owned
  `@page gp-full-bleed { margin-left: 0; margin-right: 0; }`, alongside the
  pre-existing `--pagedjs-margin-*` out-dent (kept for the Paged.js leg).
  Native honours the named page (content box = sheet, so nothing has to
  out-dent — no shrink-to-fit trigger); Paged.js ignores the named page and
  keeps using the out-dent, so its output is unchanged.

  **`PAGED_CSS` also zeroes the body margin now (2026-08-09 review pass),
  and that part is not `.full-bleed`-specific.** The named page alone was
  not enough: `width: 100%` resolves against the BODY box, and the UA
  default `body { margin: 8px }` survives native print (Paged.js's polisher
  drops it), so on a book with no body reset of its own the art stopped 8px
  short of each edge. MEASURED at 300dpi on a real `--engine native` build,
  6×4in sheet, 0.75in margins, no author body rule: ink on the bleed page
  spanned **0.080–5.917in** before, **0.000–6.000in** after. The same reset
  also removes an 8px-per-side inset that native was applying to EVERY page
  of such a book relative to the paged leg (the non-bleed page's text run
  moved from 0.840–2.920in to 0.757–2.837in, exactly matching paged).
  `PAGED_CSS` is injected before author CSS (`assemble.ts`), so a book that
  wants a body margin still just declares one. Page counts re-measured
  after the reset: `/tmp/fbtest/book` 2pp, field-guide 34pp, design-guide
  53pp — all unchanged; the Paged.js leg is unchanged too (it already had
  no body margin). Regression-tested in
  `packages/cli/src/lib/markdown/paged-css-full-bleed.test.ts`.

  If your book already
  had the workaround below in its own CSS, it's now redundant (harmless —
  same values) and can be removed:

  ```css
  /* no longer needed — core does this now */
  .full-bleed { page: gp-full-bleed; }
  @page gp-full-bleed { margin-left: 0; margin-right: 0; }
  ```

  **This can change your page count.** Turning on true bleed for an image
  that does not already fill its page forces the CSS-spec-mandated break
  AFTER the image too (its used `page` reverts to `auto` for whatever
  follows), pushing that following content to a fresh sheet instead of
  sharing the (previously non-bleeding) image's page. Measured: adding one
  `.full-bleed` image mid-chapter to a 53-page book went from 54pp (old,
  non-bleeding behavior) to 55pp (fixed, bleeding behavior) — a genuine +1
  page, not a no-op. If your book doesn't use `.full-bleed` at all, nothing
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
- Manifest keys themselves: nothing was renamed or removed. Only the value
  `engine:` resolves to when you leave it out has changed.
- Live preview hot-reload: native's plain full reload is measured faster
  than Paged.js's incremental splice on real books (see the C.13 rows in
  `docs/native-engine-acceptance-gate.md`), so switching should not make
  your edit-to-preview loop slower.

## See also

- [`docs/native-engine-acceptance-gate.md`](../native-engine-acceptance-gate.md) — the measured evidence for every native-vs-paged divergence.
- [`docs/native-engine-styling-guide.md`](../native-engine-styling-guide.md) — the full field-notes list of native engine gotchas and fixes.
- [`docs/native-only-migration-plan.md`](../native-only-migration-plan.md) — the phase plan for removing Paged.js entirely.

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
- **`.full-bleed` does NOT bleed on the native engine — this one is a real
  gap, not a deliberate divergence.** Core's `.full-bleed` rule
  (`markdown-it-paged.js`'s `PAGED_CSS`) cancels the page's side margins by
  reading `--pagedjs-margin-left` / `--pagedjs-margin-right`, custom
  properties that only the Paged.js polyfill sets. The native engine never
  sets them, so the `var(…, 0px)` fallbacks apply and the element is simply
  `width: 100%` of the content box. Measured on a 6×4in book with
  `margin: 0.75in` and a `.full-bleed` image: paged prints it edge-to-edge
  across the full sheet width; native prints it inset by 0.75in on both
  sides. **Workaround until core is fixed:** give the element its own named
  page and zero that page's side margins — standard CSS that works on both
  engines:

  ```css
  .full-bleed { page: gp-full-bleed; }
  @page gp-full-bleed { margin-left: 0; margin-right: 0; }
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

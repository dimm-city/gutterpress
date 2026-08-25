# Styling for the native engine — tips, tricks, and gotchas

Field notes from styling a 300-page book against the Gutterpress engine
(Chromium print pagination). Every claim below was **measured** against real
builds, not inferred from specs. Where a fix lives in a real stylesheet, the
canonical example is `dc-op-manual/dc-design-guide/css/page.css` (the
page-furniture sections at the end of the file).

> **Several of these gotchas no longer bite** — the engine now defends
> against them by default (marked **[handled]** below). They stay documented
> because you will still meet them when you override a default, read an older
> book's CSS, or hit a case the default cannot cover.

The single most important mental-model shift: **the engine styles one
continuous document that Chromium fragments at print time** — there are no
page-sized DOM boxes to style, and no per-page containing block unless
something makes one. Almost every gotcha below is a consequence of that.

---

## 1. Backgrounds and page chrome

- **The root (`html`) background paints the page CONTENT box only — never the
  margins.** A full-bleed texture needs two layers: `html { background: … }`
  for the content area, plus `@page` margin boxes carrying the same background
  for the margin band (all 16 boxes if you want a seamless frame).
- **Don't use `position: fixed` for per-page backdrops.** It's
  viewport-dependent and unreliable under print. The `html` background is
  viewport-independent and repeats correctly on every page.
- **Margin boxes support**: `background`, `border`, `padding`, `counter()`,
  `width: fit-content` + `height: fit-content` (chip/pill footers), fonts, and
  `text-transform`. They do **not** support `transform: rotate()` or
  `box-shadow` — rotated/shadowed sticker chrome must be flattened to a square,
  unshadowed version. **[reported]** — the CSS linter warns when it sees one
  of these inside a margin box, so a silently-ignored declaration doesn't read
  as "my shadow just isn't showing up".
- **A chip needs BOTH `fit-content` axes — `width` alone is the common trap.**
  A margin box is sized by its margin area, so `width: fit-content` collapses
  the chip horizontally while it stays stretched to the full band height: a
  9pt folio in a 0.75in bottom margin paints as a tall rectangle around the
  number, not a pill. Add `height: fit-content` (equivalently
  `block-size: fit-content`, or an explicit `height`) to collapse the other
  axis. MEASURED (Chromium 148, 7×4in sheet, 0.75in margins): `height:
  fit-content` and `block-size: fit-content` both give a tight pill;
  `align-self: end` and `vertical-align: bottom` do **nothing** — the box
  stays full-height. There is no inner element to align: the margin box IS the
  box, so you size it, not align within it.
- **Named pages and `:blank` can override margin-box chrome.** A later
  `@page chapter-start { @bottom-left { content: ""; … } }` suppresses chips on
  chrome-free pages. Keep an empty background fill in the suppressed box so a
  patterned margin band stays continuous.

- **Large raster images in `@page { background }` are silently dropped.**
  Measured: a 2550×3300 texture never paints (flat colour, no error, every
  page) while a 450×582 downscale of the same image paints correctly —
  bounded between 450×582 (ok) and 638×825 (dropped). Resample background
  tiles to their display resolution (450px at a 1.5in tile is exactly
  300dpi). Gradients in `@page { background }` paint nothing at all. Both
  are tracked: dimm-city/gutterpress#152, #149. Verify any `@page`
  background fixture with a PRODUCTION-SIZED asset — a 16×16 test tile
  passes and proves nothing.

## 2. The whole-document shrink-to-fit trap

This is the nastiest native behavior because the symptom (every page slightly
smaller, more pages, different pagination) appears far from the cause.

- **Any box that extends past the page content box triggers a whole-document
  print scale-down.** One overflowing element on page 213 shrinks all 300
  pages. Left-side protrusion counts too (**[handled]** — the build's width
  check now flags both edges, names the element, and states the one-line fix;
  it is a hard error unless you pass `allowShrink`). Overflow that a clipping
  ancestor CONTAINS (`overflow-x: hidden|clip|auto|scroll`) never escapes to
  the document and never scales the book — measured, and the width check
  skips it. Two exceptions that still shrink: `overflow: hidden` on a STATIC
  ancestor does not contain an absolutely positioned descendant (only the
  descendant's containing block onward can), and `overflow-y: clip` leaves
  `overflow-x: visible` alone, so horizontal overflow still escapes.
- **Auto-width replaced elements (images) trigger it via their INTRINSIC
  width.** An `<img>` with `width: auto` feeds its natural pixel width into
  Chromium's preferred-width computation. `max-width: 100%` does **not** bound
  the preferred width; `min-width: 0` doesn't help either. **Only an explicit
  `width` does.** Give every large image an explicit width (`width: 100%` or a
  fixed inch value) — treat `width: auto` on big art as a bug.
- **This races on image load.** The intrinsic width only exists once the image
  decodes, so a build can nondeterministically flip between "shrunk" and "not
  shrunk" depending on decode timing. Explicit widths eliminate the race
  entirely. (The engine awaits `img.decode()` before its width check for this
  reason.)
- **Debug it by measuring a known glyph height** across builds (render a probe
  page, measure in points). A 3–20% uniform shrink means something, somewhere,
  is past the content box. The engine's pre-print width check reports
  offenders; believe it.

## 3. `position: absolute` — the containing-block landmine

- **An abspos element with no positioned ancestor resolves against the whole
  document canvas.** `bottom: 0` means *bottom of the book* — the art you
  pinned to a page footer paints, mostly clipped, on the LAST page of the PDF,
  while its own page renders empty. This is invisible until you look at the
  final pages (or run `pdfimages -list` on them and find objects that shouldn't
  be there).
  **[handled]**, with a caveat worth understanding: core now makes every
  `.page`/`.spread` a containing block, so a mispinned element lands on its
  own page instead of the book's last page. That contains the blast radius;
  it does not make the pin correct. A `.page` may still span several sheets
  (see Fix B), so `bottom: 0` pins to the END of that run, not to a sheet
  edge. Anything still positioned against the document — abspos in raw HTML
  outside a page wrapper — is reported as a build diagnostic.
- **Fix A (preferred): don't position — flow.** Seat art in normal flow and
  let floats/margins do the design (the core `gp-*` classes: positions,
  sizes, `.gp-tight`/`.gp-loose` spacing, and `.gp-shape` alpha-silhouette
  wrap). In-flow art also rebalances surrounding multicol content, often
  improving the page.
- **Fix A½ (for images): core now ships a supported pin idiom.** A markdown
  image with `{.gp-pin}` (+ `.gp-top/.gp-bottom/.gp-left/.gp-right` edge
  modifiers, `.gp-small/.gp-medium/.gp-large` sizes) is abspos done the safe
  way: PAGED_CSS supplies `inset: 0` + explicit self-alignment, the
  containing block is the `.page`/`.spread` the image sits in, and a
  `pin_outside_page` parse-time warning fires when there is no such
  container (the preview would otherwise mask exactly that mistake — its
  strip wrapper is positioned and one page tall). Same caveat as Fix B: the
  pin anchors to the CONTAINER, so keep pinned layouts to single-page
  `@page` blocks.
- **Fix B (when you truly need a pin on something else): give it a local
  containing block.** `position: relative` on the element's own wrapper
  (scope with `:has()` if the wrapper has no class). Remember: a semantic
  ".page" div in the source is NOT one printed page natively — it can span
  several sheets, so `bottom: 0` pins to the *element's* end, not a sheet
  edge.
- **An abspos replaced element with `width: auto` resolves to its intrinsic
  pixel width** even with both `left` and `right` set. Divs stretch; images
  don't. Set width explicitly (see §2 — this also triggers shrink-to-fit).

## 4. Fragmentation: what survives a page break and what doesn't

Plain block flow is the only layout that fragments robustly. Everything else
degrades:

- **Flex containers slice graphically** across page breaks — a flex row/column
  is treated as (near-)monolithic and gets cut like a screenshot.
- **Percentage heights inside a fragmented flex container resolve to 0.**
- **`margin-top: auto` (the classic "push to bottom" trick) consumes the
  entire continuation fragment** — content exists in the PDF but is painted
  out of view. You get a blank page that *contains* the image object
  (`pdfimages` shows it; the eye doesn't).
- **Grid rows fragment no better than flex.**
- **Monolithic replaced content (a tall image) taller than one page gets
  sliced** mid-artwork. Cap art with `max-height` + `object-fit: contain` so
  it always fits one page, or give it its own page.
- **Practical recipe for "text page with art pinned at the foot":** plain
  block flow, art as the last in-flow element, `max-height` capped,
  `break-inside: avoid` on the figure. Every flex/grid/auto-margin variant of
  this failed; source-order + block flow succeeded.

## 5. Multi-column sections

Fragmented multicol (a `columns: 2` block flowing across pages) is the least
forgiving layout in the engine — Chromium fragments it for real, so every
oversize child has consequences.

- **`break-inside: avoid` on children taller than one column is
  unenforceable**, and Chromium degrades badly: the child lands whole in one
  column and the neighbor column goes dead. If sections/cards inside a column
  wrapper can exceed a column's height, give them `break-inside: auto`.
  **[handled]** — core used to ship a blanket `.section { break-inside: avoid }`
  that caused this collapse in books that never wrote the rule. That default
  is gone (replaced by first-child glue, §6), so a `break-inside: avoid` you
  see in a computed style is now yours. Still check the computed style rather
  than only your own sheets when hunting one down.
- **`column-fill: balance` on a multicol that fragments across pages leaves
  non-final page fragments with a dead second column.** Use
  `column-fill: auto` (sequential fill) on fragmenting multicol under native —
  both columns fill on every page. (Balance is fine for a multicol that fits
  on one page — which is why this is NOT defaulted: a global `column-fill:
  auto` would visibly ragged-ify every ordinary single-page two-column
  layout.) **[reported]** — the build warns when a balanced multicol actually
  fragments, names it, and tells you to add `column-fill: auto`.
- **A column-spanning heading (`column-span: all`) followed by an
  unbreakable box strands the heading**: Chromium emits an EMPTY box fragment
  (border + padding, zero content) under the spanner at the page bottom, and
  the content flows headerless onto the next page. Fix: make the box after
  the spanner fragmentable (`break-inside: auto`) so it starts filling
  directly under its header.

## 6. Keeping headers with their content

**[handled]** for the common case: core ships `break-after: avoid` on every
heading and `break-before: avoid` on the first child of a `.section`/`figure`,
both at `:where()` zero specificity so any rule of yours wins. The mechanics
below still matter when you override them, or when the glue cannot hold.

`break-after: avoid` (on the heading) and `break-before: avoid` (on the first
child of a box) **do work** in Chromium print — verified with a synthetic
fixture — but only when the thing being kept-with can actually be placed:

- Heading + fragmentable box → glue works; both move or the box starts under
  the heading.
- Heading + `break-inside: avoid` box taller than the available space → the
  avoid rules become soft hints and Chromium breaks anyway (see §5's empty
  fragment).
- Decorative "tab" chips that are separate blocks from their card body
  (`inline-flex` tab + body div) need explicit glue:
  `.tab { break-after: avoid }` + `.body > :first-child { break-before: avoid }`.
  Otherwise a page break lands between them and the chip strands alone.

## 7. Generated content, counters, and cross-references

- **TOC page numbers via `target-counter()` work natively** — but only against
  anchors that exist. Fragment links with spaces or typos silently produce
  wrong/empty numbers. **[handled]** — the build now names every
  cross-reference whose target id does not exist, instead of printing a
  blank number and saying nothing.
- **Check whether the "regression" was ever right.** When counter output looks
  wrong, confirm the rule ever worked before treating it as a break — we found
  a `counter-reset: chapter 1 page 0` that had been silently broken for the
  book's whole life.
- **`string-set` value expressions** (`attr(x)`, `content()`) are supported by
  the engine's compiler — if a footer chip suddenly shows an entire chapter's
  text, the string is being sourced from element text content instead of the
  declared value expression (that was an engine bug, fixed; report, don't
  work around).

## 8. Things that rasterize or slow the build

- **`filter` on an element rasterizes its whole subtree to a 300-DPI bitmap**
  in the PDF: text becomes unselectable/unsearchable, `pdftotext` returns
  nothing for those pages, and it dominates build time (~90% measured; 57 s →
  6 s over 60 pp when scoped down). Scope filters to the smallest possible
  selector, or replace with non-filter equivalents.
- `clip-path` and friends are also rasterization risks — the CSS lint flags
  them; take the warnings seriously on text-bearing elements.

## 9. Full-bleed art without shrinking the book

- Use the manifest's **`engineStyles: { native: [...] }`** to load a stylesheet
  **after** every other sheet. Keep engine workarounds in that one file, each
  rule commented with the measured failure it fixes.
- **`GUTTERPRESS_CSS`'s `.gp-bleed` reaches the sheet edge by assigning the
  element's page to a core-owned named page**, `@page gp-full-bleed {
  margin-left: 0; margin-right: 0; }`. That page's content box already IS the
  sheet, so `width: 100%` reaches both edges and nothing out-dents — no
  shrink-to-fit trigger. The obvious alternative (out-denting by the real page
  margins) was implemented, measured, and REVERTED: out-denting to the sheet
  edge shrinks the whole document, because the shrink-to-fit trigger is the
  page CONTENT box, not the sheet (§2). Measured on Chromium 148, 6×4in sheet,
  0.75in margins, by the width of a fixed text run:

  | band | text run | result |
  |---|---|---|
  | inside the content box | 204.4pt | no shrink |
  | out to the sheet edge | 182.9pt | book shrunk ~10% |
  | past the sheet | 171.7pt | book shrunk ~16% |

  The named-page mechanism sidesteps this entirely: the content box IS the
  sheet, so nothing has to out-dent past it.

  The named page is necessary but was not sufficient on its own: `width:
  100%` resolves against the BODY box, and the UA's default `body { margin:
  8px }` survives print. `GUTTERPRESS_CSS` therefore also ships `body { margin:
  0 }`. MEASURED at 300dpi on a real build (6×4in sheet, 0.75in margins, no
  author body rule): the art spanned 0.080–5.917in before the reset and
  0.000–6.000in after. The reset is first in the cascade (`assemble.ts` puts
  author CSS last), so declaring your own `body` margin still wins.

  **Known gap, not fixed in core:** on the bleed page, the running head/folio
  move onto the trim line under native (margin boxes are positioned by the
  page's own margins, which `gp-full-bleed` zeroes). If you need to keep
  them, suppress the ones that would land on the trim edge, scoped to core's
  named page:

  ```css
  @page gp-full-bleed {
    @top-center { content: none; }
    @bottom-center { content: none; }
  }
  ```

  Core does not ship this suppression itself — which margin boxes a book
  actually uses (and whether hiding them on the art page is even wanted) is a
  book-level design call, not a default.

## 10. Debugging workflow that actually finds things

- **Render, don't trust metrics.** Page count and glyph size matching says
  nothing about a dead column or leaked art. `pdftoppm -r 30-40 -jpeg` gives
  cheap page images you (or a reviewer agent) can eyeball; keep them small.
- **`pdfimages -list -f N -l N`** answers "what actually painted on this
  page." Unexpected object IDs on the last page = abspos leak (§3). An
  "empty" page that contains a large image object = auto-margin fragment
  consumption (§4).
- **Stage the book HTML and inspect the live DOM** (computed
  `columnCount` / `columnFill` / `breakInside`, ancestor chains, child
  geometry) before writing a fix. Two of our worst wrong turns came from
  guessing selectors; every real fix came within minutes once the actual
  element and its computed values were on screen.
- **Remember which media you're measuring.** A staged DOM you inspect
  computes styles under **screen** media unless print is explicitly emulated
  (`Emulation.setEmulatedMedia({ media: "print" })`) — any rule inside
  `@media print` is invisible to the inspection but active in the printed
  output. Verify print-only rules by printing, or emulate print before
  reading computed styles. (The engine's own audits do this now — they run
  under print media, so what they measure is what prints.)
- **Prove CSS mechanisms in a synthetic 2-page fixture** (`chromium
  --headless --print-to-pdf` on a 20-line HTML file, ~5 s) before waiting on
  a 300-page build to test a hypothesis.
- **Keep a small proof book** (front matter + one chapter) for fast iteration
  on early-book issues; only run full builds for late-book pages and final
  verification.
- **Check the book's own design before "fixing" anything.** Several
  scary-looking pages (a lone divider illustration, a header-only page)
  turned out to be book-as-designed, not defects.

## 11. What the build tells you, and where it says it

Every finding below names the offending element and states the fix in one
line. In the desktop app they appear in the **Problems panel** next to the
spell-check-style source findings; from the CLI they print as warnings.

| Finding | Meaning |
|---|---|
| Too wide for the page | Something exceeds the page content box and would shrink the whole book (§2). Hard error unless you pass `allowShrink`. |
| Image has no width set | An auto-width image whose natural size exceeds the page — the shrink risk of §2, as a warning. |
| Broken link | A cross-reference points at an id that does not exist; its page number would print blank (§7). |
| Placed off its page | An absolutely positioned element with nothing positioned around it (§3). |
| Trapped background layer | A `.gp-behind` element has a live ancestor that clips it or creates a stacking context, so it cannot paint behind the page as intended. The source-only `printsafe/page-containment` lint is an early hint for `.page`/`.spread`; this build-time check is authoritative for every wrapper class. |
| Empty column | A balanced multi-column block that runs past one page, leaving dead columns (§5). |
| Taller than the page | Content that print splits but the screen preview clips — the two will not agree there (§4). |
| Image resolution | Below the DPI floor; may look soft in print. |

If you add a check to the engine, give it a code in `BUILD_DIAGNOSTIC_CODES`
and a plain-language label in the desktop's `SOURCE_LABELS` — a test fails
otherwise, so an author never sees a raw id like
`engine.multicol.dead-column`.

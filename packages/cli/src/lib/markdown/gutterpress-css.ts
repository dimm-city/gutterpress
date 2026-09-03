/**
 * GUTTERPRESS_CSS — the `gp-*` author vocabulary.
 *
 * This is Gutterpress's broad author-vocabulary stylesheet. The separate
 * `MARKER_CSS` block owns only the `.page`/`.spread`/`.section`/`.chapter`
 * structure emitted by Gutterpress's marker parser; this file owns the `gp-*`
 * classes authors apply to content. Keeping the two core blocks separate makes
 * that ownership boundary explicit without implying an external plugin.
 *
 * Injected by assemble.ts inside `@layer gp.vocab` (#227), immediately after
 * MARKER_CSS's own `@layer gp.marker`, and before user plugin CSS and the
 * author's project stylesheets — both of which stay UNLAYERED. Per the CSS
 * Cascade Layers spec, unlayered CSS always beats layered CSS regardless of
 * selector specificity, so a plugin or project rule targeting a `gp-*` class
 * now wins UNCONDITIONALLY, not merely at equal specificity — see
 * assemble.ts's cascade-order comment for the full layer list.
 *
 * Also ships the author-facing `gp-*` image/block vocabulary (CLAUDE.md §0 —
 * a behavior broadly useful to non-technical authors belongs in core, not a
 * project layer; see UX finding M17). markdown-it-attrs is bundled by
 * default (renderer.ts), so `![Art](x.jpg){.gp-right .gp-small}` already
 * attaches the classes to the rendered `<img>` — these rules are what make
 * them actually do something print-safe. The gp-* vocabulary REPLACED the
 * five pre-vocabulary utility names (.center/.float-left/.float-right/
 * .full-width/.full-bleed), which were removed rather than kept as
 * aliases — one vocabulary, no duplicate way to spell each layout. Books
 * migrate by renaming the classes in their markdown; the desktop editor
 * recognizes the old names when editing an image and rewrites them to the
 * gp-* names in place.
 *
 *   .gp-left      — floats left, text wraps.
 *   .gp-right     — floats right, text wraps.
 *   .gp-center    — centers a block element.
 *   .gp-full      — fills the page's content width.
 *   .gp-small     — width 25% of the column. Sizes compose with any
 *   .gp-medium    — width 50%.        position (including .gp-pin, where
 *   .gp-large     — width 75%.        the % resolves against the page box).
 *   .gp-tight     — float/shape clearance 0.5em (sets --gp-gap; default 1em).
 *   .gp-loose     — float/shape clearance 2em (sets --gp-gap).
 *   .gp-shape     — wraps text to a floated image's alpha silhouette
 *                   (shape-outside; the pipeline mirrors the src into
 *                   --gp-shape because CSS url() contexts can't read
 *                   attr()). Floats only; inert elsewhere.
 *   .gp-pin       — pins within its nearest POSITIONED ANCESTOR, falling
 *                   back to the page/spread. Core gives `.page`/`.spread`
 *                   `position: relative` (markers.js MARKER_CSS), so with no
 *                   other positioned ancestor in between that is the page —
 *                   the common case. A theme that positions something closer
 *                   (a `.section` card, a component shell) becomes the pin's
 *                   frame instead, BY DESIGN: that is how a pin is scoped to
 *                   a card rather than a sheet. Page-level furniture must
 *                   therefore be authored outside such a wrapper.
 *                   Centered on both axes unless combined with the edge
 *                   modifiers .gp-top/.gp-bottom/.gp-left/.gp-right.
 *   .gp-flush     — with .gp-pin + an edge, the art sits on the PAPER's
 *                   edge rather than on the text block's. No CSS rule here:
 *                   the class is a marker both ENGINES implement (see
 *                   engine/shared/flush.ts), because reaching the paper
 *                   requires freeing that page's margin — per page — and
 *                   relocating the furniture that lived in it, neither of
 *                   which a stylesheet can do. Inert without .gp-pin + an
 *                   edge word, and inert under plain markdown-it.
 *   .gp-bleed     — forces its own page (break-before) and spans it
 *                   edge-to-edge horizontally. This does NOT cancel the
 *                   top/bottom margins, extend past the trim into printer
 *                   bleed overage, or remove headers/footers — none of
 *                   that is implemented.
 *
 *                   The mechanism is a named page: the rule below assigns the
 *                   element's page to `@page gp-full-bleed`, which has zero
 *                   side margins, so the page's own CONTENT box IS the sheet
 *                   and a plain `width: 100%` already reaches both edges —
 *                   with no shrink-to-fit trigger, because nothing out-dents
 *                   past the content box. MEASURED (Chromium 148, 6x4in
 *                   sheet, 0.75in margins): the obvious alternative — a
 *                   negative out-dent of the real page margins — shrank the
 *                   WHOLE document ~10% (text run 204.4pt -> 182.9pt),
 *                   because the shrink-to-fit trigger is the page CONTENT
 *                   box, not the sheet. That failure mode is why the named
 *                   page exists.
 *
 *                   KNOWN GAP: on the bleed page, native's running head/folio
 *                   move onto the trim line (margin boxes are positioned by
 *                   the page's own margins, which are now zero on this named
 *                   page). This is not fixed in core — see
 *                   docs/native-engine-styling-guide.md §9 for the one-line
 *                   author remedy (`@top-center { content: none }` etc. on
 *                   `@page gp-full-bleed`).
 *
 *                   A standalone `![Art](x.jpg){.gp-bleed}` markdown image
 *                   is rendered as `<p><img class="gp-bleed"></p>` — a
 *                   naked markdown-it standalone-image wrap, not something
 *                   this plugin controls. The `<p>`'s UA default vertical
 *                   margin sits above/below an image sized to the page's
 *                   full content box, overflows the box by that margin, and
 *                   on native print pushes the whole page onto a spurious
 *                   extra sheet, which then renders BLANK (the art landed on
 *                   the sheet after). MEASURED (300dpi, 6x9in sheet, a
 *                   4-source-file fixture book): with the paragraph margin
 *                   left at UA default, native emits 8pp with page 6 fully
 *                   blank (0 dark pixels of 540,000 sampled); zeroing the
 *                   wrapping paragraph's margin below gives the intended
 *                   7pp with the art bleeding edge-to-edge on page 6. Scoped
 *                   to `:only-child` so a `.gp-bleed` image sharing a
 *                   paragraph with other inline content keeps its margin.
 *
 * Rule ORDER within the gp-* block is the contract: flow positions → sizes
 * → spacing → .gp-pin → pin-edge modifiers. Everything is flat 0-1-0
 * specificity, so combining classes resolves by source order: a later flow
 * position wins (left < right < center < full < bleed); an explicit size's
 * max-width:100% lifts the floats' 50% cap; .gp-pin's margin:0 /
 * max-width:100% beat the float declarations; the edge modifiers beat
 * .gp-pin's center defaults.
 *
 * .gp-pin semantics, stated honestly: it pins within its @page/@spread
 * CONTAINER, not "the sheet edge". A .page div that fragments across
 * several printed sheets is ONE containing block, so align-self:end is the
 * end of the run. For the single-page layouts pin is meant for (title
 * pages, chapter openers, watermark pages) the two are the same thing. A
 * .gp-pin outside any @page/@spread resolves against the document canvas
 * and can print on a completely different sheet — the gp_pin_scope_check
 * core rule below warns at parse time (`pin_outside_page`), and the
 * compiler's engine.abspos.leak diagnostic catches the raw-HTML cases the
 * token walk can't see.
 *
 * Pin CSS mechanics (all three are load-bearing, verified by
 * paged-css-image-pin.test.ts): `inset: 0` is REQUIRED — abspos
 * self-alignment aligns within the inset-modified containing block, and
 * with auto insets that collapses to the static-position rectangle, where
 * alignment does nothing. The center defaults must be EXPLICIT — `normal`
 * alignment behaves as `start` for abspos replaced elements, not center.
 * And `justify-self` on .gp-left/.gp-right does double duty (flow float +
 * pin edge) because self-alignment does not apply to in-flow floats — it is
 * inert until .gp-pin makes the element abspos. If Chrome ever ships
 * block-level self-alignment for in-flow boxes, a non-floated element
 * carrying gp-left could start shifting; that is standards-tracking per
 * CLAUDE.md ("Chrome wins once it ships"), not a bug in the author's book.
 */
export const GUTTERPRESS_CSS = `
/* gp-* author image/block vocabulary. One vocabulary, gp-* only — the
   pre-vocabulary utility names (.center/.float-left/.float-right/
   .full-width/.full-bleed) were REMOVED when gp-* shipped; books rename
   the classes in their markdown (see the migration note). Source ORDER is
   the contract — see the doctrine comment above. */

/* flow positions */
.gp-left {
  float: left;
  margin: 0 var(--gp-gap, 1em) var(--gp-gap, 1em) 0;
  max-width: 50%;
}
.gp-right {
  float: right;
  margin: 0 0 var(--gp-gap, 1em) var(--gp-gap, 1em);
  max-width: 50%;
}
.gp-center {
  display: block;
  float: none;
  margin-left: auto;
  margin-right: auto;
  max-width: 100%;
}
.gp-full {
  display: block;
  float: none;
  width: 100%;
  max-width: 100%;
}
@page gp-full-bleed { margin-left: 0; margin-right: 0; }
.gp-bleed {
  display: block;
  float: none;
  break-before: page;
  page: gp-full-bleed;
  max-width: none;
  width: 100%;
  margin-left: 0;
  margin-right: 0;
}

/* sizes — AFTER the flow positions so max-width:100% lifts the floats' 50%
   cap at equal specificity */
.gp-small { width: 25%; max-width: 100%; }
.gp-medium { width: 50%; max-width: 100%; }
.gp-large { width: 75%; max-width: 100%; }

/* float clearance presets — consumed by var(--gp-gap) in the float rules
   above and by .gp-shape's shape-margin below; --gp-gap itself is
   author-settable CSS */
.gp-tight { --gp-gap: 0.5em; }
.gp-loose { --gp-gap: 2em; }

/* column runs — plain CSS Multi-column, exposed as author vocabulary so
   "put this in two columns" does not require borrowing a styled container
   from the book's own component layer. That borrowing is what this exists
   to prevent: a book whose theme paints .section chrome by default gives
   every author who opens a section just to start a column run a panel they
   did not ask for, and the book then needs a reset rule to take it back.
   With a neutral primitive the author opts into columns and nothing else.

   Permanent vocabulary, not a shim: Chromium implements multicol natively
   and these rules are the standard properties verbatim, so there is no
   spec gap here to remove later. Deliberately minimal — column-fill is
   NOT set, because the correct value depends on whether the run fragments
   across pages (auto packs each page's columns; the CSS initial balance is
   right for a run that fits on one page) and only the author knows which.
   --gp-column-gap is author-settable. */
.gp-columns-2 { columns: 2; column-gap: var(--gp-column-gap, 1.5em); }
.gp-columns-3 { columns: 3; column-gap: var(--gp-column-gap, 1.5em); }

/* the per-shape decisions the paragraph above deliberately leaves to the
   author, named instead of left as raw CSS every book was reinventing
   (2026-09-01 CSS architecture review, findings C1/C7 — CLAUDE.md §0:
   "behavior broadly useful to non-technical authors belongs in core").
   Permanent vocabulary, standard properties verbatim — same rationale as
   the column/grid runs above. One name each, no aliases:
     .gp-columns-all       column-span: all      a heading or block that
                                                  spans every column in the
                                                  run it sits inside.
     .gp-columns-flow      column-fill: auto     a run that FRAGMENTS across
                                                  pages — every page's
                                                  columns fill instead of
                                                  only the last one
                                                  balancing (the dead-column
                                                  collapse the build's
                                                  engine.multicol.dead-column
                                                  warning names this fix
                                                  for).
     .gp-columns-balanced  column-fill: balance  a run that fits on ONE
                                                  page (the CSS initial
                                                  value — ragged columns
                                                  would be wrong here). */
.gp-columns-all { column-span: all; }
.gp-columns-flow { column-fill: auto; }
.gp-columns-balanced { column-fill: balance; }

/* grid runs — the SLOTTED counterpart to the column runs above. Grid places
   each child into the next cell, across then down (deterministic slots: card
   layouts, stat blocks, image-plus-caption pairs); columns FLOW one text run
   down then across. Same neutral-primitive rationale as .gp-columns-*, and
   permanent vocabulary for the same reason: standard CSS Grid verbatim, no
   spec gap to remove later. MEASURED (Chromium 151, gp-grid evidence pack):
   grid rows fragment across sheets with EXACT print/viewer parity — 2- and
   3-col, unequal item heights, mid-row cuts, multi-sheet overflow,
   break-inside:avoid, gap geometry — so a grid taller than the page is safe,
   no fit-one-page constraint. Two things to know, not fix:
     - on a min-height page root (MARKER_CSS), default align-content
       stretches rows apart to fill the page — identically in both engines.
       Authors wanting packed rows set align-content: start.
     - a @page-break / @column-break marker DIRECTLY inside a grid container
       becomes a grid item and corrupts placement (the one measured parity
       break); markers.js diagnoses it (break_inside_grid).
   --gp-grid-gap is author-settable. */
.gp-grid-2 { display: grid; grid-template-columns: repeat(2, 1fr); gap: var(--gp-grid-gap, 1.5em); }
.gp-grid-3 { display: grid; grid-template-columns: repeat(3, 1fr); gap: var(--gp-grid-gap, 1.5em); }

/* fragmentation controls — generic pagination utilities for any element,
   independent of the column/grid vocabulary above (a book reached for
   these just as often outside a multicol run: keeping a card whole,
   forcing a section to start a fresh page). Standard properties only —
   this project is Chromium-only (CLAUDE.md), so there are no legacy
   page-break-* twins to also emit. One name each. */
.gp-no-break { break-inside: avoid; }
.gp-break-before { break-before: page; }

/* shape wrap — text follows the image's alpha silhouette instead of its
   rectangular box. shape-outside only applies to floats, so this is inert
   without .gp-left/.gp-right (and under .gp-pin, which un-floats). The
   shape URL cannot be written in CSS (url() contexts can't read attr()),
   so the image renderer rule (images.ts) mirrors the src into an inline
   --gp-shape:url(...) custom property whenever it sees this class --
   authors only ever type the class. threshold 0.2 ignores near-transparent
   anti-aliasing halos; shape-margin shares the float-gap vocabulary. */
img.gp-shape {
  shape-outside: var(--gp-shape);
  shape-image-threshold: 0.2;
  shape-margin: var(--gp-gap, 1em);
}

/* pin — within the nearest positioned ancestor (.page/.spread, rule above).
   inset:0 and the explicit centers are load-bearing; see doctrine comment. */
.gp-pin {
  position: absolute;
  inset: 0;
  align-self: center;
  justify-self: center;
  margin: 0;
  max-width: 100%;
}

/* pin edge modifiers — AFTER .gp-pin to beat its center defaults;
   justify-self is inert on in-flow floats, so gp-left/gp-right safely do
   double duty as flow float + pin edge */
.gp-top { align-self: start; }
.gp-bottom { align-self: end; }
.gp-left { justify-self: start; }
.gp-right { justify-self: end; }

/* wrapper-margin neutralization (same pattern and rationale as the
   .gp-bleed paragraph-margin note in the doctrine comment; for pin, the
   emptied paragraph would otherwise leave a phantom margin gap in flow) */
:where(p:has(> img.gp-bleed:only-child)) { margin: 0; }
:where(p:has(> img.gp-pin:only-child)) { margin: 0; }

/* depth — a named ladder for z-index, so books stop hand-tuning bare
   integers. A real book measured 21 z-index declarations using only four
   distinct values (-1, 0, 1, 2), each written literally at its use site.
   The custom properties are the author-settable surface (a book needing a
   deeper stack raises them once); the classes are the shorthand.

   NOT named "layer": CSS Paged Media 3 §3.1 already defines "page layers"
   (page background, canvas, borders, contents, margin boxes) and those are
   parts of the PAGE BOX, not a z-ladder for content. Reusing the word for a
   different concept would collide with the spec vocabulary this project
   tracks. The pin EDGE modifiers already own .gp-top/.gp-bottom, so the
   ladder avoids those words too.

   .gp-behind is the one that earns its place: it puts a pinned image UNDER
   the page's text, which is otherwise impossible to express without a bare
   negative z-index. "Above" needs no class — an out-of-flow pin already
   paints above in-flow content.

   Two things silently defeat .gp-behind, neither visible at the use site:
     - a stacking context on the .page/.spread ancestor (z-index, isolation,
       opacity, filter, transform on it traps the negative layer inside).
       Core keeps .page/.spread at 'position: relative; z-index: auto'
       precisely so they are not stacking contexts.
     - a clipping ancestor (overflow other than visible) — but only where
       the art actually overhangs that ancestor's clip box on a clipped
       axis: the overhang is cut off, the same mechanism that clips a
       .gp-bleed plate back to the wrapper's width. Clipping never reorders
       layers — within-bounds art under a clipping .page prints whole and
       still behind (measured; see the build audit's comment in
       engine/compiler/build.ts), and a static wrapper's overflow never
       binds an abspos .gp-pin at all.
   The build-time engine.layer.trapped audit reports both against the live
   ancestor chain. printsafe/page-containment is only an early source hint for
   declarations written directly on .page/.spread. */
:root {
  --gp-z-behind: -1;
  --gp-z-base: 0;
  --gp-z-raised: 1;
  --gp-z-front: 2;
}
.gp-behind { z-index: var(--gp-z-behind); }
.gp-base   { z-index: var(--gp-z-base); }
.gp-raised { z-index: var(--gp-z-raised); }
.gp-front  { z-index: var(--gp-z-front); }

/* GFM-style alert/callout boxes (#237) — the DOM gfm-alerts.ts emits from
   "> [!TYPE]" blockquote syntax when a project opts into the bundled
   gutterpress-gfm-alerts feature (BUILTIN_OPTIONAL_PLUGINS, renderer.ts).
   The plugin is optional and inert by default; these rules are equally
   inert wherever the classes never appear, exactly like every other
   utility above, so shipping them costs nothing to a book that has not
   turned the feature on.

   This is authored-COMPONENT vocabulary, not the @marker structural family
   (markers.js/MARKER_CSS) — CLAUDE.md §6 splits the two core CSS blocks by
   ROLE, and an author-facing box an author invokes via inline syntax is the
   same role as every other gp-* utility here, not page/chapter/section DOM.

   Deliberately minimal (CLAUDE.md "thin over capable" / the issue's own
   "a rule and a label"): a left border plus a bold label, :where()'d to
   zero specificity so a theme's own (unlayered) rule for any of these
   classes wins outright regardless of selector weight — see the
   cascade-layers note atop this file. Five semantic accent colors (the same
   NOTE/TIP/IMPORTANT/WARNING/CAUTION hues GitHub's own alerts use — a
   long-established, non-proprietary convention, not DC branding) are
   exposed as :root custom properties, the same author-settable-surface
   pattern as the --gp-z-* ladder above: a book retints every alert of one
   type by overriding a single property, no specificity fight required.
   --gp-alert-color cascades from the type modifier down to .gp-alert-title
   through ordinary CSS inheritance (the title is always a DOM descendant of
   the box), so it is set in exactly five places, not ten. */
:root {
  --gp-alert-note-color: #0969da;
  --gp-alert-tip-color: #1a7f37;
  --gp-alert-important-color: #8250df;
  --gp-alert-warning-color: #9a6700;
  --gp-alert-caution-color: #cf222e;
}
:where(.gp-alert) {
  margin: 1em 0;
  padding: 0.5em 1em;
  border-left: 0.25em solid var(--gp-alert-color, currentColor);
}
:where(.gp-alert-title) {
  margin: 0 0 0.5em;
  font-weight: bold;
  color: var(--gp-alert-color, inherit);
}
:where(.gp-alert-note)      { --gp-alert-color: var(--gp-alert-note-color); }
:where(.gp-alert-tip)       { --gp-alert-color: var(--gp-alert-tip-color); }
:where(.gp-alert-important) { --gp-alert-color: var(--gp-alert-important-color); }
:where(.gp-alert-warning)   { --gp-alert-color: var(--gp-alert-warning-color); }
:where(.gp-alert-caution)   { --gp-alert-color: var(--gp-alert-caution-color); }
`;
/**
 * GP_CLASSES — every class an author may legitimately write with a `gp-`
 * prefix: the `.gp-*` selectors in `GUTTERPRESS_CSS` above, the two
 * structural classes `markers.js`'s `MARKER_CSS` styles (`gp-page-break`,
 * `gp-column-break`), and two classes the marker plugin EMITS but that carry
 * no CSS rule of their own — `gp-continued` (a `@continue`d section's marker,
 * for author/theme styling — see markers.js's header) and `gp-flush` (a
 * `.gp-pin` edge modifier implemented in the engine's layout code, not CSS —
 * see the `.gp-flush` doctrine note above).
 *
 * This is the vocabulary `gp-pin-scope.js`'s `unknown_gp_class` diagnostic
 * (#226) checks every author-facing class against: any `gp-`-prefixed class
 * NOT in this set is either a typo or forgotten vocabulary, and is worth a
 * warning either way — key on `gp-` only; `.dc-*`, `.fg-*`, and unprefixed
 * classes are none of core's business.
 *
 * `gutterpress-css.test.ts` asserts this set and the `.gp-*` selectors
 * textually present in `GUTTERPRESS_CSS` + `MARKER_CSS` agree (modulo the two
 * marker-only exceptions above), so the two cannot silently drift apart —
 * whoever adds a class to one CSS block and forgets this list finds out from
 * a failing test, not from a future bug report.
 */
export const GP_CLASSES: ReadonlySet<string> = new Set([
  // flow positions, sizes, spacing
  "gp-left", "gp-right", "gp-center", "gp-full", "gp-bleed",
  "gp-small", "gp-medium", "gp-large",
  "gp-tight", "gp-loose",
  // column runs + the column-fill/span vocabulary (#225/#228)
  "gp-columns-2", "gp-columns-3",
  "gp-columns-all", "gp-columns-flow", "gp-columns-balanced",
  // fragmentation controls (#225/#228)
  "gp-no-break", "gp-break-before",
  // grid runs
  "gp-grid-2", "gp-grid-3",
  // shape wrap
  "gp-shape",
  // pin + edge modifiers
  "gp-pin", "gp-top", "gp-bottom",
  // depth ladder
  "gp-behind", "gp-base", "gp-raised", "gp-front",
  // GFM alert boxes (#237, gfm-alerts.ts) — base + the five GitHub types + label
  "gp-alert", "gp-alert-title",
  "gp-alert-note", "gp-alert-tip", "gp-alert-important", "gp-alert-warning", "gp-alert-caution",
  // MARKER_CSS (markers.js) — structural break classes
  "gp-page-break", "gp-column-break",
  // marker-only, no CSS rule of their own (see the doc comment above)
  "gp-continued", "gp-flush",
]);

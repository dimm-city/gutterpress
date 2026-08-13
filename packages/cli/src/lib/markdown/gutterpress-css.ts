/**
 * GUTTERPRESS_CSS — the `gp-*` author vocabulary.
 *
 * This is Gutterpress's broad author-vocabulary stylesheet. The separate
 * `MARKER_CSS` block owns only the `.page`/`.spread`/`.section`/`.chapter`
 * structure emitted by Gutterpress's marker parser; this file owns the `gp-*`
 * classes authors apply to content. Keeping the two core blocks separate makes
 * that ownership boundary explicit without implying an external plugin.
 *
 * Injected by assemble.ts immediately AFTER `MARKER_CSS` and BEFORE user plugin
 * and project CSS, so the cascade order is: marker layout primitives ->
 * Gutterpress vocabulary -> plugin CSS -> the author's stylesheets last. An
 * author overriding a `gp-*` class at equal specificity still wins.
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
 *   .gp-pin       — pins within the nearest @page/@spread container;
 *                   centered on both axes unless combined with the edge
 *                   modifiers .gp-top/.gp-bottom/.gp-left/.gp-right.
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
 *                   sheet, 0.75in margins): the earlier mechanism (a negative
 *                   out-dent of the real page margins, inherited from the
 *                   Paged.js era, where the polyfill published them as
 *                   `--pagedjs-margin-left/right`) shrank the WHOLE document
 *                   ~10% under native print (text run 204.4pt -> 182.9pt),
 *                   because the shrink-to-fit trigger is the page CONTENT
 *                   box, not the sheet — that failure mode is why the named
 *                   page exists. Paged.js has since been removed
 *                   (native-only-migration-plan.md Phase 6), so the out-dent
 *                   (whose custom properties nothing sets any more, making it
 *                   a permanent no-op) went with it.
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
     - a clipping ancestor (overflow other than visible), the same mechanism
       that clips a .gp-bleed plate back to the wrapper's width.
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
`;

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
 * project layer). markdown-it-attrs is bundled by
 * default (renderer.ts), so `![Art](x.jpg){.gp-right .gp-small}` already
 * attaches the classes to the rendered `<img>` — these rules are what make
 * them actually do something print-safe. One vocabulary, no aliases: there
 * is no duplicate way to spell each layout (the desktop editor rewrites the
 * pre-gp-* names `.center`/`.float-left`/`.float-right`/`.full-width`/
 * `.full-bleed` to gp-* names in place when editing an image).
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
 *                   Centered in the text block unless combined with the
 *                   edge modifiers .gp-top/.gp-bottom/.gp-left/.gp-right;
 *                   an edge pin sits on the printer's ART-SAFE line of that
 *                   edge and never moves the text — see "the pin box" below.
 *   .gp-flush     — with .gp-pin + an edge, the escape hatch: the art runs
 *                   to the PAPER's edge, past the printer's safe area. It
 *                   only zeroes the pin box's insets (the rule after the
 *                   edge modifiers). Inert without .gp-pin + an edge word.
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
 * → spacing → .gp-pin → pin-edge modifiers → .gp-flush. Everything else is
 * flat 0-1-0 specificity, so combining classes resolves by source order: a
 * later flow position wins (left < right < center < full < bleed); an
 * explicit size's max-width:100% lifts the floats' 50% cap; .gp-pin's
 * margin:0 / max-width:100% beat the float declarations; the edge modifiers
 * beat .gp-pin's center defaults.
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
 * The PIN BOX — where a pin may sit, and why the text never moves. An edge
 * pin has to be able to reach the paper, and Chromium's printable area IS
 * the page area (engine/shared/pin-edges.ts has the measurements), so both
 * engines free the page margin on each edge a pin names: print through a
 * generated named page, the preview through the run's strip geometry. The
 * page root gets that margin back as padding, on top of any of its own
 * (`box-decoration-break: clone`), so its content box — the text — is the
 * author's content box, same size, same place, same breaks, wherever the art
 * is pinned. The pin's containing
 * block is the root's padding box, and the engine sets `--gp-pin-<edge>` on
 * the root to the art-safe line's distance from the sheet edge (the bleed
 * plus page.artSafe on the top, bottom and outside edge; page.safe at the
 * binding, from the manifest); `.gp-pin` reads them as its four insets.
 * `.gp-flush` zeroes them on the pin: the paper's edge. Under plain
 * markdown-it nothing sets them and every inset is 0.
 *
 * Pin CSS mechanics (all three are load-bearing, verified by
 * marker-css-image-pin.test.ts): four non-auto insets are REQUIRED — abspos
 * self-alignment aligns within the inset-modified containing block (the pin
 * box), and with auto insets that collapses to the static-position
 * rectangle, where alignment does nothing. The center defaults must be
 * EXPLICIT — `normal` alignment behaves as `start` for abspos replaced
 * elements, not center.
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

/* column runs — plain CSS Multi-column, emitted by the core @columns marker
   (markers.js): @columns [1-5] ... @end-columns is the ONE way to lay
   content out in columns, and @column-break moves to the next column.
   The classes below are the CSS that marker emits, not author vocabulary.

   Permanent vocabulary, not a shim: Chromium implements multicol natively
   and these rules are the standard properties verbatim, so there is no
   spec gap here to remove later. Deliberately minimal — column-fill is
   NOT set (the CSS initial balance applies).
   Themes style a run through two tokens instead of writing column rules:
     --gp-column-gap   default 1.5em
     --gp-column-rule  default none (any column-rule shorthand value)
   Both hooks sit at zero specificity (:where), so any author rule wins.
   .gp-columns is two columns on its own; a count class (bare @columns
   emits gp-columns-2) wins because it comes later at the same specificity. */
:where(.gp-columns, .gp-columns-1, .gp-columns-2, .gp-columns-3, .gp-columns-4, .gp-columns-5) {
  column-gap: var(--gp-column-gap, 1.5em);
  column-rule: var(--gp-column-rule, none);
}
.gp-columns { columns: 2; }
.gp-columns-1 { columns: 1; }
.gp-columns-2 { columns: 2; }
.gp-columns-3 { columns: 3; }
.gp-columns-4 { columns: 4; }
.gp-columns-5 { columns: 5; }

/* fragmentation controls — generic pagination utilities for any element,
   independent of the column vocabulary above (a book reached for
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
   The four insets are the pin box: 0 (the text block's edge) unless an
   engine set --gp-pin-<edge> on the page root for an edge a pin uses (the
   art-safe line). Non-auto insets and the explicit centers are
   load-bearing; see doctrine comment. */
.gp-pin {
  position: absolute;
  top: var(--gp-pin-top, 0px);
  right: var(--gp-pin-right, 0px);
  bottom: var(--gp-pin-bottom, 0px);
  left: var(--gp-pin-left, 0px);
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

/* the escape hatch — the paper's edge, past the printer's safe area: the
   pin box loses its art-safe insets. Set on the pin itself, so it beats the
   values the page root hands down. */
.gp-pin.gp-flush {
  --gp-pin-top: 0px;
  --gp-pin-right: 0px;
  --gp-pin-bottom: 0px;
  --gp-pin-left: 0px;
}

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
 * `gp-column-break`), and one class the marker plugin EMITS but that carries
 * no CSS rule of its own — `gp-continued` (a `@continue`d section's marker,
 * for author/theme styling — see markers.js's header).
 *
 * This is the vocabulary `gp-pin-scope.js`'s `unknown_gp_class` diagnostic
 * (#226) checks every author-facing class against: any `gp-`-prefixed class
 * NOT in this set is either a typo or forgotten vocabulary, and is worth a
 * warning either way — key on `gp-` only; `.dc-*`, `.fg-*`, and unprefixed
 * classes are none of core's business.
 *
 * `gutterpress-css.test.ts` asserts this set and the `.gp-*` selectors
 * textually present in `GUTTERPRESS_CSS` + `MARKER_CSS` agree (modulo the
 * marker-only exception above), so the two cannot silently drift apart —
 * whoever adds a class to one CSS block and forgets this list finds out from
 * a failing test, not from a future bug report.
 */
export const GP_CLASSES: ReadonlySet<string> = new Set([
  // flow positions, sizes, spacing
  "gp-left", "gp-right", "gp-center", "gp-full", "gp-bleed",
  "gp-small", "gp-medium", "gp-large",
  "gp-tight", "gp-loose",
  // column runs — the CSS the @columns marker emits
  "gp-columns", "gp-columns-1", "gp-columns-2", "gp-columns-3", "gp-columns-4", "gp-columns-5",
  // core page variants (`@page blank` / `@page full-bleed`, markers.js)
  "gp-page-blank", "gp-page-full-bleed",
  // fragmentation controls (#225/#228)
  "gp-no-break", "gp-break-before",
  // shape wrap
  "gp-shape",
  // pin + edge modifiers + the paper's-edge escape hatch
  "gp-pin", "gp-top", "gp-bottom", "gp-flush",
  // depth ladder
  "gp-behind", "gp-base", "gp-raised", "gp-front",
  // GFM alert boxes (#237, gfm-alerts.ts) — base + the five GitHub types + label
  "gp-alert", "gp-alert-title",
  "gp-alert-note", "gp-alert-tip", "gp-alert-important", "gp-alert-warning", "gp-alert-caution",
  // MARKER_CSS (markers.js) — structural break classes
  "gp-page-break", "gp-column-break",
  // marker-only, no CSS rule of its own (see the doc comment above)
  "gp-continued",
]);

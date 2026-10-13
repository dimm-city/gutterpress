(() => {
  var __defProp = Object.defineProperty;
  var __returnValue = (v) => v;
  function __exportSetter(name, newValue) {
    this[name] = __returnValue.bind(null, newValue);
  }
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, {
        get: all[name],
        enumerable: true,
        configurable: true,
        set: __exportSetter.bind(all, name)
      });
  };

  // src/engine/viewer/fragment.ts
  var exports_fragment = {};
  __export(exports_fragment, {
    wrapGeometry: () => wrapGeometry,
    waitForLayoutReady: () => waitForLayoutReady,
    versoShiftPt: () => versoShiftPt,
    synthesizeColumnBreaks: () => synthesizeColumnBreaks,
    stripMetrics: () => stripMetrics,
    strideOf: () => strideOf,
    stabilizeFullHeightPageRoots: () => stabilizeFullHeightPageRoots,
    spreadModeSupported: () => spreadModeSupported,
    runPageBox: () => runPageBox,
    rowStrideOf: () => rowStrideOf,
    pageRangeOf: () => pageRangeOf,
    pageOf: () => pageOf,
    padToSignature: () => padToSignature,
    measure: () => measure,
    makeOverflowFragmentable: () => makeOverflowFragmentable,
    loadStyleSources: () => loadStyleSources,
    injectViewerCss: () => injectViewerCss,
    injectBreakMapping: () => injectBreakMapping,
    indexInStrip: () => indexInStrip,
    fragmentDocument: () => fragmentDocument,
    cssZoomOf: () => cssZoomOf,
    contentEdgeRect: () => contentEdgeRect,
    compensateRepeatedHeaders: () => compensateRepeatedHeaders,
    compensateRectoBreaks: () => compensateRectoBreaks,
    columnReserve: () => columnReserve,
    collectCssText: () => collectCssText,
    buildStrips: () => buildStrips,
    blankPageIndices: () => blankPageIndices,
    applySpreadMode: () => applySpreadMode,
    PX_PER_PT: () => PX_PER_PT
  });

  // src/engine/viewer/viewer.css
  var viewer_default = `/* Gutterpress viewer chrome. The author's content CSS is untouched; everything here
   is scoped to Gutterpress's own wrappers/layers. */

/* The stage backdrop is viewer chrome and must stay chrome: this rule (0-1-0)
   deliberately outranks an author's \`body { background: … }\` (0-0-1). An
   author's canvas background is not lost — \`decorate()\` reads it before this
   class is applied and replays it on every sheet, which is where print puts
   it (see \`captureCanvasBackground\`). */
.gp-stage {
  --gp-sheet-bg: #fff;
  --gp-stage-bg: #4a4a52;
  --gp-guide: #e5484d;
  --gp-safe: #30a46c;
  background: var(--gp-stage-bg);
  margin: 0;
  padding: 32px;
  /* No \`overflow\` of its own. The page scrolls through the viewport, which
     scrolls on its own. An \`overflow: auto\` here only ever reached the
     viewport by propagation; once a host clips \`<html>\` (fit-to-width), it
     stopped propagating and made the body a sideways scroller whose
     scrollbars sit off-screen (#353). */
  /* Standalone pages use \`--gutterpress-fit-zoom\`; embedded previews use the
     host-owned \`--gutterpress-zoom\`. fitZoom() guarantees only one is active. */
  --gp-zoom: calc(var(--gutterpress-zoom, 1) * var(--gutterpress-fit-zoom, 1));
  /* Zoom is a pure paint transform, NEVER CSS \`zoom\`. \`zoom\` changes layout
     inputs (font sizes and lengths are scaled before text shaping and
     LayoutUnit snapping), so Chromium's column fragmentation broke lines at
     different points per zoom level: in the user guide a paragraph sat on
     page 6 at 50% and page 7 at 25%, and the same book paginated differently
     at 25/50/75/100/150% (#318). \`transform\` leaves layout untouched, so the
     pages are the ones print produces at every zoom.
     Layout width is the visible width / zoom, which is what \`zoom\` gave.
     A transform does not shrink the parent's layout box, so a scaled-down
     stage would leave dead scroll space below it. Taking the stage out of
     flow makes the viewport's scrollable overflow exactly its transformed
     extent, as \`zoom\` had it. */
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: border-box;
  width: calc(100% / var(--gp-zoom));
  transform: scale(var(--gp-zoom));
  transform-origin: 0 0;
}

/* One flow strip per named-page run. Chromium fragments its content into
   columns; each column IS a page's content area. \`width\` is deliberately ONE
   column wide — it sizes the strip's own box to the first page's content
   area, matching where the strip sits inside that sheet (see the transform
   below). \`overflow\` must stay \`visible\`: with a fixed height and no
   \`column-count\`, Chromium creates as many columns as the content needs,
   extending past this box in the inline direction (\`scrollWidth\` — read by
   \`measure()\` — reflects the true extent). \`overflow: hidden\` here would
   clip every column past the first from painting while leaving
   getClientRects()/scrollWidth (and so pageOf()) unaffected, so pages 2+ of
   a run would measure correctly but render blank — the \`.gp-run\` wrapper
   below is already sized to the run's full width and owns the actual
   clipping/visibility, so the strip does not need to. */
.gp-strip {
  /* Column pitch less the content width. \`--gp-verso-shift\` is set only on a
     book with mirrored margins: decorate.ts slides each verso's sheet by it,
     and growing the pitch by the same amount keeps the gap between a verso and
     the recto it faces at the sheet gap (the gap across the page turn gets
     twice the shift instead). Without it, it is 0px and nothing changes. */
  --gp-col-gap: calc(
    var(--gp-margin-right) + var(--gp-margin-left) + var(--gp-sheet-gap) +
      var(--gp-verso-shift, 0px)
  );
  position: relative;
  width: var(--gp-content-w);
  height: var(--gp-content-h);
  column-width: var(--gp-content-w);
  column-gap: var(--gp-col-gap);
  column-fill: auto;
  overflow: visible;
  margin: 0;
  /* strip sits inside the first sheet's content box */
  transform: translate(var(--gp-margin-left), var(--gp-margin-top));
}

/* NOTE: there is deliberately no \`.gp-strip > * { break-inside: auto }\` here.
   The original spike shipped one, under a comment about sheet transparency that
   described no rule of its own, and it was never justified anywhere. Because
   viewer chrome is injected after the author's stylesheet, it beat every
   single-class author rule at equal specificity: a top-level block the author
   declared atomic (\`.card\`, \`.section\`, a stat block) split on screen while the
   PDF moved it whole and left a short page. Measured on
   \`docs/fixtures/atomic-blocks\`: print 6pp, viewer 5pp with the rule, 6pp and
   6pp without it; a longer probe of the same shape ran 25pp against 21pp.
   Chromium honours \`break-inside: avoid\` in multicol as it does in paged media,
   including relaxing it for a block too tall to fit an empty fragmentainer, so
   nothing here needs to override the author.

   Scope: \`>\` means this only ever reached the flow root's OWN children, so a
   book whose atomic blocks sit inside \`@page\`/\`@section\` wrappers was never
   affected — which is why removing it did not move the dc-op-manual field
   guide's divergence.

   That separate divergence is now PARTLY closed. Its cause was
   \`compensateTrailingMarginsBeforeAvoids\`, a viewer shim built on the false
   premise that print discards a trailing margin at a fragmentainer edge.
   Measured with printToPDF on the shim's own fixture: print keeps the margin
   and defers the avoid block (8 print pages; the viewer reported 6). Removing
   it took the field guide from viewer 294 / PDF 295 to 295 / 295.

   STILL OPEN, and NOT what that shim caused: an interior +1 then -1 pair,
   opening after PDF p108 (inside Gutterdruid) and closing before p176
   (Wirephreak), so roughly p109-p153 is one page out of register while the
   totals still agree. Anchor it with image identity, not text — that PDF has
   no extractable body text; \`rabbit-walking.png\` (1379x2530, unique) sits on
   PDF p134 vs viewer folio 135. */

/* View mode (\`applySpreadMode\` in fragment.ts): wraps this run's multicol
   columns into \`--gp-wrap-cols\` ROWS instead of one long row — 2 for
   two-up/spread, 1 for single (a plain vertical stack of pages), using
   CSS Multicol L2's \`column-wrap: wrap\` + \`column-height\` (shipped unflagged
   Chrome/Edge 145+ — CSS.supports-gated in JS, so this selector only ever
   matches on a browser that has it; the base \`.gp-strip\` rules above are
   the single-row fallback everywhere else). \`row-gap\` mirrors \`column-gap\`
   above: content box height + top/bottom margins + the visual sheet gap, so
   consecutive wrapped rows are spaced exactly one page-pitch apart, matching
   how \`column-gap\` already encodes left/right margins for columns within a
   row. Width reserves the full column count so a lone page (a strip with
   only one fragment) still gets its correct left/right slot in two-up, with
   nothing inserted to fill the other. */
.gp-strip[data-wrap="on"] {
  column-wrap: wrap;
  column-height: var(--gp-content-h);
  column-count: var(--gp-wrap-cols, 2);
  row-gap: calc(
    var(--gp-margin-top) + var(--gp-margin-bottom) + var(--gp-sheet-gap)
  );
  width: calc(
    var(--gp-content-w) * var(--gp-wrap-cols, 2) +
      var(--gp-col-gap) * (var(--gp-wrap-cols, 2) - 1)
  );
}

/* Cross-run correctness (no padding, no inserted PAGE): a run whose first
   physical page is a RECTO would otherwise fall into multicol's first
   (LEFT) grid slot and get grouped with the verso that follows it — wrong
   side AND wrong pairing (a recto pairs with the verso that PRECEDES it).
   \`fragment.ts\`'s \`applySpreadMode\` inserts this as the strip's first
   child to consume exactly ONE column-flow slot with zero content, pushing
   the run's real content one slot later so it lands correctly — see its
   doc comment for why a same-box CSS-only mirror (e.g. \`direction: rtl\`)
   cannot fix this (it changes placement, not grouping). */
.gp-wrap-spacer {
  break-after: column;
  height: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.gp-run {
  position: relative;
  margin: 0 0 var(--gp-sheet-gap);
  /* Hit-transparent, like \`.gp-layer\` below: in wrap mode a recto-starting
     run is pulled up over the previous run's last row (decorate.ts's
     cross-run negative margin-top — the spread-composition overlap), and
     its leading \`.gp-wrap-spacer\` slot is visually empty. The covered page
     paints through, but the run's full-width box used to win
     elementFromPoint there, so clicks, right-clicks, link hits, and text
     selection were all dead on every covered page (measured: 60/60 dead
     probe points in two-column view). Runs are viewer chrome — only author
     content may capture hits. */
  pointer-events: none;
}

/* …and the author's content re-enables hit testing. Equal specificity with
   \`.gp-run { pointer-events: none }\` above, so ORDER is load-bearing:
   \`auto\` must come after \`none\`. */
.gp-strip > * {
  pointer-events: auto;
}

.gp-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.gp-sheet {
  position: absolute;
  top: 0;
  width: var(--gp-page-w);
  height: var(--gp-page-h);
  background: var(--gp-sheet-bg);
  box-shadow: 0 2px 12px rgb(0 0 0 / 0.35);
}

.gp-marginbox {
  position: absolute;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: pre;
  font: inherit;
  color: inherit;
}

.gp-marginbox[data-align="start"] { justify-content: flex-start; }
.gp-marginbox[data-align="center"] { justify-content: center; }
.gp-marginbox[data-align="end"] { justify-content: flex-end; }

/* The outer .gp-marginbox is the fixed geometric slot; this inner generated
   box receives the author's @page margin-box declarations. It defaults to the
   slot's full dimensions (the \`auto\` margin-box case), while explicit author
   width/height such as \`fit-content\` override these declarations and the
   outer flex alignment keeps the resulting sticker on the correct edge. */
.gp-marginbox-content {
  box-sizing: border-box;
  display: flex;
  align-items: center;
  width: 100%;
  height: 100%;
  min-width: 0;
  white-space: inherit;
}

.gp-marginbox[data-align="start"] > .gp-marginbox-content { justify-content: flex-start; }
.gp-marginbox[data-align="center"] > .gp-marginbox-content { justify-content: center; }
.gp-marginbox[data-align="end"] > .gp-marginbox-content { justify-content: flex-end; }

/* margin & bleed overlay (overlay.ts) -------------------------------- */
/* THE LOOK LIVES HERE, in these tokens, and nowhere else: colours, line
   width, line style, tint strength. The desktop app's settings change the
   colour (an inline \`--gp-ov-color\` on <body>) and pick a strength preset
   (\`data-overlay-strength\`); nothing in a book's CSS is involved or needed. */
.gp-stage {
  --gp-ov-color: #2f80ed;       /* margin box line + the tint over the margins */
  --gp-ov-width: 2px;           /* line width as seen on screen, at any zoom */
  --gp-ov-style: dashed;        /* margin box line style */
  --gp-ov-tint: 0.1;            /* opacity of the tint over the margin area */
  --gp-ov-bleed-color: #e5484d; /* bleed band + trim line */
  --gp-ov-bleed-alpha: 0.45;    /* opacity of the bleed band */
  --gp-ov-trim-color: #8a0b18;  /* the trim line: darker than the band so it reads as an edge */
  --gp-ov-flag-width: 2px;      /* overflow flag outline */
  --gp-ov-warn: #f59e0b;        /* reaches into the margin */
  --gp-ov-error: #e5484d;       /* crosses the trim / leaves the page */
  --gp-ov-intent: #8b5cf6;      /* placed on purpose */
}
.gp-stage[data-overlay-strength="subtle"] {
  --gp-ov-width: 1px;
  --gp-ov-tint: 0.05;
  --gp-ov-bleed-alpha: 0.3;
}
.gp-stage[data-overlay-strength="strong"] {
  --gp-ov-width: 3px;
  --gp-ov-tint: 0.2;
  --gp-ov-bleed-alpha: 0.65;
  --gp-ov-flag-width: 3px;
}

/* One sibling layer per run, ABOVE the strip so the lines stay visible over
   author backgrounds and art. Absolutely positioned and pointer-transparent:
   it takes no flow space and no hits, so it cannot move a page break. Exists
   only while the overlay is on. */
.gp-ov {
  position: absolute;
  inset: 0;
  z-index: 5;
  pointer-events: none;
  /* The stage is a paint transform, so a 2px line would shrink with the zoom
     and vanish at fit-to-width. Lines are sized in layout px divided by the
     zoom, which makes them the same width on screen at every zoom. */
  --gp-ov-w: calc(var(--gp-ov-width) / var(--gp-zoom, 1));
  --gp-ov-flag-w: calc(var(--gp-ov-flag-width) / var(--gp-zoom, 1));
}

.gp-ov-page {
  position: absolute;
}

/* the margins as a region: the trim minus the content box (clip-path, set in
   overlay.ts), so a margin reads as an area, not a hairline */
.gp-ov-tint {
  position: absolute;
  inset: 0;
  background: color-mix(in srgb, var(--gp-ov-color) calc(var(--gp-ov-tint) * 100%), transparent);
}

/* margin box: the content area's outline */
.gp-ov-margin {
  position: absolute;
  box-sizing: border-box;
  border: var(--gp-ov-w) var(--gp-ov-style) var(--gp-ov-color);
}

/* bleed: a translucent band OUTSIDE the trim (its width is the border) */
.gp-ov-bleed {
  position: absolute;
  box-sizing: border-box;
  border-style: solid;
  border-color: color-mix(in srgb, var(--gp-ov-bleed-color) calc(var(--gp-ov-bleed-alpha) * 100%), transparent);
}

/* trim: where the sheet will be cut, drawn only when there is bleed — solid,
   just inside the edge so it never paints over the band (overlay.ts sizes and
   places it: the whole sheet, or the sheet less an in-sheet bleed) */
.gp-ov-trim {
  position: absolute;
  outline: var(--gp-ov-w) solid var(--gp-ov-trim-color);
  outline-offset: calc(-1 * var(--gp-ov-w));
}

/* overflow flags — outline + faint tint, never a box change */
.gp-ov-flag {
  position: absolute;
  box-sizing: border-box;
}
.gp-ov-flag[data-kind="margin"] {
  outline: var(--gp-ov-flag-w) solid var(--gp-ov-warn);
  background: color-mix(in srgb, var(--gp-ov-warn) 16%, transparent);
}
.gp-ov-flag[data-kind="bleed"],
.gp-ov-flag[data-kind="off-page"] {
  outline: var(--gp-ov-flag-w) solid var(--gp-ov-error);
  background: color-mix(in srgb, var(--gp-ov-error) 18%, transparent);
}
/* placed on purpose (.gp-bleed, .gp-pin, …): present, not a problem */
.gp-ov-flag[data-kind="intended"] {
  outline: var(--gp-ov-flag-w) dotted var(--gp-ov-intent);
}

/* designer mode ------------------------------------------------------- */
.gp-guide-trim,
.gp-guide-safe,
.gp-crop-mark {
  position: absolute;
  pointer-events: none;
  display: none;
}

.gp-stage[data-designer="on"] .gp-guide-trim,
.gp-stage[data-designer="on"] .gp-guide-safe,
.gp-stage[data-designer="on"] .gp-crop-mark {
  display: block;
}

.gp-guide-trim { outline: 1px dashed var(--gp-guide); }
.gp-guide-safe { outline: 1px dashed var(--gp-safe); }
.gp-crop-mark { background: var(--gp-guide); }

.gp-warning {
  position: absolute;
  right: 4px;
  top: 4px;
  background: var(--gp-guide);
  color: #fff;
  font: 600 10px/1.4 ui-sans-serif, system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 3px;
}

/* An accidental Ctrl+P on the published page must not print the dark stage
   plus decorations — the PDF, shipped alongside book.html, is the print
   artifact. This is a minimal reset, not a print layout. */
@media print {
  .gp-stage {
    background: none;
    padding: 0;
    overflow: visible;
    position: static;
    width: auto;
    transform: none;
  }
  .gp-layer,
  .gp-ov,
  .gp-warning,
  .gp-guide-trim,
  .gp-guide-safe,
  .gp-crop-mark {
    display: none !important;
  }
  .gp-sheet {
    box-shadow: none;
  }
}
`;

  // src/engine/shared/gcpm-extract.ts
  var exports_gcpm_extract = {};
  __export(exports_gcpm_extract, {
    toPt: () => toPt,
    splitTopLevel: () => splitTopLevel,
    resolvePage: () => resolvePage,
    parseSize: () => parseSize,
    parseMargin: () => parseMargin,
    parseDeclarations: () => parseDeclarations,
    mediaPrintBodies: () => mediaPrintBodies,
    extract: () => extract,
    PAGE_SIZES: () => PAGE_SIZES,
    MARGIN_BOX_NAMES: () => MARGIN_BOX_NAMES
  });
  var MARGIN_BOX_NAMES = [
    "top-left-corner",
    "top-left",
    "top-center",
    "top-right",
    "top-right-corner",
    "bottom-left-corner",
    "bottom-left",
    "bottom-center",
    "bottom-right",
    "bottom-right-corner",
    "left-top",
    "left-middle",
    "left-bottom",
    "right-top",
    "right-middle",
    "right-bottom"
  ];
  var NESTED_AT_RULES = /^@(media|supports|layer|scope|container|document)\b/i;
  function scanRules(css) {
    const out = [];
    let i = 0;
    let start = 0;
    let depth = 0;
    let bodyStart = -1;
    while (i < css.length) {
      const c = css[i];
      if (c === "/" && css[i + 1] === "*") {
        const end = css.indexOf("*/", i + 2);
        i = end === -1 ? css.length : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipString(css, i);
        continue;
      }
      if (c === "{") {
        if (depth === 0)
          bodyStart = i;
        depth++;
        i++;
        continue;
      }
      if (c === "}") {
        depth--;
        if (depth === 0) {
          out.push({
            prelude: stripComments(css.slice(start, bodyStart)).trim(),
            body: css.slice(bodyStart + 1, i)
          });
          start = i + 1;
        }
        i++;
        continue;
      }
      if (c === ";" && depth === 0) {
        const stmt = stripComments(css.slice(start, i)).trim();
        if (stmt)
          out.push({ statement: stmt });
        start = i + 1;
        i++;
        continue;
      }
      i++;
    }
    return out;
  }
  function stripComments(s) {
    let out = "";
    let i = 0;
    while (i < s.length) {
      if (s[i] === "/" && s[i + 1] === "*") {
        const end = s.indexOf("*/", i + 2);
        i = end === -1 ? s.length : end + 2;
        continue;
      }
      if (s[i] === '"' || s[i] === "'") {
        const end = skipString(s, i);
        out += s.slice(i, end);
        i = end;
        continue;
      }
      out += s[i++];
    }
    return out;
  }
  function skipString(css, i) {
    const quote = css[i];
    i++;
    while (i < css.length) {
      if (css[i] === "\\")
        i += 2;
      else if (css[i] === quote)
        return i + 1;
      else
        i++;
    }
    return i;
  }
  function parseDeclarations(body) {
    const decls = {};
    let i = 0;
    let start = 0;
    let depth = 0;
    const push = (chunk) => {
      const s = stripComments(chunk).trim();
      if (!s)
        return;
      const colon = indexOfTopLevel(s, ":");
      if (colon <= 0)
        return;
      const rawProp = s.slice(0, colon).trim();
      const prop = rawProp.startsWith("--") ? rawProp : rawProp.toLowerCase();
      const value = s.slice(colon + 1).trim().replace(/\s*!important$/i, "");
      if (prop)
        decls[prop] = value;
    };
    while (i < body.length) {
      const c = body[i];
      if (c === "/" && body[i + 1] === "*") {
        const end = body.indexOf("*/", i + 2);
        i = end === -1 ? body.length : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipString(body, i);
        continue;
      }
      if (c === "(" || c === "{" || c === "[")
        depth++;
      else if (c === ")" || c === "}" || c === "]")
        depth--;
      else if (c === ";" && depth === 0) {
        push(body.slice(start, i));
        start = i + 1;
      }
      i++;
    }
    push(body.slice(start));
    return decls;
  }
  function indexOfTopLevel(s, ch) {
    let depth = 0;
    for (let i = 0;i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = skipString(s, i) - 1;
        continue;
      }
      if (c === "(")
        depth++;
      else if (c === ")")
        depth--;
      else if (c === ch && depth === 0)
        return i;
    }
    return -1;
  }
  function mediaPrintBodies(css) {
    const out = [];
    for (const rule of scanRules(css)) {
      if ("statement" in rule)
        continue;
      if (/^@media/i.test(rule.prelude)) {
        const q = rule.prelude.replace(/^@media/i, "").trim();
        if (/print/i.test(q) && !/not\s+print/i.test(q))
          out.push(rule.body);
      }
    }
    return out;
  }
  function extract(css) {
    const model = {
      pageRules: [],
      stringSets: [],
      pageAssignments: [],
      breaks: [],
      xrefs: [],
      counterResets: [],
      pageNames: [],
      warnings: []
    };
    walk(css, model);
    resolveGeometryVars(model, collectRootCustomProperties(css));
    const names = new Set;
    for (const r of model.pageRules)
      if (r.name)
        names.add(r.name);
    for (const a of model.pageAssignments)
      names.add(a.page);
    model.pageNames = [...names];
    return model;
  }
  var GEOMETRY_PROPS = [
    "size",
    "margin",
    "margin-top",
    "margin-right",
    "margin-bottom",
    "margin-left",
    "bleed",
    "marks"
  ];
  function collectRootCustomProperties(css) {
    const props = new Map;
    const walkForRoot = (body) => {
      for (const rule of scanRules(body)) {
        if ("statement" in rule)
          continue;
        const { prelude, body: ruleBody } = rule;
        if (NESTED_AT_RULES.test(prelude)) {
          walkForRoot(ruleBody);
          continue;
        }
        if (!prelude.startsWith("@")) {
          const selectors = splitTopLevel(prelude, ",");
          if (selectors.some((s) => s.trim() === ":root")) {
            const decls = parseDeclarations(ruleBody);
            for (const [k, v] of Object.entries(decls)) {
              if (k.startsWith("--"))
                props.set(k, v);
            }
          }
        }
      }
    };
    walkForRoot(css);
    return props;
  }
  function matchParen(s, open) {
    let depth = 0;
    let i = open;
    while (i < s.length) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = skipString(s, i);
        continue;
      }
      if (c === "(")
        depth++;
      else if (c === ")") {
        depth--;
        if (depth === 0)
          return i;
      }
      i++;
    }
    return -1;
  }
  function resolveVarsInValue(value, customProps, stack = new Set) {
    let out = "";
    let i = 0;
    while (i < value.length) {
      const isVarStart = /^var\(/i.test(value.slice(i, i + 4)) && (i === 0 || !/[\w-]/.test(value[i - 1]));
      if (!isVarStart) {
        out += value[i];
        i++;
        continue;
      }
      const open = i + 3;
      const close = matchParen(value, open);
      if (close === -1) {
        out += value.slice(i);
        break;
      }
      const inner = value.slice(open + 1, close);
      const commaIdx = indexOfTopLevel(inner, ",");
      const name = (commaIdx === -1 ? inner : inner.slice(0, commaIdx)).trim();
      const fallback = commaIdx === -1 ? undefined : inner.slice(commaIdx + 1).trim();
      if (!/^--[\w-]+$/.test(name)) {
        return { text: out, unresolved: `var(${inner}) is not a valid custom property reference` };
      }
      if (stack.has(name)) {
        return { text: out, unresolved: `var(${name}) is circular` };
      }
      const rootValue = customProps.get(name);
      if (rootValue !== undefined) {
        const nested = resolveVarsInValue(rootValue, customProps, new Set(stack).add(name));
        if (nested.unresolved)
          return { text: out, unresolved: nested.unresolved };
        out += nested.text;
      } else if (fallback !== undefined) {
        if (/\bvar\(/i.test(fallback)) {
          return {
            text: out,
            unresolved: `var(${name}, ${fallback}) — a fallback containing another var() is not resolved`
          };
        }
        out += fallback;
      } else {
        return {
          text: out,
          unresolved: `${name} is not defined at :root and var() has no fallback`
        };
      }
      i = close + 1;
    }
    return { text: out };
  }
  function resolveGeometryVars(model, customProps) {
    for (const rule of model.pageRules) {
      for (const prop of GEOMETRY_PROPS) {
        const value = rule.decls[prop];
        if (!value || !/\bvar\(/i.test(value))
          continue;
        const { text, unresolved } = resolveVarsInValue(value, customProps);
        if (unresolved) {
          throw new Error(`${rule.raw} { ${prop}: ${value} } — cannot resolve ${unresolved}. ` + `Define the custom property at :root, add a literal var(--x, fallback) fallback, or use a literal value.`);
        }
        const unparsable = unparsableGeometry(prop, text);
        if (unparsable) {
          throw new Error(`${rule.raw} { ${prop}: ${value} } — resolves to \`${text.trim()}\`, ${unparsable}. ` + `Use a value this engine can read (a length like 0.75in/12pt/10mm, or a named page size for \`size\`).`);
        }
        rule.decls[prop] = text;
      }
    }
  }
  function unparsableGeometry(prop, text) {
    const t = text.trim();
    if (prop === "size") {
      if (!t)
        return "which is empty";
      return parseSize(t) ? undefined : "which is not a page size";
    }
    if (prop === "margin" || prop.startsWith("margin-")) {
      if (!t)
        return "which is empty";
      const parts = t.split(/\s+/);
      if (prop !== "margin" && parts.length !== 1)
        return "which is not a single length";
      if (parts.length > 4)
        return "which is not a valid margin";
      const bad = parts.filter((p) => toPt(p) === undefined);
      if (bad.length)
        return `which this engine cannot read as a length (\`${bad[0]}\`)`;
      return;
    }
    if (prop === "bleed") {
      if (!t)
        return "which is empty";
      if (/^(auto|none)$/i.test(t))
        return;
      return toPt(t) === undefined ? "which this engine cannot read as a length" : undefined;
    }
    return;
  }
  function walk(css, model) {
    for (const rule of scanRules(css)) {
      if ("statement" in rule)
        continue;
      const { prelude, body } = rule;
      if (NESTED_AT_RULES.test(prelude)) {
        walk(body, model);
        continue;
      }
      if (/^@page\b/i.test(prelude)) {
        model.pageRules.push(parsePageRule(prelude, body));
        continue;
      }
      if (prelude.startsWith("@"))
        continue;
      parseQualifiedRule(prelude, body, model);
    }
  }
  function parsePageRule(prelude, body) {
    const sel = prelude.replace(/^@page\s*/i, "").trim();
    const nameMatch = /^([A-Za-z_][\w-]*)/.exec(sel);
    const pseudos = [...sel.matchAll(/:([A-Za-z-]+)(\([^)]*\))?/g)].map((m) => m[1] + (m[2] ?? ""));
    const rule = {
      name: nameMatch?.[1],
      pseudos,
      decls: {},
      marginBoxes: {},
      raw: `@page ${sel}`.trim()
    };
    let rest = "";
    let i = 0;
    while (i < body.length) {
      const at = findNextAtRule(body, i);
      if (at === -1) {
        rest += body.slice(i);
        break;
      }
      rest += body.slice(i, at);
      const open = body.indexOf("{", at);
      if (open === -1) {
        rest += body.slice(at);
        break;
      }
      const name = body.slice(at + 1, open).trim().toLowerCase();
      let depth = 1;
      let j = open + 1;
      while (j < body.length && depth > 0) {
        const c = body[j];
        if (c === "/" && body[j + 1] === "*") {
          const end = body.indexOf("*/", j + 2);
          j = end === -1 ? body.length : end + 2;
          continue;
        }
        if (c === '"' || c === "'") {
          j = skipString(body, j);
          continue;
        }
        if (c === "{")
          depth++;
        else if (c === "}")
          depth--;
        j++;
      }
      rule.marginBoxes[`@${name}`] = parseDeclarations(body.slice(open + 1, j - 1));
      i = j;
    }
    rule.decls = parseDeclarations(rest);
    return rule;
  }
  function findNextAtRule(body, start) {
    let i = start;
    while (i < body.length) {
      const c = body[i];
      if (c === "/" && body[i + 1] === "*") {
        const end = body.indexOf("*/", i + 2);
        i = end === -1 ? body.length : end + 2;
        continue;
      }
      if (c === '"' || c === "'") {
        i = skipString(body, i);
        continue;
      }
      if (c === "@")
        return i;
      i++;
    }
    return -1;
  }
  function parseQualifiedRule(selector, body, model) {
    const decls = parseDeclarations(body);
    for (const [prop, value] of Object.entries(decls)) {
      if (prop === "string-set") {
        for (const entry of splitTopLevel(value, ",")) {
          const m = /^\s*([A-Za-z_][\w-]*)\s+(.+)$/.exec(entry);
          if (m && m[1] !== undefined && m[2] !== undefined)
            model.stringSets.push({ selector, name: m[1], value: m[2].trim() });
        }
      } else if (prop === "page") {
        if (value && value !== "auto")
          model.pageAssignments.push({ selector, page: value.trim() });
      } else if (prop === "break-before" || prop === "break-after" || prop === "break-inside") {
        model.breaks.push({ selector, prop, value });
      } else if (prop === "counter-reset") {
        const m = /\bpage\s+(-?\d+)/.exec(value);
        if (m)
          model.counterResets.push({ selector, start: Number(m[1]) });
      } else if (prop === "content") {
        for (const fn of ["target-counter", "target-text", "leader", "string"]) {
          if (new RegExp(`\\b${fn}\\s*\\(`).test(value)) {
            model.xrefs.push({ selector, content: value, fn });
          }
        }
      }
    }
  }
  function splitTopLevel(s, sep) {
    const out = [];
    let depth = 0;
    let start = 0;
    for (let i = 0;i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = skipString(s, i) - 1;
        continue;
      }
      if (c === "(")
        depth++;
      else if (c === ")")
        depth--;
      else if (c === sep && depth === 0) {
        out.push(s.slice(start, i));
        start = i + 1;
      }
    }
    out.push(s.slice(start));
    return out.map((x) => x.trim()).filter(Boolean);
  }
  var UNITS_PER_PT = {
    pt: 1,
    px: 0.75,
    in: 72,
    pc: 12,
    cm: 72 / 2.54,
    mm: 72 / 25.4,
    q: 72 / 101.6
  };
  function toPt(value) {
    const m = /^(-?[\d.]+)([a-z%]*)$/i.exec(value.trim());
    if (!m)
      return;
    const n = Number(m[1]);
    const unit = (m[2] || "px").toLowerCase();
    const factor = UNITS_PER_PT[unit];
    return factor === undefined ? undefined : n * factor;
  }
  var PAGE_SIZES = {
    a5: [419.53, 595.28],
    a4: [595.28, 841.89],
    a3: [841.89, 1190.55],
    b5: [498.9, 708.66],
    b4: [708.66, 1000.63],
    "jis-b5": [515.91, 728.5],
    "jis-b4": [728.5, 1031.81],
    letter: [612, 792],
    legal: [612, 1008],
    ledger: [1224, 792]
  };
  function parseSize(value) {
    const parts = value.trim().split(/\s+/);
    let landscape = false;
    const lens = [];
    let named;
    for (const p of parts) {
      const key = p.toLowerCase();
      if (key === "landscape")
        landscape = true;
      else if (key === "portrait")
        continue;
      else if (PAGE_SIZES[key])
        named = PAGE_SIZES[key];
      else {
        const pt = toPt(p);
        if (pt !== undefined)
          lens.push(pt);
      }
    }
    let w, h;
    if (named)
      [w, h] = named;
    else if (lens.length === 1)
      [w, h] = [lens[0], lens[0]];
    else if (lens.length >= 2)
      [w, h] = [lens[0], lens[1]];
    else
      return;
    if (landscape && h > w)
      [w, h] = [h, w];
    return { width: w, height: h };
  }
  function parseMargin(value) {
    const parts = value.trim().split(/\s+/).map((p) => toPt(p) ?? 0);
    const a = parts[0] ?? 0;
    const b = parts[1] ?? a;
    const c = parts[2] ?? a;
    const d = parts[3] ?? b;
    return { top: a, right: b, bottom: c, left: d };
  }
  function resolvePage(model, ctx = {}) {
    const wanted = new Set(ctx.pseudos ?? []);
    const applicable = model.pageRules.filter((r) => r.name ? r.name === ctx.name : true).filter((r) => r.pseudos.every((p) => wanted.has(p))).sort((a, b) => specificity(a) - specificity(b));
    const decls = {};
    const marginBoxes = {};
    const margin = { top: 72, right: 72, bottom: 72, left: 72 };
    for (const rule of applicable) {
      for (const [prop, value] of Object.entries(rule.decls)) {
        if (prop === "margin")
          Object.assign(margin, parseMargin(value));
        else if (prop === "margin-top" || prop === "margin-right" || prop === "margin-bottom" || prop === "margin-left") {
          const side = prop.slice(7);
          margin[side] = toPt(value) ?? margin[side];
        }
      }
      Object.assign(decls, rule.decls);
      for (const [box, d] of Object.entries(rule.marginBoxes)) {
        marginBoxes[box] = { ...marginBoxes[box] ?? {}, ...d };
      }
    }
    const size = parseSize(decls.size ?? "letter") ?? { width: 612, height: 792 };
    return {
      decls,
      marginBoxes,
      geometry: {
        width: size.width,
        height: size.height,
        margin,
        bleed: decls.bleed ? toPt(decls.bleed) ?? 0 : 0,
        marks: (decls.marks ?? "none").split(/\s+/).filter((m) => m && m !== "none")
      }
    };
  }
  function specificity(r) {
    return (r.name ? 2 : 0) + r.pseudos.length;
  }

  // src/engine/shared/synthesis.ts
  var RECTO_VERSO_VALUES = /^(right|recto|left|verso)$/;
  function isRectoVersoBreak(decl) {
    return decl.prop === "break-before" && RECTO_VERSO_VALUES.test(decl.value.trim());
  }
  function wantsRecto(value) {
    return /^(right|recto)$/.test(value.trim());
  }
  function planRectoBlanks(sites) {
    let shift = 0;
    return sites.map((site) => {
      if (site.page <= 0)
        return false;
      const effective = site.page + shift;
      const onRecto = effective % 2 === 1;
      const wrong = site.wantsRecto ? !onRecto : onRecto;
      if (wrong)
        shift++;
      return wrong;
    });
  }
  function signaturePadding(pageCount, signature = 1, lastPage) {
    const size = signature > 1 ? signature : 1;
    if (lastPage === "short-by-one")
      return (size - (pageCount + 1) % size) % size;
    const padded = (size - pageCount % size) % size;
    return padded === 0 && lastPage === "blank" ? size : padded;
  }
  var WHICH_VALUES = new Set(["first", "start", "last", "first-except"]);
  function parseWhich(raw) {
    const w = (raw ?? "").trim();
    return WHICH_VALUES.has(w) ? w : "first";
  }
  function stringValueAt(entries, page, which = "first") {
    let entry = "";
    const onPage = [];
    for (const e of entries) {
      if (e.page < page)
        entry = e.value;
      else if (e.page === page)
        onPage.push(e.value);
      else
        break;
    }
    switch (which) {
      case "start":
        return entry;
      case "last":
        return onPage.length ? onPage[onPage.length - 1] : entry;
      case "first-except":
        return onPage.length ? "" : entry;
      case "first":
        return onPage.length ? onPage[0] : entry;
    }
  }
  function pageCounterValues(resets, pageCount) {
    const byPage = new Map;
    for (const r of resets)
      if (r.page >= 1)
        byPage.set(r.page, r.start);
    const values = [];
    let value = 0;
    for (let p = 1;p <= pageCount; p++) {
      if (byPage.has(p))
        value = byPage.get(p) - 1;
      value++;
      values.push(value);
    }
    return values;
  }
  function toFolioPage(physicalPage, pageValues) {
    if (!pageValues)
      return physicalPage;
    return pageValues[physicalPage - 1] ?? physicalPage;
  }
  var LEADER_START = "";
  var LEADER_END = "";
  function leaderMarker(glue) {
    return `${LEADER_START}${glue}${LEADER_END}`;
  }
  var LEADER_RE = /\uE000([^\uE001]*)\uE001/;
  function leaderFillCount(gapPx, gluePx) {
    if (!(gluePx > 0) || !(gapPx > 0))
      return 0;
    return Math.max(0, Math.floor(gapPx / gluePx) - 1);
  }
  function generatedContentCss(selectors) {
    const rules = new Set;
    for (const raw of selectors) {
      for (const one of raw.split(",")) {
        const selector = one.trim();
        if (!selector)
          continue;
        const m = /^(.*?)(::?)(after|before)\s*$/i.exec(selector);
        if (!m)
          continue;
        const [, base, colons, pseudo] = m;
        if (base === undefined || colons === undefined || pseudo === undefined)
          continue;
        const where = pseudo.toLowerCase();
        rules.add(`${base.trim()}[data-gp-${where}]${colons}${where} { content: attr(data-gp-${where}); }`);
      }
    }
    rules.add(`[data-gp-after]::after { content: attr(data-gp-after); }`);
    rules.add(`[data-gp-before]::before { content: attr(data-gp-before); }`);
    return [...rules].join(`
`);
  }

  // src/engine/shared/flush.ts
  var FLUSH_EDGES = ["top", "right", "bottom", "left"];
  function flushEdgesIn(root) {
    return FLUSH_EDGES.filter((edge) => root.querySelector(`.gp-pin.gp-flush.gp-${edge}`));
  }
  function flushMargins(margin, edges) {
    return {
      top: edges.includes("top") ? 0 : margin.top,
      right: edges.includes("right") ? 0 : margin.right,
      bottom: edges.includes("bottom") ? 0 : margin.bottom,
      left: edges.includes("left") ? 0 : margin.left
    };
  }

  // src/engine/viewer/fragment.ts
  var PX_PER_PT = 96 / 72;
  function injectViewerCss(doc = document) {
    if (doc.getElementById("gp-viewer-css"))
      return;
    const style = doc.createElement("style");
    style.id = "gp-viewer-css";
    style.textContent = viewer_default;
    doc.head.appendChild(style);
  }
  var pt = (v) => v * PX_PER_PT;
  function collectCssText(doc = document) {
    let out = "";
    for (const sheet of Array.from(doc.styleSheets)) {
      const owner = sheet.ownerNode;
      if (owner && owner.tagName === "STYLE") {
        out += owner.textContent + `
`;
        continue;
      }
      const raw = owner?.__gpSource;
      if (raw)
        out += raw + `
`;
    }
    return out;
  }
  async function loadStyleSources(doc = document) {
    const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'));
    await Promise.all(links.map(async (l) => {
      if (l.__gpSource)
        return;
      try {
        l.__gpSource = await (await fetch(l.href)).text();
      } catch {
        l.__gpSource = "";
      }
    }));
    return collectCssText(doc);
  }
  var FORCED_PAGE_LIKE = /^(page|left|right|recto|verso)$/;
  function injectBreakMapping(_model, doc = document) {
    doc.getElementById("gp-break-mapping")?.remove();
    return "";
  }
  var FRAGMENT_EPSILON_PX = 1;
  function contentEdgeRect(site, atEnd) {
    const rects = Array.from(site.getClientRects());
    return atEnd ? rects.at(-1) : rects[0];
  }
  function columnReserve(offset, columnHeight) {
    const remaining = columnHeight - offset;
    if (remaining < FRAGMENT_EPSILON_PX)
      return null;
    if (remaining > columnHeight - FRAGMENT_EPSILON_PX)
      return null;
    return Math.ceil(remaining);
  }
  function synthesizeColumnBreaks(model) {
    const sites = [];
    const seen = new WeakMap;
    for (const b of model.breaks) {
      if (b.prop === "break-inside")
        continue;
      if (!FORCED_PAGE_LIKE.test(b.value.trim()))
        continue;
      let els;
      try {
        els = Array.from(document.querySelectorAll(b.selector));
      } catch {
        continue;
      }
      for (const el of els) {
        if (!el.closest(".gp-strip"))
          continue;
        const cs = getComputedStyle(el);
        const effective = b.prop === "break-before" ? cs.breakBefore : cs.breakAfter;
        if (!FORCED_PAGE_LIKE.test(effective.trim()))
          continue;
        const props = seen.get(el) ?? new Set;
        if (props.has(b.prop))
          continue;
        props.add(b.prop);
        seen.set(el, props);
        sites.push({ el, prop: b.prop });
      }
    }
    sites.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    for (const { el, prop } of sites) {
      if (prop === "break-before" && el.style.breakBefore === "auto")
        continue;
      const strip = el.closest(".gp-strip");
      if (!strip)
        continue;
      let site = el;
      if (prop === "break-before") {
        const target = propagatedBreakTarget(el, strip);
        if (!target)
          continue;
        site = target;
      }
      if (prop === "break-after" && !el.nextElementSibling)
        continue;
      const rect = contentEdgeRect(site, prop === "break-after");
      if (!rect)
        continue;
      const stripTop = strip.getBoundingClientRect().top;
      const edge = prop === "break-after" ? rect.bottom : rect.top;
      if (columnReserve((edge - stripTop) / cssZoomOf(strip), strip.clientHeight) === null)
        continue;
      const spacer = document.createElement("div");
      spacer.className = "gp-column-break-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = `${prop}: column; height:0; margin:0; padding:0; border:0;`;
      if (prop === "break-after")
        el.after(spacer);
      else
        site.before(spacer);
    }
  }
  function propagatedBreakTarget(el, strip) {
    let site = el;
    while (!site.previousElementSibling) {
      const parent = site.parentElement;
      if (!parent || parent === strip)
        return null;
      const cs = getComputedStyle(site);
      if (cs.position === "absolute" || cs.position === "fixed" || cs.float !== "none")
        return null;
      for (let node = site.previousSibling;node; node = node.previousSibling) {
        if (node.nodeType === 3 && (node.textContent ?? "").trim() !== "")
          return site;
      }
      const pcs = getComputedStyle(parent);
      if (!/^(block|flow-root)$/.test(pcs.display) || pcs.columnCount !== "auto")
        return null;
      site = parent;
    }
    return site;
  }
  function directPageName(el, model) {
    for (const a of model.pageAssignments) {
      try {
        if (el.matches(a.selector))
          return a.page;
      } catch {}
    }
    return;
  }
  function hasDescendantPageAssignment(el, model) {
    for (const a of model.pageAssignments) {
      try {
        if (el.querySelector(a.selector))
          return true;
      } catch {}
    }
    return false;
  }
  function pushRun(runs, page, nodes, flushEdges) {
    const key = (r) => `${r.page ?? ""}\x00${(r.flushEdges ?? []).join(",")}`;
    const last = runs[runs.length - 1];
    if (last && key(last) === key({ page, flushEdges }))
      last.nodes.push(...nodes);
    else
      runs.push({ page, nodes, flushEdges: flushEdges?.length ? flushEdges : undefined });
  }
  function explodeChildren(container, model) {
    const runs = [];
    let pending = [];
    const carry = () => {
      if (!pending.length)
        return [];
      const held = pending;
      pending = [];
      const last = runs[runs.length - 1];
      if (last) {
        pushRun(runs, last.page, held, last.flushEdges);
        return [];
      }
      if (held.some((n) => (n.textContent ?? "").trim() !== "")) {
        pushRun(runs, undefined, held);
        return [];
      }
      return held;
    };
    for (const node of Array.from(container.childNodes)) {
      if (node.nodeType !== 1) {
        pending.push(node);
        continue;
      }
      const kid = node;
      if (kid.classList.contains("gp-layer"))
        continue;
      const flush = flushEdgesIn(kid);
      const own = directPageName(kid, model);
      if (own !== undefined) {
        pushRun(runs, own, [...carry(), kid], flush);
        continue;
      }
      if (!hasDescendantPageAssignment(kid, model)) {
        pushRun(runs, undefined, [...carry(), kid], flush);
        continue;
      }
      const inner = explodeChildren(kid, model);
      if (inner.length <= 1) {
        pushRun(runs, inner[0]?.page, [...carry(), kid]);
        continue;
      }
      let lead = carry();
      for (const r of inner) {
        const shell = kid.cloneNode(false);
        for (const n of r.nodes)
          shell.appendChild(n);
        kid.before(shell);
        pushRun(runs, r.page, [...lead, shell], flushEdgesIn(shell));
        lead = [];
      }
      kid.remove();
    }
    const trailing = carry();
    if (trailing.length)
      pushRun(runs, undefined, trailing);
    return runs;
  }
  var FORCED_BREAK = /^(column|page|left|right|recto|verso|always)$/;
  function clearLeadingForcedBreaks(strip) {
    for (let el = strip.firstElementChild;el; el = el.firstElementChild) {
      const cs = getComputedStyle(el);
      if (FORCED_BREAK.test(cs.breakBefore))
        el.style.breakBefore = "auto";
    }
  }
  function stabilizeFullHeightPageRoots(model, strips) {
    let stabilized = 0;
    for (const strip of strips) {
      if (!strip.page)
        continue;
      const stripHeight = parseFloat(getComputedStyle(strip.el).getPropertyValue("--gp-content-h"));
      if (!(stripHeight > 0))
        continue;
      for (let el = strip.el.firstElementChild;el; el = el.firstElementChild) {
        if (directPageName(el, model) !== strip.page)
          continue;
        const cs = getComputedStyle(el);
        const height = parseFloat(cs.height);
        const rootRects = el.getClientRects();
        if (cs.display === "block" && cs.position !== "static" && Math.abs(height - stripHeight) <= 0.5 && (rootRects.length > 1 || el.getBoundingClientRect().top - strip.el.getBoundingClientRect().top > 0.5)) {
          el.dataset.gpLeadingPageRootDisplay = el.style.getPropertyValue("display");
          el.dataset.gpLeadingPageRootDisplayPriority = el.style.getPropertyPriority("display");
          el.style.display = "flow-root";
          el.dataset.gpLeadingPageRoot = "stabilized";
          stabilized++;
        }
        break;
      }
    }
    return stabilized;
  }
  function restoreFullHeightPageRoots(doc = document) {
    for (const el of Array.from(doc.querySelectorAll('[data-gp-leading-page-root="stabilized"]'))) {
      const value = el.dataset.gpLeadingPageRootDisplay ?? "";
      const priority = el.dataset.gpLeadingPageRootDisplayPriority ?? "";
      if (value)
        el.style.setProperty("display", value, priority);
      else
        el.style.removeProperty("display");
      delete el.dataset.gpLeadingPageRoot;
      delete el.dataset.gpLeadingPageRootDisplay;
      delete el.dataset.gpLeadingPageRootDisplayPriority;
    }
  }
  var SCROLLABLE = /^(auto|scroll|hidden)$/;
  function makeOverflowFragmentable(strips) {
    const todo = [];
    for (const strip of strips) {
      for (const el of Array.from(strip.el.querySelectorAll("*"))) {
        const cs = getComputedStyle(el);
        const x = SCROLLABLE.test(cs.overflowX);
        const y = SCROLLABLE.test(cs.overflowY);
        if (x || y)
          todo.push({ el, x, y });
      }
    }
    for (const { el, x, y } of todo) {
      el.dataset.gpOverflow = "clipped";
      el.dataset.gpOverflowX = el.style.getPropertyValue("overflow-x");
      el.dataset.gpOverflowY = el.style.getPropertyValue("overflow-y");
      el.dataset.gpOverflowXPriority = el.style.getPropertyPriority("overflow-x");
      el.dataset.gpOverflowYPriority = el.style.getPropertyPriority("overflow-y");
      if (x)
        el.style.setProperty("overflow-x", "clip");
      if (y)
        el.style.setProperty("overflow-y", "clip");
    }
  }
  function restoreScrollContainers(doc = document) {
    for (const el of Array.from(doc.querySelectorAll('[data-gp-overflow="clipped"]'))) {
      for (const axis of ["x", "y"]) {
        const value = axis === "x" ? el.dataset.gpOverflowX : el.dataset.gpOverflowY;
        const priority = axis === "x" ? el.dataset.gpOverflowXPriority : el.dataset.gpOverflowYPriority;
        if (value)
          el.style.setProperty(`overflow-${axis}`, value, priority || "");
        else
          el.style.removeProperty(`overflow-${axis}`);
      }
      delete el.dataset.gpOverflow;
      delete el.dataset.gpOverflowX;
      delete el.dataset.gpOverflowY;
      delete el.dataset.gpOverflowXPriority;
      delete el.dataset.gpOverflowYPriority;
    }
  }
  function runPageBox(model, name, warnings = []) {
    const { right, agree, r, l } = pageSides(model, name);
    if (agree)
      return right;
    warnings.push(`@page :left and @page :right give ${name ? `the "${name}" page` : "this book"} ` + `different content areas (${l.w.toFixed(1)}×${l.h.toFixed(1)}pt vs ` + `${r.w.toFixed(1)}×${r.h.toFixed(1)}pt). Print alternates between them; the preview can ` + `only show one, so page breaks here may not match the PDF. Mirror the margins instead: ` + `swap which edge is wide and keep the total the same.`);
    return resolvePage(model, { name }).geometry;
  }
  function pageSides(model, name) {
    const right = resolvePage(model, { name, pseudos: ["right"] }).geometry;
    const left = resolvePage(model, { name, pseudos: ["left"] }).geometry;
    const box = (g) => ({
      w: g.width - g.margin.left - g.margin.right,
      h: g.height - g.margin.top - g.margin.bottom
    });
    const r = box(right);
    const l = box(left);
    return {
      right,
      left,
      r,
      l,
      agree: Math.abs(r.w - l.w) < 0.01 && Math.abs(r.h - l.h) < 0.01
    };
  }
  function versoShiftPt(model, name, flushEdges = []) {
    const { right, left, agree } = pageSides(model, name);
    if (!agree)
      return 0;
    const r = flushMargins(right.margin, flushEdges);
    const l = flushMargins(left.margin, flushEdges);
    if (Math.abs(r.left + r.right - (l.left + l.right)) >= 0.01)
      return 0;
    return r.left - l.left;
  }
  function buildStrips(model, opts = {}, warnings = []) {
    const doc = document;
    const root = opts.root ?? doc.querySelector("main") ?? doc.body;
    const gap = opts.sheetGap ?? 24;
    const runs = explodeChildren(root, model);
    const strips = [];
    for (const run of runs) {
      const geometry = runPageBox(model, run.page, warnings);
      const strip = doc.createElement("div");
      strip.className = "gp-strip";
      if (run.page)
        strip.dataset.page = run.page;
      const margin = run.flushEdges?.length ? flushMargins(geometry.margin, run.flushEdges) : geometry.margin;
      const w = pt(geometry.width - margin.left - margin.right);
      const h = pt(geometry.height - margin.top - margin.bottom);
      strip.style.setProperty("--gp-content-w", `${w}px`);
      strip.style.setProperty("--gp-content-h", `${h}px`);
      strip.style.setProperty("--gp-sheet-gap", `${gap}px`);
      strip.style.setProperty("--gp-page-w", `${pt(geometry.width)}px`);
      strip.style.setProperty("--gp-page-h", `${pt(geometry.height)}px`);
      strip.style.setProperty("--gp-margin-top", `${pt(margin.top)}px`);
      strip.style.setProperty("--gp-margin-right", `${pt(margin.right)}px`);
      strip.style.setProperty("--gp-margin-bottom", `${pt(margin.bottom)}px`);
      strip.style.setProperty("--gp-margin-left", `${pt(margin.left)}px`);
      const rawShift = versoShiftPt(model, run.page, run.flushEdges);
      const versoShift = Math.abs(rawShift) >= 0.01 ? rawShift : 0;
      if (versoShift)
        strip.style.setProperty("--gp-verso-shift", `${pt(versoShift)}px`);
      run.nodes[0].before(strip);
      for (const n of run.nodes)
        strip.appendChild(n);
      strips.push({
        el: strip,
        page: run.page,
        geometry,
        flushEdges: run.flushEdges,
        versoShift,
        pages: 0,
        offset: 0
      });
    }
    for (const s of strips)
      clearLeadingForcedBreaks(s.el);
    return strips;
  }
  var AVOID_BREAK = /^avoid(-page|-column)?$/;
  function keepChainHead(el) {
    let head = el;
    for (let prev = head.previousElementSibling;prev instanceof HTMLElement; prev = head.previousElementSibling) {
      const linked = AVOID_BREAK.test(getComputedStyle(prev).breakAfter) || AVOID_BREAK.test(getComputedStyle(head).breakBefore);
      if (!linked)
        break;
      head = prev;
    }
    return head;
  }
  var pushTargets = new WeakMap;
  function compensateRepeatedHeaders(strips, maxPasses = 24) {
    const warnings = [];
    let passes = 0;
    let touched = 0;
    for (const strip of strips) {
      const tables = Array.from(strip.el.querySelectorAll("table")).filter((t) => t.tHead || t.tFoot);
      if (!tables.length)
        continue;
      for (const table of tables) {
        for (const shim of Array.from(table.querySelectorAll("tr.gp-thead-shim, tr.gp-tfoot-shim")))
          shim.remove();
        table.style.breakBefore = "";
        const target = pushTargets.get(table);
        if (target)
          target.style.breakBefore = "";
        pushTargets.delete(table);
      }
      const pushed = new Set;
      const footClaims = new Map;
      let previous = "";
      for (let pass = 0;pass < maxPasses; pass++) {
        passes = Math.max(passes, pass + 1);
        const stride = strideOf(strip.el);
        const stripLeft = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
        const zoom = cssZoomOf(strip.el);
        const colOf = (r) => Math.floor(((r.left - stripLeft) / zoom + 1) / stride);
        const stripTop = strip.el.getBoundingClientRect().top;
        const colBottom = strip.el.clientHeight;
        const plans = [];
        for (const table of tables) {
          const head = table.tHead;
          const headRect = head?.getClientRects()[0];
          const footHeight = (table.tFoot?.getBoundingClientRect().height ?? 0) / zoom;
          const rows = Array.from(table.querySelectorAll("tbody > tr")).filter((r) => !r.classList.contains("gp-thead-shim") && !r.classList.contains("gp-tfoot-shim"));
          if (!rows.length)
            continue;
          const rects = rows.map((r) => r.getClientRects()[0] ?? r.getBoundingClientRect());
          const cols = rects.map(colOf);
          const claims = footClaims.get(table) ?? new Map;
          footClaims.set(table, claims);
          let newClaim;
          if (footHeight > 0) {
            const lastCol = cols[cols.length - 1];
            for (let i = 0;i < rows.length; i++) {
              const row = rows[i];
              if (cols[i] === lastCol || claims.has(row))
                continue;
              const bottom = (rects[i].bottom - stripTop) / zoom;
              if (bottom > colBottom - footHeight + 0.5) {
                newClaim = row;
                claims.set(row, colBottom - (rects[i].top - stripTop) / zoom);
                break;
              }
            }
          }
          plans.push({
            table,
            push: headRect ? colOf(headRect) < cols[0] : false,
            headHeight: (headRect?.height ?? 0) / zoom,
            footHeight,
            breakRows: headRect ? rows.filter((_, i) => i > 0 && cols[i] > cols[i - 1]) : [],
            footRows: [...claims.entries()],
            grew: newClaim !== undefined,
            cells: Math.max(1, ...rows.map((r) => r.cells.length))
          });
        }
        const signature = plans.map((p) => `${p.push || pushed.has(p.table) ? "P" : ""}${p.breakRows.map((r) => r.rowIndex).join(".")}~${p.footRows.map(([r]) => r.rowIndex).join(".")}`).join("|");
        const anyGrowth = plans.some((p) => p.grew);
        if (!anyGrowth && signature === previous)
          break;
        previous = signature;
        for (const plan of plans) {
          for (const shim of Array.from(plan.table.querySelectorAll("tr.gp-thead-shim, tr.gp-tfoot-shim")))
            shim.remove();
          if (plan.push && !pushed.has(plan.table)) {
            pushed.add(plan.table);
            const target = keepChainHead(plan.table);
            target.style.breakBefore = "column";
            pushTargets.set(plan.table, target);
            touched++;
            continue;
          }
          for (const row of plan.breakRows) {
            row.before(headerShim(plan.table.tHead, plan.headHeight, plan.cells));
            touched++;
          }
          for (const [row, height] of plan.footRows) {
            row.before(sectionShim(plan.table.tFoot, height, plan.cells, "gp-tfoot-shim"));
            touched++;
          }
        }
      }
    }
    return { tables: touched, passes, warnings };
  }
  function headerShim(head, height, cells) {
    return sectionShim(head, height, cells, "gp-thead-shim");
  }
  function sectionShim(section, height, cells, className) {
    const shim = document.createElement("tr");
    shim.className = className;
    shim.setAttribute("aria-hidden", "true");
    shim.style.height = `${height}px`;
    if (className === "gp-tfoot-shim")
      shim.style.verticalAlign = "bottom";
    const source = section.rows[0];
    if (source) {
      for (const cell of Array.from(source.cells)) {
        const td = document.createElement("td");
        td.colSpan = cell.colSpan;
        td.innerHTML = cell.innerHTML;
        const cs = getComputedStyle(cell);
        td.style.cssText = `font:${cs.font};text-align:${cs.textAlign};padding:${cs.padding};border:${cs.border};background:${cs.backgroundColor};`;
        shim.appendChild(td);
      }
    } else {
      const td = document.createElement("td");
      td.colSpan = cells;
      td.style.cssText = `height:${height}px;padding:0;border:0;`;
      shim.appendChild(td);
    }
    return shim;
  }
  function compensateRectoBreaks(model, strips) {
    const decls = model.breaks.filter(isRectoVersoBreak);
    for (const spacer of Array.from(document.querySelectorAll(".gp-recto-spacer")))
      spacer.remove();
    if (!decls.length)
      return 0;
    const sites = [];
    for (const d of decls) {
      let els = [];
      try {
        els = Array.from(document.querySelectorAll(d.selector));
      } catch {
        continue;
      }
      for (const el of els)
        sites.push({ el, wantsRecto: wantsRecto(d.value) });
    }
    sites.sort((a, b) => a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1);
    const plan = planRectoBlanks(sites.map((site) => ({ page: pageOf(site.el, strips) + 1, wantsRecto: site.wantsRecto })));
    let inserted = 0;
    for (const [i, site] of sites.entries()) {
      if (!plan[i])
        continue;
      const leading = site.el.previousElementSibling;
      const need = leading?.classList.contains("gp-column-break-spacer") ? 1 : 2;
      for (let n = 0;n < need; n++) {
        const spacer = document.createElement("div");
        spacer.className = "gp-recto-spacer";
        spacer.setAttribute("aria-hidden", "true");
        spacer.style.cssText = "break-before: column; height: 0; margin: 0; padding: 0; border: 0;";
        site.el.before(spacer);
      }
      inserted++;
    }
    return inserted;
  }
  function unwrapStrips(strips) {
    for (const strip of strips) {
      const stripEl = strip.el;
      for (const spacer of Array.from(stripEl.querySelectorAll(".gp-wrap-spacer, .gp-column-break-spacer")))
        spacer.remove();
      const runWrapper = stripEl.parentElement;
      const removalTarget = runWrapper && runWrapper.classList.contains("gp-run") ? runWrapper : stripEl;
      const parent = removalTarget.parentNode;
      if (!parent)
        continue;
      while (stripEl.firstChild)
        parent.insertBefore(stripEl.firstChild, removalTarget);
      parent.removeChild(removalTarget);
    }
  }
  function measure(strips) {
    let offset = 0;
    for (const strip of strips) {
      const stride = strideOf(strip.el);
      strip.pages = Math.max(1, Math.round(strip.el.scrollWidth / stride));
      strip.offset = offset;
      offset += strip.pages;
      strip.el.style.setProperty("--gp-pages", String(strip.pages));
    }
    return { strips, totalPages: offset };
  }
  function strideOf(strip) {
    return stripMetrics(strip).stride;
  }
  function cssZoomOf(el) {
    const stage = el.closest(".gp-stage") ?? document.body;
    return new DOMMatrixReadOnly(getComputedStyle(stage).transform).a || 1;
  }
  function stripMetrics(strip) {
    const cs = getComputedStyle(strip);
    const w = parseFloat(cs.getPropertyValue("--gp-content-w"));
    const colGap = parseFloat(cs.columnGap) || 0;
    const h = parseFloat(cs.getPropertyValue("--gp-content-h"));
    const rowGap = parseFloat(cs.rowGap) || 0;
    return { stride: w + colGap, rowStride: h + rowGap };
  }
  function rowStrideOf(strip) {
    return stripMetrics(strip).rowStride;
  }
  function wrapGeometry(strip) {
    if (!strip.wrapCols)
      return { perRow: strip.pages, shift: 0 };
    return {
      perRow: strip.wrapCols,
      shift: strip.wrapCols === 2 && strip.offset % 2 === 0 ? 1 : 0
    };
  }
  function indexInStrip(left, top, strip) {
    const { stride, rowStride } = stripMetrics(strip.el);
    const stripBox = strip.el.getBoundingClientRect();
    const zoom = cssZoomOf(strip.el);
    const x = (left - stripBox.left) / zoom + strip.el.scrollLeft;
    const y = (top - stripBox.top) / zoom;
    const { perRow, shift } = wrapGeometry(strip);
    const colVisual = Math.floor((x + 1) / stride);
    const colClamped = Math.max(0, Math.min(perRow - 1, colVisual));
    const row = Math.max(0, Math.floor((y + 1) / rowStride));
    const idx = row * perRow + colClamped - shift;
    return Math.max(0, Math.min(strip.pages - 1, idx));
  }
  function pageOf(el, strips) {
    const strip = strips.find((s) => s.el.contains(el));
    if (!strip)
      return -1;
    const rects = el.getClientRects();
    const first = rects.length ? rects[0] : el.getBoundingClientRect();
    return strip.offset + indexInStrip(first.left, first.top, strip);
  }
  function spreadModeSupported() {
    return typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("column-wrap", "wrap") && CSS.supports("column-height", "100px");
  }
  function applySpreadMode(strips, spread) {
    const cols = spread ? 2 : 1;
    const on = spreadModeSupported();
    for (const strip of strips) {
      const el = strip.el;
      const existingSpacer = el.querySelector(":scope > .gp-wrap-spacer");
      if (!on) {
        existingSpacer?.remove();
        delete el.dataset.wrap;
        el.style.removeProperty("--gp-wrap-cols");
        strip.wrapCols = undefined;
        continue;
      }
      strip.wrapCols = cols;
      const { shift } = wrapGeometry(strip);
      el.dataset.wrap = "on";
      el.style.setProperty("--gp-wrap-cols", String(cols));
      if (shift) {
        if (!existingSpacer) {
          const spacer = document.createElement("div");
          spacer.className = "gp-wrap-spacer";
          spacer.setAttribute("aria-hidden", "true");
          el.insertBefore(spacer, el.firstChild);
        }
      } else {
        existingSpacer?.remove();
      }
    }
  }
  function blankPageIndices(strips) {
    return Array.from(document.querySelectorAll(".gp-recto-spacer")).map((el) => pageOf(el, strips));
  }
  function padToSignature(strips, contentPages) {
    for (const spacer of Array.from(document.querySelectorAll(".gp-pad-spacer")))
      spacer.remove();
    const data = document.documentElement.dataset;
    const count = signaturePadding(contentPages, Number(data.gpSignature) || 1, data.gpLastPage);
    const last = strips[strips.length - 1];
    if (!last || count === 0)
      return contentPages;
    const target = contentPages + count;
    let total = contentPages;
    for (let n = 0;n < count + 2 && total < target; n++) {
      const spacer = document.createElement("div");
      spacer.className = "gp-pad-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = "break-before: column; height: 0; margin: 0; padding: 0; border: 0;";
      last.el.appendChild(spacer);
      total = measure(strips).totalPages;
    }
    return total;
  }
  function pagesAfter(contentPages, totalPages) {
    return Array.from({ length: Math.max(0, totalPages - contentPages) }, (_, i) => contentPages + i);
  }
  function pageRangeOf(el, strips) {
    const strip = strips.find((s) => s.el.contains(el));
    if (!strip)
      return [-1, -1];
    const rects = Array.from(el.getClientRects());
    if (!rects.length)
      return [pageOf(el, strips), pageOf(el, strips)];
    const idx = rects.map((r) => indexInStrip(r.left, r.top, strip));
    return [strip.offset + Math.min(...idx), strip.offset + Math.max(...idx)];
  }
  function imageIntrinsicSizeReady(img) {
    if (img.complete)
      return Promise.resolve();
    return new Promise((resolve) => {
      img.addEventListener("load", () => resolve(), { once: true });
      img.addEventListener("error", () => resolve(), { once: true });
    });
  }
  function waitForLayoutReady(doc = document) {
    const fontsReady = doc.fonts?.ready ?? Promise.resolve();
    const imagesReady = Promise.all(Array.from(doc.images).map(imageIntrinsicSizeReady));
    return Promise.all([fontsReady, imagesReady]).then(() => {
      return;
    });
  }
  async function fragmentDocument(opts = {}) {
    const layoutReady = waitForLayoutReady();
    const css = await loadStyleSources();
    injectViewerCss();
    const printOnly = mediaPrintBodies(css).join(`
`);
    if (printOnly && !document.getElementById("gp-media-print")) {
      const style = document.createElement("style");
      style.id = "gp-media-print";
      style.textContent = printOnly;
      document.head.appendChild(style);
    }
    const model = extract(css);
    injectBreakMapping(model);
    const authoring = [];
    const strips = buildStrips(model, opts, authoring);
    await layoutReady;
    makeOverflowFragmentable(strips);
    stabilizeFullHeightPageRoots(model, strips);
    synthesizeColumnBreaks(model);
    measure(strips);
    const blanks = compensateRectoBreaks(model, strips);
    if (blanks)
      measure(strips);
    const headers = opts.compensateHeaders === false ? { tables: 0, passes: 0, warnings: [] } : compensateRepeatedHeaders(strips);
    const contentPages = measure(strips).totalPages;
    const totalPages = padToSignature(strips, contentPages);
    const api = {
      model,
      strips,
      totalPages,
      warnings: [...new Set([...authoring, ...headers.warnings])],
      blankPages: blanks,
      blankPageIndices: blankPageIndices(strips),
      paddedPageIndices: pagesAfter(contentPages, totalPages),
      pageOf: (sel) => pageOf(typeof sel === "string" ? document.querySelector(sel) : sel, strips),
      pageRangeOf: (sel) => pageRangeOf(typeof sel === "string" ? document.querySelector(sel) : sel, strips),
      relayout: () => {
        restoreFullHeightPageRoots();
        restoreScrollContainers();
        unwrapStrips(strips);
        for (const spacer of Array.from(document.querySelectorAll(".gp-recto-spacer, .gp-pad-spacer")))
          spacer.remove();
        const rebuilt = buildStrips(model, opts, authoring);
        strips.length = 0;
        strips.push(...rebuilt);
        makeOverflowFragmentable(strips);
        stabilizeFullHeightPageRoots(model, strips);
        synthesizeColumnBreaks(model);
        measure(strips);
        api.blankPages = compensateRectoBreaks(model, strips);
        if (opts.compensateHeaders !== false)
          api.warnings = [
            ...new Set([...authoring, ...compensateRepeatedHeaders(strips).warnings])
          ];
        const content = measure(strips).totalPages;
        padToSignature(strips, content);
        const r = measure(strips);
        api.totalPages = r.totalPages;
        api.blankPageIndices = blankPageIndices(strips);
        api.paddedPageIndices = pagesAfter(content, r.totalPages);
        return r;
      }
    };
    return api;
  }

  // src/engine/shared/content-value.ts
  var exports_content_value = {};
  __export(exports_content_value, {
    unquote: () => unquote,
    resolveUrlArg: () => resolveUrlArg,
    parseContent: () => parseContent,
    needsMeasurement: () => needsMeasurement,
    formatCounter: () => formatCounter,
    evaluateContent: () => evaluateContent,
    evaluate: () => evaluate
  });
  var FUNC = /^([a-z-]+)\(/i;
  function parseContent(value) {
    const parts = [];
    let i = 0;
    const s = value.trim();
    while (i < s.length) {
      const c = s[i];
      if (/\s/.test(c)) {
        i++;
        continue;
      }
      if (c === '"' || c === "'") {
        const end = closeString(s, i);
        parts.push({ type: "literal", value: unquote(s.slice(i, end)) });
        i = end;
        continue;
      }
      const rest = s.slice(i);
      const fn = FUNC.exec(rest);
      if (fn && fn[1] !== undefined) {
        const open = i + fn[0].length - 1;
        const close = matchParen2(s, open);
        const args = splitTopLevel(s.slice(open + 1, close), ",");
        parts.push(toPart(fn[1].toLowerCase(), args));
        i = close + 1;
        continue;
      }
      const word = /^[^\s"']+/.exec(rest)[0];
      parts.push({ type: "keyword", value: word });
      i += word.length;
    }
    return parts;
  }
  function toPart(name, args) {
    switch (name) {
      case "counter":
        return { type: "counter", name: args[0] ?? "page", style: args[1] ?? "decimal" };
      case "string":
        return { type: "string", name: args[0] ?? "", which: args[1] ?? "first" };
      case "target-counter":
        return {
          type: "target-counter",
          url: args[0] ?? "",
          counter: args[1] ?? "page",
          style: args[2] ?? "decimal"
        };
      case "target-text":
        return { type: "target-text", url: args[0] ?? "", which: args[1] ?? "content" };
      case "leader":
        return { type: "leader", glue: unquote(args[0] ?? '"."') };
      case "attr": {
        const [a, as] = (args[0] ?? "").split(/\s+/);
        return { type: "attr", name: a ?? "", as };
      }
      case "content":
        return { type: "content", which: args[0] ?? "text" };
      default:
        return { type: "keyword", value: `${name}(${args.join(",")})` };
    }
  }
  function closeString(s, i) {
    const q = s[i++];
    while (i < s.length) {
      if (s[i] === "\\")
        i += 2;
      else if (s[i] === q)
        return i + 1;
      else
        i++;
    }
    return i;
  }
  function matchParen2(s, open) {
    let depth = 0;
    for (let i = open;i < s.length; i++) {
      const c = s[i];
      if (c === '"' || c === "'") {
        i = closeString(s, i) - 1;
        continue;
      }
      if (c === "(")
        depth++;
      else if (c === ")" && --depth === 0)
        return i;
    }
    return s.length - 1;
  }
  function unquote(s) {
    const t = s.trim();
    if (t.startsWith('"') && t.endsWith('"') || t.startsWith("'") && t.endsWith("'"))
      return t.slice(1, -1).replace(/\\(.)/g, "$1");
    return t;
  }
  function resolveUrlArg(arg, ctx) {
    const m = /^attr\(\s*([\w-]+)(?:\s+url)?\s*\)$/i.exec(arg.trim());
    if (m && m[1] !== undefined)
      return ctx.attr?.(m[1]) ?? "";
    return unquote(arg);
  }
  var ROMAN = [
    [1000, "m"],
    [900, "cm"],
    [500, "d"],
    [400, "cd"],
    [100, "c"],
    [90, "xc"],
    [50, "l"],
    [40, "xl"],
    [10, "x"],
    [9, "ix"],
    [5, "v"],
    [4, "iv"],
    [1, "i"]
  ];
  function formatCounter(n, style = "decimal") {
    switch (style.trim()) {
      case "decimal-leading-zero":
        return n < 10 ? `0${n}` : String(n);
      case "lower-roman":
      case "upper-roman": {
        let v = n;
        let out = "";
        for (const [num, sym] of ROMAN)
          while (v >= num)
            out += sym, v -= num;
        return style === "upper-roman" ? out.toUpperCase() : out;
      }
      case "lower-alpha":
      case "upper-alpha": {
        let v = n;
        let out = "";
        while (v > 0) {
          const r = (v - 1) % 26;
          out = String.fromCharCode(97 + r) + out;
          v = Math.floor((v - 1) / 26);
        }
        return style === "upper-alpha" ? out.toUpperCase() : out;
      }
      case "none":
        return "";
      default:
        return String(n);
    }
  }
  function evaluateContent(parts, ctx) {
    let out = "";
    for (const p of parts) {
      switch (p.type) {
        case "literal":
          out += p.value;
          break;
        case "counter":
          out += formatCounter(p.name === "pages" ? ctx.pages ?? 0 : ctx.page ?? 0, p.style);
          break;
        case "string":
          out += ctx.strings?.(p.name, p.which) ?? "";
          break;
        case "target-counter": {
          const url = resolveUrlArg(p.url, ctx);
          const page = ctx.targetPage?.(url);
          out += page === undefined ? "?" : formatCounter(page, p.style);
          break;
        }
        case "target-text": {
          const url = resolveUrlArg(p.url, ctx);
          out += ctx.targetText?.(url, p.which) ?? "";
          break;
        }
        case "attr":
          out += ctx.attr?.(p.name) ?? "";
          break;
        case "content":
          out += ctx.text ?? "";
          break;
        case "leader":
          out += ctx.leader?.(p.glue) ?? "";
          break;
        case "keyword":
          if (p.value === "normal" || p.value === "none")
            break;
          out += p.value;
          break;
      }
    }
    return out;
  }
  function evaluate(value, ctx) {
    return evaluateContent(parseContent(value), ctx);
  }
  function needsMeasurement(value) {
    return parseContent(value).some((p) => p.type === "target-counter" || p.type === "target-text" || p.type === "leader");
  }

  // src/engine/shared/margin-box-support.ts
  var MARGIN_BOX_IGNORED_PROPERTIES = new Set([
    "transform",
    "rotate",
    "translate",
    "scale",
    "perspective",
    "box-shadow",
    "opacity",
    "outline",
    "outline-color",
    "outline-style",
    "outline-width",
    "outline-offset",
    "filter",
    "backdrop-filter",
    "mix-blend-mode",
    "clip-path"
  ]);
  function isIgnoredMarginBoxProperty(property) {
    return MARGIN_BOX_IGNORED_PROPERTIES.has(property.toLowerCase());
  }
  function marginBoxRectPt(name, g) {
    const { top, right, bottom, left } = g.margin;
    const cw = g.width - left - right;
    const ch = g.height - top - bottom;
    const third = (n) => n / 3;
    const T = {
      "top-left-corner": [0, 0, left, top],
      "top-left": [left, 0, third(cw), top],
      "top-center": [left + third(cw), 0, third(cw), top],
      "top-right": [left + 2 * third(cw), 0, third(cw), top],
      "top-right-corner": [g.width - right, 0, right, top],
      "bottom-left-corner": [0, g.height - bottom, left, bottom],
      "bottom-left": [left, g.height - bottom, third(cw), bottom],
      "bottom-center": [left + third(cw), g.height - bottom, third(cw), bottom],
      "bottom-right": [left + 2 * third(cw), g.height - bottom, third(cw), bottom],
      "bottom-right-corner": [g.width - right, g.height - bottom, right, bottom],
      "left-top": [0, top, left, third(ch)],
      "left-middle": [0, top + third(ch), left, third(ch)],
      "left-bottom": [0, top + 2 * third(ch), left, third(ch)],
      "right-top": [g.width - right, top, right, third(ch)],
      "right-middle": [g.width - right, top + third(ch), right, third(ch)],
      "right-bottom": [g.width - right, top + 2 * third(ch), right, third(ch)]
    };
    const [x, y, w, h] = T[name] ?? [0, 0, 0, 0];
    return { x, y, w, h };
  }
  function marginBoxAlign(name) {
    if (name.includes("center") || name.includes("middle"))
      return "center";
    return /right/.test(name) ? "end" : "start";
  }

  // src/engine/compiler/tier2.ts
  var DEFAULT_SLUG_PT = 18;
  function pageGeometry(model, opts) {
    const base = resolvePage(model);
    const trim = { width: base.geometry.width, height: base.geometry.height };
    const bleed = opts.bleedPt ?? base.geometry.bleed;
    const wantsMarks = base.geometry.marks.length > 0 || opts.marks === true;
    const slug = wantsMarks ? opts.slugPt ?? DEFAULT_SLUG_PT : 0;
    return {
      trim,
      bleed,
      slug,
      marks: base.geometry.marks.length ? base.geometry.marks : wantsMarks ? ["crop"] : [],
      media: {
        width: trim.width + 2 * (bleed + slug),
        height: trim.height + 2 * (bleed + slug)
      }
    };
  }

  // src/engine/viewer/overlay.ts
  function documentBleedPt(model) {
    return pageGeometry(model, { model }).bleed;
  }
  function pageBoxes(g, margin, bleed, scale = 1) {
    const w = g.width * scale;
    const h = g.height * scale;
    const b = Math.max(0, bleed) * scale;
    return {
      host: { x: 0, y: 0, w, h },
      trim: { x: 0, y: 0, w, h },
      content: {
        x: margin.left * scale,
        y: margin.top * scale,
        w: w - (margin.left + margin.right) * scale,
        h: h - (margin.top + margin.bottom) * scale
      },
      bleedBox: { x: -b, y: -b, w: w + 2 * b, h: h + 2 * b },
      bleed: b
    };
  }
  function insetPageBoxes(g, margin, bleed, side, scale = 1) {
    const sheet = pageBoxes(g, margin, 0, scale);
    const b = Math.max(0, bleed) * scale;
    return {
      host: sheet.host,
      trim: { x: side === "verso" ? b : 0, y: b, w: sheet.host.w - b, h: sheet.host.h - 2 * b },
      content: sheet.content,
      bleedBox: sheet.host,
      bleed: b
    };
  }
  var SEVERITY = { inside: 0, margin: 1, bleed: 2, "off-page": 3 };
  var within = (r, outer, tol) => r.x >= outer.x - tol && r.y >= outer.y - tol && r.x + r.w <= outer.x + outer.w + tol && r.y + r.h <= outer.y + outer.h + tol;
  function classifyRect(r, boxes, tol = 0) {
    if (within(r, boxes.content, tol))
      return "inside";
    if (within(r, boxes.trim, tol))
      return "margin";
    if (boxes.bleed > 0 && within(r, boxes.bleedBox, tol))
      return "bleed";
    return "off-page";
  }
  function worstKind(kinds) {
    return kinds.reduce((worst, k) => SEVERITY[k] > SEVERITY[worst] ? k : worst, "inside");
  }
  var INTENT_SELECTOR = ".gp-bleed, .gp-pin, .gp-flush, .gp-behind, .gp-page-full-bleed";
  var OVERLAY_STRENGTHS = ["subtle", "normal", "strong"];
  var HEX_COLOR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
  function sanitizeOverlayStyle(style) {
    const s = style && typeof style === "object" ? style : {};
    const out = {};
    if (typeof s.color === "string" && HEX_COLOR.test(s.color.trim()))
      out.color = s.color.trim();
    if (OVERLAY_STRENGTHS.includes(s.strength))
      out.strength = s.strength;
    return out;
  }
  var OVERLAY_OFF = { on: false, issues: 0, intended: 0, bleedPt: 0 };
  function pageFrameMargin(margin, versoShift, side) {
    if (side === "recto" || !versoShift)
      return margin;
    return { ...margin, left: margin.left - versoShift, right: margin.right + versoShift };
  }
  function configInsetBleedPt() {
    const v = parseFloat(document.querySelector('meta[name="gp-inset-bleed"]')?.getAttribute("content") ?? "");
    return Number.isFinite(v) && v > 0 ? v : 0;
  }
  var SKIP = new Set(["SCRIPT", "STYLE", "LINK", "TEMPLATE", "BR", "WBR", "SOURCE", "TRACK", "META"]);
  var TOL_PX = 1;
  function div(cls, box) {
    const el = document.createElement("div");
    el.className = cls;
    if (box)
      place(el, box);
    return el;
  }
  function place(el, r) {
    el.style.left = `${r.x}px`;
    el.style.top = `${r.y}px`;
    el.style.width = `${r.w}px`;
    el.style.height = `${r.h}px`;
  }
  function marginTint(b) {
    const el = div("gp-ov-tint");
    const t = b.trim;
    const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    const l = clamp(b.content.x, t.x, t.x + t.w);
    const r = clamp(b.content.x + b.content.w, t.x, t.x + t.w);
    const top = clamp(b.content.y, t.y, t.y + t.h);
    const bot = clamp(b.content.y + b.content.h, t.y, t.y + t.h);
    const x2 = t.x + t.w;
    const y2 = t.y + t.h;
    el.style.clipPath = `polygon(evenodd, ${t.x}px ${t.y}px, ${x2}px ${t.y}px, ${x2}px ${y2}px, ${t.x}px ${y2}px, ${t.x}px ${t.y}px, ` + `${l}px ${top}px, ${l}px ${bot}px, ${r}px ${bot}px, ${r}px ${top}px, ${l}px ${top}px)`;
    return el;
  }
  function clearOverlay() {
    for (const layer of Array.from(document.querySelectorAll(".gp-ov")))
      layer.remove();
  }
  function paintOverlay(pages, strips, bleedPt, insetBleedPt = 0) {
    const inSheet = bleedPt <= 0 && insetBleedPt > 0;
    clearOverlay();
    const layers = new Map;
    const painted = new Map;
    for (const p of pages) {
      const run = p.sheet.closest(".gp-run");
      if (!run)
        continue;
      let layer = layers.get(run);
      if (!layer) {
        layer = div("gp-ov");
        run.appendChild(layer);
        layers.set(run, layer);
      }
      const boxes = inSheet ? insetPageBoxes(p.geometry, p.margin, insetBleedPt, p.sheet.dataset.side === "verso" ? "verso" : "recto", PX_PER_PT) : pageBoxes(p.geometry, p.margin, bleedPt, PX_PER_PT);
      const host = div("gp-ov-page", boxes.host);
      host.style.left = p.sheet.style.left;
      host.style.top = p.sheet.style.top;
      host.dataset.page = String(p.index + 1);
      if (boxes.bleed > 0) {
        const bb = boxes.bleedBox;
        const t = boxes.trim;
        const band = div("gp-ov-bleed", bb);
        band.style.borderWidth = `${t.y - bb.y}px ${bb.x + bb.w - (t.x + t.w)}px ${bb.y + bb.h - (t.y + t.h)}px ${t.x - bb.x}px`;
        host.appendChild(band);
        host.appendChild(div("gp-ov-trim", t));
      }
      host.appendChild(marginTint(boxes));
      host.appendChild(div("gp-ov-margin", boxes.content));
      layer.appendChild(host);
      painted.set(p.index, { host, boxes, sheet: p.sheet });
    }
    const flags = [];
    let issues = 0;
    let intended = 0;
    for (const strip of strips) {
      const zoom = cssZoomOf(strip.el);
      const colW = (parseFloat(strip.el.style.getPropertyValue("--gp-content-w")) || 0) * zoom;
      const colH = (parseFloat(strip.el.style.getPropertyValue("--gp-content-h")) || 0) * zoom;
      const visit = (el) => {
        if (SKIP.has(el.tagName) || el.classList.contains("gp-wrap-spacer"))
          return;
        const kinds = [];
        const found = [];
        for (const r of Array.from(el.getClientRects())) {
          if (r.width <= 0 && r.height <= 0)
            continue;
          const ax = r.left + Math.min(r.width, colW || r.width) / 2;
          const ay = r.top + Math.min(r.height, colH || r.height) / 2;
          const target = painted.get(strip.offset + indexInStrip(ax, ay, strip));
          if (!target)
            continue;
          target.rect ??= target.sheet.getBoundingClientRect();
          const local = {
            x: (r.left - target.rect.left) / zoom,
            y: (r.top - target.rect.top) / zoom,
            w: r.width / zoom,
            h: r.height / zoom
          };
          const kind = classifyRect(local, target.boxes, TOL_PX);
          kinds.push(kind);
          if (kind !== "inside")
            found.push({ host: target.host, kind, box: local });
        }
        const worst = worstKind(kinds);
        if (worst !== "inside") {
          const isIntended = el.closest(INTENT_SELECTOR) !== null;
          if (isIntended)
            intended++;
          else
            issues++;
          for (const f of found)
            flags.push(isIntended ? { ...f, kind: "intended" } : f);
          return;
        }
        for (const child of Array.from(el.children))
          visit(child);
      };
      for (const child of Array.from(strip.el.children))
        visit(child);
    }
    for (const f of flags) {
      const el = div(`gp-ov-flag`, f.box);
      el.dataset.kind = f.kind;
      f.host.appendChild(el);
    }
    return inSheet ? { on: true, issues, intended, bleedPt: insetBleedPt, bleedInSheet: true } : { on: true, issues, intended, bleedPt };
  }

  // src/engine/viewer/decorate.ts
  var px = (v) => `${v * PX_PER_PT}px`;
  function elementForHref(href) {
    const raw = href.replace(/^#/, "");
    if (!raw)
      return null;
    let id = raw;
    try {
      id = decodeURIComponent(raw);
    } catch {}
    return document.getElementById(id);
  }
  function applyPageBackground(sheet, decls) {
    for (const [prop, value] of Object.entries(decls)) {
      const p = prop.toLowerCase();
      if (p !== "background" && !p.startsWith("background-"))
        continue;
      if (p === "background-attachment")
        continue;
      sheet.style.setProperty(p, value);
    }
  }
  function decorate(layout, opts = {}) {
    const model = layout.model;
    const sheets = new Map;
    let blankPages = new Set;
    let paddedPages = new Set;
    const warnings = [];
    let overlayOn = false;
    let overlayPages = [];
    let overlaySummary = OVERLAY_OFF;
    const paintOverlayNow = () => {
      overlaySummary = paintOverlay(overlayPages, layout.strips, documentBleedPt(model), configInsetBleedPt());
      window.dispatchEvent(new CustomEvent("gp:overlay", { detail: overlaySummary }));
    };
    const api = {
      redraw: () => draw(),
      sheetFor: (p) => sheets.get(p),
      stringMap: new Map,
      targets: new Map,
      pageNumbers: [],
      warnings,
      setDesigner(on) {
        document.body.dataset.designer = on ? "on" : "off";
      },
      setOverlay(on, style) {
        if (style) {
          const { color, strength } = sanitizeOverlayStyle(style);
          if (strength)
            document.body.dataset.overlayStrength = strength;
          if (color)
            document.body.style.setProperty("--gp-ov-color", color);
        }
        const wasOn = overlayOn;
        overlayOn = on;
        document.body.dataset.overlay = on ? "on" : "off";
        if (on) {
          if (!(wasOn && style))
            paintOverlayNow();
        } else {
          clearOverlay();
          overlaySummary = OVERLAY_OFF;
          window.dispatchEvent(new CustomEvent("gp:overlay", { detail: overlaySummary }));
        }
        return overlaySummary;
      },
      overlay: () => overlaySummary
    };
    const canvasBg = captureCanvasBackground();
    document.body.classList.add("gp-stage");
    if (document.body.dataset.designer === undefined)
      api.setDesigner(!!opts.designer);
    function pageContext(strip, indexInStrip2, bookIndex) {
      if (paddedPages.has(bookIndex)) {
        const { geometry: geometry2 } = resolvePage(model, { pseudos: [] });
        return { index: bookIndex, strip, pseudos: [], geometry: geometry2, marginBoxes: {}, decls: {}, padded: true };
      }
      if (blankPages.has(bookIndex)) {
        const pseudos2 = ["blank"];
        const { geometry: geometry2, marginBoxes: marginBoxes2, decls: decls2 } = resolvePage(model, { pseudos: pseudos2 });
        return { index: bookIndex, strip, pseudos: pseudos2, geometry: geometry2, marginBoxes: marginBoxes2, decls: decls2 };
      }
      const pseudos = [];
      if (bookIndex === 0)
        pseudos.push("first");
      if (indexInStrip2 === 0)
        pseudos.push("nth-first-of-run");
      pseudos.push(bookIndex % 2 === 0 ? "right" : "left");
      const { geometry, marginBoxes, decls } = resolvePage(model, {
        name: strip.page,
        pseudos
      });
      return { index: bookIndex, strip, pseudos, geometry, marginBoxes, decls };
    }
    function buildMaps() {
      api.stringMap = new Map;
      api.targets = new Map;
      for (const decl of model.stringSets) {
        let els = [];
        try {
          els = Array.from(document.querySelectorAll(decl.selector));
        } catch {
          continue;
        }
        const entries = api.stringMap.get(decl.name) ?? [];
        for (const el of els) {
          const [page] = pageRangeOf(el, layout.strips);
          if (page < 0)
            continue;
          entries.push({
            page,
            value: evaluate(decl.value, {
              text: (el.textContent ?? "").trim(),
              attr: (n) => el.getAttribute(n) ?? undefined
            })
          });
        }
        entries.sort((a, b) => a.page - b.page);
        api.stringMap.set(decl.name, entries);
      }
      const resets = [];
      for (const r of model.counterResets) {
        let els = [];
        try {
          els = Array.from(document.querySelectorAll(r.selector));
        } catch {
          continue;
        }
        for (const el of els) {
          const [page] = pageRangeOf(el, layout.strips);
          if (page >= 0)
            resets.push({ page: page + 1, start: r.start });
        }
      }
      api.pageNumbers = resets.length ? pageCounterValues(resets, layout.totalPages) : [];
      const pageValues = api.pageNumbers.length ? api.pageNumbers : null;
      const linked = new Set;
      for (const a of Array.from(document.querySelectorAll("a[href^='#']")))
        linked.add(a.getAttribute("href"));
      for (const href of linked) {
        const el = elementForHref(href);
        if (!el)
          continue;
        const [page] = pageRangeOf(el, layout.strips);
        if (page >= 0)
          api.targets.set(href, toFolioPage(page + 1, pageValues));
      }
    }
    function stringAt(name, which, page) {
      return stringValueAt(api.stringMap.get(name) ?? [], page, parseWhich(which));
    }
    function fillXrefs() {
      const brokenHrefs = new Set;
      for (const xref of model.xrefs) {
        if (!needsMeasurement(xref.content))
          continue;
        const base = xref.selector.replace(/::?(after|before)$/, "");
        const pseudo = /::?after$/.test(xref.selector) ? "after" : "before";
        let els = [];
        try {
          els = Array.from(document.querySelectorAll(base));
        } catch {
          continue;
        }
        for (const el of els) {
          const text = evaluate(xref.content, {
            attr: (n) => el.getAttribute(n) ?? undefined,
            targetPage: (url) => {
              const page = api.targets.get(url);
              if (page === undefined && url.startsWith("#"))
                brokenHrefs.add(url);
              return page;
            },
            targetText: (url) => (elementForHref(url)?.textContent ?? "").trim() || undefined,
            leader: leaderMarker
          });
          el.setAttribute(`data-gp-${pseudo}`, text);
        }
      }
      for (const href of brokenHrefs)
        warnings.push(`The link "${href}" doesn't point at anything in this book, so its page number can't be shown. Check the spelling, or add that id to the heading you meant.`);
      fillLeaders();
      let style = document.getElementById("gp-xref-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "gp-xref-style";
        document.head.appendChild(style);
      }
      style.textContent = generatedContentCss(model.xrefs.map((x) => x.selector));
    }
    function fillLeaders() {
      const marked = [];
      for (const attr of ["data-gp-after", "data-gp-before"]) {
        for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
          const raw = el.getAttribute(attr) ?? "";
          if (LEADER_RE.test(raw))
            marked.push({ el, attr, raw });
        }
      }
      if (!marked.length)
        return;
      const canvas = document.createElement("canvas");
      const cx = canvas.getContext("2d");
      for (const m of marked)
        m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, ""));
      document.body.offsetHeight;
      for (const m of marked) {
        const glue = LEADER_RE.exec(m.raw)[1] || ".";
        const block = m.el.parentElement ?? document.body;
        const blockRect = block.getBoundingClientRect();
        const cs = getComputedStyle(block);
        const contentRight = blockRect.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
        const rects = m.el.getClientRects();
        const last = rects.length ? rects[rects.length - 1] : m.el.getBoundingClientRect();
        cx.font = getComputedStyle(m.el).font;
        const n = leaderFillCount(contentRight - last.right, cx.measureText(glue).width);
        m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, glue.repeat(n)));
      }
    }
    function draw() {
      sheets.clear();
      warnings.length = 0;
      blankPages = new Set(layout.blankPageIndices);
      paddedPages = new Set(layout.paddedPageIndices);
      overlayPages = [];
      buildMaps();
      fillXrefs();
      let prevPageH = 0;
      let prevVersoShift = 0;
      let prevRunX = 0;
      let first = true;
      for (const strip of layout.strips) {
        const run = ensureRun(strip);
        const { stride, rowStride } = stripMetrics(strip.el);
        const sheetGap = parseFloat(getComputedStyle(strip.el).getPropertyValue("--gp-sheet-gap")) || 0;
        run.style.setProperty("--gp-sheet-gap", `${sheetGap}px`);
        const { perRow, shift } = wrapGeometry(strip);
        const layer = run.querySelector(".gp-layer");
        layer.textContent = "";
        const g = strip.geometry;
        for (let i = 0;i < strip.pages; i++) {
          const bookIndex = strip.offset + i;
          const ctx = pageContext(strip, i, bookIndex);
          const slot = i + shift;
          const row = Math.floor(slot / perRow);
          const colVisual = slot % perRow;
          const side = bookIndex % 2 === 0 ? "recto" : "verso";
          const sheetLeft = colVisual * stride + (side === "verso" ? strip.versoShift * PX_PER_PT : 0);
          const sheetTop = row * rowStride;
          const sheet = document.createElement("div");
          sheet.className = "gp-sheet";
          sheet.dataset.page = String(bookIndex + 1);
          sheet.dataset.side = side;
          sheet.style.left = `${sheetLeft}px`;
          sheet.style.top = `${sheetTop}px`;
          sheet.style.setProperty("--gp-page-w", px(ctx.geometry.width));
          sheet.style.setProperty("--gp-page-h", px(ctx.geometry.height));
          applyPageBackground(sheet, ctx.decls);
          if (!ctx.padded)
            for (const [prop, value] of canvasBg)
              sheet.style.setProperty(prop, value);
          layer.appendChild(sheet);
          sheets.set(bookIndex, sheet);
          drawMarginBoxes(sheet, ctx, layout.totalPages - paddedPages.size);
          drawGuides(sheet, ctx);
          drawCropMarks(sheet, ctx);
          overlayPages.push({
            index: bookIndex,
            sheet,
            strip,
            geometry: ctx.geometry,
            margin: ctx.padded || blankPages.has(bookIndex) ? ctx.geometry.margin : pageFrameMargin(flushMargins(g.margin, strip.flushEdges ?? []), strip.versoShift, side)
          });
        }
        const rows = Math.max(1, Math.ceil((strip.pages + shift) / perRow));
        run.style.height = `${rowStride * (rows - 1) + PX_PER_PT * g.height}px`;
        run.style.width = `${stride * perRow}px`;
        const composed = !!strip.wrapCols && shift === 1 && !first;
        run.style.marginTop = composed ? `${-(prevPageH + sheetGap)}px` : "";
        const runX = composed ? prevRunX + (prevVersoShift - strip.versoShift) * PX_PER_PT : 0;
        run.style.marginLeft = runX ? `${runX}px` : "";
        prevPageH = PX_PER_PT * g.height;
        prevVersoShift = strip.versoShift;
        prevRunX = runX;
        first = false;
        if (opts.designer)
          checkOverflow(strip, warnings);
      }
      if (overlayOn)
        paintOverlayNow();
    }
    function drawMarginBoxes(sheet, ctx, totalPages) {
      const g = ctx.geometry;
      for (const name of MARGIN_BOX_NAMES) {
        const decls = ctx.marginBoxes[`@${name}`];
        if (!decls?.content)
          continue;
        const text = evaluate(decls.content, {
          page: api.pageNumbers[ctx.index] ?? ctx.index + 1,
          pages: totalPages,
          strings: (n, w) => stringAt(n, w, ctx.index),
          targetPage: (url) => api.targets.get(url)
        });
        if (!text)
          continue;
        const box = document.createElement("div");
        box.className = "gp-marginbox";
        box.dataset.box = name;
        Object.assign(box.style, rectFor(name, g));
        box.dataset.align = marginBoxAlign(name);
        const content = document.createElement("span");
        content.className = "gp-marginbox-content";
        content.textContent = text;
        for (const [prop, value] of Object.entries(decls)) {
          if (prop.toLowerCase() === "content" || isIgnoredMarginBoxProperty(prop))
            continue;
          content.style.setProperty(prop, value);
        }
        box.appendChild(content);
        sheet.appendChild(box);
      }
    }
    const CROP_LEN = 14;
    const CROP_GAP = 3;
    function drawCropMarks(sheet, ctx) {
      const g = ctx.geometry;
      if (g.bleed <= 0)
        return;
      const w = g.width * PX_PER_PT;
      const h = g.height * PX_PER_PT;
      const mark = (left, top, width, height) => {
        const el = document.createElement("div");
        el.className = "gp-crop-mark";
        Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
        sheet.appendChild(el);
      };
      for (const [cx, cy] of [
        [0, 0],
        [w, 0],
        [0, h],
        [w, h]
      ]) {
        const ox = cx === 0 ? -1 : 1;
        const oy = cy === 0 ? -1 : 1;
        mark(cx + (ox < 0 ? -(CROP_GAP + CROP_LEN) : CROP_GAP), cy - 0.5, CROP_LEN, 1);
        mark(cx - 0.5, cy + (oy < 0 ? -(CROP_GAP + CROP_LEN) : CROP_GAP), 1, CROP_LEN);
      }
    }
    function drawGuides(sheet, ctx) {
      const g = ctx.geometry;
      if (g.bleed > 0) {
        const trim = document.createElement("div");
        trim.className = "gp-guide-trim";
        Object.assign(trim.style, {
          left: "0px",
          top: "0px",
          width: px(g.width),
          height: px(g.height)
        });
        sheet.appendChild(trim);
      }
      const safe = document.createElement("div");
      safe.className = "gp-guide-safe";
      Object.assign(safe.style, {
        left: px(g.margin.left),
        top: px(g.margin.top),
        width: px(g.width - g.margin.left - g.margin.right),
        height: px(g.height - g.margin.top - g.margin.bottom)
      });
      sheet.appendChild(safe);
    }
    function checkOverflow(strip, out) {
      const h = strip.el.clientHeight;
      for (const el of Array.from(strip.el.querySelectorAll("figure,table,img,pre"))) {
        const r = el.getBoundingClientRect();
        if (r.height > h + 1) {
          out.push(`${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} is ${Math.round(r.height)}px tall; page content box is ${Math.round(h)}px — it will clip on screen and overflow in print.`);
          el.classList.add("gp-overflowing");
        }
      }
    }
    draw();
    return api;
  }
  var CANVAS_BG_PROPS = [
    "background-color",
    "background-image",
    "background-repeat",
    "background-position",
    "background-size",
    "background-origin",
    "background-clip",
    "background-blend-mode"
  ];
  function captureCanvasBackground() {
    for (const el of [document.documentElement, document.body]) {
      const cs = getComputedStyle(el);
      const transparent = /^(transparent|rgba\(0, ?0, ?0, ?0\))$/.test(cs.backgroundColor);
      if (cs.backgroundImage === "none" && transparent)
        continue;
      const captured = CANVAS_BG_PROPS.map((p) => [p, cs.getPropertyValue(p)]);
      if (el === document.documentElement)
        el.style.background = "none";
      return captured;
    }
    return [];
  }
  function ensureRun(strip) {
    const parent = strip.el.parentElement;
    if (parent.classList.contains("gp-run"))
      return parent;
    const run = document.createElement("div");
    run.className = "gp-run";
    strip.el.before(run);
    run.appendChild(strip.el);
    const layer = document.createElement("div");
    layer.className = "gp-layer";
    run.insertBefore(layer, strip.el);
    return run;
  }
  function rectFor(name, g) {
    const r = marginBoxRectPt(name, g);
    return { left: px(r.x), top: px(r.y), width: px(r.w), height: px(r.h) };
  }

  // src/engine/viewer/index.ts
  var resizeListener;
  async function mount(opts = {}) {
    const t0 = performance.now();
    const layout = await fragmentDocument(opts);
    applySpreadMode(layout.strips, false);
    const decoration = decorate(layout, { designer: opts.designer });
    let spreadOn = false;
    const api = Object.assign(layout, {
      decoration,
      goto(page) {
        const clamped = Math.max(1, Math.min(layout.totalPages, Math.round(page)));
        current = clamped - 1;
        const target = decoration.sheetFor(current);
        target?.scrollIntoView({ block: "start", inline: "center" });
        emit();
      },
      next: () => api.goto(api.currentPage() + 1),
      prev: () => api.goto(api.currentPage() - 1),
      currentPage: () => current + 1,
      refresh() {
        layout.relayout();
        applySpreadMode(layout.strips, spreadOn);
        decoration.redraw();
        emit();
      },
      setSpread(on) {
        spreadOn = on;
        applySpreadMode(layout.strips, spreadOn);
        decoration.redraw();
        emit();
      }
    });
    let current = 0;
    const emit = () => {
      const detail = { page: current, pagecount: layout.totalPages };
      window.dispatchEvent(new CustomEvent("gp:page", { detail }));
      if (window.parent !== window)
        window.parent.postMessage({ gp: detail }, "*");
    };
    const ns = window.Gutterpress;
    if (ns) {
      for (const k of Object.keys(ns))
        if (!(k in api))
          api[k] = ns[k];
    }
    window.Gutterpress = api;
    emit();
    window.dispatchEvent(new CustomEvent("gp:layout", {
      detail: { ms: performance.now() - t0, pages: layout.totalPages }
    }));
    fitZoom();
    if (resizeListener)
      window.removeEventListener("resize", resizeListener);
    resizeListener = fitZoom;
    window.addEventListener("resize", resizeListener);
    return api;
  }
  function fitZoom() {
    if (document.documentElement.style.getPropertyValue("--gutterpress-zoom")) {
      document.body.style.removeProperty("--gutterpress-fit-zoom");
      return;
    }
    const sheet = document.querySelector(".gp-sheet");
    if (!sheet)
      return;
    const pageW = parseFloat(sheet.style.getPropertyValue("--gp-page-w"));
    if (!pageW)
      return;
    const stagePadding = parseFloat(getComputedStyle(document.body).paddingLeft) + parseFloat(getComputedStyle(document.body).paddingRight);
    const available = window.innerWidth - stagePadding;
    if (available > 0 && available < pageW)
      document.body.style.setProperty("--gutterpress-fit-zoom", String(available / pageW));
    else
      document.body.style.removeProperty("--gutterpress-fit-zoom");
  }
  if (typeof document !== "undefined" && !window.__GP_MANUAL__) {
    const params = new URLSearchParams(location.search);
    const start = () => mount({ designer: params.has("designer") });
    if (document.readyState === "loading")
      document.addEventListener("DOMContentLoaded", start, { once: true });
    else
      start();
  }

  // src/engine/viewer/global.ts
  var api = { mount, decorate, ...exports_fragment, gcpm: exports_gcpm_extract, content: exports_content_value };
  window.Gutterpress = api;
})();

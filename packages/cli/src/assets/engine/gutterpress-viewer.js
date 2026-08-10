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
    waitForLayoutReady: () => waitForLayoutReady,
    strideOf: () => strideOf,
    spreadModeSupported: () => spreadModeSupported,
    rowStrideOf: () => rowStrideOf,
    pageRangeOf: () => pageRangeOf,
    pageOf: () => pageOf,
    measure: () => measure,
    loadStyleSources: () => loadStyleSources,
    injectViewerCss: () => injectViewerCss,
    injectBreakMapping: () => injectBreakMapping,
    fragmentDocument: () => fragmentDocument,
    compensateRepeatedHeaders: () => compensateRepeatedHeaders,
    compensateRectoBreaks: () => compensateRectoBreaks,
    collectCssText: () => collectCssText,
    buildStrips: () => buildStrips,
    blankPageIndices: () => blankPageIndices,
    applySpreadMode: () => applySpreadMode,
    PX_PER_PT: () => PX_PER_PT
  });

  // src/engine/viewer/viewer.css
  var viewer_default = `/* Folio viewer chrome. The author's content CSS is untouched; everything here
   is scoped to Folio's own wrappers/layers. */

/* The stage backdrop is viewer chrome and must stay chrome: this rule (0-1-0)
   deliberately outranks an author's \`body { background: … }\` (0-0-1). An
   author's canvas background is not lost — \`decorate()\` reads it before this
   class is applied and replays it on every sheet, which is where print puts
   it (see \`captureCanvasBackground\`). */
.folio-stage {
  --folio-sheet-bg: #fff;
  --folio-stage-bg: #4a4a52;
  --folio-guide: #e5484d;
  --folio-safe: #30a46c;
  background: var(--folio-stage-bg);
  margin: 0;
  padding: 32px;
  overflow: auto;
  /* Two independent inputs: the host's zoom control (\`--gutterpress-zoom\`, set
     on <html> by preview-interface.js) and the viewer's own fit-to-width
     shrink for narrow viewports (\`--gutterpress-fit-zoom\`, set on <body> by
     fitZoom()). They MUST compose — writing both to one property makes the
     <body> value shadow the host's and the zoom control goes dead. */
  zoom: calc(var(--gutterpress-zoom, 1) * var(--gutterpress-fit-zoom, 1));
  /* Kept for a host that makes THIS element the scroll container. In the
     ordinary document the viewport scrolls, not <body> — \`overflow: auto\`
     above propagates to the viewport and leaves <body> itself a non-scroller,
     so a \`scroll-snap-type\` declared here is inert (measured: with the
     property only here, a smooth scroll settles exactly where asked, sheet
     left edges 152–300px off the viewport edge, in every view mode). The
     rule that actually does the work is on :root below. */
  scroll-snap-type: x proximity;
}

/* Manual wheel/trackpad scroll settles on a page boundary (single mode) or a
   recto-page boundary (two-up, see \`data-side\` below) — \`proximity\`, not
   \`mandatory\`, so a fast gesture isn't fought to a stop mid-flick. \`x\` only:
   rows (chapters) stack vertically with no equivalent "page" unit to snap to.
   Declared on the viewport's real scroll container (:root), scoped by :has()
   so it can only ever apply to a document the viewer itself owns. */
:root:has(> body.folio-stage) {
  scroll-snap-type: x proximity;
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
   a run would measure correctly but render blank — the \`.folio-run\` wrapper
   below is already sized to the run's full width and owns the actual
   clipping/visibility, so the strip does not need to. */
.folio-strip {
  position: relative;
  width: var(--folio-content-w);
  height: var(--folio-content-h);
  column-width: var(--folio-content-w);
  column-gap: calc(
    var(--folio-margin-right) + var(--folio-margin-left) + var(--folio-sheet-gap)
  );
  column-fill: auto;
  overflow: visible;
  margin: 0 0 var(--folio-sheet-gap);
  /* strip sits inside the first sheet's content box */
  transform: translate(var(--folio-margin-left), var(--folio-margin-top));
}

/* Sheets/margin boxes are painted behind/around the strip by the decoration
   layer; the strip itself must stay transparent so they show through. */
.folio-strip > * {
  break-inside: auto;
}

/* Two-up/spread view mode (\`applySpreadMode\` in fragment.ts): wraps this
   run's multicol columns into 2-column ROWS instead of one long row, using
   CSS Multicol L2's \`column-wrap: wrap\` + \`column-height\` (shipped unflagged
   Chrome/Edge 145+ — CSS.supports-gated in JS, so this selector only ever
   matches on a browser that has it; the base \`.folio-strip\` rules above are
   the single-row fallback everywhere else). \`row-gap\` mirrors \`column-gap\`
   above: content box height + top/bottom margins + the visual sheet gap, so
   consecutive wrapped rows are spaced exactly one page-pitch apart, matching
   how \`column-gap\` already encodes left/right margins for columns within a
   row. Width reserves exactly two columns so a lone page (a strip with only
   one fragment) still gets its correct left/right slot, with nothing
   inserted to fill the other. */
.folio-strip[data-wrap="on"] {
  column-wrap: wrap;
  column-height: var(--folio-content-h);
  column-count: 2;
  row-gap: calc(
    var(--folio-margin-top) + var(--folio-margin-bottom) + var(--folio-sheet-gap)
  );
  width: calc(
    var(--folio-content-w) * 2 + var(--folio-margin-right) + var(--folio-margin-left) +
      var(--folio-sheet-gap)
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
.folio-wrap-spacer {
  break-after: column;
  height: 0;
  margin: 0;
  padding: 0;
  border: 0;
}

.folio-run {
  position: relative;
  margin: 0 0 var(--folio-sheet-gap);
}

.folio-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
}

.folio-sheet {
  position: absolute;
  top: 0;
  width: var(--folio-page-w);
  height: var(--folio-page-h);
  background: var(--folio-sheet-bg);
  box-shadow: 0 2px 12px rgb(0 0 0 / 0.35);
  scroll-snap-align: start;
}

/* View modes (WORK PACKAGE B item 3): content NEVER moves — sheets stay
   exactly where decorate.ts painted them (see draw()'s own comment on why a
   prior repositioning approach shipped broken and was retired). A view mode
   is purely a paging/scroll-snap granularity choice: \`pageStep()\`
   (preview-interface.js) already steps next/prevPage by 1 or 2 book pages;
   this is the matching manual-scroll behavior. Two-up snaps ONLY on recto
   sheets, so a manual scroll settles with a recto+verso PAIR in view
   together, never split across a snap point. Keyed off \`data-side\` (written
   by decorate.ts from the sheet's own 1-based book page number), NOT
   \`nth-child(odd)\`: a \`.folio-layer\`'s first sheet is NOT always a recto —
   measured on the 34pp field guide, the layers start at pages 1, 3, 5, 7 and
   **14** (a verso), so nth-child parity would snap that 20-page run on its
   VERSO pages, splitting exactly the pairs this is meant to keep together. */
body.view-two-column .folio-sheet[data-side="verso"],
body.view-spread .folio-sheet[data-side="verso"] {
  scroll-snap-align: none;
}

.folio-marginbox {
  position: absolute;
  display: flex;
  align-items: center;
  overflow: hidden;
  white-space: pre;
  font: inherit;
  color: inherit;
}

.folio-marginbox[data-align="start"] { justify-content: flex-start; }
.folio-marginbox[data-align="center"] { justify-content: center; }
.folio-marginbox[data-align="end"] { justify-content: flex-end; }

/* designer mode ------------------------------------------------------- */
.folio-guide-trim,
.folio-guide-safe,
.folio-crop-mark {
  position: absolute;
  pointer-events: none;
  display: none;
}

.folio-stage[data-designer="on"] .folio-guide-trim,
.folio-stage[data-designer="on"] .folio-guide-safe,
.folio-stage[data-designer="on"] .folio-crop-mark {
  display: block;
}

.folio-guide-trim { outline: 1px dashed var(--folio-guide); }
.folio-guide-safe { outline: 1px dashed var(--folio-safe); }
.folio-crop-mark { background: var(--folio-guide); }

.folio-warning {
  position: absolute;
  right: 4px;
  top: 4px;
  background: var(--folio-guide);
  color: #fff;
  font: 600 10px/1.4 ui-sans-serif, system-ui, sans-serif;
  padding: 2px 6px;
  border-radius: 3px;
}

/* An accidental Ctrl+P on the published page must not print the dark stage
   plus decorations — the PDF, shipped alongside book.html, is the print
   artifact. This is a minimal reset, not a print layout. */
@media print {
  .folio-stage {
    background: none;
    padding: 0;
    overflow: visible;
    zoom: 1;
  }
  .folio-layer,
  .folio-warning,
  .folio-guide-trim,
  .folio-guide-safe,
  .folio-crop-mark {
    display: none !important;
  }
  .folio-sheet {
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
      const s = chunk.trim();
      if (!s)
        return;
      const colon = indexOfTopLevel(s, ":");
      if (colon <= 0)
        return;
      const prop = s.slice(0, colon).trim().toLowerCase();
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
    const names = new Set;
    for (const r of model.pageRules)
      if (r.name)
        names.add(r.name);
    for (const a of model.pageAssignments)
      names.add(a.page);
    model.pageNames = [...names];
    return model;
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
      const at = body.indexOf("@", i);
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
        rules.add(`${base.trim()}[data-folio-${where}]${colons}${where} { content: attr(data-folio-${where}); }`);
      }
    }
    rules.add(`[data-folio-after]::after { content: attr(data-folio-after); }`);
    rules.add(`[data-folio-before]::before { content: attr(data-folio-before); }`);
    return [...rules].join(`
`);
  }

  // src/engine/viewer/fragment.ts
  var PX_PER_PT = 96 / 72;
  function injectViewerCss(doc = document) {
    if (doc.getElementById("folio-viewer-css"))
      return;
    const style = doc.createElement("style");
    style.id = "folio-viewer-css";
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
      const raw = owner?.__folioSource;
      if (raw)
        out += raw + `
`;
    }
    return out;
  }
  async function loadStyleSources(doc = document) {
    const links = Array.from(doc.querySelectorAll('link[rel~="stylesheet"]'));
    await Promise.all(links.map(async (l) => {
      if (l.__folioSource)
        return;
      try {
        l.__folioSource = await (await fetch(l.href)).text();
      } catch {
        l.__folioSource = "";
      }
    }));
    return collectCssText(doc);
  }
  function injectBreakMapping(model, doc = document) {
    const rules = [];
    for (const b of model.breaks) {
      if (b.prop === "break-inside")
        continue;
      if (!/^(page|left|right|recto|verso|always)$/.test(b.value.trim()))
        continue;
      rules.push(`.folio-strip ${b.selector} { ${b.prop}: column; }`);
    }
    const css = rules.join(`
`);
    if (css) {
      const style = doc.createElement("style");
      style.id = "folio-break-mapping";
      style.textContent = css;
      doc.head.appendChild(style);
    }
    return css;
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
  function pushRun(runs, page, nodes) {
    const last = runs[runs.length - 1];
    if (last && last.page === page)
      last.nodes.push(...nodes);
    else
      runs.push({ page, nodes });
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
        pushRun(runs, last.page, held);
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
      if (kid.classList.contains("folio-layer"))
        continue;
      const own = directPageName(kid, model);
      if (own !== undefined) {
        pushRun(runs, own, [...carry(), kid]);
        continue;
      }
      if (!hasDescendantPageAssignment(kid, model)) {
        pushRun(runs, undefined, [...carry(), kid]);
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
        pushRun(runs, r.page, [...lead, shell]);
        lead = [];
      }
      kid.remove();
    }
    const trailing = carry();
    if (trailing.length)
      pushRun(runs, undefined, trailing);
    return runs;
  }
  function buildStrips(model, opts = {}, warnings = []) {
    const doc = document;
    const root = opts.root ?? doc.querySelector("main") ?? doc.body;
    const gap = opts.sheetGap ?? 24;
    const runs = explodeChildren(root, model);
    const strips = [];
    for (const run of runs) {
      const { geometry } = resolvePage(model, { name: run.page });
      const strip = doc.createElement("div");
      strip.className = "folio-strip";
      if (run.page)
        strip.dataset.page = run.page;
      const w = pt(geometry.width - geometry.margin.left - geometry.margin.right);
      const h = pt(geometry.height - geometry.margin.top - geometry.margin.bottom);
      strip.style.setProperty("--folio-content-w", `${w}px`);
      strip.style.setProperty("--folio-content-h", `${h}px`);
      strip.style.setProperty("--folio-sheet-gap", `${gap}px`);
      strip.style.setProperty("--folio-page-w", `${pt(geometry.width)}px`);
      strip.style.setProperty("--folio-page-h", `${pt(geometry.height)}px`);
      strip.style.setProperty("--folio-margin-top", `${pt(geometry.margin.top)}px`);
      strip.style.setProperty("--folio-margin-right", `${pt(geometry.margin.right)}px`);
      strip.style.setProperty("--folio-margin-bottom", `${pt(geometry.margin.bottom)}px`);
      strip.style.setProperty("--folio-margin-left", `${pt(geometry.margin.left)}px`);
      run.nodes[0].before(strip);
      for (const n of run.nodes)
        strip.appendChild(n);
      strips.push({ el: strip, page: run.page, geometry, pages: 0, offset: 0 });
    }
    return strips;
  }
  function compensateRepeatedHeaders(strips, maxPasses = 24) {
    const warnings = [];
    let passes = 0;
    let touched = 0;
    for (const strip of strips) {
      const tables = Array.from(strip.el.querySelectorAll("table")).filter((t) => t.tHead || t.tFoot);
      if (!tables.length)
        continue;
      for (const table of tables) {
        for (const shim of Array.from(table.querySelectorAll("tr.folio-thead-shim, tr.folio-tfoot-shim")))
          shim.remove();
        table.style.breakBefore = "";
      }
      const pushed = new Set;
      const footClaims = new Map;
      let previous = "";
      for (let pass = 0;pass < maxPasses; pass++) {
        passes = Math.max(passes, pass + 1);
        const stride = strideOf(strip.el);
        const stripLeft = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
        const colOf = (r) => Math.floor((r.left - stripLeft + 1) / stride);
        const stripTop = strip.el.getBoundingClientRect().top;
        const colBottom = strip.el.clientHeight;
        const plans = [];
        for (const table of tables) {
          const head = table.tHead;
          const headRect = head?.getClientRects()[0];
          const footHeight = table.tFoot?.getBoundingClientRect().height ?? 0;
          const rows = Array.from(table.querySelectorAll("tbody > tr")).filter((r) => !r.classList.contains("folio-thead-shim") && !r.classList.contains("folio-tfoot-shim"));
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
              const bottom = rects[i].bottom - stripTop;
              if (bottom > colBottom - footHeight + 0.5) {
                newClaim = row;
                claims.set(row, colBottom - (rects[i].top - stripTop));
                break;
              }
            }
          }
          plans.push({
            table,
            push: headRect ? colOf(headRect) < cols[0] : false,
            headHeight: headRect?.height ?? 0,
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
          for (const shim of Array.from(plan.table.querySelectorAll("tr.folio-thead-shim, tr.folio-tfoot-shim")))
            shim.remove();
          if (plan.push && !pushed.has(plan.table)) {
            pushed.add(plan.table);
            plan.table.style.breakBefore = "column";
            touched++;
            continue;
          }
          for (const row of plan.breakRows) {
            row.before(headerShim(plan.table.tHead, plan.headHeight, plan.cells));
            touched++;
          }
          for (const [row, height] of plan.footRows) {
            row.before(sectionShim(plan.table.tFoot, height, plan.cells, "folio-tfoot-shim"));
            touched++;
          }
        }
      }
    }
    return { tables: touched, passes, warnings };
  }
  function headerShim(head, height, cells) {
    return sectionShim(head, height, cells, "folio-thead-shim");
  }
  function sectionShim(section, height, cells, className) {
    const shim = document.createElement("tr");
    shim.className = className;
    shim.setAttribute("aria-hidden", "true");
    shim.style.height = `${height}px`;
    if (className === "folio-tfoot-shim")
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
    for (const spacer of Array.from(document.querySelectorAll(".folio-recto-spacer")))
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
      const spacer = document.createElement("div");
      spacer.className = "folio-recto-spacer";
      spacer.setAttribute("aria-hidden", "true");
      spacer.style.cssText = "break-before: column; break-after: column; height: 0; margin: 0; padding: 0; border: 0;";
      site.el.before(spacer);
      inserted++;
    }
    return inserted;
  }
  function unwrapStrips(strips) {
    for (const strip of strips) {
      const stripEl = strip.el;
      for (const spacer of Array.from(stripEl.querySelectorAll(".folio-wrap-spacer")))
        spacer.remove();
      const runWrapper = stripEl.parentElement;
      const removalTarget = runWrapper && runWrapper.classList.contains("folio-run") ? runWrapper : stripEl;
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
      strip.el.style.setProperty("--folio-pages", String(strip.pages));
    }
    return { strips, totalPages: offset };
  }
  function strideOf(strip) {
    const cs = getComputedStyle(strip);
    const w = parseFloat(cs.getPropertyValue("--folio-content-w"));
    const gap = parseFloat(cs.columnGap) || 0;
    return w + gap;
  }
  function rowStrideOf(strip) {
    const cs = getComputedStyle(strip);
    const h = parseFloat(cs.getPropertyValue("--folio-content-h"));
    const gap = parseFloat(cs.rowGap) || 0;
    return h + gap;
  }
  function indexInStrip(left, top, strip) {
    const stride = strideOf(strip.el);
    const rowStride = rowStrideOf(strip.el);
    const stripBox = strip.el.getBoundingClientRect();
    const stripLeft = stripBox.left - strip.el.scrollLeft;
    const stripTop = stripBox.top;
    const perRow = strip.wrapCols ?? strip.pages;
    const shift = strip.wrapShift ?? 0;
    const colVisual = Math.floor((left - stripLeft + 1) / stride);
    const colClamped = Math.max(0, Math.min(perRow - 1, colVisual));
    const row = Math.max(0, Math.floor((top - stripTop + 1) / rowStride));
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
    const on = spread && spreadModeSupported();
    for (const strip of strips) {
      const el = strip.el;
      const existingSpacer = el.querySelector(":scope > .folio-wrap-spacer");
      if (!on) {
        existingSpacer?.remove();
        delete el.dataset.wrap;
        strip.wrapCols = undefined;
        strip.wrapShift = 0;
        continue;
      }
      const shift = strip.offset % 2 === 0 ? 1 : 0;
      strip.wrapCols = 2;
      strip.wrapShift = shift;
      el.dataset.wrap = "on";
      if (shift) {
        if (!existingSpacer) {
          const spacer = document.createElement("div");
          spacer.className = "folio-wrap-spacer";
          spacer.setAttribute("aria-hidden", "true");
          el.insertBefore(spacer, el.firstChild);
        }
      } else {
        existingSpacer?.remove();
      }
    }
  }
  function blankPageIndices(strips) {
    return Array.from(document.querySelectorAll(".folio-recto-spacer")).map((el) => pageOf(el, strips));
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
    if (printOnly && !document.getElementById("folio-media-print")) {
      const style = document.createElement("style");
      style.id = "folio-media-print";
      style.textContent = printOnly;
      document.head.appendChild(style);
    }
    const model = extract(css);
    injectBreakMapping(model);
    const authoring = [];
    const strips = buildStrips(model, opts, authoring);
    await layoutReady;
    measure(strips);
    const blanks = compensateRectoBreaks(model, strips);
    if (blanks)
      measure(strips);
    const headers = opts.compensateHeaders === false ? { tables: 0, passes: 0, warnings: [] } : compensateRepeatedHeaders(strips);
    const { totalPages } = measure(strips);
    const api = {
      model,
      strips,
      totalPages,
      warnings: [...new Set([...authoring, ...headers.warnings])],
      blankPages: blanks,
      blankPageIndices: blankPageIndices(strips),
      pageOf: (sel) => pageOf(typeof sel === "string" ? document.querySelector(sel) : sel, strips),
      pageRangeOf: (sel) => pageRangeOf(typeof sel === "string" ? document.querySelector(sel) : sel, strips),
      relayout: () => {
        unwrapStrips(strips);
        for (const spacer of Array.from(document.querySelectorAll(".folio-recto-spacer")))
          spacer.remove();
        const rebuilt = buildStrips(model, opts, authoring);
        strips.length = 0;
        strips.push(...rebuilt);
        measure(strips);
        api.blankPages = compensateRectoBreaks(model, strips);
        if (opts.compensateHeaders !== false)
          api.warnings = [
            ...new Set([...authoring, ...compensateRepeatedHeaders(strips).warnings])
          ];
        const r = measure(strips);
        api.totalPages = r.totalPages;
        api.blankPageIndices = blankPageIndices(strips);
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
        const close = matchParen(s, open);
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
  function matchParen(s, open) {
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
  function decorate(layout, opts = {}) {
    const model = layout.model;
    const sheets = new Map;
    let blankPages = new Set;
    const warnings = [];
    const api = {
      redraw: () => draw(),
      sheetFor: (p) => sheets.get(p),
      stringMap: new Map,
      targets: new Map,
      pageNumbers: [],
      warnings,
      setDesigner(on) {
        document.body.dataset.designer = on ? "on" : "off";
      }
    };
    const canvasBg = captureCanvasBackground();
    document.body.classList.add("folio-stage");
    if (document.body.dataset.designer === undefined)
      api.setDesigner(!!opts.designer);
    function pageContext(strip, indexInStrip2, bookIndex) {
      if (blankPages.has(bookIndex)) {
        const pseudos2 = ["blank"];
        const { geometry: geometry2, marginBoxes: marginBoxes2 } = resolvePage(model, { pseudos: pseudos2 });
        return { index: bookIndex, strip, pseudos: pseudos2, geometry: geometry2, marginBoxes: marginBoxes2 };
      }
      const pseudos = [];
      if (bookIndex === 0)
        pseudos.push("first");
      if (indexInStrip2 === 0)
        pseudos.push("nth-first-of-run");
      pseudos.push(bookIndex % 2 === 0 ? "right" : "left");
      const { geometry, marginBoxes } = resolvePage(model, { name: strip.page, pseudos });
      return { index: bookIndex, strip, pseudos, geometry, marginBoxes };
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
          el.setAttribute(`data-folio-${pseudo}`, text);
        }
      }
      for (const href of brokenHrefs)
        warnings.push(`The link "${href}" doesn't point at anything in this book, so its page number can't be shown. Check the spelling, or add that id to the heading you meant.`);
      fillLeaders();
      let style = document.getElementById("folio-xref-style");
      if (!style) {
        style = document.createElement("style");
        style.id = "folio-xref-style";
        document.head.appendChild(style);
      }
      style.textContent = generatedContentCss(model.xrefs.map((x) => x.selector));
    }
    function fillLeaders() {
      const marked = [];
      for (const attr of ["data-folio-after", "data-folio-before"]) {
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
      buildMaps();
      fillXrefs();
      for (const strip of layout.strips) {
        const run = ensureRun(strip);
        const stride = strideOf(strip.el);
        const rowStride = rowStrideOf(strip.el);
        const perRow = strip.wrapCols ?? strip.pages;
        const shift = strip.wrapShift ?? 0;
        const layer = run.querySelector(".folio-layer");
        layer.textContent = "";
        const g = strip.geometry;
        for (let i = 0;i < strip.pages; i++) {
          const bookIndex = strip.offset + i;
          const ctx = pageContext(strip, i, bookIndex);
          const slot = i + shift;
          const row = Math.floor(slot / perRow);
          const colVisual = slot % perRow;
          const columnLeft = PX_PER_PT * g.margin.left + colVisual * stride;
          const sheetLeft = columnLeft - PX_PER_PT * ctx.geometry.margin.left;
          const sheetTop = row * rowStride;
          const sheet = document.createElement("div");
          sheet.className = "folio-sheet";
          sheet.dataset.page = String(bookIndex + 1);
          sheet.dataset.side = bookIndex % 2 === 0 ? "recto" : "verso";
          sheet.style.left = `${sheetLeft}px`;
          sheet.style.top = `${sheetTop}px`;
          sheet.style.setProperty("--folio-page-w", px(ctx.geometry.width));
          sheet.style.setProperty("--folio-page-h", px(ctx.geometry.height));
          for (const [prop, value] of canvasBg)
            sheet.style.setProperty(prop, value);
          layer.appendChild(sheet);
          sheets.set(bookIndex, sheet);
          drawMarginBoxes(sheet, ctx, layout.totalPages);
          drawGuides(sheet, ctx);
          drawCropMarks(sheet, ctx);
        }
        const rows = Math.max(1, Math.ceil((strip.pages + shift) / perRow));
        run.style.height = `${rowStride * rows}px`;
        run.style.width = `${stride * perRow}px`;
        if (opts.designer)
          checkOverflow(strip, warnings);
      }
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
        box.className = "folio-marginbox";
        box.dataset.box = name;
        box.textContent = text;
        Object.assign(box.style, rectFor(name, g), {
          font: decls["font"] ?? "",
          fontSize: decls["font-size"] ?? "",
          fontFamily: decls["font-family"] ?? "",
          color: decls["color"] ?? ""
        });
        box.dataset.align = name.includes("center") || name.includes("middle") ? "center" : /right/.test(name) ? "end" : "start";
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
        el.className = "folio-crop-mark";
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
        trim.className = "folio-guide-trim";
        Object.assign(trim.style, {
          left: "0px",
          top: "0px",
          width: px(g.width),
          height: px(g.height)
        });
        sheet.appendChild(trim);
      }
      const safe = document.createElement("div");
      safe.className = "folio-guide-safe";
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
          el.classList.add("folio-overflowing");
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
    if (parent.classList.contains("folio-run"))
      return parent;
    const run = document.createElement("div");
    run.className = "folio-run";
    strip.el.before(run);
    run.appendChild(strip.el);
    const layer = document.createElement("div");
    layer.className = "folio-layer";
    run.insertBefore(layer, strip.el);
    return run;
  }
  function rectFor(name, g) {
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
    return { left: px(x), top: px(y), width: px(w), height: px(h) };
  }

  // src/engine/viewer/index.ts
  var resizeListener;
  async function mount(opts = {}) {
    const t0 = performance.now();
    const layout = await fragmentDocument(opts);
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
      window.dispatchEvent(new CustomEvent("folio:page", { detail }));
      if (window.parent !== window)
        window.parent.postMessage({ folio: detail }, "*");
    };
    const ns = window.Gutterpress;
    if (ns) {
      for (const k of Object.keys(ns))
        if (!(k in api))
          api[k] = ns[k];
    }
    window.Gutterpress = api;
    window.folio = api;
    window.Folio = api;
    emit();
    window.dispatchEvent(new CustomEvent("folio:layout", {
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
    const sheet = document.querySelector(".folio-sheet");
    if (!sheet)
      return;
    const pageW = parseFloat(sheet.style.getPropertyValue("--folio-page-w"));
    if (!pageW)
      return;
    const stagePadding = parseFloat(getComputedStyle(document.body).paddingLeft) + parseFloat(getComputedStyle(document.body).paddingRight);
    const available = window.innerWidth - stagePadding;
    if (available > 0 && available < pageW)
      document.body.style.setProperty("--gutterpress-fit-zoom", String(available / pageW));
    else
      document.body.style.removeProperty("--gutterpress-fit-zoom");
  }
  if (typeof document !== "undefined" && !window.__FOLIO_MANUAL__) {
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
  window.Folio = api;
  window.folio = api;
})();

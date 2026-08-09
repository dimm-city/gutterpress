/**
 * Viewer decoration layer (§7). Absolutely-positioned chrome painted around
 * the natively-fragmented columns: page sheets, the 16 margin boxes with their
 * evaluated `content`, running strings from `string-set`, cross-references,
 * and designer-mode guides.
 *
 * Nothing here participates in layout — remove the layer and the author's
 * content is still fragmented exactly the same way.
 */
import {
  MARGIN_BOX_NAMES,
  resolvePage,
  type Declarations,
  type GcpmModel,
  type PageGeometry,
} from "../shared/gcpm-extract.ts";
import { evaluate, needsMeasurement } from "../shared/content-value.ts";
import {
  generatedContentCss,
  leaderFillCount,
  leaderMarker,
  LEADER_RE,
  pageCounterValues,
  parseWhich,
  stringValueAt,
  toFolioPage,
  type PageCounterReset,
} from "../shared/synthesis.ts";
import {
  PX_PER_PT,
  pageRangeOf,
  strideOf,
  type FolioViewerApi,
  type StripInfo,
} from "./fragment.ts";

const px = (v: number) => `${v * PX_PER_PT}px`;

/**
 * Element an in-document `#href` points at — `getElementById`, never
 * `querySelector`: markdown-it-footnote emits legal ids that are invalid CSS
 * selectors (`fnref1:1`), and a throw here aborts the whole mount.
 */
function elementForHref(href: string): Element | null {
  const raw = href.replace(/^#/, "");
  if (!raw) return null;
  let id = raw;
  try {
    id = decodeURIComponent(raw);
  } catch {
    /* not percent-encoded — use the literal */
  }
  return document.getElementById(id);
}

export interface DecorationApi {
  redraw(): void;
  sheetFor(page: number): HTMLElement | undefined;
  /** name -> [{page, value}] in document order */
  stringMap: Map<string, Array<{ page: number; value: string }>>;
  /** "#id" -> 1-based page */
  targets: Map<string, number>;
  /** the restarted `counter(page)` value for each 0-based book page, honoring `counter-reset: page N` */
  pageNumbers: number[];
  warnings: string[];
  /** show/hide trim, safe, and crop guides on the stage */
  setDesigner(on: boolean): void;
}

interface PageCtx {
  index: number; // 0-based book-wide
  strip: StripInfo;
  pseudos: string[];
  geometry: PageGeometry;
  marginBoxes: Record<string, Declarations>;
}

export function decorate(
  layout: FolioViewerApi,
  opts: { designer?: boolean } = {},
): DecorationApi {
  const model: GcpmModel = layout.model;
  const sheets = new Map<number, HTMLElement>();
  let blankPages = new Set<number>();
  const warnings: string[] = [];
  const api: DecorationApi = {
    redraw: () => draw(),
    sheetFor: (p) => sheets.get(p),
    stringMap: new Map(),
    targets: new Map(),
    pageNumbers: [],
    warnings,
    setDesigner(on) {
      document.body.dataset.designer = on ? "on" : "off";
    },
  };
  // Must run BEFORE `.folio-stage` lands on <body>: after that the stage's own
  // chrome background is indistinguishable from the author's.
  const canvasBg = captureCanvasBackground();
  document.body.classList.add("folio-stage");
  if (document.body.dataset.designer === undefined) api.setDesigner(!!opts.designer);

  function pageContext(strip: StripInfo, indexInStrip: number, bookIndex: number): PageCtx {
    // A recto/verso blank spacer is a DOM sibling of whatever it precedes, so
    // it sits inside that element's named-page run — but the compiler gives
    // every blank page its OWN isolated context (`page: folio--blank`,
    // resolved with no name, pseudo `blank` only: see `counterStyleCss` in
    // `build.ts`). Matching that here is what keeps a blank page's geometry
    // and content off the surrounding run's context (ARCHITECTURE.md §1).
    if (blankPages.has(bookIndex)) {
      const pseudos = ["blank"];
      const { geometry, marginBoxes } = resolvePage(model, { pseudos });
      return { index: bookIndex, strip, pseudos, geometry, marginBoxes };
    }
    const pseudos: string[] = [];
    if (bookIndex === 0) pseudos.push("first");
    if (indexInStrip === 0) pseudos.push("nth-first-of-run");
    // page 1 is a recto
    pseudos.push(bookIndex % 2 === 0 ? "right" : "left");
    const { geometry, marginBoxes } = resolvePage(model, { name: strip.page, pseudos });
    return { index: bookIndex, strip, pseudos, geometry, marginBoxes };
  }

  /** Which page is each string-set / xref target element on. */
  function buildMaps() {
    api.stringMap = new Map();
    api.targets = new Map();
    for (const decl of model.stringSets) {
      let els: Element[] = [];
      try {
        els = Array.from(document.querySelectorAll(decl.selector));
      } catch {
        continue;
      }
      const entries = api.stringMap.get(decl.name) ?? [];
      for (const el of els) {
        const [page] = pageRangeOf(el, layout.strips);
        if (page < 0) continue;
        entries.push({
          page,
          value: evaluate(decl.value, {
            text: (el.textContent ?? "").trim(),
            attr: (n) => el.getAttribute(n) ?? undefined,
          }),
        });
      }
      entries.sort((a, b) => a.page - b.page);
      api.stringMap.set(decl.name, entries);
    }
    // front-matter -> body folio restart (`counter-reset: page N`,
    // MIGRATION.md gap #1): the same `pageCounterValues` policy the compiler
    // applies via a generated `@counter-style`, applied here by overriding the
    // `page` fed to `evaluate()` — no CSS synthesis needed on this side.
    // Computed BEFORE the cross-reference targets below (F3), so
    // `target-counter()` can be converted through the SAME restarted numbers
    // a page's own margin box prints, instead of the raw physical page.
    const resets: PageCounterReset[] = [];
    for (const r of model.counterResets) {
      let els: Element[] = [];
      try {
        els = Array.from(document.querySelectorAll(r.selector));
      } catch {
        continue;
      }
      for (const el of els) {
        const [page] = pageRangeOf(el, layout.strips);
        if (page >= 0) resets.push({ page: page + 1, start: r.start });
      }
    }
    api.pageNumbers = resets.length ? pageCounterValues(resets, layout.totalPages) : [];
    const pageValues = api.pageNumbers.length ? api.pageNumbers : null;

    // cross-reference targets: any id that is linked to
    const linked = new Set<string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='#']")))
      linked.add(a.getAttribute("href")!);
    for (const href of linked) {
      const el = elementForHref(href);
      if (!el) continue;
      const [page] = pageRangeOf(el, layout.strips);
      if (page >= 0) api.targets.set(href, toFolioPage(page + 1, pageValues));
    }
  }

  /** Shared GCPM string() semantics — the same function the compiler samples. */
  function stringAt(name: string, which: string, page: number): string {
    return stringValueAt(api.stringMap.get(name) ?? [], page, parseWhich(which));
  }

  /**
   * Fill `target-counter()` text in the author's own DOM (screen path).
   *
   * When a link's target genuinely doesn't exist in the book, `target-counter()`
   * has nothing to resolve — that is a content bug (a typo'd `href`, or a
   * heading that lost its id), not something the viewer's measurement can
   * fix, and the compiler's own build already diagnoses it
   * (`engine.xref.broken` in `compiler/build.ts`). The preview used to leave
   * a bare "p.?" with no explanation; it now reports the same actionable
   * message the PDF build does, so the live preview is honest about WHY a
   * page number is missing instead of just showing an unexplained glyph.
   */
  function fillXrefs() {
    const brokenHrefs = new Set<string>();
    for (const xref of model.xrefs) {
      if (!needsMeasurement(xref.content)) continue;
      const base = xref.selector.replace(/::?(after|before)$/, "");
      const pseudo = /::?after$/.test(xref.selector) ? "after" : "before";
      let els: Element[] = [];
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
            if (page === undefined && url.startsWith("#")) brokenHrefs.add(url);
            return page;
          },
          targetText: (url) =>
            (elementForHref(url)?.textContent ?? "").trim() || undefined,
          leader: leaderMarker,
        });
        el.setAttribute(`data-folio-${pseudo}`, text);
      }
    }
    for (const href of brokenHrefs)
      warnings.push(
        `The link "${href}" doesn't point at anything in this book, so its page number can't be shown. Check the spelling, or add that id to the heading you meant.`,
      );
    fillLeaders();
    let style = document.getElementById("folio-xref-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "folio-xref-style";
      document.head.appendChild(style);
    }
    style.textContent = generatedContentCss(model.xrefs.map((x) => x.selector));
  }

  /**
   * Measured leader fill — the strip is already at print content width, so
   * unlike the compiler no geometry sandbox is needed; same fill policy.
   */
  function fillLeaders() {
    const marked: Array<{ el: HTMLElement; attr: string; raw: string }> = [];
    for (const attr of ["data-folio-after", "data-folio-before"]) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>(`[${attr}]`))) {
        const raw = el.getAttribute(attr) ?? "";
        if (LEADER_RE.test(raw)) marked.push({ el, attr, raw });
      }
    }
    if (!marked.length) return;
    const canvas = document.createElement("canvas");
    const cx = canvas.getContext("2d")!;
    for (const m of marked) m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, ""));
    document.body.offsetHeight;
    for (const m of marked) {
      const glue = LEADER_RE.exec(m.raw)![1] || ".";
      const block = m.el.parentElement ?? document.body;
      const blockRect = block.getBoundingClientRect();
      const cs = getComputedStyle(block);
      const contentRight =
        blockRect.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const rects = m.el.getClientRects();
      const last = rects.length ? rects[rects.length - 1]! : m.el.getBoundingClientRect();
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
      const layer = run.querySelector<HTMLElement>(".folio-layer")!;
      layer.textContent = "";
      const g = strip.geometry;

      for (let i = 0; i < strip.pages; i++) {
        const bookIndex = strip.offset + i;
        const ctx = pageContext(strip, i, bookIndex);

        // Sheets are painted exactly where Chromium put the matching column
        // (`i * stride`) — the ONLY layout that is guaranteed to agree with
        // where the strip's real content actually is. A `single`/`two-up`
        // repositioning was tried here and shipped broken (see setSpread's
        // retirement, ARCHITECTURE.md §7): the strip is one multicol flow
        // element with N columns, not N independently movable elements, so
        // the sheet chrome could be moved but the author's content — which
        // Chromium still renders at its native column offset — could not
        // move with it. Fixing that for real would mean fragmenting the DOM
        // per physical page (cloning content across pages), which is exactly
        // what this engine exists to avoid.
        const columnLeft = PX_PER_PT * g.margin.left + i * stride;
        const sheetLeft = columnLeft - PX_PER_PT * ctx.geometry.margin.left;
        const sheetTop = 0;

        const sheet = document.createElement("div");
        sheet.className = "folio-sheet";
        sheet.dataset.page = String(bookIndex + 1);
        // Recto = odd 1-based page (page 1 is a recto). Read by viewer.css's
        // two-up scroll-snap rule; a `.folio-layer`'s first sheet is NOT
        // reliably a recto, so DOM-order parity cannot stand in for this.
        sheet.dataset.side = bookIndex % 2 === 0 ? "recto" : "verso";
        sheet.style.left = `${sheetLeft}px`;
        sheet.style.top = `${sheetTop}px`;
        sheet.style.setProperty("--folio-page-w", px(ctx.geometry.width));
        sheet.style.setProperty("--folio-page-h", px(ctx.geometry.height));
        for (const [prop, value] of canvasBg) sheet.style.setProperty(prop, value);
        layer.appendChild(sheet);
        sheets.set(bookIndex, sheet);

        drawMarginBoxes(sheet, ctx, layout.totalPages);
        drawGuides(sheet, ctx);
        drawCropMarks(sheet, ctx);
      }

      run.style.height = px(g.height);
      run.style.width = `${stride * strip.pages}px`;

      if (opts.designer) checkOverflow(strip, warnings);
    }
  }

  function drawMarginBoxes(sheet: HTMLElement, ctx: PageCtx, totalPages: number) {
    const g = ctx.geometry;
    for (const name of MARGIN_BOX_NAMES) {
      const decls = ctx.marginBoxes[`@${name}`];
      if (!decls?.content) continue;
      const text = evaluate(decls.content, {
        page: api.pageNumbers[ctx.index] ?? ctx.index + 1,
        pages: totalPages,
        strings: (n, w) => stringAt(n, w, ctx.index),
        targetPage: (url) => api.targets.get(url),
      });
      if (!text) continue;
      const box = document.createElement("div");
      box.className = "folio-marginbox";
      box.dataset.box = name;
      box.textContent = text;
      Object.assign(box.style, rectFor(name, g), {
        font: decls["font"] ?? "",
        fontSize: decls["font-size"] ?? "",
        fontFamily: decls["font-family"] ?? "",
        color: decls["color"] ?? "",
      });
      box.dataset.align = name.includes("center") || name.includes("middle")
        ? "center"
        : /right/.test(name)
          ? "end"
          : "start";
      sheet.appendChild(box);
    }
  }

  const CROP_LEN = 14;
  const CROP_GAP = 3;

  /** Printer's crop marks at the trim corners, visible only in designer mode
   * (CSS-gated, same pattern as the trim/safe guides). Only meaningful when
   * the page has bleed to crop away. */
  function drawCropMarks(sheet: HTMLElement, ctx: PageCtx) {
    const g = ctx.geometry;
    if (g.bleed <= 0) return;
    const w = g.width * PX_PER_PT;
    const h = g.height * PX_PER_PT;
    const mark = (left: number, top: number, width: number, height: number) => {
      const el = document.createElement("div");
      el.className = "folio-crop-mark";
      Object.assign(el.style, { left: `${left}px`, top: `${top}px`, width: `${width}px`, height: `${height}px` });
      sheet.appendChild(el);
    };
    for (const [cx, cy] of [
      [0, 0],
      [w, 0],
      [0, h],
      [w, h],
    ] as const) {
      const ox = cx === 0 ? -1 : 1;
      const oy = cy === 0 ? -1 : 1;
      mark(cx + (ox < 0 ? -(CROP_GAP + CROP_LEN) : CROP_GAP), cy - 0.5, CROP_LEN, 1);
      mark(cx - 0.5, cy + (oy < 0 ? -(CROP_GAP + CROP_LEN) : CROP_GAP), 1, CROP_LEN);
    }
  }

  function drawGuides(sheet: HTMLElement, ctx: PageCtx) {
    const g = ctx.geometry;
    if (g.bleed > 0) {
      const trim = document.createElement("div");
      trim.className = "folio-guide-trim";
      Object.assign(trim.style, {
        left: "0px",
        top: "0px",
        width: px(g.width),
        height: px(g.height),
      });
      sheet.appendChild(trim);
    }
    const safe = document.createElement("div");
    safe.className = "folio-guide-safe";
    Object.assign(safe.style, {
      left: px(g.margin.left),
      top: px(g.margin.top),
      width: px(g.width - g.margin.left - g.margin.right),
      height: px(g.height - g.margin.top - g.margin.bottom),
    });
    sheet.appendChild(safe);
  }

  /** Screen-mode limit (§7): elements taller than a page clip. Say so, loudly. */
  function checkOverflow(strip: StripInfo, out: string[]) {
    const h = strip.el.clientHeight;
    for (const el of Array.from(strip.el.querySelectorAll<HTMLElement>("figure,table,img,pre"))) {
      const r = el.getBoundingClientRect();
      if (r.height > h + 1) {
        out.push(
          `${el.tagName.toLowerCase()}${el.id ? "#" + el.id : ""} is ${Math.round(r.height)}px tall; page content box is ${Math.round(h)}px — it will clip on screen and overflow in print.`,
        );
        el.classList.add("folio-overflowing");
      }
    }
  }

  draw();
  return api;
}

const CANVAS_BG_PROPS = [
  "background-color",
  "background-image",
  "background-repeat",
  "background-position",
  "background-size",
  "background-origin",
  "background-clip",
  "background-blend-mode",
] as const;

/**
 * The document canvas background (`html`'s, or `body`'s when `html` paints
 * nothing) is printed on EVERY page — that is how a book paints its own paper.
 * The viewer's stage IS `<body>`, so left alone that background paints one
 * backdrop behind the whole filmstrip instead of the pages themselves, and the
 * sheets stay blank white: the exact opposite of the printed artifact. Replay
 * it per sheet instead. `background-attachment` is deliberately not copied —
 * `fixed` against the viewport is meaningless for a page box.
 *
 * When it came from `html`, that element is also cleared, so the stage keeps
 * showing viewer chrome. When it came from `body`, no clearing is needed:
 * `.folio-stage` (0-1-0) already outranks the author's `body` rule (0-0-1).
 */
function captureCanvasBackground(): Array<[string, string]> {
  for (const el of [document.documentElement, document.body]) {
    const cs = getComputedStyle(el);
    const transparent = /^(transparent|rgba\(0, ?0, ?0, ?0\))$/.test(cs.backgroundColor);
    if (cs.backgroundImage === "none" && transparent) continue;
    const captured = CANVAS_BG_PROPS.map(
      (p) => [p, cs.getPropertyValue(p)] as [string, string],
    );
    if (el === document.documentElement) el.style.background = "none";
    return captured;
  }
  return [];
}

function ensureRun(strip: StripInfo): HTMLElement {
  const parent = strip.el.parentElement!;
  if (parent.classList.contains("folio-run")) return parent;
  const run = document.createElement("div");
  run.className = "folio-run";
  strip.el.before(run);
  run.appendChild(strip.el);
  const layer = document.createElement("div");
  layer.className = "folio-layer";
  run.insertBefore(layer, strip.el);
  return run;
}

/** Geometry of each of the 16 margin boxes, per CSS Paged Media §5.3. */
function rectFor(name: string, g: PageGeometry): Partial<CSSStyleDeclaration> {
  const { top, right, bottom, left } = g.margin;
  const cw = g.width - left - right;
  const ch = g.height - top - bottom;
  const third = (n: number) => n / 3;
  const T: Record<string, [number, number, number, number]> = {
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
    "right-bottom": [g.width - right, top + 2 * third(ch), right, third(ch)],
  };
  const [x, y, w, h] = T[name] ?? [0, 0, 0, 0];
  return { left: px(x), top: px(y), width: px(w), height: px(h) };
}

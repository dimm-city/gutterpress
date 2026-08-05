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
  parseWhich,
  stringValueAt,
} from "../shared/synthesis.ts";
import {
  PX_PER_PT,
  pageRangeOf,
  strideOf,
  type FolioViewerApi,
  type StripInfo,
} from "./fragment.ts";

const px = (v: number) => `${v * PX_PER_PT}px`;

export interface DecorationApi {
  redraw(): void;
  sheetFor(page: number): HTMLElement | undefined;
  /** name -> [{page, value}] in document order */
  stringMap: Map<string, Array<{ page: number; value: string }>>;
  /** "#id" -> 1-based page */
  targets: Map<string, number>;
  warnings: string[];
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
  const warnings: string[] = [];
  const api: DecorationApi = {
    redraw: () => draw(),
    sheetFor: (p) => sheets.get(p),
    stringMap: new Map(),
    targets: new Map(),
    warnings,
  };

  function pageContext(strip: StripInfo, indexInStrip: number, bookIndex: number): PageCtx {
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
    // cross-reference targets: any id that is linked to
    const linked = new Set<string>();
    for (const a of Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href^='#']")))
      linked.add(a.getAttribute("href")!);
    for (const href of linked) {
      const el = document.querySelector(href.replace(/^#/, "#"));
      if (!el) continue;
      const [page] = pageRangeOf(el, layout.strips);
      if (page >= 0) api.targets.set(href, page + 1);
    }
  }

  /** Shared GCPM string() semantics — the same function the compiler samples. */
  function stringAt(name: string, which: string, page: number): string {
    return stringValueAt(api.stringMap.get(name) ?? [], page, parseWhich(which));
  }

  /** Fill `target-counter()` text in the author's own DOM (screen path). */
  function fillXrefs() {
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
          targetPage: (url) => api.targets.get(url),
          targetText: (url) =>
            (document.querySelector(url)?.textContent ?? "").trim() || undefined,
          leader: leaderMarker,
        });
        el.setAttribute(`data-folio-${pseudo}`, text);
      }
    }
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
      const last = rects.length ? rects[rects.length - 1] : m.el.getBoundingClientRect();
      cx.font = getComputedStyle(m.el).font;
      const n = leaderFillCount(contentRight - last.right, cx.measureText(glue).width);
      m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, glue.repeat(n)));
    }
  }

  function draw() {
    sheets.clear();
    warnings.length = 0;
    buildMaps();
    fillXrefs();

    for (const strip of layout.strips) {
      const run = ensureRun(strip);
      const stride = strideOf(strip.el);
      const layer = run.querySelector<HTMLElement>(".folio-layer")!;
      layer.textContent = "";
      const g = strip.geometry;
      run.style.height = px(g.height);
      run.style.width = `${stride * strip.pages}px`;

      for (let i = 0; i < strip.pages; i++) {
        const bookIndex = strip.offset + i;
        const ctx = pageContext(strip, i, bookIndex);
        const columnLeft = PX_PER_PT * g.margin.left + i * stride;
        const sheetLeft = columnLeft - PX_PER_PT * ctx.geometry.margin.left;

        const sheet = document.createElement("div");
        sheet.className = "folio-sheet";
        sheet.dataset.page = String(bookIndex + 1);
        sheet.style.left = `${sheetLeft}px`;
        sheet.style.setProperty("--folio-page-w", px(ctx.geometry.width));
        sheet.style.setProperty("--folio-page-h", px(ctx.geometry.height));
        layer.appendChild(sheet);
        sheets.set(bookIndex, sheet);

        drawMarginBoxes(sheet, ctx, layout.totalPages);
        if (opts.designer) drawGuides(sheet, ctx);
      }

      if (opts.designer) checkOverflow(strip, warnings);
    }
  }

  function drawMarginBoxes(sheet: HTMLElement, ctx: PageCtx, totalPages: number) {
    const g = ctx.geometry;
    for (const name of MARGIN_BOX_NAMES) {
      const decls = ctx.marginBoxes[`@${name}`];
      if (!decls?.content) continue;
      const text = evaluate(decls.content, {
        page: ctx.index + 1,
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

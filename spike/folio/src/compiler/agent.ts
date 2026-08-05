/**
 * Browser-side agent for the compiler. Bundled to `dist/folio-agent.js` and
 * evaluated in the page the compiler is about to print.
 *
 * It only reads the DOM and applies what the compiler computed — all policy
 * (CSS extraction, tier routing, synthesis) stays in Node/shared modules so
 * there is exactly one implementation of each.
 */
import { leaderFillCount, LEADER_RE } from "../shared/synthesis.ts";

export interface StringSource {
  /** string name */
  name: string;
  /** element id (assigned by the agent if missing) */
  id: string;
  text: string;
  attrs: Record<string, string>;
  /** document order */
  order: number;
}

function flowRoot(): HTMLElement {
  return (document.querySelector("main") as HTMLElement) ?? document.body;
}

/** Rough CSS specificity: ids*100 + classes/attrs/pseudo-classes*10 + types. */
function specificity(selector: string): number {
  const ids = (selector.match(/#[\w-]+/g) ?? []).length;
  const classes = (selector.match(/\.[\w-]+|\[[^\]]+\]|:(?!:)[\w-]+/g) ?? []).length;
  const types = (selector.match(/(^|[\s>+~])[a-zA-Z][\w-]*/g) ?? []).length;
  return ids * 100 + classes * 10 + types;
}

let uid = 0;
/**
 * Measurement id for an element, WITHOUT mutating the element itself.
 *
 * Assigning an id to an author element is not inert — `h1[id]
 * { counter-increment: chapter }` is real theme CSS, and the old design had to
 * strip its ids and reprint, praying the clean document paginated identically
 * to the measured one. Instead: an element that already has an id is measured
 * through it (no mutation at all); one that doesn't gets a zero-size
 * `<folio-anchor id=…>` injected as its first child. Custom tag + absolute
 * positioning keep it invisible to layout, `::first-letter`, and (verified
 * against hostile `[id]`/`::before`/counter CSS) to author selectors — so the
 * instrumented document IS the shipped document and no final reprint exists.
 *
 * Residual risk, accepted and documented: a `parent > :first-child` rule could
 * observe the injected child. Elements with author ids — the common case, since
 * markdown renderers id their headings — never get an anchor at all.
 */
function ensureAnchor(el: Element): string {
  if (el.id) return el.id;
  const existing = el.firstElementChild;
  if (existing?.tagName === "FOLIO-ANCHOR" && existing.id) return existing.id;
  const anchor = document.createElement("folio-anchor");
  anchor.id = `folio-m-${++uid}`;
  anchor.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden");
  el.insertBefore(anchor, el.firstChild);
  return anchor.id;
}

/** The element a measurement id stands for (the anchor's host, or itself). */
function anchorHost(id: string): Element | null {
  const el = document.getElementById(id);
  if (!el) return null;
  return el.tagName === "FOLIO-ANCHOR" ? el.parentElement : el;
}

export async function collectCss(): Promise<string> {
  let out = "";
  for (const sheet of Array.from(document.styleSheets) as CSSStyleSheet[]) {
    const owner = sheet.ownerNode as HTMLElement | null;
    if (owner?.tagName === "STYLE") {
      out += owner.textContent + "\n";
    } else if (owner?.tagName === "LINK") {
      try {
        out += (await (await fetch((owner as HTMLLinkElement).href)).text()) + "\n";
      } catch {
        /* cross-origin: CSSOM geometry only, GCPM would be invisible anyway */
      }
    }
  }
  return out;
}

/** Every element that sets a string, in document order, with an id to measure. */
export function stringSources(
  stringSets: Array<{ selector: string; name: string }>,
): StringSource[] {
  const out: StringSource[] = [];
  let order = 0;
  for (const decl of stringSets) {
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(decl.selector));
    } catch {
      continue;
    }
    for (const el of els) {
      const attrs: Record<string, string> = {};
      for (const a of Array.from(el.attributes)) attrs[a.name] = a.value;
      out.push({
        name: decl.name,
        id: ensureAnchor(el),
        text: (el.textContent ?? "").trim().replace(/\s+/g, " "),
        attrs,
        order: order++,
      });
    }
  }
  // document order across all names
  out.sort((a, b) => {
    const ea = document.getElementById(a.id)!;
    const eb = document.getElementById(b.id)!;
    const rel = ea.compareDocumentPosition(eb);
    return rel & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
  });
  return out;
}

/**
 * Elements with a recto/verso forced break (`break-before: right|recto|…`),
 * which Chromium treats as a plain page break (S10). They need ids so the
 * compiler can learn which page they landed on.
 */
export function forcedBreakSites(
  decls: Array<{ selector: string; prop: string; value: string }>,
): Array<{ id: string; prop: string; value: string; selector: string }> {
  const out: Array<{ id: string; prop: string; value: string; selector: string }> = [];
  for (const d of decls) {
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(d.selector));
    } catch {
      continue;
    }
    for (const el of els)
      out.push({ id: ensureAnchor(el), prop: d.prop, value: d.value, selector: d.selector });
  }
  return out;
}

/**
 * Insert or remove the blank pages a recto/verso break implies.
 *
 * `entries` lists the elements that must move to the next page; a zero-height
 * spacer before each forces the extra break and carries the generated blank
 * page name so the author's `@page :blank` rules still style it (Chromium never
 * matches `:blank` itself).
 */
export function applyRectoSpacers(ids: string[], pageName: string): number {
  for (const spacer of Array.from(document.querySelectorAll(".folio-recto-spacer")))
    spacer.remove();
  let inserted = 0;
  for (const id of ids) {
    const el = anchorHost(id);
    if (!el) continue;
    const spacer = document.createElement("div");
    spacer.className = "folio-recto-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.cssText = `break-before: page; break-after: page; height: 0; margin: 0; padding: 0; border: 0; page: ${pageName};`;
    el.before(spacer);
    inserted++;
  }
  return inserted;
}

export interface ContentWarning {
  kind: "overheight" | "low-dpi";
  what: string;
  detail: string;
}

/**
 * Print-quality audit of the document, run once against the real layout.
 *
 * Two things a print pipeline must not accept silently:
 *  - a block taller than the page content box (Chromium splits images across
 *    pages in print but the viewer's multicol clips them, so these are exactly
 *    the elements where screen and print disagree), and
 *  - a raster whose natural resolution lands below the print bar once scaled
 *    to its printed size — invisible on screen, muddy on paper.
 */
export function auditContent(contentHeightPx: number, dpiFloor: number): ContentWarning[] {
  const out: ContentWarning[] = [];
  const name = (el: Element) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : "") +
    (el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : "");

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("figure,img,table,pre,svg,div"))) {
    const h = el.getBoundingClientRect().height;
    if (h > contentHeightPx + 1 && el.children.length === 0) {
      out.push({
        kind: "overheight",
        what: name(el),
        detail: `${Math.round(h)}px tall on a ${Math.round(contentHeightPx)}px content box`,
      });
    }
  }

  for (const img of Array.from(document.querySelectorAll<HTMLImageElement>("img"))) {
    const rect = img.getBoundingClientRect();
    if (!rect.width || !img.naturalWidth) continue;
    // CSS px are 1/96in; effective DPI = source pixels per printed inch
    const dpi = img.naturalWidth / (rect.width / 96);
    if (dpi < dpiFloor) {
      out.push({
        kind: "low-dpi",
        what: name(img),
        detail: `${img.naturalWidth}px wide printed at ${(rect.width / 96).toFixed(2)}in = ${Math.round(dpi)} DPI`,
      });
    }
  }
  return out;
}

/** Text of the elements cross-references point at, for `target-text()`. */
export function targetTexts(ids: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const id of ids) {
    const el = anchorHost(id);
    if (el) out[id] = (el.textContent ?? "").trim().replace(/\s+/g, " ");
  }
  return out;
}

/** Cross-reference sites: `<a href="#...">` matched by a target-* content rule. */
export function xrefSites(selectors: string[]): Array<{ id: string; href: string; selector: string }> {
  const out: Array<{ id: string; href: string; selector: string }> = [];
  for (const selector of selectors) {
    const base = selector.replace(/::?(after|before)$/, "");
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(base));
    } catch {
      continue;
    }
    for (const el of els) {
      const href = el.getAttribute("href") ?? "";
      out.push({ id: ensureAnchor(el), href, selector });
    }
  }
  return out;
}

/**
 * Instrumentation for the measurement channel (S4/S7): Chromium writes a
 * /Dests entry keyed by element id for every id something links to — even
 * from a `display:none` link, so this is provably layout-neutral.
 */
export function instrument(ids: string[]): number {
  let host = document.getElementById("folio-instrumentation");
  if (!host) {
    host = document.createElement("div");
    host.id = "folio-instrumentation";
    host.style.display = "none";
    document.body.appendChild(host);
  }
  host.textContent = "";
  for (const id of ids) {
    const a = document.createElement("a");
    a.href = `#${id}`;
    a.textContent = ".";
    host.appendChild(a);
  }
  return ids.length;
}

export function addCss(id: string, css: string): void {
  let style = document.getElementById(id) as HTMLStyleElement | null;
  if (!style) {
    style = document.createElement("style");
    style.id = id;
    document.head.appendChild(style);
  }
  style.textContent = css;
}

/**
 * Replace leader markers in generated content with a measured run of glue.
 *
 * Runs under print geometry: the body is constrained to the page content width
 * so lines wrap exactly where print wraps, each marked element is measured with
 * the marker collapsed (title + page number, no dots), and the marker becomes
 * `leaderFillCount(gap, glueWidth)` repetitions of the glue. Re-runnable —
 * `setGenerated` rewrites the attribute with a fresh marker every pass.
 */
export function fillLeaders(contentWidthPx: number): number {
  const marked: Array<{ el: Element; attr: string; raw: string }> = [];
  for (const attr of ["data-folio-after", "data-folio-before"]) {
    for (const el of Array.from(document.querySelectorAll(`[${attr}]`))) {
      const raw = el.getAttribute(attr) ?? "";
      if (LEADER_RE.test(raw)) marked.push({ el, attr, raw });
    }
  }
  if (!marked.length) return 0;

  const prevWidth = document.body.style.width;
  document.body.style.width = `${contentWidthPx}px`;
  const canvas = document.createElement("canvas");
  const cx = canvas.getContext("2d")!;
  try {
    // measure with the marker collapsed to nothing
    for (const m of marked) m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, ""));
    document.body.offsetHeight; // one forced layout for the whole batch
    for (const m of marked) {
      const match = LEADER_RE.exec(m.raw)!;
      const glue = match[1] || ".";
      const host = m.el as HTMLElement;
      const block = host.parentElement ?? document.body;
      const blockRect = block.getBoundingClientRect();
      const cs = getComputedStyle(block);
      const contentRight =
        blockRect.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      const rects = host.getClientRects();
      const last = rects.length ? rects[rects.length - 1] : host.getBoundingClientRect();
      cx.font = getComputedStyle(host).font;
      const glueW = cx.measureText(glue).width;
      const n = leaderFillCount(contentRight - last.right, glueW);
      m.el.setAttribute(m.attr, m.raw.replace(LEADER_RE, glue.repeat(n)));
    }
  } finally {
    document.body.style.width = prevWidth;
  }
  return marked.length;
}

/**
 * Apply synthesized generated content (cross-reference text) by element id.
 *
 * `css` comes from `generatedContentCss()` in Node — it must out-specify the
 * author's own `::after` rule, which survives the cascade even though
 * `target-counter()` computes to nothing (see the shared module).
 */
export function setGenerated(
  entries: Array<{ id: string; where: string; text: string }>,
  css: string,
): number {
  for (const e of entries) {
    const el = anchorHost(e.id);
    if (el) el.setAttribute(`data-folio-${e.where}`, e.text);
  }
  addCss("folio-generated-content", css);
  return entries.length;
}

declare global {
  interface Window {
    __folio: typeof api;
  }
}

const api = {
  auditContent,
  collectCss,
  forcedBreakSites,
  applyRectoSpacers,
  stringSources,
  xrefSites,
  targetTexts,
  fillLeaders,
  instrument,
  addCss,
  setGenerated,
};

if (typeof window !== "undefined") window.__folio = api;

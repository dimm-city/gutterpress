/**
 * Browser-side agent for the compiler. Bundled to `dist/gutterpress-agent.js` and
 * evaluated in the page the compiler is about to print.
 *
 * It only reads the DOM and applies what the compiler computed — all policy
 * (CSS extraction, tier routing, synthesis) stays in Node/shared modules so
 * there is exactly one implementation of each.
 */
import { leaderFillCount, LEADER_RE } from "../shared/synthesis.ts";
import { evaluate } from "../shared/content-value.ts";

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
 * `<gp-anchor id=…>` injected as its first child. Custom tag + an EMPTY
 * inline box keep it invisible to layout, `::first-letter`, and (verified
 * against hostile `[id]`/`::before`/counter CSS) to author selectors — so the
 * instrumented document IS the shipped document and no final reprint exists.
 *
 * The `display` value is load-bearing in BOTH directions; `display:inline` is
 * the only value measured to satisfy both constraints:
 *
 *  - NOT `position: absolute`: measured on
 *    docs/fixtures/css-authoring-spike/book, an absolutely positioned anchor
 *    that was the very first box after a forced `break-before: page` printed
 *    its PDF named destination one page LATE (page 2's heading measured as
 *    page 3), because its static-position fragmentation lands differently
 *    from ordinary in-flow content right at a page-break boundary.
 *  - NOT `display: inline-block`: a non-inline child before the text
 *    DISQUALIFIES `::first-letter` in Chromium, silently deleting an author's
 *    drop cap on any anchored element (measured: an `h1::first-letter` drop
 *    cap renders with `display:inline` and vanishes with `inline-block`).
 *    Pinned by `agent.first-letter.test.ts`.
 *
 * An empty in-flow inline box has neither problem: it fragments through the
 * same layout path as ordinary content — already proven correct, since
 * author-supplied ids (no anchor at all) never hit the page-late bug — and is
 * transparent to `::first-letter`. `width`/`height` are not set because they
 * do not apply to a non-replaced inline box; it is zero-size by being empty.
 *
 * Residual risk, accepted and documented: a `parent > :first-child` rule could
 * observe the injected child. Elements with author ids — the common case, since
 * markdown renderers id their headings — never get an anchor at all.
 */
function ensureAnchor(el: Element): string {
  if (el.id) return el.id;
  const existing = el.firstElementChild;
  if (existing?.tagName === "GP-ANCHOR" && existing.id) return existing.id;
  const anchor = document.createElement("gp-anchor");
  anchor.id = `gp-m-${++uid}`;
  anchor.setAttribute("style", "display:inline");
  el.insertBefore(anchor, el.firstChild);
  return anchor.id;
}

/** The element a measurement id stands for (the anchor's host, or itself). */
function anchorHost(id: string): Element | null {
  const el = document.getElementById(id);
  if (!el) return null;
  return el.tagName === "GP-ANCHOR" ? el.parentElement : el;
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
  stringSets: Array<{ selector: string; name: string; value?: string }>,
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
      // The string VALUE is the declared expression (content(), attr(x),
      // literals), evaluated exactly as the viewer evaluates it
      // (ARCHITECTURE.md §1 — same function, decorate.ts does the same).
      // Falling back to raw textContent shipped a chapter's ENTIRE text
      // into a folio chip when the book declared `attr(data-ch)`.
      const text = decl.value
        ? evaluate(decl.value, {
            text: (el.textContent ?? "").trim().replace(/\s+/g, " "),
            attr: (n) => el.getAttribute(n) ?? undefined,
          })
        : (el.textContent ?? "").trim().replace(/\s+/g, " ");
      out.push({
        name: decl.name,
        id: ensureAnchor(el),
        text,
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
 * Elements carrying `counter-reset: page N` in content flow. Chromium does not
 * apply this restart to `counter(page)` (ENGINE.md §8), so the compiler needs
 * the page each one lands on to synthesize the restart via a counter-style map
 * (`counterStyleCss`).
 */
export function counterResetSites(
  resets: Array<{ selector: string; start: number }>,
): Array<{ id: string; start: number; selector: string }> {
  const out: Array<{ id: string; start: number; selector: string }> = [];
  for (const r of resets) {
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(r.selector));
    } catch {
      continue;
    }
    for (const el of els) out.push({ id: ensureAnchor(el), start: r.start, selector: r.selector });
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
  for (const spacer of Array.from(document.querySelectorAll(".gp-recto-spacer")))
    spacer.remove();
  let inserted = 0;
  for (const id of ids) {
    const el = anchorHost(id);
    if (!el) continue;
    const spacer = document.createElement("div");
    spacer.className = "gp-recto-spacer";
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

export interface PageContentHeights {
  /** Minimum default/unnamed content-box height across its pseudo-page variants. */
  default: number;
  /** Named page -> minimum content-box height across its pseudo-page variants. */
  named: Record<string, number>;
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
export function auditContent(
  contentHeights: PageContentHeights,
  dpiFloor: number,
): ContentWarning[] {
  const out: ContentWarning[] = [];
  const name = (el: Element) =>
    el.tagName.toLowerCase() +
    (el.id ? `#${el.id}` : "") +
    (el.className && typeof el.className === "string" ? `.${el.className.split(/\s+/)[0]}` : "");

  const pageContext = (el: Element): { name: string; height: number } => {
    // `page` is read from computed style so cascade/specificity and downstream
    // book wrapper classes are already resolved. Walk ancestors as a backstop
    // for a leaf inside a wrapper that owns the named-page assignment.
    for (let node: Element | null = el; node; node = node.parentElement) {
      const pageName = getComputedStyle(node).getPropertyValue("page").trim();
      if (pageName && pageName !== "auto") {
        return {
          name: pageName,
          // Computed style exposes the assigned page NAME but not which
          // pseudo-page (:left/:right/:first/...) the element ultimately lands
          // on. Node therefore sends the minimum content height across every
          // applicable variant. This can warn conservatively when variants
          // differ, but can never miss an element too tall for one of them.
          height: contentHeights.named[pageName] ?? contentHeights.default,
        };
      }
    }
    return { name: "default", height: contentHeights.default };
  };

  for (const el of Array.from(document.querySelectorAll<HTMLElement>("figure,img,table,pre,svg,div"))) {
    const h = el.getBoundingClientRect().height;
    const context = pageContext(el);
    if (h > context.height + 1 && el.children.length === 0) {
      out.push({
        kind: "overheight",
        what: name(el),
        detail:
          `${Math.round(h)}px tall on a ${Math.round(context.height)}px ` +
          `${context.name === "default" ? "default-page" : `${context.name} page`} content box`,
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
  let host = document.getElementById("gp-instrumentation");
  if (!host) {
    host = document.createElement("div");
    host.id = "gp-instrumentation";
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
  for (const attr of ["data-gp-after", "data-gp-before"]) {
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
      const last = rects.length ? rects[rects.length - 1]! : host.getBoundingClientRect();
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
    if (el) el.setAttribute(`data-gp-${e.where}`, e.text);
  }
  addCss("gp-generated-content", css);
  return entries.length;
}

declare global {
  interface Window {
    __gp: typeof api;
  }
}


/**
 * `.gp-flush` support, part 1 — find every page root whose pins ask for a
 * flushed edge, stamp it so the compiler's generated stylesheet can address
 * it (`data-gp-flush`), and report its AUTHOR page context (computed BEFORE
 * the generated assignment exists — the caller invokes this exactly once,
 * before it injects any flush CSS). The anchor id doubles as the root's
 * measurement id when furniture relocation needs to know its physical page.
 */
export function flushRoots(): Array<{ id: string; page: string; edges: string[]; key: string }> {
  const out: Array<{ id: string; page: string; edges: string[]; key: string }> = [];
  for (const root of Array.from(document.querySelectorAll(".page, .spread"))) {
    const edges = ["top", "right", "bottom", "left"].filter((edge) =>
      root.querySelector(`.gp-pin.gp-flush.gp-${edge}`),
    );
    if (!edges.length) continue;
    const page = getComputedStyle(root).page;
    const key = `${page === "auto" ? "" : page}|${edges.map((e) => e[0]).join("")}`;
    (root as HTMLElement).dataset.gpFlush = key;
    out.push({ id: ensureAnchor(root), page, edges, key });
  }
  return out;
}

/**
 * `.gp-flush` support, part 2 — paint the flushed edge's margin boxes as
 * page-area content, at the slot rectangles the compiler computed from the
 * page's ORIGINAL geometry. Chromium cannot render a margin box whose margin
 * is gone (measured; see shared/flush.ts), so on flushed pages the engine is
 * the furniture painter — exactly as the viewer already is on every page.
 *
 * Coordinates are px relative to the page ROOT's border box, which the flush
 * machinery has already stretched to the (grown) page area — the same
 * root-is-the-page-area assumption `.gp-pin` itself rests on. Idempotent per
 * root: each call replaces the previous furniture, so fixpoint passes
 * converge instead of stacking copies. Styling mirrors the viewer's
 * `.gp-marginbox` slot/content split; z-index puts furniture above content,
 * as CSS Paged Media §3.1 paints native margin boxes.
 */
export function setFlushFurniture(
  items: Array<{
    id: string;
    boxes: Array<{
      box: string;
      x: number;
      y: number;
      w: number;
      h: number;
      align: "start" | "center" | "end";
      text: string;
      decls: Record<string, string>;
    }>;
  }>,
): number {
  let painted = 0;
  for (const item of items) {
    const host = anchorHost(item.id) as HTMLElement | null;
    if (!host) continue;
    let layer = host.querySelector(":scope > .gp-flush-furniture") as HTMLElement | null;
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "gp-flush-furniture";
      layer.setAttribute("aria-hidden", "true");
      layer.setAttribute(
        "style",
        "position:absolute;inset:0;pointer-events:none;z-index:10;",
      );
      host.appendChild(layer);
    }
    layer.textContent = "";
    for (const b of item.boxes) {
      const slot = document.createElement("div");
      slot.dataset.box = b.box;
      const justify = b.align === "center" ? "center" : b.align === "end" ? "flex-end" : "flex-start";
      slot.setAttribute(
        "style",
        `position:absolute;left:${b.x}px;top:${b.y}px;width:${b.w}px;height:${b.h}px;` +
          `display:flex;align-items:center;justify-content:${justify};overflow:hidden;white-space:pre;`,
      );
      const content = document.createElement("span");
      content.textContent = b.text;
      for (const [prop, value] of Object.entries(b.decls)) content.style.setProperty(prop, value);
      slot.appendChild(content);
      layer.appendChild(slot);
      painted++;
    }
  }
  return painted;
}

const api = {
  auditContent,
  collectCss,
  forcedBreakSites,
  counterResetSites,
  applyRectoSpacers,
  stringSources,
  xrefSites,
  targetTexts,
  fillLeaders,
  instrument,
  addCss,
  setGenerated,
  flushRoots,
  setFlushFurniture,
};

if (typeof window !== "undefined") window.__gp = api;

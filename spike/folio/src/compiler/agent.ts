/**
 * Browser-side agent for the compiler. Bundled to `dist/folio-agent.js` and
 * evaluated in the page the compiler is about to print.
 *
 * It only reads the DOM and applies what the compiler computed — all policy
 * (CSS extraction, tier routing, synthesis) stays in Node so there is exactly
 * one implementation of each.
 */

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
 * Ids assigned BY Folio, so they can be taken back off before the final print.
 *
 * An id is not inert: `h1[id] { counter-increment: chapter }` is real theme CSS
 * (the Gutterpress user guide), so instrumenting the document changed the
 * chapter numbers. Measurement must leave no trace in the printed artifact.
 */
const assignedIds: Element[] = [];
function ensureId(el: Element): string {
  if (!el.id) {
    el.id = `folio-m-${++uid}`;
    assignedIds.push(el);
  }
  return el.id;
}

/** Remove every trace of the measurement pass. */
export function deinstrument(): { ids: number; hosts: number } {
  let ids = 0;
  for (const el of assignedIds) {
    el.removeAttribute("id");
    ids++;
  }
  assignedIds.length = 0;
  let hosts = 0;
  for (const host of Array.from(document.querySelectorAll("#folio-instrumentation"))) {
    host.remove();
    hosts++;
  }
  // spacers stay: they are output, not instrumentation
  return { ids, hosts };
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
        id: ensureId(el),
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
    for (const el of els) out.push({ id: ensureId(el), prop: d.prop, value: d.value, selector: d.selector });
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
    const el = document.getElementById(id);
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
      out.push({ id: ensureId(el), href, selector });
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

/** Apply synthesized generated content (cross-reference text) by element id. */
export function setGenerated(entries: Array<{ id: string; where: string; text: string }>): number {
  for (const e of entries) {
    const el = document.getElementById(e.id);
    if (el) el.setAttribute(`data-folio-${e.where}`, e.text);
  }
  addCss(
    "folio-generated-content",
    `[data-folio-after]::after { content: attr(data-folio-after); }
[data-folio-before]::before { content: attr(data-folio-before); }`,
  );
  return entries.length;
}

declare global {
  interface Window {
    __folio: typeof api;
  }
}

const api = {
  collectCss,
  deinstrument,
  forcedBreakSites,
  applyRectoSpacers,
  stringSources,
  xrefSites,
  instrument,
  addCss,
  setGenerated,
};

if (typeof window !== "undefined") window.__folio = api;

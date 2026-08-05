/**
 * Browser-side agent for the compiler. Bundled to `dist/folio-agent.js` and
 * evaluated in the page the compiler is about to print.
 *
 * It only reads the DOM and applies what the compiler computed — all policy
 * (CSS extraction, tier routing, synthesis) stays in Node so there is exactly
 * one implementation of each.
 */

export interface RunInfo {
  hook: string;
  page?: string;
  /** string-set name -> literal value for this run */
  strings: Record<string, string>;
  /**
   * Every page name that appears anywhere in this run (container or
   * descendants), each already stamped onto its elements as
   * `data-folio-page`. Tier 2 has to rename ALL of them together: if the
   * container moves to a generated page name and a descendant keeps the
   * author's, the mismatch becomes a page break print never had.
   */
  names: string[];
}

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
function ensureId(el: Element): string {
  if (!el.id) el.id = `folio-m-${++uid}`;
  return el.id;
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

/**
 * Group top-level flow children into named-page runs and tag them, so Tier 2
 * can give each run its own generated `@page` with literal running heads.
 */
const FORCED = /^(page|always|left|right|recto|verso)$/;

/** Does this box, or the first descendant that starts it, force a break? */
function startsWithForcedBreak(el: Element): boolean {
  let cur: Element | null = el;
  for (let depth = 0; cur && depth < 4; depth++) {
    if (FORCED.test(getComputedStyle(cur).breakBefore)) return true;
    cur = cur.firstElementChild;
  }
  return false;
}

export function discoverRuns(
  assignments: Array<{ selector: string; page: string }>,
  stringSets: Array<{ selector: string; name: string }>,
): RunInfo[] {
  const root = flowRoot();
  const children = Array.from(root.children) as HTMLElement[];
  /**
   * The page name assigned to the ELEMENT ITSELF, by the winning declaration
   * (highest specificity, last on a tie). Descendant assignments are not the
   * container's page — they are reported separately as `inner`, because in
   * print they are exactly where the page context (and therefore a break)
   * changes inside the run.
   */
  const pageOf = (el: Element): string | undefined => {
    let best: { page: string; score: number; order: number } | undefined;
    assignments.forEach((a, order) => {
      try {
        if (!el.matches(a.selector)) return;
      } catch {
        return;
      }
      const score = specificity(a.selector);
      if (!best || score > best.score || (score === best.score && order > best.order))
        best = { page: a.page, score, order };
    });
    return best?.page;
  };

  const setsAString = (el: Element) =>
    stringSets.some((d) => {
      try {
        return el.matches(d.selector) || !!el.querySelector(d.selector);
      } catch {
        return false;
      }
    });

  // A run is a maximal sequence of top-level children sharing a page context
  // AND a set of running-string values. A child that re-sets a string starts a
  // new run ONLY if it also forces a break — otherwise a generated page name
  // would introduce a page break print would not have. (Strings that change
  // without a forced break are page-granular: Tier 3's job.)
  const runs: Array<{ page?: string; nodes: HTMLElement[] }> = [];
  for (const child of children) {
    const page = pageOf(child);
    const last = runs[runs.length - 1];
    const rebinds = setsAString(child) && startsWithForcedBreak(child);
    if (last && last.page === page && !rebinds) last.nodes.push(child);
    else runs.push({ page, nodes: [child] });
  }

  return runs.map((run, i) => {
    const hook = `r${i + 1}`;
    for (const n of run.nodes) n.setAttribute("data-folio-run", hook);
    const strings: Record<string, string> = {};
    for (const decl of stringSets) {
      for (const node of run.nodes) {
        let el: Element | null = null;
        try {
          el = node.matches(decl.selector) ? node : node.querySelector(decl.selector);
        } catch {
          continue;
        }
        if (el) {
          strings[decl.name] = (el.textContent ?? "").trim().replace(/\s+/g, " ");
          break;
        }
      }
    }
    // Stamp the winning page name on every element that has one, so the
    // rename can be applied per element (inline, cascade-proof) rather than by
    // replaying the author's selectors at a guessed specificity.
    const names = new Set<string>();
    for (const node of run.nodes) {
      for (const el of [node, ...Array.from(node.querySelectorAll<HTMLElement>("*"))]) {
        const name = pageOf(el);
        if (!name) continue;
        el.setAttribute("data-folio-page", name);
        names.add(name);
      }
    }
    return { hook, page: run.page, strings, names: [...names] };
  });
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

/**
 * Apply Tier 2's generated page names as INLINE styles.
 *
 * Inline beats every author rule regardless of specificity, so a generated
 * name can never lose a cascade fight with (say) `#ch-toc h1 { page: toc }`
 * and leave one element on the old name — which would read as a spurious page
 * break. The compiler only ever mutates the page it is printing; author files
 * are untouched.
 */
export function applyPageNames(
  entries: Array<{ hook: string; from: string; to: string }>,
): number {
  let applied = 0;
  for (const entry of entries) {
    for (const el of Array.from(
      document.querySelectorAll<HTMLElement>(`[data-folio-run="${entry.hook}"]`),
    )) {
      const targets = [el, ...Array.from(el.querySelectorAll<HTMLElement>("*"))];
      for (const target of targets) {
        if (target.getAttribute("data-folio-page") !== entry.from) continue;
        target.style.setProperty("page", entry.to);
        applied++;
      }
    }
  }
  return applied;
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
  discoverRuns,
  applyPageNames,
  stringSources,
  xrefSites,
  instrument,
  addCss,
  setGenerated,
};

if (typeof window !== "undefined") window.__folio = api;

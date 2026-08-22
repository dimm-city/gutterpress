/**
 * Viewer core (§7): let Chromium fragment the author's content into pages on
 * screen, using multicol — the same LayoutNG block-fragmentation engine print
 * uses. Gutterpress contributes ONE shallow wrapper per named-page run and a handful
 * of CSS custom properties. It never chunks the DOM.
 */
import VIEWER_CSS from "./viewer.css" with { type: "text" };
import {
  extract,
  mediaPrintBodies,
  resolvePage,
  type GcpmModel,
  type PageGeometry,
} from "../shared/gcpm-extract.ts";
import { isRectoVersoBreak, planRectoBlanks, wantsRecto } from "../shared/synthesis.ts";
import { flushEdgesIn, flushMargins, type FlushEdge } from "../shared/flush.ts";

export const PX_PER_PT = 96 / 72;

export interface StripInfo {
  el: HTMLElement;
  /** named page for this run, undefined = default page context */
  page?: string;
  /** the AUTHOR context's geometry — decoration (sheets, margin-box slots,
   * guides) always uses this. A flush run's grown content box lives only in
   * the strip's CSS custom properties (see stripify). */
  geometry: PageGeometry;
  /** edges freed by `.gp-flush` pins in this run (shared/flush.ts) */
  flushEdges?: FlushEdge[];
  /** page count of this run */
  pages: number;
  /** page index (0-based, book-wide) of this run's first page */
  offset: number;
  /** two-up/spread view mode (§ applySpreadMode): pages rendered per wrapped
   * row. `undefined` = single row (view mode off, or unsupported browser).
   * The leading-spacer shift is NOT stored — it is fully determined by
   * `wrapCols` + `offset` parity; derive it with `wrapGeometry()`. */
  wrapCols?: number;
}

export interface LayoutResult {
  strips: StripInfo[];
  totalPages: number;
}

/** The viewer's own chrome, inlined into the bundle (self-contained, §3). */
export function injectViewerCss(doc: Document = document) {
  if (doc.getElementById("gp-viewer-css")) return;
  const style = doc.createElement("style");
  style.id = "gp-viewer-css";
  style.textContent = VIEWER_CSS;
  doc.head.appendChild(style);
}

export interface LayoutOptions {
  /** gap between page sheets, in CSS px */
  sheetGap?: number;
  /** flow root; defaults to <main> or <body> */
  root?: HTMLElement;
  /** reserve (and draw) repeated table headers on continuation pages; default true */
  compensateHeaders?: boolean;
}

const pt = (v: number) => v * PX_PER_PT;

/** Collect every stylesheet's source text (same-origin; the viewer owns its document). */
export function collectCssText(doc: Document = document): string {
  let out = "";
  for (const sheet of Array.from(doc.styleSheets) as CSSStyleSheet[]) {
    // Inline <style> is authoritative: CSSOM would already have dropped GCPM.
    const owner = sheet.ownerNode as HTMLElement | null;
    if (owner && owner.tagName === "STYLE") {
      out += owner.textContent + "\n";
      continue;
    }
    const raw = (owner as any)?.__gpSource;
    if (raw) out += raw + "\n";
  }
  return out;
}

/**
 * Fetch linked stylesheets as text so `gcpm-extract` sees the declarations
 * CSSOM drops (`string-set`, `bleed`, `marks`, `target-counter()`).
 */
export async function loadStyleSources(doc: Document = document): Promise<string> {
  const links = Array.from(
    doc.querySelectorAll<HTMLLinkElement>('link[rel~="stylesheet"]'),
  );
  await Promise.all(
    links.map(async (l) => {
      if ((l as any).__gpSource) return;
      try {
        (l as any).__gpSource = await (await fetch(l.href)).text();
      } catch {
        (l as any).__gpSource = "";
      }
    }),
  );
  return collectCssText(doc);
}

/** Forced break values that mean "start a new page" in author CSS — the ones
 * `injectBreakMapping` maps to `column` for the outer `.gp-strip`. `column`
 * itself is excluded: it is already the multicol-native value and needs no
 * CSS mapping (only `synthesizeColumnBreaks`'s JS fallback, and only for the
 * outer strip — see that function's doc comment). */
// `always` is the obsolete page-break-* alias, not a valid value of the
// modern break-before/after properties. Chromium computes it to `auto` in
// print; synthesizing it on screen would create pages the PDF does not have.
const FORCED_PAGE_LIKE = /^(page|left|right|recto|verso)$/;

/**
 * Retained public no-op for hosts that called the pre-0.10 helper directly.
 *
 * A blanket `page -> column` CSS mapping forces a fresh column even when the
 * site already starts at a named-run boundary (or naturally lands at the next
 * column top). That over-paginated the Field Guide by 19 pages. Breaks are now
 * synthesized from measured geometry by `synthesizeColumnBreaks()`.
 */
export function injectBreakMapping(_model: GcpmModel, doc: Document = document): string {
  doc.getElementById("gp-break-mapping")?.remove();
  return "";
}

/**
 * Whether this browser implements forced `column` breaks at all
 * (`break-before`/`break-after: column`). Firefox does not — a long-standing
 * Gecko gap (bug 549114) — which `injectBreakMapping()`'s CSS-only mapping
 * depends on. Feature-probed, not UA-sniffed.
 */
export function forcedColumnBreaksSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("break-before", "column") &&
    CSS.supports("break-after", "column")
  );
}

/**
 * Sub-pixel tolerance for fragmentainer geometry, in CSS px.
 *
 * `synthesizeColumnBreaks` reads a box's position by measuring its fragment
 * rects against its column. Two effects put that measurement up to (but
 * under) 1px away from the whole number the box logically sits at, and both
 * are properties of block fragmentation, not of any one browser:
 *
 *   - the reserve spacer's height is `Math.ceil`ed so it is guaranteed to
 *     overflow the column (an exact fit may leave the following box in
 *     place). That overshoot is `ceil(x) - x`, i.e. strictly < 1px, and it
 *     re-appears at the top of the next column, so the box the break moved
 *     starts up to 1px BELOW the column top instead of exactly on it;
 *   - a box pushed to the next column can be left with a hairline leading
 *     fragment at the tail of the previous one. Gecko emits one (measured:
 *     0.3px); Blink does not.
 *
 * Neither is visible on screen, and neither may be read as "this box still
 * has room in the current column" — that misreading is what turned a 0.3px
 * hairline into two blank pages of Firefox over-pagination (the issue #46
 * cross-browser smoke test measured firefox 6pp against chromium 4pp).
 */
const FRAGMENT_EPSILON_PX = 1;

/**
 * The fragment rect where `site`'s content actually starts (`atEnd` false)
 * or ends (`atEnd` true).
 *
 * A multicol box spanning a column boundary reports one rect per fragment,
 * and a fragment thinner than `FRAGMENT_EPSILON_PX` is fragmentation
 * residue holding no content — the box visibly starts (or ends) in the
 * neighbouring column, so the residue must not be mistaken for its content
 * edge. Falls back to the raw rects when every fragment is that thin, which
 * is the only case where a hairline IS the content.
 */
export function contentEdgeRect(site: Element, atEnd: boolean): DOMRect | undefined {
  const rects = Array.from(site.getClientRects());
  const solid = rects.filter((r) => r.height >= FRAGMENT_EPSILON_PX);
  const pool = solid.length ? solid : rects;
  return atEnd ? pool.at(-1) : pool[0];
}

/**
 * Height of the reserve spacer that pushes a break site past its current
 * column, or null when the forced break is ALREADY satisfied and print puts
 * nothing more in this column either.
 *
 * `offset` is the site's content edge measured down from the column's top —
 * the strip is `column-fill: auto` with a fixed `--gp-content-h`, so every
 * column shares the strip's top edge and one number locates the site in
 * whichever column it landed in.
 *
 * Both "already satisfied" verdicts are refusals to manufacture a wholly
 * blank page: a `break-before` site already at its column's top, or a
 * `break-after` site already at its column's bottom, needs no spacer, and
 * reserving one would add a page the PDF does not have. They are also what
 * dedupes a wrapper/inner-heading pair carrying the same forced break — the
 * loop remeasures between insertions, so the second site of the pair sees
 * itself already moved. Each is `FRAGMENT_EPSILON_PX` tolerant because the
 * `Math.ceil` below can leave a moved site a sub-pixel off the column top.
 */
export function columnReserve(offset: number, columnHeight: number): number | null {
  const remaining = columnHeight - offset;
  if (remaining < FRAGMENT_EPSILON_PX) return null; // already at the column's end
  if (remaining > columnHeight - FRAGMENT_EPSILON_PX) return null; // already at its start
  return Math.ceil(remaining);
}

/**
 * Geometry-aware screen synthesis for author `break-*: page|left|right`.
 * It runs in every browser: even where forced column breaks are supported, a
 * CSS-only `page -> column` mapping cannot tell that a named-run boundary or
 * natural flow already satisfied the break and creates a redundant page.
 *
 * Reads the same forced-break declarations straight from the extracted CSS
 * model (not computed style, for the reason above) and, for each site,
 * inserts a reserve spacer sized to the space REMAINING in the element's
 * current column of its `.gp-strip` — `.gp-strip` is `column-fill: auto`
 * with a fixed `--gp-content-h`, so every column shares the same top edge,
 * and reserving exactly to the strip's bottom edge pushes the element to the
 * top of the next column, matching what the CSS mapping achieves natively
 * elsewhere.
 *
 * Scoped to the OUTER strip only (`FORCED_PAGE_LIKE` values — the ones
 * `injectBreakMapping` maps to `column`), because that is what the
 * cross-browser page COUNT depends on. A break already authored as `column`
 * directly (`.gp-column-break`, used for a nested in-page `.section`
 * multicol) targets an auto-height BALANCED multicol context with no fixed
 * column height to reserve against — out of scope here, a known remaining
 * Firefox cosmetic limitation (docs/native-engine-acceptance-gate.md).
 *
 * Processed in document order, remeasuring between insertions: an insertion
 * shifts every later break site, and a site that already lands at the top of
 * its column (the strip's own leading break — see `clearLeadingForcedBreaks`
 * — or the second half of a wrapper/inner-heading pair that both carry the
 * same forced break) needs no spacer, which is what dedupes those pairs
 * without extra bookkeeping.
 */
export function synthesizeColumnBreaks(model: GcpmModel): void {
  const sites: Array<{ el: Element; prop: string }> = [];
  const seen = new WeakMap<Element, Set<string>>();
  for (const b of model.breaks) {
    if (b.prop === "break-inside") continue;
    if (!FORCED_PAGE_LIKE.test(b.value.trim())) continue;
    let els: Element[];
    try {
      els = Array.from(document.querySelectorAll(b.selector));
    } catch {
      continue; // unsupported selector — ignore, never throw on author CSS
    }
    for (const el of els) {
      if (!el.closest(".gp-strip")) continue;
      // The extracted model contains losing declarations too. Native print
      // fragments from the cascade winner, so synthesis must reject a raw
      // `page` declaration overridden by `auto` (and invalid modern values
      // such as `always`, which Chromium also computes to `auto`).
      const cs = getComputedStyle(el);
      const effective = b.prop === "break-before" ? cs.breakBefore : cs.breakAfter;
      if (!FORCED_PAGE_LIKE.test(effective.trim())) continue;
      const props = seen.get(el) ?? new Set<string>();
      if (props.has(b.prop)) continue;
      props.add(b.prop);
      seen.set(el, props);
      sites.push({ el, prop: b.prop });
    }
  }
  sites.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  for (const { el, prop } of sites) {
    // `buildStrips()` already ran `clearLeadingForcedBreaks()`, which sets
    // this exact inline style on a break-before element sitting on the
    // strip's leading in-flow chain — a forced break there is spec-ignorable
    // (CSS Fragmentation Module Level 3), and Chromium/WebKit already ignore
    // it. Honour the same call here instead of re-deriving it from geometry,
    // which a chapter opener with a non-zero margin-top would get wrong (see
    // `clearLeadingForcedBreaks`'s own doc comment).
    if (prop === "break-before" && (el as HTMLElement).style.breakBefore === "auto") continue;
    const strip = el.closest<HTMLElement>(".gp-strip");
    if (!strip) continue;
    // A forced page break is only valid between sibling boxes in the same
    // fragmentation flow, so the break lands at the class-A point before the
    // outermost box CSS Break §3.1's first-child propagation carries it to —
    // `propagatedBreakTarget` resolves that box (usually `el` itself). When
    // the propagation chain reaches the strip's own leading edge instead,
    // print ignores the break, so no spacer is manufactured for it.
    let site: Element = el;
    if (prop === "break-before") {
      const target = propagatedBreakTarget(el, strip);
      if (!target) continue;
      site = target;
    }
    if (prop === "break-after" && !el.nextElementSibling) continue;
    const rect = contentEdgeRect(site, prop === "break-after");
    if (!rect) continue;
    const stripTop = strip.getBoundingClientRect().top;
    const edge = prop === "break-after" ? rect.bottom : rect.top;
    const reserve = columnReserve(edge - stripTop, strip.clientHeight);
    if (reserve === null) continue;
    const spacer = document.createElement("div");
    spacer.className = "gp-column-break-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.cssText = `height:${reserve}px;margin:0;padding:0;border:0;`;
    if (prop === "break-after") el.after(spacer);
    else site.before(spacer);
  }
}

/**
 * The box a forced `break-before` on `el` actually breaks before.
 *
 * CSS Break §3.1 propagates a forced break-before on a parent's FIRST
 * in-flow child to the parent itself, recursively — so the break
 * opportunity is the sibling boundary before the outermost box of that
 * first-child chain, and Chromium print honours exactly that. Measured on
 * docs/fixtures/css-authoring-spike: `.page { break-before: page }` nested
 * first inside a `.chapter` wrapper starts the whole wrapper — PDF named
 * destination included — on the new page, while skipping the site (the
 * pre-0.10.0 behavior) left the wrapper's first fragment at the tail of the
 * previous column and shifted every cross-reference to it one page early.
 *
 * Returns `el` itself when it has a preceding sibling (the common case —
 * nothing propagates), the outermost chain ancestor with a preceding
 * sibling when it doesn't, or null when the chain reaches the strip with no
 * preceding sibling anywhere: that is the strip's leading edge, where a
 * forced break is spec-ignorable (`clearLeadingForcedBreaks`'s call).
 *
 * The walk is deliberately conservative — it only steps up while the chain
 * is a plain in-flow first-child chain, since that is the only shape §3.1
 * propagates through:
 *   - rendered text before `site` inside the parent forms an anonymous
 *     sibling BOX — a class-A break point of its own — so the break lands
 *     right there: return `site` unpropagated (print splits the parent
 *     between its leading text and `site`);
 *   - `site` out of flow (absolute/fixed/floated — print ignores its
 *     break-* entirely) returns null, the old skip;
 *   - a parent that is not a plain block container, or is itself a multicol
 *     container (a nested fragmentation context does not propagate page
 *     breaks out into the strip's own flow), returns null likewise.
 */
function propagatedBreakTarget(el: Element, strip: HTMLElement): Element | null {
  let site = el;
  while (!site.previousElementSibling) {
    const parent = site.parentElement;
    if (!parent || parent === strip) return null;
    const cs = getComputedStyle(site);
    if (cs.position === "absolute" || cs.position === "fixed" || cs.float !== "none") return null;
    for (let node = site.previousSibling; node; node = node.previousSibling) {
      if (node.nodeType === 3 && (node.textContent ?? "").trim() !== "") return site;
    }
    const pcs = getComputedStyle(parent);
    if (!/^(block|flow-root)$/.test(pcs.display) || pcs.columnCount !== "auto") return null;
    site = parent;
  }
  return site;
}

/** Named page assigned directly ON `el` itself (not a descendant). */
function directPageName(el: Element, model: GcpmModel): string | undefined {
  for (const a of model.pageAssignments) {
    try {
      if (el.matches(a.selector)) return a.page;
    } catch {
      /* unsupported selector — ignore, never throw on author CSS */
    }
  }
  return undefined;
}

/** Whether some descendant of `el` (not `el` itself) carries a page assignment. */
function hasDescendantPageAssignment(el: Element, model: GcpmModel): boolean {
  for (const a of model.pageAssignments) {
    try {
      if (el.querySelector(a.selector)) return true;
    } catch {
      /* unsupported selector — ignore */
    }
  }
  return false;
}

interface Run {
  page?: string;
  nodes: ChildNode[];
  /** `.gp-flush` edges of this run's root — part of the partition key, so a
   * flush root always gets its own strip: its content box differs from its
   * neighbours' even when they share a page name, exactly as in print, where
   * the compiler gives the root its own generated page context. */
  flushEdges?: FlushEdge[];
}

function pushRun(
  runs: Run[],
  page: string | undefined,
  nodes: ChildNode[],
  flushEdges?: FlushEdge[],
) {
  const key = (r: { page?: string; flushEdges?: FlushEdge[] }) =>
    `${r.page ?? ""}\u0000${(r.flushEdges ?? []).join(",")}`;
  const last = runs[runs.length - 1];
  if (last && key(last) === key({ page, flushEdges })) last.nodes.push(...nodes);
  else runs.push({ page, nodes, flushEdges: flushEdges?.length ? flushEdges : undefined });
}

/**
 * Partition `container`'s child NODES into runs of identical page context, in
 * document order — recursively.
 *
 * A `page:` assignment on a DESCENDANT (the `h1 { page: chapter }` "chapter
 * opener" shape) gives only that element's own fragment the named template;
 * the run reverts to the default page right after it, because `page` is not
 * inherited sideways to later siblings of the box that set it (verified
 * against Chromium print and the Gutterpress user guide theme). A child with
 * no page assignment of its own but a page-changing descendant is
 * recursively exploded into synthetic sibling shells — shallow clones of
 * the child (same tag/attributes, no content duplication; the fragmenter
 * still only ever MOVES authored content) — so the opener element ends up
 * in its own run/strip at the named geometry while the rest of the child's
 * content lands in a following run/strip at the default geometry, matching
 * print exactly.
 *
 * A child whose page assignment is on the CONTAINER itself (`directPageName`
 * matches) is never recursed into — the whole subtree keeps that name, same
 * as before this function existed.
 *
 * Text and comment nodes ride along with the run of the element BEFORE them
 * (the run print would leave them in), or with the first run when nothing
 * precedes them. Iterating elements alone would leave every loose text node
 * behind in the emptied original and delete it from the preview.
 *
 * A shell keeps the original's attributes INCLUDING `id`, so author CSS that
 * scopes by id (`.chapter#ch-cli table`) still matches in every shell. The
 * duplicate id is deliberate: `getElementById` then answers with the FIRST
 * shell, which is where the element starts — the answer a cross-reference
 * wants.
 */
function explodeChildren(container: Element, model: GcpmModel): Run[] {
  const runs: Run[] = [];
  let pending: ChildNode[] = [];
  /** Nodes to emit before the next element: prior run if there is one. */
  const carry = (): ChildNode[] => {
    if (!pending.length) return [];
    const held = pending;
    pending = [];
    const last = runs[runs.length - 1];
    if (last) {
      // The FULL partition key, not just the page name: text riding behind a
      // flush run must stay in that run, or the whitespace after a flush root
      // opens a spurious same-name strip — measured as a 5pp preview of a
      // 4pp book.
      pushRun(runs, last.page, held, last.flushEdges);
      return [];
    }
    // Nothing precedes it: text with real content opens its own default-page
    // run (print puts it on the default page, then the named element breaks
    // to its own). Whitespace generates no box, so it just rides along.
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
    const kid = node as HTMLElement;
    if (kid.classList.contains("gp-layer")) continue; // viewer chrome, not content
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
    // kid's own page context changes partway through its children: split it
    // into one shell per inner run, inserted in kid's place, then drop the
    // now-empty original.
    let lead = carry();
    for (const r of inner) {
      const shell = kid.cloneNode(false) as HTMLElement;
      for (const n of r.nodes) shell.appendChild(n);
      kid.before(shell);
      pushRun(runs, r.page, [...lead, shell], flushEdgesIn(shell));
      lead = [];
    }
    kid.remove();
  }
  const trailing = carry();
  if (trailing.length) pushRun(runs, undefined, trailing);
  return runs;
}

const FORCED_BREAK = /^(column|page|left|right|recto|verso|always)$/;

/**
 * Neutralize a forced `break-before` sitting on the LEADING in-flow chain of a
 * strip (the strip's first child, its first child, …).
 *
 * A strip IS a fragmentation container, and a forced break at the very start of
 * one is spec-ignorable — Chromium ignores it (measured: neutralizing changes
 * NOTHING in Chromium, all 18 design-guide strip widths byte-identical before
 * and after). WebKit does not always: on the design-guide's `#ch-palette`
 * chapter opener — whose wrapper carries a non-zero `margin-top`, unlike every
 * other opener in that book — WebKit honours the `break-before` mapped onto the
 * opener `h1`, leaves column 1 empty and pushes the `h1` into column 2, so the
 * strip measures 1488px against a 840px column stride (2 pages) where Chromium
 * measures 648px (1 page). That is the single spurious page behind the
 * published-HTML 54-vs-53 page-count divergence in
 * `docs/native-engine-acceptance-gate.md` §E.
 *
 * Clearing it here is Chromium-neutral by construction (a break Chromium
 * already ignores) and makes the published artifact paginate identically in
 * Chromium, Firefox and WebKit.
 */
function clearLeadingForcedBreaks(strip: HTMLElement) {
  for (let el = strip.firstElementChild; el; el = el.firstElementChild) {
    const cs = getComputedStyle(el);
    if (FORCED_BREAK.test(cs.breakBefore)) (el as HTMLElement).style.breakBefore = "auto";
  }
}

/**
 * Keep a full-content-height named-page containing block on the page whose
 * geometry sized it.
 *
 * A named-page change is a forced page break in print, so Chromium discards a
 * leading collapsed child margin at that fragmentainer boundary. A viewer run
 * starts a fresh multicol box instead of arriving through a column break. In
 * that shape Chromium lets the first child's margin collapse through every
 * shallow shell and through the named-page root itself. A root authored at
 * exactly the page content height is consequently shifted down by that margin,
 * its last few pixels fragment into a second column, and an absolutely
 * positioned `bottom: 0` descendant anchors to that second fragment.
 *
 * Establishing a BFC on only that displaced root contains the child's margin
 * without removing it: the child keeps the same visible inset, while the
 * page-sized containing block starts at the strip's content edge as it does in
 * print. Do not blanket-apply `flow-root` to named pages — authored flex/grid
 * page layouts and genuinely multi-page roots must retain their display and
 * fragmentation behavior.
 */
export function stabilizeFullHeightPageRoots(model: GcpmModel, strips: StripInfo[]): number {
  let stabilized = 0;
  for (const strip of strips) {
    if (!strip.page) continue;
    const stripHeight = parseFloat(
      getComputedStyle(strip.el).getPropertyValue("--gp-content-h"),
    );
    if (!(stripHeight > 0)) continue;

    // explodeChildren() may leave shallow author shells around the element
    // that directly owns `page:`. Only the leading chain can collapse a margin
    // through the run's block-start edge.
    for (
      let el = strip.el.firstElementChild as HTMLElement | null;
      el;
      el = el.firstElementChild as HTMLElement | null
    ) {
      if (directPageName(el, model) !== strip.page) continue;
      const cs = getComputedStyle(el);
      const height = parseFloat(cs.height);
      const rootRects = el.getClientRects();
      if (
        cs.display === "block" &&
        cs.position !== "static" &&
        Math.abs(height - stripHeight) <= 0.5 &&
        (rootRects.length > 1 ||
          el.getBoundingClientRect().top - strip.el.getBoundingClientRect().top > 0.5)
      ) {
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

/** Restore the exact authored inline display before a refresh rebuild. */
function restoreFullHeightPageRoots(doc: Document = document): void {
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>('[data-gp-leading-page-root="stabilized"]'),
  )) {
    const value = el.dataset.gpLeadingPageRootDisplay ?? "";
    const priority = el.dataset.gpLeadingPageRootDisplayPriority ?? "";
    if (value) el.style.setProperty("display", value, priority);
    else el.style.removeProperty("display");
    delete el.dataset.gpLeadingPageRoot;
    delete el.dataset.gpLeadingPageRootDisplay;
    delete el.dataset.gpLeadingPageRootDisplayPriority;
  }
}

/**
 * Match page-fragmentation's trailing-margin discard for an atomic block.
 *
 * Chromium versions disagree in multicol when a `break-inside: avoid*` block
 * would fit at the bottom of the previous column only if its preceding
 * sibling's trailing margin were discarded. Print pagination discards that
 * margin at the fragmentainer edge. Some multicol builds count it first and
 * defer the whole atomic block, adding a preview-only page.
 *
 * Correct only the demonstrated boundary: the avoid block is already at the
 * very top of the immediately following column, and its border-box fits the
 * previous column with the margin removed but not with it present. Runtimes
 * that already place the block on the previous column never match and are not
 * changed. Authored inline state is saved for refresh restoration.
 */
export function compensateTrailingMarginsBeforeAvoids(
  model: GcpmModel,
  strips: StripInfo[],
): number {
  const candidates = new Set<HTMLElement>();
  for (const decl of model.breaks) {
    if (decl.prop !== "break-inside" || !/^avoid(?:-|$)/.test(decl.value.trim())) continue;
    let els: Element[];
    try {
      els = Array.from(document.querySelectorAll(decl.selector));
    } catch {
      continue;
    }
    for (const el of els) {
      if (el instanceof HTMLElement && el.closest(".gp-strip")) candidates.add(el);
    }
  }

  let compensated = 0;
  const orderedCandidates = Array.from(candidates).sort((a, b) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  for (const el of orderedCandidates) {
    if (!/^avoid(?:-|$)/.test(getComputedStyle(el).breakInside)) continue;
    const prev = el.previousElementSibling as HTMLElement | null;
    const stripEl = el.closest<HTMLElement>(".gp-strip");
    const strip = strips.find((item) => item.el === stripEl);
    if (!prev || !stripEl || !strip) continue;

    const rects = Array.from(el.getClientRects());
    const prevRects = Array.from(prev.getClientRects());
    if (rects.length !== 1 || !prevRects.length) continue;
    const rect = rects[0]!;
    const prevRect = prevRects.at(-1)!;
    const stripRect = stripEl.getBoundingClientRect();
    const { stride } = stripMetrics(stripEl);
    const colOf = (r: DOMRect) => Math.floor((r.left - stripRect.left + 1) / stride);
    const currentCol = colOf(rect);
    if (currentCol !== colOf(prevRect) + 1) continue;
    if (Math.abs(rect.top - stripRect.top) > 0.5) continue;

    const marginEnd = parseFloat(getComputedStyle(prev).marginBlockEnd) || 0;
    if (marginEnd <= 0.5) continue;
    const remaining = stripEl.clientHeight - (prevRect.bottom - stripRect.top);
    if (rect.height > remaining + 0.5) continue;
    if (rect.height + marginEnd <= remaining + 0.5) continue;

    prev.dataset.gpTrailingMargin = "compensated";
    prev.dataset.gpTrailingMarginValue = prev.style.getPropertyValue("margin-block-end");
    prev.dataset.gpTrailingMarginPriority = prev.style.getPropertyPriority("margin-block-end");
    prev.style.setProperty("margin-block-end", "0px");
    compensated++;
  }
  return compensated;
}

function restoreTrailingMargins(doc: Document = document): void {
  for (const el of Array.from(
    doc.querySelectorAll<HTMLElement>('[data-gp-trailing-margin="compensated"]'),
  )) restoreTrailingMargin(el);
}

function restoreTrailingMargin(el: HTMLElement): void {
  const value = el.dataset.gpTrailingMarginValue ?? "";
  const priority = el.dataset.gpTrailingMarginPriority ?? "";
  if (value) el.style.setProperty("margin-block-end", value, priority);
  else el.style.removeProperty("margin-block-end");
  delete el.dataset.gpTrailingMargin;
  delete el.dataset.gpTrailingMarginValue;
  delete el.dataset.gpTrailingMarginPriority;
}

/** Drop a speculative correction if a later layout pass still deferred it. */
function restoreIneffectiveTrailingMargins(strips: StripInfo[]): void {
  for (const prev of Array.from(
    document.querySelectorAll<HTMLElement>('[data-gp-trailing-margin="compensated"]'),
  )) {
    const target = prev.nextElementSibling;
    if (!target || pageOf(target, strips) !== pageRangeOf(prev, strips)[1]) {
      restoreTrailingMargin(prev);
    }
  }
}

/**
 * Group the flow root's children into runs of identical page context and wrap
 * each run in a strip. Runs only ever split where print would already have
 * forced a break (a named-page change), so strip boundaries add no breaks of
 * their own — the parity property S1 tests.
 */
export function buildStrips(
  model: GcpmModel,
  opts: LayoutOptions = {},
  warnings: string[] = [],
): StripInfo[] {
  const doc = document;
  const root = opts.root ?? doc.querySelector("main") ?? doc.body;
  const gap = opts.sheetGap ?? 24;

  // `warnings` is kept in the signature (opts callers still pass it) but no
  // fidelity warning remains to raise here — explodeChildren resolves the
  // opener idiom structurally instead of diverging and warning about it.
  const runs = explodeChildren(root, model);

  const strips: StripInfo[] = [];
  for (const run of runs) {
    const { geometry } = resolvePage(model, { name: run.page });
    const strip = doc.createElement("div");
    strip.className = "gp-strip";
    if (run.page) strip.dataset.page = run.page;
    // `.gp-flush` frees the pinned edges' margins for this run only — the
    // print twin is the compiler's generated page context. Every derived
    // var below uses the freed margins, so the strip's content box grows to
    // the sheet edge, its translate lands on the paper where flushed, and
    // the sheet-pitch arithmetic (content + margins + gap) is unchanged by
    // construction. Decoration keeps the AUTHOR geometry via strip.geometry:
    // sheets and margin-box slots do not move — margin boxes on a flushed
    // edge keep painting at their original coordinates, exactly where the
    // compiler relocates them in print.
    const margin = run.flushEdges?.length
      ? flushMargins(geometry.margin, run.flushEdges)
      : geometry.margin;
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
    run.nodes[0]!.before(strip);
    for (const n of run.nodes) strip.appendChild(n);
    strips.push({
      el: strip,
      page: run.page,
      geometry,
      flushEdges: run.flushEdges,
      pages: 0,
      offset: 0,
    });
  }
  // Separate pass: `clearLeadingForcedBreaks` reads computed style, and doing
  // that inside the loop above would force one synchronous style recalc per
  // strip right after that strip's own DOM writes.
  for (const s of strips) clearLeadingForcedBreaks(s.el);
  return strips;
}

/**
 * Screen-mode compensation for repeated table headers (S5).
 *
 * Chromium repeats `<thead>`/`<tfoot>` on every PAGE a table spans in print,
 * but NOT on every COLUMN in multicol. The repeated header consumes height, so
 * without this the screen fits more rows per page than print and everything
 * after a spanning table drifts.
 *
 * Fix: reserve the header's height at the top of each continuation fragment
 * with a zero-content shim row, then re-check — inserting a shim can move the
 * break, so iterate to a fixed point (bounded; converges in ≤2 passes on real
 * content, same model as the compiler's Tier 3).
 */
export function compensateRepeatedHeaders(
  strips: StripInfo[],
  maxPasses = 24,
): { tables: number; passes: number; warnings: string[] } {
  const warnings: string[] = [];
  let passes = 0;
  let touched = 0;

  for (const strip of strips) {
    const tables = Array.from(strip.el.querySelectorAll("table")).filter(
      (t) => t.tHead || t.tFoot,
    );
    if (!tables.length) continue;
    for (const table of tables) {
      for (const shim of Array.from(
        table.querySelectorAll("tr.gp-thead-shim, tr.gp-tfoot-shim"),
      ))
        shim.remove();
      table.style.breakBefore = "";
    }

    // Push and foot claims are STICKY for the rest of this run: a fix removes
    // the symptom it was derived from, so re-deriving from the fixed state
    // would undo it and oscillate. Claims only grow; the loop ends when a pass
    // adds nothing new.
    const pushed = new Set<HTMLTableElement>();
    // row -> shim height: the shim FILLS the space from the last kept row to
    // the column bottom (>= footHeight by the intruder rule), so the reserve
    // genuinely sits at the bottom and rows fill exactly to print's line.
    const footClaims = new Map<HTMLTableElement, Map<HTMLTableRowElement, number>>();
    let previous = "";
    for (let pass = 0; pass < maxPasses; pass++) {
      passes = Math.max(passes, pass + 1);

      // READ phase — one layout for the whole strip, then pure reads. Reading
      // and writing per table instead costs a forced relayout of the entire
      // book per table (measured: ~5ms × table count).
      const stride = strideOf(strip.el);
      const stripLeft = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
      const colOf = (r: DOMRect) => Math.floor((r.left - stripLeft + 1) / stride);
      const stripTop = strip.el.getBoundingClientRect().top;
      const colBottom = strip.el.clientHeight;
      const plans: Array<{
        table: HTMLTableElement;
        push: boolean;
        headHeight: number;
        footHeight: number;
        breakRows: HTMLTableRowElement[];
        footRows: Array<[HTMLTableRowElement, number]>;
        grew: boolean;
        cells: number;
      }> = [];

      for (const table of tables) {
        const head = table.tHead;
        const headRect = head?.getClientRects()[0];
        const footHeight = table.tFoot?.getBoundingClientRect().height ?? 0;
        const rows = Array.from(
          table.querySelectorAll<HTMLTableRowElement>("tbody > tr"),
        ).filter(
          (r) =>
            !r.classList.contains("gp-thead-shim") &&
            !r.classList.contains("gp-tfoot-shim"),
        );
        if (!rows.length) continue;
        const rects = rows.map((r) => r.getClientRects()[0] ?? r.getBoundingClientRect());
        const cols = rects.map(colOf);

        // Print reserves the repeated footer at the BOTTOM of every fragment:
        // a row whose bottom edge intrudes into that reserve moves to the next
        // page. Multicol reserves nothing, so the first intruding row of each
        // column (except the table's last fragment) gets a foot-clone shim
        // inserted before it — the shim occupies the reserve, the row moves.
        // One NEW foot claim per table per pass: the first unclaimed row whose
        // bottom edge intrudes into the reserve. Later columns shift once the
        // shim lands, so only the first new claim is derived from settled
        // geometry — the rest come from subsequent passes.
        const claims = footClaims.get(table) ?? new Map<HTMLTableRowElement, number>();
        footClaims.set(table, claims);
        let newClaim: HTMLTableRowElement | undefined;
        if (footHeight > 0) {
          const lastCol = cols[cols.length - 1];
          for (let i = 0; i < rows.length; i++) {
            const row = rows[i]!;
            if (cols[i] === lastCol || claims.has(row)) continue;
            const bottom = rects[i]!.bottom - stripTop;
            if (bottom > colBottom - footHeight + 0.5) {
              newClaim = row;
              claims.set(row, colBottom - (rects[i]!.top - stripTop));
              break;
            }
          }
        }

        plans.push({
          table,
          // Print never strands a repeated header: a header fragment must be
          // followed by at least one row, else the whole table moves on.
          push: headRect ? colOf(headRect) < cols[0]! : false,
          headHeight: headRect?.height ?? 0,
          footHeight,
          breakRows: headRect
            ? rows.filter((_, i) => i > 0 && cols[i]! > cols[i - 1]!)
            : [],
          footRows: [...claims.entries()],
          grew: newClaim !== undefined,
          cells: Math.max(1, ...rows.map((r) => r.cells.length)),
        });
      }

      const signature = plans
        .map(
          (p) =>
            `${p.push || pushed.has(p.table) ? "P" : ""}${p.breakRows
              .map((r) => r.rowIndex)
              .join(".")}~${p.footRows.map(([r]) => r.rowIndex).join(".")}`,
        )
        .join("|");
      const anyGrowth = plans.some((p) => p.grew);
      if (!anyGrowth && signature === previous) break;
      previous = signature;

      // WRITE phase
      for (const plan of plans) {
        for (const shim of Array.from(
          plan.table.querySelectorAll("tr.gp-thead-shim, tr.gp-tfoot-shim"),
        ))
          shim.remove();
        if (plan.push && !pushed.has(plan.table)) {
          pushed.add(plan.table);
          plan.table.style.breakBefore = "column";
          touched++;
          continue; // its fragments are re-derived next pass, from the new position
        }
        for (const row of plan.breakRows) {
          row.before(headerShim(plan.table.tHead!, plan.headHeight, plan.cells));
          touched++;
        }
        for (const [row, height] of plan.footRows) {
          row.before(sectionShim(plan.table.tFoot!, height, plan.cells, "gp-tfoot-shim"));
          touched++;
        }
      }
    }
  }
  return { tables: touched, passes, warnings };
}

/**
 * A clone of the header, not a blank spacer: the screen then SHOWS the repeated
 * header print would draw, and consumes exactly the same height.
 */
function headerShim(head: HTMLTableSectionElement, height: number, cells: number): HTMLTableRowElement {
  return sectionShim(head, height, cells, "gp-thead-shim");
}

/** Clone of a thead/tfoot row reserving `height`, drawn where print draws it. */
function sectionShim(
  section: HTMLTableSectionElement,
  height: number,
  cells: number,
  className: string,
): HTMLTableRowElement {
  const shim = document.createElement("tr");
  shim.className = className;
  shim.setAttribute("aria-hidden", "true");
  shim.style.height = `${height}px`;
  // a foot shim may be taller than the foot itself (it fills to the column
  // bottom); pin the cloned content to the bottom edge, where print draws it
  if (className === "gp-tfoot-shim") shim.style.verticalAlign = "bottom";
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

/**
 * Screen-mode synthesis for recto/verso forced breaks.
 *
 * `break-before: right|recto|left|verso` is a plain break in Chromium (S10), so
 * the compiler inserts blank pages to honour it. The viewer has to insert the
 * same blanks or its page numbers drift from the PDF for every book that opens
 * chapters on a right-hand page.
 *
 * Same analytic rule as the compiler: walk the sites in document order carrying
 * a running count of blanks inserted so far, because each blank shifts every
 * later page by exactly one.
 */
export function compensateRectoBreaks(
  model: GcpmModel,
  strips: StripInfo[],
): number {
  const decls = model.breaks.filter(isRectoVersoBreak);
  for (const spacer of Array.from(document.querySelectorAll(".gp-recto-spacer")))
    spacer.remove();
  if (!decls.length) return 0;

  const sites: Array<{ el: Element; wantsRecto: boolean }> = [];
  for (const d of decls) {
    let els: Element[] = [];
    try {
      els = Array.from(document.querySelectorAll(d.selector));
    } catch {
      continue;
    }
    for (const el of els) sites.push({ el, wantsRecto: wantsRecto(d.value) });
  }
  sites.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  // Read every page BEFORE mutating: inserting a spacer reflows immediately, so
  // a later read already includes the shift and adding it again double-counts.
  // The plan itself is the shared policy the compiler uses on its PDF-measured
  // pages — same input shape, same decision.
  const plan = planRectoBlanks(
    sites.map((site) => ({ page: pageOf(site.el, strips) + 1, wantsRecto: site.wantsRecto })),
  );
  let inserted = 0;
  for (const [i, site] of sites.entries()) {
    if (!plan[i]) continue;
    const spacer = document.createElement("div");
    spacer.className = "gp-recto-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.cssText =
      "break-before: column; break-after: column; height: 0; margin: 0; padding: 0; border: 0;";
    site.el.before(spacer);
    inserted++;
  }
  return inserted;
}

/**
 * Undo `buildStrips()`: move each strip's children back out to its former
 * position in the flow root, in order, then drop the now-empty wrapper.
 * `relayout()` must call this before rebuilding the strip list — calling
 * `buildStrips()` a second time without unwrapping first would explode the
 * PREVIOUS run's strip elements as if they were authored content, nesting
 * strips inside strips instead of re-partitioning the original DOM.
 *
 * `decorate.ts`'s `ensureRun()` may since have wrapped `strip.el` in a
 * `.gp-run` container (alongside a sibling `.gp-layer`) — that
 * decoration chrome has to come out too, or it is left behind as an orphan
 * in the flow root and the NEXT `buildStrips()` sweeps it up as if it were
 * authored content (measured: a stale `.gp-run` left two ghost pages of
 * decoration ahead of the real, rebuilt strip).
 */
function unwrapStrips(strips: StripInfo[]): void {
  for (const strip of strips) {
    const stripEl = strip.el;
    // `applySpreadMode` may have inserted a leading `.gp-wrap-spacer`, and
    // `synthesizeColumnBreaks()` may have inserted `.gp-column-break-spacer`s
    // — viewer chrome, not authored content. Both have to come out same as
    // the `.gp-run` decoration wrapper below, or they leak into the flow
    // root and the NEXT `buildStrips()` sweeps them up as if an author wrote
    // them.
    for (const spacer of Array.from(
      stripEl.querySelectorAll(".gp-wrap-spacer, .gp-column-break-spacer"),
    ))
      spacer.remove();
    const runWrapper = stripEl.parentElement;
    const removalTarget =
      runWrapper && runWrapper.classList.contains("gp-run") ? runWrapper : stripEl;
    const parent = removalTarget.parentNode;
    if (!parent) continue;
    while (stripEl.firstChild) parent.insertBefore(stripEl.firstChild, removalTarget);
    parent.removeChild(removalTarget);
  }
}

/** One geometry read per strip; no per-node measurement. */
export function measure(strips: StripInfo[]): LayoutResult {
  let offset = 0;
  for (const strip of strips) {
    const stride = strideOf(strip.el);
    // scrollWidth includes the trailing gap in Chromium's overflow columns;
    // round-to-nearest against the stride is stable for both cases.
    strip.pages = Math.max(1, Math.round(strip.el.scrollWidth / stride));
    strip.offset = offset;
    offset += strip.pages;
    strip.el.style.setProperty("--gp-pages", String(strip.pages));
  }
  return { strips, totalPages: offset };
}

export function strideOf(strip: HTMLElement): number {
  return stripMetrics(strip).stride;
}

/**
 * Both pitches from ONE getComputedStyle read. `indexInStrip` runs once per
 * xref/string-set/probe element on every mount and refresh, and each
 * getComputedStyle call can force a style recalc — reading the horizontal
 * and vertical pitch together halves that cost without any caching to
 * invalidate.
 */
export function stripMetrics(strip: HTMLElement): { stride: number; rowStride: number } {
  const cs = getComputedStyle(strip);
  const w = parseFloat(cs.getPropertyValue("--gp-content-w"));
  const colGap = parseFloat(cs.columnGap) || 0;
  const h = parseFloat(cs.getPropertyValue("--gp-content-h"));
  const rowGap = parseFloat(cs.rowGap) || 0;
  return { stride: w + colGap, rowStride: h + rowGap };
}

/**
 * Vertical pitch between wrapped rows — the EXACT mirror of `strideOf`:
 * multicol lays a wrapped row out at `column-height` + `row-gap`, exactly as
 * it lays a column out at the content width + `column-gap`. So this must read
 * the CONTENT height (`--gp-content-h`, which is what `column-height` is
 * set to), not the full page height.
 *
 * Reading `--gp-page-h` here overshot by (margin-top + margin-bottom) per
 * row — measured on design-guide: sheets painted at a 1260px pitch while
 * Chromium wrapped content at 1080px, so from row 1 on the sheet chrome sat
 * below the text it was supposed to frame, drifting a further 180px each row,
 * and `pageOf()` mapped 106/363 probe elements to the wrong page in spread
 * mode. `--gp-page-h` + `sheetGap` is the same number by construction
 * (`row-gap` = margins + gap), but content-h + rowGap is the form that stays
 * correct if either definition changes.
 *
 * Unused (but harmless to read) when a strip isn't wrapped — every fragment
 * then sits in row 0 regardless of this value.
 */
export function rowStrideOf(strip: HTMLElement): number {
  return stripMetrics(strip).rowStride;
}

/**
 * Local fragment index (0-based, WITHIN this strip) of a rect, generalizing
 * the single-row case (`wrapCols` unset ⇒ `perRow` = `strip.pages`, every
 * fragment in row 0, exactly the pre-wrap formula) to a wrapped 2-column
 * grid. `wrapGeometry()`'s shift accounts for a leading `.gp-wrap-spacer` — see
 * `applySpreadMode` — which occupies grid slots BEFORE this strip's own
 * first real fragment, so the grid slot a rect is found in has to be
 * un-shifted back to a real content index.
 */
/**
 * Wrap-grid geometry of a strip, derived — never stored — so it cannot drift
 * from the state that determines it. `perRow = pages` when wrap is off makes
 * every consumer's row/col math degrade to the single-row layout for free.
 * The shift is 1 exactly when a wrapped run's first physical page is a recto
 * (0-based `offset` even): `applySpreadMode` inserts a leading
 * `.gp-wrap-spacer` for that case, so the run's real first fragment sits
 * one grid slot in.
 */
export function wrapGeometry(strip: StripInfo): { perRow: number; shift: number } {
  if (!strip.wrapCols) return { perRow: strip.pages, shift: 0 };
  // Only two-up pairs pages, so only two-up needs the recto/verso slot
  // shift; a 1-column wrap is a plain vertical stack.
  return {
    perRow: strip.wrapCols,
    shift: strip.wrapCols === 2 && strip.offset % 2 === 0 ? 1 : 0,
  };
}

function indexInStrip(left: number, top: number, strip: StripInfo): number {
  const { stride, rowStride } = stripMetrics(strip.el);
  const stripBox = strip.el.getBoundingClientRect();
  const stripLeft = stripBox.left - strip.el.scrollLeft;
  const stripTop = stripBox.top;
  const { perRow, shift } = wrapGeometry(strip);
  const colVisual = Math.floor((left - stripLeft + 1) / stride);
  const colClamped = Math.max(0, Math.min(perRow - 1, colVisual));
  const row = Math.max(0, Math.floor((top - stripTop + 1) / rowStride));
  const idx = row * perRow + colClamped - shift;
  return Math.max(0, Math.min(strip.pages - 1, idx));
}

/**
 * Page index (0-based, book-wide) of an element, from its fragment's
 * position. In a fragmented context an element's client rect identifies its
 * fragmentainer — O(declared elements), not O(nodes).
 */
export function pageOf(el: Element, strips: StripInfo[]): number {
  const strip = strips.find((s) => s.el.contains(el));
  if (!strip) return -1;
  const rects = el.getClientRects();
  const first = rects.length ? rects[0]! : (el as HTMLElement).getBoundingClientRect();
  return strip.offset + indexInStrip(first.left, first.top, strip);
}

/**
 * Whether this browser can lay multicol columns out in wrapping ROWS
 * (CSS Multicol L2's `column-wrap: wrap` + `column-height`, shipped
 * unflagged in Chrome/Edge 145). Gates two-up/spread view mode — the
 * published `book.html` runs in the READER's browser, and Firefox/Safari
 * don't have this yet (docs/native-engine-acceptance-gate.md 08-09/08-10).
 */
export function spreadModeSupported(): boolean {
  return (
    typeof CSS !== "undefined" &&
    typeof CSS.supports === "function" &&
    CSS.supports("column-wrap", "wrap") &&
    CSS.supports("column-height", "100px")
  );
}

/**
 * View mode. Wraps each run's own multicol flow into N-column ROWS instead
 * of one long row (`.gp-strip[data-wrap="on"]` in viewer.css) — content
 * genuinely moves with the columns, because they are the same box; this is
 * not the retired chrome-only two-up (`decorate.ts`'s `draw()` comment).
 *
 * BOTH view modes wrap: spread is 2 columns, single is ONE — a plain
 * vertical stack of pages, which is what a page-at-a-time reader expects.
 * Without the 1-column wrap, single mode is each run's pages in one long
 * HORIZONTAL row with runs stacked vertically, so a book with many
 * named-page runs reads as pages ragged-wrapped into rows of varying
 * length (reported against 0.10.0-alpha.1 on the field guide). Only the
 * column count differs, so `decorate.ts`'s row/col arithmetic covers both
 * unchanged, and only two-up takes the recto/verso slot shift below.
 *
 * No-ops to the pre-wrap single-row layout when the browser lacks the
 * capability (`spreadModeSupported()` — Firefox/Safari today).
 *
 * CROSS-RUN CORRECTNESS: each run starts its own fresh 2-column grid at grid
 * slot 0, so a run whose first physical page is a RECTO would otherwise land
 * in multicol's first (LEFT) slot and get grouped with the VERSO that
 * follows it — both backwards (recto belongs on the right) and the wrong
 * pairing (a recto pairs with the verso that PRECEDES it, in the previous
 * run, not the one after it). A same-box CSS-only fix (e.g. `direction: rtl`
 * to mirror left/right) cannot fix this: mirroring only changes which edge a
 * slot paints at, not which fragments the browser's own column-wrap
 * grouping puts in the same row together — that grouping is exactly what's
 * wrong here. Fixing the GROUPING needs a real, empty, zero-height
 * `.gp-wrap-spacer` occupying grid slot 0 (`break-after: column`, so it
 * consumes exactly one column-flow slot and nothing else) — inserted as the
 * strip's first child, AFTER `measure()` has already fixed `strip.pages`/
 * `offset`/`totalPages` for good, so it can never perturb the page count or
 * any page-of-element mapping (verified: fragment index of every element is
 * unaffected — the spacer is pure grid-slot bookkeeping, `indexInStrip`
 * subtracts it back out). It pushes this run's real first page into slot 1
 * (the right column), and every fragment after it shifts down by the same
 * one slot, so the run's own internal pairing lines up correctly for its
 * whole length. A page count of 1 still gets the 2-column reservation
 * (never skipped), so a solo shifted recto (e.g. the book's very first
 * page) renders in the RIGHT slot with an empty left slot — the classic
 * single-page-spread convention — with nothing else inserted.
 */
export function applySpreadMode(strips: StripInfo[], spread: boolean): void {
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

/**
 * Book-wide (0-based) page index of every recto/verso blank spacer, read from
 * its OWN fragment position — not inherited from `strip.page`.
 *
 * A blank spacer sits inside whichever named-page run happens to contain the
 * site it precedes (it is a DOM sibling, not a strip boundary — recto/verso
 * breaks split PAGES, not runs), but the compiler gives every blank page its
 * own isolated context (`page: gp--blank`, ENGINE.md §8 / `counterStyleCss`
 * in `build.ts`), decoupled from the surrounding run. `pageContext` in
 * `decorate.ts` needs this list to do the same, or a blank page picks up the
 * WRONG context's geometry and content — exactly the recto/verso parity class
 * of bug (`ARCHITECTURE.md` §1).
 */
export function blankPageIndices(strips: StripInfo[]): number[] {
  return Array.from(document.querySelectorAll(".gp-recto-spacer")).map((el) =>
    pageOf(el, strips),
  );
}

/** Page range [firstPage, lastPage] an element spans (0-based, book-wide). */
export function pageRangeOf(el: Element, strips: StripInfo[]): [number, number] {
  const strip = strips.find((s) => s.el.contains(el));
  if (!strip) return [-1, -1];
  const rects = Array.from(el.getClientRects());
  if (!rects.length) return [pageOf(el, strips), pageOf(el, strips)];
  const idx = rects.map((r) => indexInStrip(r.left, r.top, strip));
  return [strip.offset + Math.min(...idx), strip.offset + Math.max(...idx)];
}

export interface GutterpressViewerApi {
  model: GcpmModel;
  strips: StripInfo[];
  totalPages: number;
  /** fidelity warnings raised during fragmentation (screen-mode limits) */
  warnings: string[];
  /** blank pages inserted to honour recto/verso forced breaks */
  blankPages: number;
  /** book-wide (0-based) index of every inserted blank page */
  blankPageIndices: number[];
  pageOf(sel: string | Element): number;
  pageRangeOf(sel: string | Element): [number, number];
  relayout(): LayoutResult;
}

/**
 * An `<img>`'s INTRINSIC SIZE (`naturalWidth`/`naturalHeight`, what the
 * fragmenter's layout read cares about) is available as soon as the element
 * reaches `complete` — the browser doesn't need the full pixel decode
 * `img.decode()` forces. Measured: on this book's 20-image chapter,
 * `decode()` cost ~400ms of real per-navigation decode work on a fresh
 * iframe (large print-resolution art, not re-decoded free across
 * navigations) versus ~80-170ms waiting only for `complete` — the
 * `load`/`error` event already fires once dimensions are known. Waiting on
 * decode was measurably wrong for this call site: it bought no additional
 * layout correctness, only paint readiness we don't need here.
 */
function imageIntrinsicSizeReady(img: HTMLImageElement): Promise<void> {
  if (img.complete) return Promise.resolve();
  return new Promise((resolve) => {
    img.addEventListener("load", () => resolve(), { once: true });
    img.addEventListener("error", () => resolve(), { once: true });
  });
}

/**
 * Wait for whatever the fragmenter is about to measure to actually be ready:
 * web fonts (line-box heights) and already-requested images (intrinsic size).
 * Both promises are already-resolved no-ops on a warm load — `document.fonts.ready`
 * settles immediately once every face is in, and `imageIntrinsicSizeReady`
 * short-circuits on `img.complete` — so this costs nothing when nothing is
 * pending; it only holds up a genuinely cold cache, which is exactly the race
 * this closes (blocker #3: first-load-in-a-fresh-Chromium fragmenting before
 * fonts/images finish and reporting one fewer page than every later load).
 */
export function waitForLayoutReady(doc: Document = document): Promise<void> {
  const fontsReady = doc.fonts?.ready ?? Promise.resolve();
  const imagesReady = Promise.all(Array.from(doc.images).map(imageIntrinsicSizeReady));
  return Promise.all([fontsReady, imagesReady]).then(() => undefined);
}

/** Fragment the current document. Decoration is a separate layer (decorate.ts). */
export async function fragmentDocument(opts: LayoutOptions = {}): Promise<GutterpressViewerApi> {
  // Kick off alongside the stylesheet fetches below so a cold cache's font/
  // image load overlaps network time instead of adding to it.
  const layoutReady = waitForLayoutReady();
  const css = await loadStyleSources();
  injectViewerCss();
  // the preview renders the PRINT stylesheet: re-inject `@media print` bodies
  // as screen rules, since the browser won't apply them outside print emulation
  const printOnly = mediaPrintBodies(css).join("\n");
  if (printOnly && !document.getElementById("gp-media-print")) {
    const style = document.createElement("style");
    style.id = "gp-media-print";
    style.textContent = printOnly;
    document.head.appendChild(style);
  }
  const model = extract(css);
  injectBreakMapping(model);
  const authoring: string[] = [];
  const strips = buildStrips(model, opts, authoring);
  await layoutReady;
  stabilizeFullHeightPageRoots(model, strips);
  compensateTrailingMarginsBeforeAvoids(model, strips);
  synthesizeColumnBreaks(model);
  measure(strips);
  const blanks = compensateRectoBreaks(model, strips);
  if (blanks) measure(strips);
  const headers =
    opts.compensateHeaders === false
      ? { tables: 0, passes: 0, warnings: [] }
      : compensateRepeatedHeaders(strips);
  restoreIneffectiveTrailingMargins(strips);
  const { totalPages } = measure(strips);
  const api: GutterpressViewerApi = {
    model,
    strips,
    totalPages,
    warnings: [...new Set([...authoring, ...headers.warnings])],
    blankPages: blanks,
    blankPageIndices: blankPageIndices(strips),
    pageOf: (sel) =>
      pageOf(typeof sel === "string" ? document.querySelector(sel)! : sel, strips),
    pageRangeOf: (sel) =>
      pageRangeOf(typeof sel === "string" ? document.querySelector(sel)! : sel, strips),
    // Rebuilds the strip structure from scratch instead of only re-measuring
    // the strips built at mount. A re-measure-only relayout cannot see a DOM
    // edit that adds or removes a page-context run (e.g. a spliced-in
    // `page:`-assigned element) — it would silently keep the old strip
    // boundaries and report the wrong page count. Measured cost of a full
    // rebuild is the same order as mount (tens of ms on a real book), so
    // there is no separate "cheap" path to keep.
    relayout: () => {
      restoreFullHeightPageRoots();
      restoreTrailingMargins();
      unwrapStrips(strips);
      for (const spacer of Array.from(document.querySelectorAll(".gp-recto-spacer")))
        spacer.remove();
      const rebuilt = buildStrips(model, opts, authoring);
      strips.length = 0;
      strips.push(...rebuilt);
      stabilizeFullHeightPageRoots(model, strips);
      compensateTrailingMarginsBeforeAvoids(model, strips);
      synthesizeColumnBreaks(model);
      measure(strips);
      api.blankPages = compensateRectoBreaks(model, strips);
      if (opts.compensateHeaders !== false)
        api.warnings = [
          ...new Set([...authoring, ...compensateRepeatedHeaders(strips).warnings]),
        ];
      restoreIneffectiveTrailingMargins(strips);
      const r = measure(strips);
      api.totalPages = r.totalPages;
      api.blankPageIndices = blankPageIndices(strips);
      return r;
    },
  };
  return api;
}

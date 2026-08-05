/**
 * Viewer core (§7): let Chromium fragment the author's content into pages on
 * screen, using multicol — the same LayoutNG block-fragmentation engine print
 * uses. Folio contributes ONE shallow wrapper per named-page run and a handful
 * of CSS custom properties. It never chunks the DOM.
 */
import VIEWER_CSS from "./viewer.css" with { type: "text" };
import {
  extract,
  resolvePage,
  type GcpmModel,
  type PageGeometry,
} from "../shared/gcpm-extract.ts";

export const PX_PER_PT = 96 / 72;

export interface StripInfo {
  el: HTMLElement;
  /** named page for this run, undefined = default page context */
  page?: string;
  geometry: PageGeometry;
  /** page count of this run */
  pages: number;
  /** page index (0-based, book-wide) of this run's first page */
  offset: number;
}

export interface LayoutResult {
  strips: StripInfo[];
  totalPages: number;
}

/** The viewer's own chrome, inlined into the bundle (self-contained, §3). */
export function injectViewerCss(doc: Document = document) {
  if (doc.getElementById("folio-viewer-css")) return;
  const style = doc.createElement("style");
  style.id = "folio-viewer-css";
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
    const raw = (owner as any)?.__folioSource;
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
      if ((l as any).__folioSource) return;
      try {
        (l as any).__folioSource = await (await fetch(l.href)).text();
      } catch {
        (l as any).__folioSource = "";
      }
    }),
  );
  return collectCssText(doc);
}

/**
 * Screen-scoped companion rules for `break-*: page|left|right`.
 * Authors write page breaks; inside a multicol strip that must mean `column`.
 */
export function injectBreakMapping(model: GcpmModel, doc: Document = document): string {
  const rules: string[] = [];
  for (const b of model.breaks) {
    if (b.prop === "break-inside") continue; // `avoid` works identically in multicol
    if (!/^(page|left|right|recto|verso|always)$/.test(b.value.trim())) continue;
    rules.push(`.folio-strip ${b.selector} { ${b.prop}: column; }`);
  }
  const css = rules.join("\n");
  if (css) {
    const style = doc.createElement("style");
    style.id = "folio-break-mapping";
    style.textContent = css;
    doc.head.appendChild(style);
  }
  return css;
}

/**
 * Named page that applies to a top-level flow child.
 *
 * A `page:` assignment on a DESCENDANT (the `h1 { page: chapter }` shape) gives
 * the HEADING's page that template and breaks back to the default page right
 * after it — which is exactly how a "chapter opener" template is written, and
 * how both Chromium and Paged.js behave (verified against the Gutterpress user
 * guide theme). What it does NOT do is put the whole chapter on that template.
 * The viewer cannot reproduce a mid-container page change without chunking the
 * DOM, so it says so rather than diverging silently.
 */
function pageNameOf(
  el: Element,
  model: GcpmModel,
  warnings: string[],
): string | undefined {
  for (const a of model.pageAssignments) {
    try {
      if (el.matches(a.selector)) return a.page;
    } catch {
      /* unsupported selector — ignore, never throw on author CSS */
    }
  }
  for (const a of model.pageAssignments) {
    try {
      const inner = el.querySelector(a.selector);
      if (!inner) continue;
      warnings.push(
        `\`${a.selector} { page: ${a.page} }\` sits on a descendant, so in print only ${a.selector}'s own ` +
          `page uses the "${a.page}" template (the opener idiom) and the rest of the run returns to the ` +
          `default page. The screen preview applies it to the whole run. If the whole run was meant to use ` +
          `the template, move \`page\` to the container; if this is a chapter opener, the PDF is correct.`,
      );
      return a.page;
    } catch {
      /* ignore */
    }
  }
  return undefined;
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

  const children = Array.from(root.children).filter(
    (c) => !c.classList.contains("folio-layer"),
  ) as HTMLElement[];

  const runs: Array<{ page?: string; nodes: HTMLElement[] }> = [];
  for (const child of children) {
    const page = pageNameOf(child, model, warnings);
    const last = runs[runs.length - 1];
    if (last && last.page === page) last.nodes.push(child);
    else runs.push({ page, nodes: [child] });
  }

  const strips: StripInfo[] = [];
  for (const run of runs) {
    const { geometry } = resolvePage(model, { name: run.page });
    const strip = doc.createElement("div");
    strip.className = "folio-strip";
    if (run.page) strip.dataset.page = run.page;
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
    for (const n of run.nodes) strip.appendChild(n);
    strips.push({ el: strip, page: run.page, geometry, pages: 0, offset: 0 });
  }
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
  maxPasses = 4,
): { tables: number; passes: number; warnings: string[] } {
  const warnings: string[] = [];
  let passes = 0;
  let touched = 0;

  for (const strip of strips) {
    const tables = Array.from(strip.el.querySelectorAll("table")).filter((t) => t.tHead);
    if (!tables.length) continue;
    for (const table of tables) {
      for (const shim of Array.from(table.querySelectorAll("tr.folio-thead-shim")))
        shim.remove();
      table.style.breakBefore = "";
      if (table.tFoot)
        warnings.push(
          `table${table.id ? "#" + table.id : ""} has a <tfoot>; the screen preview does not reserve the repeated footer (print does).`,
        );
    }

    // A push is sticky for the rest of this run: once the table has moved, the
    // header is no longer stranded, so re-deriving `push` from the moved state
    // would just undo it (and oscillate).
    const pushed = new Set<HTMLTableElement>();
    let previous = "";
    for (let pass = 0; pass < maxPasses; pass++) {
      passes = Math.max(passes, pass + 1);

      // READ phase — one layout for the whole strip, then pure reads. Reading
      // and writing per table instead costs a forced relayout of the entire
      // book per table (measured: ~5ms × table count).
      const stride = strideOf(strip.el);
      const stripLeft = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
      const colOf = (r: DOMRect) => Math.floor((r.left - stripLeft + 1) / stride);
      const plans: Array<{
        table: HTMLTableElement;
        push: boolean;
        headHeight: number;
        breakRows: HTMLTableRowElement[];
        cells: number;
      }> = [];

      for (const table of tables) {
        const head = table.tHead!;
        const headRect = head.getClientRects()[0];
        if (!headRect?.height) continue;
        const rows = Array.from(
          table.querySelectorAll<HTMLTableRowElement>("tbody > tr"),
        ).filter((r) => !r.classList.contains("folio-thead-shim"));
        if (!rows.length) continue;
        const cols = rows.map((r) => colOf(r.getClientRects()[0] ?? r.getBoundingClientRect()));
        plans.push({
          table,
          // Print never strands a repeated header: a header fragment must be
          // followed by at least one row, else the whole table moves on.
          push: colOf(headRect) < cols[0],
          headHeight: headRect.height,
          breakRows: rows.filter((_, i) => i > 0 && cols[i] > cols[i - 1]),
          cells: Math.max(1, ...rows.map((r) => r.cells.length)),
        });
      }

      const signature = plans
        .map(
          (p) =>
            `${p.push || pushed.has(p.table) ? "P" : ""}${p.breakRows
              .map((r) => r.rowIndex)
              .join(".")}`,
        )
        .join("|");
      if (signature === previous) break;
      previous = signature;

      // WRITE phase
      for (const plan of plans) {
        for (const shim of Array.from(plan.table.querySelectorAll("tr.folio-thead-shim")))
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
  const shim = document.createElement("tr");
  shim.className = "folio-thead-shim";
  shim.setAttribute("aria-hidden", "true");
  shim.style.height = `${height}px`;
  const source = head.rows[0];
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
  const decls = model.breaks.filter(
    (b) => b.prop === "break-before" && /^(right|recto|left|verso)$/.test(b.value.trim()),
  );
  for (const spacer of Array.from(document.querySelectorAll(".folio-recto-spacer")))
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
    for (const el of els)
      sites.push({ el, wantsRecto: /^(right|recto)$/.test(d.value.trim()) });
  }
  sites.sort((a, b) =>
    a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );

  // Read every page BEFORE mutating: inserting a spacer reflows immediately, so
  // a later read already includes the shift and adding it again double-counts.
  const pages = sites.map((site) => pageOf(site.el, strips) + 1);

  let shift = 0;
  let inserted = 0;
  for (const [i, site] of sites.entries()) {
    const page = pages[i]; // 1-based, page 1 is a recto
    if (page <= 0) continue;
    const effective = page + shift;
    const wrong = site.wantsRecto ? effective % 2 === 0 : effective % 2 === 1;
    if (!wrong) continue;
    const spacer = document.createElement("div");
    spacer.className = "folio-recto-spacer";
    spacer.setAttribute("aria-hidden", "true");
    spacer.style.cssText =
      "break-before: column; break-after: column; height: 0; margin: 0; padding: 0; border: 0;";
    site.el.before(spacer);
    shift++;
    inserted++;
  }
  return inserted;
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
    strip.el.style.setProperty("--folio-pages", String(strip.pages));
  }
  return { strips, totalPages: offset };
}

export function strideOf(strip: HTMLElement): number {
  const cs = getComputedStyle(strip);
  const w = parseFloat(cs.getPropertyValue("--folio-content-w"));
  const gap = parseFloat(cs.columnGap) || 0;
  return w + gap;
}

/**
 * Page index (0-based, book-wide) of an element, from its fragment's x offset.
 * In a fragmented context an element's client rect identifies its
 * fragmentainer — O(declared elements), not O(nodes).
 */
export function pageOf(el: Element, strips: StripInfo[]): number {
  const strip = strips.find((s) => s.el.contains(el));
  if (!strip) return -1;
  const stride = strideOf(strip.el);
  const rects = el.getClientRects();
  const stripLeft = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
  const first = rects.length ? rects[0] : (el as HTMLElement).getBoundingClientRect();
  const idx = Math.floor((first.left - stripLeft + 1) / stride);
  return strip.offset + Math.max(0, Math.min(strip.pages - 1, idx));
}

/** Page range [firstPage, lastPage] an element spans (0-based, book-wide). */
export function pageRangeOf(el: Element, strips: StripInfo[]): [number, number] {
  const strip = strips.find((s) => s.el.contains(el));
  if (!strip) return [-1, -1];
  const stride = strideOf(strip.el);
  const stripLeft = strip.el.getBoundingClientRect().left - strip.el.scrollLeft;
  const rects = Array.from(el.getClientRects());
  if (!rects.length) return [pageOf(el, strips), pageOf(el, strips)];
  const idx = rects.map((r) =>
    Math.max(
      0,
      Math.min(strip.pages - 1, Math.floor((r.left - stripLeft + 1) / stride)),
    ),
  );
  return [strip.offset + Math.min(...idx), strip.offset + Math.max(...idx)];
}

export interface FolioViewerApi {
  model: GcpmModel;
  strips: StripInfo[];
  totalPages: number;
  /** fidelity warnings raised during fragmentation (screen-mode limits) */
  warnings: string[];
  /** blank pages inserted to honour recto/verso forced breaks */
  blankPages: number;
  pageOf(sel: string | Element): number;
  pageRangeOf(sel: string | Element): [number, number];
  relayout(): LayoutResult;
}

/** Fragment the current document. Decoration is a separate layer (decorate.ts). */
export async function fragmentDocument(opts: LayoutOptions = {}): Promise<FolioViewerApi> {
  const css = await loadStyleSources();
  injectViewerCss();
  const model = extract(css);
  injectBreakMapping(model);
  const authoring: string[] = [];
  const strips = buildStrips(model, opts, authoring);
  measure(strips);
  const blanks = compensateRectoBreaks(model, strips);
  if (blanks) measure(strips);
  const headers =
    opts.compensateHeaders === false
      ? { tables: 0, passes: 0, warnings: [] }
      : compensateRepeatedHeaders(strips);
  const { totalPages } = measure(strips);
  const api: FolioViewerApi = {
    model,
    strips,
    totalPages,
    warnings: [...new Set([...authoring, ...headers.warnings])],
    blankPages: blanks,
    pageOf: (sel) =>
      pageOf(typeof sel === "string" ? document.querySelector(sel)! : sel, strips),
    pageRangeOf: (sel) =>
      pageRangeOf(typeof sel === "string" ? document.querySelector(sel)! : sel, strips),
    relayout: () => {
      measure(strips);
      api.blankPages = compensateRectoBreaks(model, strips);
      if (opts.compensateHeaders !== false)
        api.warnings = [
          ...new Set([...authoring, ...compensateRepeatedHeaders(strips).warnings]),
        ];
      const r = measure(strips);
      api.totalPages = r.totalPages;
      return r;
    },
  };
  return api;
}

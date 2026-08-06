/**
 * Shared synthesis policy — the single implementation both renderers consume.
 *
 * The compiler and the viewer must produce the same book from the same CSS, so
 * every rule that DECIDES something (where blank pages go, which string value a
 * page shows) lives here as a pure function. The renderers differ only in how
 * they measure (client rects vs the PDF's /Dests) and how they apply (DOM
 * spacers vs DOM spacers via the agent) — never in policy. This is what keeps
 * "every compiler-side synthesis needs a viewer-side twin" from rotting: there
 * is no twin, there is one function.
 */

// ---------------------------------------------------------------------------
// recto/verso forced breaks
// ---------------------------------------------------------------------------

/** `break-before` values Chromium treats as a plain page break but shouldn't. */
export const RECTO_VERSO_VALUES = /^(right|recto|left|verso)$/;

export function isRectoVersoBreak(decl: { prop: string; value: string }): boolean {
  return decl.prop === "break-before" && RECTO_VERSO_VALUES.test(decl.value.trim());
}

export function wantsRecto(value: string): boolean {
  return /^(right|recto)$/.test(value.trim());
}

export interface RectoSite {
  /** 1-based page the element landed on in a clean (spacer-free) layout */
  page: number;
  /** true = must start on a right-hand page; false = left-hand */
  wantsRecto: boolean;
}

/**
 * Which sites need a blank page inserted before them.
 *
 * Pure and analytic: a blank page shifts every later page by exactly one and
 * changes no content, so the whole set follows from one clean measurement —
 * walk the sites in document order carrying the count of blanks inserted so
 * far. (Toggling spacers one measure-pass at a time oscillates instead: the
 * spacer fixes the parity, the next pass sees it fixed and removes it.)
 *
 * Page 1 is a recto; recto pages are odd.
 */
export function planRectoBlanks(sites: RectoSite[]): boolean[] {
  let shift = 0;
  return sites.map((site) => {
    if (site.page <= 0) return false;
    const effective = site.page + shift;
    const onRecto = effective % 2 === 1;
    const wrong = site.wantsRecto ? !onRecto : onRecto;
    if (wrong) shift++;
    return wrong;
  });
}

// ---------------------------------------------------------------------------
// GCPM running strings — string(name, which)
// ---------------------------------------------------------------------------

export type StringWhich = "first" | "start" | "last" | "first-except";

export interface StringEntry {
  /** 1-based page the assignment lands on */
  page: number;
  value: string;
}

const WHICH_VALUES = new Set(["first", "start", "last", "first-except"]);

export function parseWhich(raw: string | undefined): StringWhich {
  const w = (raw ?? "").trim();
  return (WHICH_VALUES.has(w) ? w : "first") as StringWhich;
}

/**
 * The value `string(name, which)` shows on `page`, per CSS GCPM §2.4:
 *
 * - `first` — the value of the first assignment on the page; if none, the
 *   entry value (what was in effect at the top of the page).
 * - `start` — the entry value: the value in effect at the START of the page
 *   (assignments on the page itself don't count).
 * - `last` — the value of the last assignment on the page; if none, the entry
 *   value.
 * - `first-except` — empty on pages where an assignment happens (the chapter
 *   opener), the entry value elsewhere. The classic "no running head on the
 *   opener" behaviour.
 *
 * `entries` must be sorted by page; multiple entries on one page keep document
 * order.
 */
export function stringValueAt(
  entries: StringEntry[],
  page: number,
  which: StringWhich = "first",
): string {
  let entry = ""; // value in effect at the start of the page
  const onPage: string[] = [];
  for (const e of entries) {
    if (e.page < page) entry = e.value;
    else if (e.page === page) onPage.push(e.value);
    else break;
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

/**
 * One symbol per page for a `@counter-style { system: fixed }` map — the
 * compiler's whole running-heads mechanism is `stringValueAt` sampled at every
 * page (verified in s3).
 */
export function stringSymbols(
  entries: StringEntry[],
  pageCount: number,
  which: StringWhich = "first",
): string[] {
  const symbols: string[] = [];
  for (let p = 1; p <= pageCount; p++) symbols.push(stringValueAt(entries, p, which));
  return symbols;
}

/** CSS-escape a string for use inside a double-quoted `symbols:` list. */
export function cssQuote(s: string): string {
  return `"${s.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Stable generated counter-style name for a (string name, which) pair. */
export function counterStyleName(name: string, which: StringWhich): string {
  return which === "first" ? `folio-${name}` : `folio-${name}--${which}`;
}

// ---------------------------------------------------------------------------
// page-counter restart (`counter-reset: page N`)
// ---------------------------------------------------------------------------

export interface PageCounterReset {
  /** 1-based page (after recto/verso blank insertion) the reset takes effect on */
  page: number;
  /** the value `counter-reset: page N` sets */
  start: number;
}

/**
 * One numeric `counter(page)` value per page, honoring `counter-reset: page N`
 * restarts the author declared in content flow.
 *
 * Native Chromium print ignores this restart entirely (ENGINE.md §8: the
 * element sits on page 3, the margin box still reads 3) — front-matter (roman)
 * → body (arabic from 1) is therefore not expressible in the author's content,
 * so the compiler replays the restart as a fixed per-page value list, the same
 * trick `stringSymbols` uses for `string()`. Formatting (`lower-roman` front
 * matter vs decimal body) is a separate, per-`@page`-context concern the
 * caller applies with `formatCounter` — this function only fixes the NUMBER,
 * so one map serves every context regardless of which style each requests.
 *
 * Pure and analytic, like `planRectoBlanks`: one pass, no fixpoint. A blank
 * page inserted before a restart site shifts `page` by exactly one, which is
 * why `page` must be the FINAL (post-blank) page number — the caller resolves
 * that the same way it resolves every other measured page (`ENGINE.md` §6).
 *
 * Multiple resets on the same page keep the LAST one in `resets` order,
 * matching `counter-reset`'s own last-write-wins cascade. `resets` need not be
 * pre-sorted.
 */
export function pageCounterValues(resets: PageCounterReset[], pageCount: number): number[] {
  const byPage = new Map<number, number>();
  for (const r of resets) if (r.page >= 1) byPage.set(r.page, r.start);
  const values: number[] = [];
  let value = 0;
  for (let p = 1; p <= pageCount; p++) {
    if (byPage.has(p)) value = byPage.get(p)! - 1;
    value++;
    values.push(value);
  }
  return values;
}

/**
 * `resetSites` (id + declared start) -> `pageCounterValues`'s input shape,
 * resolved against a measured id->page map. Both the compiler's folio-CSS
 * synthesis (`counterStyleCss`) and its `target-counter()` resolution
 * (`applySynthesis`) need this same resets->values step — one function, so
 * a page's own folio and a cross-reference TO that page can never disagree
 * (F2/F3). Returns `null` when the document declares no restart, so a
 * caller can fall back to the raw physical page number.
 */
export function restartedPageValues(
  resetSites: Array<{ id: string; start: number }>,
  pageMap: Record<string, number>,
  pageCount: number,
): number[] | null {
  const resets: PageCounterReset[] = resetSites
    .map((s) => ({ page: pageMap[s.id] ?? 0, start: s.start }))
    .filter((r) => r.page > 0);
  return resets.length ? pageCounterValues(resets, pageCount) : null;
}

/**
 * A 1-based PHYSICAL page number -> the folio it actually prints, honoring a
 * `counter-reset: page N` restart (F3: `target-counter(attr(href), page)`
 * must resolve to the SAME folio the target page's own margin box prints,
 * not the raw physical page). `pageValues` is the array `pageCounterValues`
 * (or `restartedPageValues`) produced; `null` means no restart is in play.
 */
export function toFolioPage(physicalPage: number, pageValues: number[] | null): number {
  if (!pageValues) return physicalPage;
  return pageValues[physicalPage - 1] ?? physicalPage;
}

// ---------------------------------------------------------------------------
// leader() glue fill
// ---------------------------------------------------------------------------

/**
 * Marker pair wrapping a pending leader inside generated content. Private-use
 * codepoints so author text can never collide; the glue string sits between
 * them. Both renderers replace the marker with a measured run of glue.
 */
export const LEADER_START = "\uE000";
export const LEADER_END = "\uE001";

export function leaderMarker(glue: string): string {
  return `${LEADER_START}${glue}${LEADER_END}`;
}

export const LEADER_RE = /\uE000([^\uE001]*)\uE001/;

/**
 * How many glue repetitions fill `gapPx`. One short of the exact quotient so
 * the line can never overflow by a rounding error — measured on print output:
 * numbers land 1–2 glue-widths from the content edge, nothing wraps.
 */
export function leaderFillCount(gapPx: number, gluePx: number): number {
  if (!(gluePx > 0) || !(gapPx > 0)) return 0;
  return Math.max(0, Math.floor(gapPx / gluePx) - 1);
}

// ---------------------------------------------------------------------------
// generated content (cross-references, leaders)
// ---------------------------------------------------------------------------

/**
 * CSS that makes Folio's computed text win over the author's own rule.
 *
 * Folio resolves `target-counter()` / `target-text()` / `leader()` into a
 * `data-folio-after|before` attribute and renders it with `content: attr(…)`.
 *
 * The pinned engine PARSES `target-counter()` (and `CSS.supports()` reports it
 * as supported) but computes the whole `content` value to `none` — nothing
 * renders. So the author's declaration SURVIVES the cascade, and
 * `a.xref::after` (0,1,1) outranks a bare `[data-folio-after]::after` (0,1,0):
 * a lower-specificity override loses to the author's empty value and the
 * cross-reference silently disappears.
 *
 * The fix is to out-specify the author on their own terms: reuse their selector
 * and add Folio's attribute to it, so the override is strictly more specific
 * than the rule it must beat, whatever that rule looks like. The bare rules are
 * kept as a fallback for content Folio generates on elements no author selector
 * mentions.
 */
export function generatedContentCss(selectors: Iterable<string>): string {
  const rules = new Set<string>();
  for (const raw of selectors) {
    for (const one of raw.split(",")) {
      const selector = one.trim();
      if (!selector) continue;
      const m = /^(.*?)(::?)(after|before)\s*$/i.exec(selector);
      if (!m) continue;
      const [, base, colons, pseudo] = m;
      const where = pseudo.toLowerCase();
      rules.add(
        `${base.trim()}[data-folio-${where}]${colons}${where} { content: attr(data-folio-${where}); }`,
      );
    }
  }
  // fallback for elements no author selector named (specificity 0,1,0)
  rules.add(`[data-folio-after]::after { content: attr(data-folio-after); }`);
  rules.add(`[data-folio-before]::before { content: attr(data-folio-before); }`);
  return [...rules].join("\n");
}

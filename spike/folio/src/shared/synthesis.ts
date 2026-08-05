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

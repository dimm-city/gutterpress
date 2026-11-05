/**
 * Measured split — the measuring loop. Runs in the viewer page (the compiler's
 * predict page and the preview, the same function) against the viewer's own
 * fragmenter, which is the one the PDF is printed through. See
 * `shared/split.ts` for the policy and `shared/split-dom.ts` for the markup.
 *
 * A split adds height after its break only, so everything before it is final.
 * Each pass takes at most one split per scope (scopes separated by a forced page
 * break cannot influence each other), then re-lays the document out once; a pass is one `relayout()`, no
 * print. A head part that still spans pages (its closed foot cost it a line)
 * gives its last unit to the continuation instead of growing a third part.
 */
import {
  SPLIT_PASS_CAP,
  chooseWordBreak,
  firstCrossingUnit,
  pickPerScope,
  stepBackOverAvoid,
  pullBack,
  pullBackWord,
  reserveFrom,
  shortOfReserve,
  spanPages,
  type SplitDiagnostic,
  type SplitOp,
  type SplitResult,
  type WordPos,
} from "../shared/split.ts";
import {
  cardsOf,
  ensureSplitCss,
  flowOf,
  continuationCard as continuationOfCard,
  isContinuation,
  labelContinuations,
  mergeBack,
  scopeOf,
  splitCardAt,
  unitsOf,
  type SplitUnit,
  unsplitAll,
  wordRanges,
} from "./split-dom.ts";
import { cssZoomOf, indexInStrip, stripMetrics, type GutterpressViewerApi } from "./fragment.ts";

type Layout = Pick<GutterpressViewerApi, "pageRangeOf" | "relayout" | "totalPages" | "strips" | "model">;

/**
 * Every word of a paragraph with its line and last page, from the live layout.
 * A new line starts at a rect that begins below the bottom of the one before
 * it (or on another page): a raised `<sup>` or a small `<code>` sits inside its
 * line's band and does not start one.
 */
function wordPositions(api: Layout, p: Element): WordPos[] {
  const strip = api.strips.find((s) => s.el.contains(p));
  if (!strip) return [];
  const pageAt = (r: DOMRect): number => strip.offset + indexInStrip(r.left, r.top, strip);
  let line = 0;
  let bottom = -Infinity;
  let page = -1;
  return wordRanges(p).map((range) => {
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return { line, lastPage: -1 };
    let first = 0;
    let lastPage = -1;
    rects.forEach((r, i) => {
      const at = pageAt(r);
      if (at !== page || r.top >= bottom - 1) line++;
      if (i === 0) first = line;
      page = at;
      bottom = r.bottom;
      lastPage = at;
    });
    return { line: first, lastPage };
  });
}

/** Room left below the card's last fragment to the bottom of the page content, in CSS px. */
function roomBelow(api: Layout, card: Element): number {
  const strip = api.strips.find((s) => s.el.contains(card));
  const rect = Array.from(card.getClientRects()).at(-1);
  if (!strip || !rect) return Infinity;
  const { rowStride, height } = stripMetrics(strip.el);
  const zoom = cssZoomOf(strip.el);
  const top = strip.el.getBoundingClientRect().top;
  const row = Math.max(0, Math.floor(((rect.top - top) / zoom + 1) / rowStride));
  return height - ((rect.bottom - top) / zoom - row * rowStride);
}

const FORCED = /^(page|left|right|recto|verso)$/;

/** The elements that force a page break before or after themselves. */
function forcedBreaks(api: Layout): Array<{ el: Element; after: boolean }> {
  const out: Array<{ el: Element; after: boolean }> = [];
  for (const b of api.model.breaks) {
    if (b.prop === "break-inside" || !FORCED.test(b.value.trim())) continue;
    let els: Element[];
    try {
      els = Array.from(document.querySelectorAll(b.selector));
    } catch {
      continue;
    }
    for (const el of els) {
      const cs = getComputedStyle(el);
      const value = b.prop === "break-before" ? cs.breakBefore : cs.breakAfter;
      if (FORCED.test(value.trim())) out.push({ el, after: b.prop !== "break-before" });
    }
  }
  return out;
}

/**
 * Whether a page break the author forced lies between two cards. Only then is
 * a cut in the second independent of a cut in the first: a cut adds height
 * after its break, up to the next forced page break.
 */
function separated(sites: ReturnType<typeof forcedBreaks>, a: Element, b: Element): boolean {
  const FOLLOWING = Node.DOCUMENT_POSITION_FOLLOWING;
  return sites.some(({ el, after }) => {
    if (after) {
      if (el === a || (el.contains(a) && !el.contains(b))) return true;
      return !!(a.compareDocumentPosition(el) & FOLLOWING) && !a.contains(el) &&
        !el.contains(b) && !!(el.compareDocumentPosition(b) & FOLLOWING);
    }
    if (el.contains(a)) return false;
    return !!(a.compareDocumentPosition(el) & FOLLOWING) && !a.contains(el) &&
      (el === b || el.contains(b) || !!(el.compareDocumentPosition(b) & FOLLOWING));
  });
}

const AVOID = /^avoid/;

/** Whether no break may fall before each unit (`break-after: avoid` above it or `break-before: avoid` on it). */
function joinedUnits(units: SplitUnit[]): boolean[] {
  return units.map((u, i) => {
    if (i === 0) return false;
    const before = getComputedStyle(units[i - 1]!.last ?? units[i - 1]!.el).breakAfter;
    return AVOID.test(before) || AVOID.test(getComputedStyle(u.el).breakBefore);
  });
}

function scopeSpans(api: Layout): Map<string, number> {
  const ranges = new Map<string, Array<[number, number]>>();
  for (const card of cardsOf()) {
    const list = ranges.get(scopeOf(card)) ?? [];
    list.push(api.pageRangeOf(card));
    ranges.set(scopeOf(card), list);
  }
  return new Map([...ranges].map(([scope, r]) => [scope, spanPages(r)]));
}

export { ensureSplitCss, unsplitAll };

/** Whether the document has anything to split. */
export function hasSplitCards(): boolean {
  return document.querySelector("[data-gp-split]") !== null;
}

/** Cards that span pages now (heads that still do are a failed cut). */
export function spanningCards(api: Pick<GutterpressViewerApi, "pageRangeOf">): { all: number; cut: number } {
  let all = 0;
  let cut = 0;
  for (const card of cardsOf()) {
    const [s, e] = api.pageRangeOf(card);
    if (e <= s) continue;
    all++;
    if (continuationOfCard(card)) cut++;
  }
  return { all, cut };
}

type Plan =
  | { card: Element; kind: "pull"; prior: SplitOp; word: number | null }
  | { card: Element; kind: "cut"; k: number; word: number | null }
  | { card: Element; kind: "settle"; note?: SplitDiagnostic };

/** A split op is dropped: the cards after it were counted with its continuation in front of them. */
function dropOp(ops: SplitOp[], op: SplitOp): void {
  const at = ops.indexOf(op);
  if (at < 0) return;
  ops.splice(at, 1);
  for (const later of ops.slice(at)) if (later.n > op.n) later.n--;
}

/**
 * Split every marked card that spans pages, until the layout is stable.
 * `api` must already hold a measured layout of the unsplit document, taken
 * after `ensureSplitCss()` (the break rule has to be in the model).
 */
export function measuredSplit(api: Layout): SplitResult {
  const t0 = performance.now();
  const ops: SplitOp[] = [];
  const diagnostics: SplitDiagnostic[] = [];
  const diagnosed = new Set<string>();
  const note = (d: SplitDiagnostic) => {
    if (diagnosed.has(d.code + d.message)) return;
    diagnosed.add(d.code + d.message);
    diagnostics.push(d);
  };
  const pagesBefore = api.totalPages;
  const before = scopeSpans(api);
  const settled = new WeakSet<Element>();
  const pending = new Map<Element, SplitOp>();
  let passes = 0;
  let unconverged = false;

  for (;;) {
    const cards = cardsOf().filter((c) => !settled.has(c));
    const info = cards.map((card) => {
      const [first, e] = api.pageRangeOf(card);
      // a card whose tab ends a page and whose first unit starts the next is measured from there
      const flow = flowOf(card);
      const firstUnit = flow ? unitsOf(flow)[0] : undefined;
      const s = Math.max(first, firstUnit ? api.pageRangeOf(firstUnit.el)[0] : first);
      // a head that ends too near the foot of the page (less than its reserve) counts as spanning
      const short = pending.has(card) && shortOfReserve(roomBelow(api, card), reserveFrom(card.getAttribute("data-gp-split-reserve")));
      if (e <= s && !short) pending.delete(card);
      return { scope: scopeOf(card), spans: e > s || short, start: s };
    });
    const picked = pickPerScope(info);
    if (!picked.length) break;
    if (passes >= SPLIT_PASS_CAP) {
      unconverged = true;
      break;
    }
    passes++;

    // 1. measure every picked card against the layout as it stands: nothing is touched yet
    const plans: Plan[] = picked.map((i): Plan => {
      const card = cards[i]!;
      const flow = flowOf(card);
      if (!flow) return { card, kind: "settle" };
      const prior = pending.get(card);
      if (prior) {
        // the head still spans pages: one unit (or one line) fewer
        const head = prior.word === undefined ? undefined : unitsOf(flow)[prior.unit]?.el;
        const word = head ? pullBackWord(wordPositions(api, head).map((w) => w.line)) : null;
        return { card, kind: "pull", prior, word };
      }
      const units = unitsOf(flow);
      const start = info[i]!.start;
      const k = firstCrossingUnit(
        start,
        units.map((u) => Math.max(api.pageRangeOf(u.el)[1], api.pageRangeOf(u.last ?? u.el)[1])),
      );
      if (k < 0) return { card, kind: "settle" }; // only the card's own chrome spills
      // a paragraph that starts on this page and runs onto the next is cut at a line
      const crossing = units[k]!;
      const [from, to] = api.pageRangeOf(crossing.el);
      const word =
        crossing.kind === "block" && crossing.el.tagName === "P" && from === start && to > from
          ? chooseWordBreak(wordPositions(api, crossing.el), start)
          : null;
      // no cut leaves a sub-heading (break-after: avoid) at the foot of a head
      const at = word === null ? stepBackOverAvoid(k, joinedUnits(units)) : k;
      if (at === 0 && word === null) {
        // the first unit does not fit where the card starts: a continuation
        // starts a page, so there it is taller than a page
        return { card, kind: "settle", note: isContinuation(card) ? unsplittable(card) : undefined };
      }
      return { card, kind: "cut", k: at, word };
    });

    // 2. apply in document order; a card is cut in this pass only if a forced page
    // break separates it from the last card cut (else its measure is stale), and waits otherwise
    const sites = forcedBreaks(api);
    let last: Element | null = null;
    for (const plan of plans) {
      const { card } = plan;
      if (plan.kind === "settle") {
        settled.add(card);
        if (plan.note) note(plan.note);
        continue;
      }
      if (last && !separated(sites, last, card)) continue;
      last = card;
      if (plan.kind === "pull") {
        const { prior } = plan;
        pending.delete(card);
        mergeBack(card);
        const keep = prior.word !== undefined; // a paragraph: one line fewer, else the whole paragraph
        let unit = keep ? prior.unit : pullBack(prior.unit);
        // one unit fewer must not end the head on a sub-heading either
        const flow = flowOf(card);
        if (unit !== null && !keep && flow) unit = stepBackOverAvoid(unit, joinedUnits(unitsOf(flow)));
        if (unit !== null && splitCardAt(card, unit, keep ? (plan.word ?? undefined) : undefined).ok) {
          prior.unit = unit;
          prior.word = keep ? (plan.word ?? undefined) : undefined;
          prior.kind = prior.word === undefined ? "block" : prior.kind;
          pending.set(card, prior);
        } else {
          dropOp(ops, prior);
          settled.add(card);
          note(unsplittable(card));
        }
        continue;
      }
      const n = cardsOf().indexOf(card as HTMLElement);
      const res = splitCardAt(card, plan.k, plan.word ?? undefined);
      if (!res.ok) {
        if (res.diagnostic) note(res.diagnostic);
        settled.add(card);
        continue;
      }
      const op: SplitOp = { n, unit: plan.k, kind: res.kind, ...(plan.word === null ? {} : { word: plan.word }) };
      ops.push(op);
      pending.set(card, op);
    }
    api.relayout();
  }

  if (unconverged)
    note({
      code: "engine.split.unconverged",
      message:
        `Splitting cards did not settle in ${SPLIT_PASS_CAP} passes; the cards still spanning ` +
        `pages stay as the browser breaks them.`,
    });
  const ids = labelContinuations();
  const after = scopeSpans(api);
  const kinds: Record<string, number> = {};
  for (const op of ops) kinds[op.kind] = (kinds[op.kind] ?? 0) + 1;
  return {
    ops,
    diagnostics,
    ...ids,
    ms: performance.now() - t0,
    pagesBefore,
    pagesAfter: api.totalPages,
    passes,
    kinds,
    scopes: [...after].map(([scope, n]) => ({ scope, before: before.get(scope) ?? n, after: n })),
  };
}

/** The card, named by its scope and its first words, for a message that has to point at it. */
function nameOf(card: Element): string {
  const text = (card.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 40);
  const scope = scopeOf(card);
  return `"${text}"${scope ? ` (scope ${scope})` : ""}`;
}

function unsplittable(card: Element): SplitDiagnostic {
  return {
    code: "engine.split.unsplittable",
    message:
      `A unit inside the split card ${nameOf(card)} is taller than a page (or leaves no room for ` +
      `the card's own foot), so that card stays as the browser breaks it.`,
  };
}

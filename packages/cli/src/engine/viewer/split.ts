/**
 * Measured split — the measuring loop. Runs in the viewer page (the compiler's
 * predict page and the preview, the same function) against the viewer's own
 * fragmenter, which is the one the PDF is printed through. See
 * `shared/split.ts` for the policy and `shared/split-dom.ts` for the markup.
 *
 * A split adds height after its break only, so everything before it is final.
 * Each pass takes at most one split per scope (scopes cannot influence each
 * other), then re-lays the document out once; a pass is one `relayout()`, no
 * print. A head part that still spans pages (its closed foot cost it a line)
 * gives its last unit to the continuation instead of growing a third part.
 */
import {
  SPLIT_PASS_CAP,
  chooseWordBreak,
  firstCrossingUnit,
  pickPerScope,
  pullBack,
  pullBackWord,
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
  isContinuation,
  labelContinuations,
  mergeBack,
  scopeOf,
  splitCardAt,
  unitsOf,
  unsplitAll,
  wordRanges,
} from "./split-dom.ts";
import { indexInStrip, type GutterpressViewerApi } from "./fragment.ts";

type Layout = Pick<GutterpressViewerApi, "pageRangeOf" | "relayout" | "totalPages" | "strips">;

/** Every word of a paragraph with its line and last page, from the live layout. */
function wordPositions(api: Layout, p: Element): WordPos[] {
  const strip = api.strips.find((s) => s.el.contains(p));
  if (!strip) return [];
  const pageAt = (r: DOMRect): number => strip.offset + indexInStrip(r.left, r.top, strip);
  let line = 0;
  let key = "";
  return wordRanges(p).map((range) => {
    const rects = Array.from(range.getClientRects());
    if (!rects.length) return { line, lastPage: -1 };
    const first = rects[0]!;
    const k = `${pageAt(first)}:${Math.round(first.top)}`;
    if (k !== key) line++;
    key = k;
    return { line, lastPage: pageAt(rects[rects.length - 1]!) };
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
      const [s, e] = api.pageRangeOf(card);
      if (e <= s) pending.delete(card);
      return { scope: scopeOf(card), spans: e > s, start: s };
    });
    const picked = pickPerScope(info);
    if (!picked.length) break;
    if (passes >= SPLIT_PASS_CAP) {
      unconverged = true;
      break;
    }
    passes++;
    for (const i of picked) {
      const card = cards[i]!;
      const flow = flowOf(card);
      if (!flow) {
        settled.add(card);
        continue;
      }
      const prior = pending.get(card);
      if (prior) {
        // the head still spans pages: keep one unit fewer
        pending.delete(card);
        const head = prior.word === undefined ? undefined : unitsOf(flow)[prior.unit]?.el;
        const word = head ? pullBackWord(wordPositions(api, head).map((w) => w.line)) : null;
        mergeBack(card);
        const keep = prior.word !== undefined; // a paragraph: one line fewer, else the whole paragraph moves
        const unit = keep ? prior.unit : pullBack(prior.unit);
        if (unit !== null && splitCardAt(card, unit, keep ? (word ?? undefined) : undefined).ok) {
          prior.unit = unit;
          prior.word = keep ? (word ?? undefined) : undefined;
          prior.kind = prior.word === undefined ? "block" : prior.kind;
          pending.set(card, prior);
        } else {
          ops.splice(ops.indexOf(prior), 1);
          settled.add(card);
          note(unsplittable());
        }
        continue;
      }
      const units = unitsOf(flow);
      const k = firstCrossingUnit(
        info[i]!.start,
        units.map((u) => api.pageRangeOf(u.el)[1]),
      );
      if (k < 0) {
        settled.add(card); // only the card's own chrome spills
        continue;
      }
      // a paragraph that starts on this page and runs onto the next is cut at a line
      const crossing = units[k]!;
      const [from, to] = api.pageRangeOf(crossing.el);
      const word =
        crossing.kind === "block" && crossing.el.tagName === "P" && from === info[i]!.start && to > from
          ? chooseWordBreak(wordPositions(api, crossing.el), info[i]!.start)
          : null;
      if (k === 0 && word === null) {
        // the first unit does not fit where the card starts: a continuation
        // starts a page, so there it is taller than a page
        if (isContinuation(card)) note(unsplittable());
        settled.add(card);
        continue;
      }
      const n = cardsOf().indexOf(card);
      const res = splitCardAt(card, k, word ?? undefined);
      if (!res.ok) {
        if (res.diagnostic) note(res.diagnostic);
        settled.add(card);
        continue;
      }
      const op: SplitOp = { n, unit: k, kind: res.kind, ...(word === null ? {} : { word }) };
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
  const continuations = labelContinuations();
  const after = scopeSpans(api);
  const kinds: Record<string, number> = {};
  for (const op of ops) kinds[op.kind] = (kinds[op.kind] ?? 0) + 1;
  return {
    ops,
    diagnostics,
    continuations,
    ms: performance.now() - t0,
    pagesBefore,
    pagesAfter: api.totalPages,
    passes,
    kinds,
    scopes: [...after].map(([scope, n]) => ({ scope, before: before.get(scope) ?? n, after: n })),
  };
}

function unsplittable(): SplitDiagnostic {
  return {
    code: "engine.split.unsplittable",
    message:
      `A unit inside a split card is taller than a page (or leaves no room for the card's own ` +
      `foot), so that card stays as the browser breaks it.`,
  };
}

/**
 * Measured split — the DOM half, shared by the viewer (which measures and
 * decides) and the compiler agent (which replays the recorded ops on the page
 * that prints). One implementation, so the two pages cannot build different
 * documents from the same ops. Policy is in `shared/split.ts`.
 *
 * Markup contract (what an author or extension emits):
 *   card      data-gp-split="<selector of the flow element>"   required
 *             data-gp-split-scope="<id>"      cards that share a flow
 *             data-gp-split-cut="<class>"     added to a part that continues
 *   inside    <template data-gp-split-head>   the continuation's root element,
 *                                             with an empty [data-gp-flow]
 *   units     p, div, ... one unit each; ul/ol by li; table by tr (one tbody,
 *             no tfoot; thead is copied); a block with
 *             data-gp-split-units="<sel>" by its matching children, and
 *             data-gp-split-repeat="<sel>" children copied onto each part;
 *             data-gp-nosplit keeps a block whole.
 */
import {
  SPLIT_CSS,
  sameWords,
  wordsOf,
  type SplitDiagnostic,
  type SplitIds,
  type SplitKind,
  type SplitOp,
} from "../shared/split.ts";

export const CARD_SELECTOR = "[data-gp-split]";
const CONT = "data-gp-split-cont";
const JOIN = "data-gp-split-join";
const COPY = "data-gp-split-copy";

export interface SplitUnit {
  el: Element;
  /** the last row of a group a `rowspan` ties together; absent for a single element */
  last?: Element;
  /** the flow child this unit belongs to */
  block: Element;
  kind: SplitKind;
}

export function ensureSplitCss(doc: Document = document): void {
  if (doc.getElementById("gp-split-css")) return;
  const style = doc.createElement("style");
  style.id = "gp-split-css";
  style.textContent = SPLIT_CSS;
  doc.head.appendChild(style);
}

export function cardsOf(root: ParentNode = document): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(CARD_SELECTOR));
}

export function scopeOf(card: Element): string {
  return card.getAttribute("data-gp-split-scope") ?? "";
}

export function isContinuation(card: Element): boolean {
  return card.hasAttribute(CONT);
}

/** The element whose children are the card's units, or null if the selector finds none. */
export function flowOf(card: Element): Element | null {
  const sel = card.getAttribute("data-gp-split");
  if (!sel) return null;
  try {
    return card.querySelector(sel);
  } catch {
    return null;
  }
}

function templateOf(card: Element): HTMLTemplateElement | null {
  return card.querySelector<HTMLTemplateElement>("template[data-gp-split-head]");
}

function childrenMatching(parent: Element, sel: string): Element[] {
  return Array.from(parent.children).filter((c) => {
    try {
      return c.matches(sel);
    } catch {
      return false;
    }
  });
}

/** The units of a flow, in document order; the index here is the op's `unit`. */
export function unitsOf(flow: Element): SplitUnit[] {
  const out: SplitUnit[] = [];
  for (const block of Array.from(flow.children)) {
    if (block.tagName === "GP-ANCHOR" || block.tagName === "TEMPLATE") continue;
    const whole = (): void => void out.push({ el: block, block, kind: "block" });
    if (block.hasAttribute("data-gp-nosplit")) {
      whole();
      continue;
    }
    const declared = block.getAttribute("data-gp-split-units");
    let units: Element[] = [];
    const groups: Array<{ el: Element; last?: Element }> = [];
    let kind: SplitKind = "unit";
    if (declared) units = childrenMatching(block, declared);
    else if ((block.tagName === "UL" || block.tagName === "OL") && !block.hasAttribute("reversed")) {
      units = childrenMatching(block, "li");
      kind = "list-item";
    } else if (block.tagName === "TABLE") {
      const bodies = childrenMatching(block, "tbody");
      if (bodies.length === 1 && !block.querySelector(":scope > tfoot")) {
        const rows = Array.from(bodies[0]!.children).filter((r) => r.tagName === "TR");
        // a row that a `rowspan` above still covers is no cut point: it joins the unit before it
        let covered = 0;
        for (const row of rows) {
          if (covered > 0 && groups.length) groups[groups.length - 1]!.last = row;
          else {
            units.push(row);
            groups.push({ el: row });
          }
          const reach = Math.max(0, ...Array.from((row as HTMLTableRowElement).cells, (c) => c.rowSpan - 1));
          covered = Math.max(covered - 1, reach);
        }
        kind = "table-row";
      }
    }
    if (!units.length) whole();
    else if (groups.length) for (const g of groups) out.push({ ...g, block, kind });
    else for (const el of units) out.push({ el, block, kind });
  }
  return out;
}

/** What marks an element as THE one: its id and its place in the source. A copy has neither. */
function stripIds(el: Element): void {
  const bare = (e: Element) => {
    e.removeAttribute("id");
    e.removeAttribute("data-source-range");
    e.removeAttribute("data-source-line");
  };
  bare(el);
  for (const d of Array.from(el.querySelectorAll("[id], [data-source-range], [data-source-line]"))) bare(d);
}

function copyOf(el: Element): Element {
  const c = el.cloneNode(true) as Element;
  stripIds(c);
  c.setAttribute(COPY, "");
  return c;
}

/**
 * A shell for the tail of `block`, starting before unit `first`: the same tag
 * and attributes, repeated heads copied in, `first` and everything after it
 * moved across. A table's shell nests a tbody shell; an `ol` carries on its count.
 */
function tailOf(block: Element, first: Element): Element {
  const shell = block.cloneNode(false) as Element;
  stripIds(shell);
  shell.setAttribute(JOIN, "");
  let target: Element = shell;
  let from: Element = first;
  if (block.tagName === "TABLE") {
    for (const c of childrenMatching(block, "colgroup, thead")) shell.appendChild(copyOf(c));
    const body = first.parentElement!;
    target = body.cloneNode(false) as Element;
    stripIds(target);
    target.setAttribute(JOIN, "");
    shell.appendChild(target);
  } else if (block.tagName === "OL") {
    const start = parseInt(block.getAttribute("start") ?? "1", 10) || 1;
    const index = Array.from(block.children).filter((c) => c.tagName === "LI").indexOf(first);
    shell.setAttribute("start", String(start + index));
  } else {
    const repeat = block.getAttribute("data-gp-split-repeat");
    if (repeat) for (const c of childrenMatching(block, repeat)) shell.appendChild(copyOf(c));
  }
  while (from) {
    const next: Element | null = from.nextElementSibling;
    target.appendChild(from);
    if (!next) break;
    from = next;
  }
  return shell;
}

/** The continuation of `head`, past any viewer chrome (a column-break spacer) between them. */
function continuationOf(head: Element): Element | null {
  for (let n = head.nextElementSibling; n; n = n.nextElementSibling) {
    if (n.hasAttribute(CONT)) return n;
    if (!/(^|\s)gp-/.test(n.className)) return null;
  }
  return null;
}

/** Whether a card has been cut: its continuation follows it. */
export function continuationCard(card: Element): boolean {
  return continuationOf(card) !== null;
}

/** The part `cont` was cut from. */
function headOf(cont: Element): Element | null {
  for (let n = cont.previousElementSibling; n; n = n.previousElementSibling) {
    if (/(^|\s)gp-/.test(n.className)) continue;
    return n.hasAttribute("data-gp-split") ? n : null;
  }
  return null;
}

interface WordSpot {
  node: Text;
  offset: number;
  endNode: Text;
  endOffset: number;
}

/** The whitespace-separated words of a paragraph's text, as positions in its text nodes. */
function wordSpots(el: Element): WordSpot[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  const starts: number[] = [];
  let flat = "";
  for (const n of nodes) {
    starts.push(flat.length);
    flat += n.data;
  }
  const at = (g: number, inclusive: boolean): [Text, number] => {
    let i = nodes.length - 1;
    while (i > 0 && starts[i]! > (inclusive ? g : g - 1)) i--;
    return [nodes[i]!, g - starts[i]!];
  };
  return Array.from(flat.matchAll(/\S+/g), (m) => {
    const [node, offset] = at(m.index!, true);
    const [endNode, endOffset] = at(m.index! + m[0].length, false);
    return { node, offset, endNode, endOffset };
  });
}

/** One Range per word of a paragraph, for measuring where each lands. */
export function wordRanges(el: Element): Range[] {
  return wordSpots(el).map((w) => {
    const r = document.createRange();
    r.setStart(w.node, w.offset);
    r.setEnd(w.endNode, w.endOffset);
    return r;
  });
}

/**
 * Cut a paragraph before word `index`: the rest moves into a clone of the
 * paragraph (id dropped, class `gp-split-cont`) inserted after it. Partial
 * inline ancestors are cloned by the extraction, no text is trimmed. False
 * when the paragraph keeps whitespace as written or has no such word.
 */
function cutParagraphAt(p: Element, index: number): boolean {
  if (/^pre/.test(getComputedStyle(p).whiteSpace)) return false;
  const spot = wordSpots(p)[index];
  if (!spot || index < 1) return false;
  const range = document.createRange();
  range.setStart(spot.node, spot.offset);
  // a word that opens an inline element takes the element with it, not an empty clone of it
  let from: Node = spot.node;
  while (spot.offset === 0 && from.parentNode && from.parentNode !== p && !from.previousSibling)
    from = from.parentNode;
  if (from !== spot.node) range.setStartBefore(from);
  range.setEnd(p, p.childNodes.length);
  const rest = p.cloneNode(false) as Element;
  rest.setAttribute(JOIN, "");
  rest.classList.add("gp-split-cont");
  rest.appendChild(range.extractContents());
  stripIds(rest);
  p.after(rest);
  return true;
}

/** A continuation for `head`, from its template, ready to take the units; null if it has none. */
function makeContinuation(head: Element): Element | null {
  const tpl = templateOf(head);
  const root = tpl?.content.firstElementChild;
  if (!tpl || !root) return null;
  const cont = root.cloneNode(true) as Element;
  if (!cont.querySelector("[data-gp-flow]")) return null;
  stripIds(cont);
  for (const a of Array.from(head.attributes))
    if (a.name.startsWith("data-gp-split")) cont.setAttribute(a.name, a.value);
  cont.setAttribute("data-gp-split", "[data-gp-flow]");
  cont.setAttribute(CONT, "");
  cont.appendChild(tpl.cloneNode(true));
  return cont;
}

/** The words of a card's flow, not counting the heads copied onto a continuation. */
function flowWords(card: Element): string[] {
  const flow = flowOf(card);
  if (!flow) return [];
  const text: string[] = [];
  const walk = (node: Node): void => {
    for (const n of Array.from(node.childNodes)) {
      if (n.nodeType === 3) text.push(n.textContent ?? "");
      else if (n instanceof Element && !n.hasAttribute(COPY)) walk(n);
    }
  };
  walk(flow);
  return wordsOf(text.join(" "));
}

export type SplitResultKind =
  | { ok: true; cont: Element; kind: SplitKind }
  | { ok: false; diagnostic?: SplitDiagnostic };

/**
 * Cut `card` before flat unit `index` (>= 1): the units from there on move to
 * a new continuation inserted right after it, the card gains its cut class.
 * Words are checked before and after; a mismatch undoes the split.
 */
export function splitCardAt(card: Element, index: number, word?: number): SplitResultKind {
  const flow = flowOf(card);
  let units = flow ? unitsOf(flow) : [];
  let unit = units[index];
  if (!flow || !unit || (index < 1 && word === undefined)) return { ok: false };
  const cont = makeContinuation(card);
  if (!cont) {
    return {
      ok: false,
      diagnostic: {
        code: "engine.split.template",
        message:
          `A card marked data-gp-split has no usable <template data-gp-split-head> ` +
          `(one root element holding an empty [data-gp-flow]), so it stays as the browser breaks it.`,
      },
    };
  }
  const before = flowWords(card);
  let kind = unit.kind;
  if (word !== undefined) {
    // cut inside the paragraph first, then move its tail with everything after it
    if (unit.kind !== "block" || unit.el.tagName !== "P" || !cutParagraphAt(unit.el, word))
      return { ok: false };
    units = unitsOf(flow);
    index += 1;
    unit = units[index]!;
    kind = "paragraph";
  }
  const contFlow = flowOf(cont)!;
  const following: Element[] = [];
  for (let n = unit.block.nextElementSibling; n; n = n.nextElementSibling) following.push(n);
  const blockStart = units.findIndex((u) => u.block === unit.block);
  const head = blockStart === index ? unit.block : tailOf(unit.block, unit.el);
  const moved = [head, ...following];
  for (const el of moved) contFlow.appendChild(el);
  card.after(cont);
  const cut = card.getAttribute("data-gp-split-cut");
  if (cut) card.classList.add(cut);
  if (!sameWords(before, [...flowWords(card), ...flowWords(cont)])) {
    mergeBack(card);
    return {
      ok: false,
      diagnostic: {
        code: "engine.split.text-changed",
        message:
          `Splitting a card would have changed its words, so it was left as the browser breaks it.`,
      },
    };
  }
  return { ok: true, cont, kind };
}

/** Two elements that differ at most by the id or source marks a copy never carries. */
function sameShell(a: Element, b: Element): boolean {
  const x = a.cloneNode(false) as Element;
  const y = b.cloneNode(false) as Element;
  for (const e of [x, y]) {
    e.removeAttribute("id");
    e.removeAttribute("data-source-range");
    e.removeAttribute("data-source-line");
  }
  return x.isEqualNode(y);
}

/** Fold a join shell back into the part it was cut from. */
function mergeInto(target: Element, shell: Element, inline = shell.classList.contains("gp-split-cont")): void {
  while (shell.firstChild) {
    const n = shell.firstChild;
    const last = target.lastChild;
    if (n instanceof Element && n.hasAttribute(COPY)) n.remove();
    else if (n instanceof Element && n.hasAttribute(JOIN)) {
      mergeInto(target.lastElementChild!, n);
      n.remove();
    } else if (
      inline &&
      n instanceof Element &&
      last instanceof Element &&
      sameShell(last, n)
    ) {
      // an inline element the cut split in two (<em>a | b</em>) is one again
      mergeInto(last, n, true);
      n.remove();
    } else target.appendChild(n);
  }
  target.normalize();
}

/** Undo the split of `head` (the exact inverse of `splitCardAt`). */
export function mergeBack(head: Element): void {
  const cont = continuationOf(head);
  const hf = flowOf(head);
  const cf = cont ? flowOf(cont) : null;
  if (!cont || !hf || !cf) return;
  const first = cf.firstElementChild;
  if (first?.hasAttribute(JOIN)) {
    const last = Array.from(hf.children).filter((c) => c.tagName !== "GP-ANCHOR").at(-1);
    if (last) mergeInto(last, first);
    first.remove();
  }
  while (cf.firstChild) hf.appendChild(cf.firstChild);
  cont.remove();
  const cut = head.getAttribute("data-gp-split-cut");
  if (cut) head.classList.remove(cut);
}

/** Take the ids `labelContinuations` set off, so a second labelling (or an undo) leaves none behind. */
function clearLabels(root: ParentNode): void {
  for (const e of Array.from(root.querySelectorAll("[id^='gp-split-']")))
    if (/^gp-split-\d+(-head)?$/.test(e.id)) e.removeAttribute("id");
}

/** Undo every split in the document, last first so chains unwind. */
export function unsplitAll(root: ParentNode = document): number {
  const conts = Array.from(root.querySelectorAll(`[${CONT}]`)).reverse();
  for (const cont of conts) {
    const head = headOf(cont);
    if (head) mergeBack(head);
  }
  clearLabels(root);
  return conts.length;
}

/**
 * Give each continuation an id (`gp-split-1`, ...) in document order, so the
 * build can read which page it landed on. The id sits on the flow element, not
 * the card: a card that starts a page by a forced break has its destination
 * recorded on the page before in the PDF. Done once, at the end, because the
 * loop may pull a split back and the print page replays only the final ops.
 */
export function labelContinuations(root: ParentNode = document): SplitIds {
  clearLabels(root);
  const continuations: string[] = [];
  const heads: string[] = [];
  for (const cont of Array.from(root.querySelectorAll(`[${CONT}]`))) {
    const flow = flowOf(cont);
    if (!flow) continue;
    const n = continuations.length + 1;
    flow.id = `gp-split-${n}`;
    continuations.push(flow.id);
    // the part it was cut from, read through its last unit (an id of its own is kept)
    const head = headOf(cont);
    const hf = head ? flowOf(head) : null;
    const last = hf ? unitsOf(hf).at(-1)?.el : undefined;
    if (last && !last.id) last.id = `gp-split-${n}-head`;
    heads.push(last?.id ?? "");
  }
  return { continuations, heads };
}

/** Replay recorded ops in order (the print page, or a preview rebuilt from the same ops). */
export function replaySplitOps(ops: SplitOp[]): SplitIds & { failed: number } {
  ensureSplitCss();
  let failed = 0;
  for (const op of ops) {
    const card = cardsOf()[op.n];
    if (!card || !splitCardAt(card, op.unit, op.word).ok) failed++;
  }
  return { ...labelContinuations(), failed };
}

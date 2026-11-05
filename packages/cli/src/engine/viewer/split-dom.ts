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
  type SplitKind,
  type SplitOp,
} from "../shared/split.ts";

export const CARD_SELECTOR = "[data-gp-split]";
const CONT = "data-gp-split-cont";
const JOIN = "data-gp-split-join";
const COPY = "data-gp-split-copy";

export interface SplitUnit {
  el: Element;
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
    let kind: SplitKind = "unit";
    if (declared) units = childrenMatching(block, declared);
    else if ((block.tagName === "UL" || block.tagName === "OL") && !block.hasAttribute("reversed")) {
      units = childrenMatching(block, "li");
      kind = "list-item";
    } else if (block.tagName === "TABLE") {
      const bodies = childrenMatching(block, "tbody");
      if (bodies.length === 1 && !block.querySelector(":scope > tfoot")) {
        units = Array.from(bodies[0]!.children).filter((r) => r.tagName === "TR");
        kind = "table-row";
      }
    }
    if (!units.length) whole();
    else for (const el of units) out.push({ el, block, kind });
  }
  return out;
}

function stripIds(el: Element): void {
  el.removeAttribute("id");
  for (const d of Array.from(el.querySelectorAll("[id]"))) d.removeAttribute("id");
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

/** The part `cont` was cut from. */
function headOf(cont: Element): Element | null {
  for (let n = cont.previousElementSibling; n; n = n.previousElementSibling) {
    if (/(^|\s)gp-/.test(n.className)) continue;
    return n.hasAttribute("data-gp-split") ? n : null;
  }
  return null;
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
export function splitCardAt(card: Element, index: number): SplitResultKind {
  const flow = flowOf(card);
  const units = flow ? unitsOf(flow) : [];
  const unit = units[index];
  if (!flow || !unit || index < 1) return { ok: false };
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
  return { ok: true, cont, kind: unit.kind };
}

/** Fold a join shell back into the part it was cut from. */
function mergeInto(target: Element, shell: Element): void {
  while (shell.firstChild) {
    const n = shell.firstChild;
    if (n instanceof Element && n.hasAttribute(COPY)) n.remove();
    else if (n instanceof Element && n.hasAttribute(JOIN)) {
      mergeInto(target.lastElementChild!, n);
      n.remove();
    } else target.appendChild(n);
  }
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

/** Undo every split in the document, last first so chains unwind. */
export function unsplitAll(root: ParentNode = document): number {
  const conts = Array.from(root.querySelectorAll(`[${CONT}]`)).reverse();
  for (const cont of conts) {
    const head = headOf(cont);
    if (head) mergeBack(head);
  }
  return conts.length;
}

/**
 * Give each continuation an id (`gp-split-1`, ...) in document order, so the
 * build can read which page it landed on. Done once, at the end, because the
 * loop may pull a split back and the print page replays only the final ops.
 */
export function labelContinuations(root: ParentNode = document): string[] {
  return Array.from(root.querySelectorAll(`[${CONT}]`)).map((c, i) => {
    c.id = `gp-split-${i + 1}`;
    return c.id;
  });
}

/** Replay recorded ops in order (the print page, or a preview rebuilt from the same ops). */
export function replaySplitOps(ops: SplitOp[]): string[] {
  ensureSplitCss();
  for (const op of ops) {
    const card = cardsOf()[op.n];
    if (card) splitCardAt(card, op.unit);
  }
  return labelContinuations();
}

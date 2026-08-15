/**
 * Gutterpress inline-edit module (ADR 0010, Phase 2).
 *
 * Runs INSIDE the book frame, bundled separately from the viewer
 * (`gutterpress-edit.js`) and injected only by the preview server — published
 * books never carry it. Exposed as `window.GutterpressEdit`; the preview
 * bridge's protocol-v7 commands delegate here.
 *
 * The model (plan `review-the-example-html-tender-starfish`):
 *  - The paginated book DOM is the editing surface. `.gp-strip` hosts get
 *    `contenteditable`; a `beforeinput` policy confines edits to annotated
 *    content blocks (wrapper divs, chapter openers, engine artifacts, and
 *    raw-HTML islands refuse input — fail safe, never a guessed edit).
 *  - Typing mutates the DOM natively (multicol reflow is browser-native and
 *    measured at ~2ms on a 200pp strip — edit-physics.test.ts). Pagination
 *    re-settles via an idle, caret-preserving `Gutterpress.refresh()`.
 *  - A debounced autosync serializes dirty blocks (serialize.ts, the codec
 *    proven by scripts/roundtrip-gate.ts) into `{chapter, range, expected,
 *    replacement}` patch proposals, dispatched as `editPatches`. The SPA
 *    commits them through the commit engine's gates and acks back.
 *  - Source mirrors: chapter sources are fetched from the preview server
 *    (which serves project files in place) and kept in sync by applying
 *    acked patches locally; `data-source-range` attrs below an applied patch
 *    shift by its line delta so editing continues without any reload.
 *  - Converge-on-drift: after commits, the chapter is re-fetched from the
 *    (revived) `/__chapter` route, parsed with DOMParser, and compared
 *    per-block against the live DOM; only drifted blocks are healed in
 *    place, and authoritative `data-source-range` values are re-stamped.
 *    The viewer never reloads or swaps during an editing session.
 */
import {
  discoverContentBlocks,
  extractBlockModel,
  findBlockRangeAttr,
  modelsEqual,
  serializeBlock,
  type BlockNode,
  type ElementLike,
  type SerializeFeatures,
  type SerializeResult,
} from "../../lib/markdown/serialize";

// ── types ───────────────────────────────────────────────────────────────────

export interface EnableOptions {
  features?: SerializeFeatures;
  /** URL of a chapter's markdown source (default: served project file). */
  sourceUrl?: (chapter: string) => string;
  /** URL of a chapter's fresh single-file render (default: /__chapter). */
  chapterUrl?: (chapter: string) => string;
  /** Idle debounce before pagination re-settles (ms). */
  relayoutDelayMs?: number;
  /** Idle debounce before dirty blocks are serialized + proposed (ms). */
  autosyncDelayMs?: number;
}

export interface EditPatch {
  chapter: string;
  range: [number, number];
  expected: string;
  replacement: string;
}

export interface EditRefusal {
  chapter: string;
  range: [number, number];
  reason: string;
}

export interface PatchResult {
  chapter: string;
  range: [number, number];
  status: "applied" | "refused" | "failed";
  reason?: string;
}

interface DirtyEntry {
  chapter: string;
  range: [number, number];
  pristine: BlockNode | null;
}

const keyOf = (chapter: string, range: [number, number]): string =>
  `${chapter}\u0000${range[0]}:${range[1]}`;

// ── module state ────────────────────────────────────────────────────────────

let enabled = false;
let opts: Required<Pick<EnableOptions, "relayoutDelayMs" | "autosyncDelayMs">> &
  EnableOptions = { relayoutDelayMs: 300, autosyncDelayMs: 600 };

const mirrors = new Map<string, string[]>(); // chapter → source lines
/** Keyed by chapter+range, NOT element: a split block's clone shares the
 *  range, and two entries for one range would propose duplicate patches. */
const dirty = new Map<string, DirtyEntry>();
/** Last model this module committed for an element — the pristine baseline
 *  for undo-after-commit (a fresh capture would read the post-undo DOM and
 *  wrongly report "unchanged"). */
const committedModels = new WeakMap<Element, BlockNode>();
const pendingBatches = new Map<number, EditPatch[]>();
let batchCounter = 0;

let composing = false;
let relayoutTimer: ReturnType<typeof setTimeout> | undefined;
let autosyncTimer: ReturnType<typeof setTimeout> | undefined;
const verifyTimers = new Map<string, ReturnType<typeof setTimeout>>();
let hadDirty = false;
/** Heals per block (keyed by chapter+range) this session. A block that keeps
 *  drifting after its commits has a codec disagreement — degrade it to the
 *  overlay instead of letting the author fight the healer. */
const healCounts = new Map<string, number>();
const DEGRADE_AFTER_HEALS = 3;
const DEGRADED_ATTR = "data-gp-edit-degraded";

// ── small utilities ─────────────────────────────────────────────────────────

const gp = () =>
  (window as unknown as { Gutterpress?: { refresh(): void } }).Gutterpress;

function emit(name: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function newlineSplit(text: string): string[] {
  // MUST match markdown-it's line-break rule (ADR 0009 §1).
  return text.split(/\r\n?|\n/);
}

const CONTENT_TAGS = new Set([
  "P", "H1", "H2", "H3", "H4", "H5", "H6", "BLOCKQUOTE", "UL", "OL",
  "TABLE", "PRE", "HR", "DL",
]);

function parseRangeAttr(el: Element): [number, number] | null {
  const raw = findBlockRangeAttr(el as unknown as ElementLike);
  if (!raw) return null;
  const [a, b] = raw.split(":").map(Number);
  return Number.isFinite(a) && Number.isFinite(b) ? [a!, b!] : null;
}

/**
 * The commit unit containing `node`: the OUTERMOST annotated content-tag
 * ancestor (a paragraph inside a blockquote commits the blockquote; a text
 * node in a fence resolves through <code> to <pre>). Null outside any
 * editable block — wrappers, chapter openers, engine artifacts, raw HTML.
 */
function commitUnitOf(node: Node | null): Element | null {
  let unit: Element | null = null;
  let el: Element | null =
    node && node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node?.parentElement ?? null;
  for (; el; el = el.parentElement) {
    if (el.classList.contains("gp-strip")) break;
    if (CONTENT_TAGS.has(el.tagName) && parseRangeAttr(el)) unit = el;
  }
  return unit;
}

function chapterOf(el: Element): string | null {
  const holder = el.closest("[data-chapter-src]");
  return holder?.getAttribute("data-chapter-src") ?? null;
}

/** Every live element of one committed range (a split block clones its
 *  attrs, so the group shares chapter+range), in document order. */
function extentOf(entry: DirtyEntry): Element[] {
  const sel = `[data-source-range="${entry.range[0]}:${entry.range[1]}"]` +
    `[data-chapter-src="${CSS.escape(entry.chapter)}"]`;
  return [...document.querySelectorAll(sel)].filter((el) => CONTENT_TAGS.has(el.tagName));
}

// ── caret capture/restore ───────────────────────────────────────────────────

interface CaretSnapshot {
  anchorNode: Node;
  anchorOffset: number;
  focusNode: Node;
  focusOffset: number;
}

function captureCaret(): CaretSnapshot | null {
  const sel = getSelection();
  if (!sel || !sel.anchorNode || !sel.focusNode) return null;
  return {
    anchorNode: sel.anchorNode,
    anchorOffset: sel.anchorOffset,
    focusNode: sel.focusNode,
    focusOffset: sel.focusOffset,
  };
}

function restoreCaret(c: CaretSnapshot | null): void {
  if (!c || !c.anchorNode.isConnected || !c.focusNode.isConnected) return;
  try {
    getSelection()?.setBaseAndExtent(
      c.anchorNode,
      Math.min(c.anchorOffset, lengthOf(c.anchorNode)),
      c.focusNode,
      Math.min(c.focusOffset, lengthOf(c.focusNode)),
    );
  } catch {
    // A restore that fails only loses the caret, never content.
  }
}

function lengthOf(n: Node): number {
  return n.nodeType === Node.TEXT_NODE ? (n as Text).length : n.childNodes.length;
}

// ── editability ─────────────────────────────────────────────────────────────

function applyEditability(): void {
  for (const strip of document.querySelectorAll<HTMLElement>(".gp-strip")) {
    strip.contentEditable = enabled ? "true" : "inherit";
    if (enabled) strip.spellcheck = false;
  }
}

/** Caret-preserving pagination re-settle; deferred while composing. */
function safeRelayout(): void {
  if (composing) {
    scheduleRelayout();
    return;
  }
  const caret = captureCaret();
  gp()?.refresh(); // dispatches gp:relayout → applyEditability re-runs
  restoreCaret(caret);
}

function scheduleRelayout(): void {
  clearTimeout(relayoutTimer);
  relayoutTimer = setTimeout(safeRelayout, opts.relayoutDelayMs);
}

// ── source mirrors ──────────────────────────────────────────────────────────

async function mirrorOf(chapter: string): Promise<string[] | null> {
  const cached = mirrors.get(chapter);
  if (cached) return cached;
  const url = opts.sourceUrl?.(chapter) ?? `/${chapter}`;
  try {
    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) return null;
    const lines = newlineSplit(await res.text());
    mirrors.set(chapter, lines);
    return lines;
  } catch {
    return null;
  }
}

function sliceOf(lines: string[], range: [number, number]): string {
  return lines.slice(range[0], range[1]).join("\n");
}

// ── dirty tracking ──────────────────────────────────────────────────────────

function ensureTracked(el: Element): void {
  const chapter = chapterOf(el);
  const range = parseRangeAttr(el);
  if (!chapter || !range) return;
  const key = keyOf(chapter, range);
  if (dirty.has(key)) return;
  let pristine: BlockNode | null = committedModels.get(el) ?? null;
  if (!pristine) {
    try {
      pristine = extractBlockModel(el as unknown as ElementLike, { features: opts.features });
    } catch {
      pristine = null; // unextractable pristine — serialization will refuse
    }
  }
  dirty.set(key, { chapter, range, pristine });
  void mirrorOf(chapter); // warm the mirror before autosync needs it
}

function markDirtyFromSelection(): void {
  const unit = commitUnitOf(getSelection()?.anchorNode ?? null);
  if (unit) ensureTracked(unit);
}

// ── input policy ────────────────────────────────────────────────────────────

function unitsOfEvent(ev: InputEvent): Element[] | null {
  const ranges = ev.getTargetRanges();
  const nodes: (Node | null)[] = ranges.length
    ? ranges.flatMap((r) => [r.startContainer, r.endContainer])
    : [getSelection()?.anchorNode ?? null, getSelection()?.focusNode ?? null];
  const units: Element[] = [];
  for (const node of nodes) {
    const unit = commitUnitOf(node);
    if (!unit) return null; // any endpoint outside an editable block → refuse
    if (unit.hasAttribute(DEGRADED_ATTR)) return null; // overlay-only block
    if (!units.includes(unit)) units.push(unit);
  }
  return units;
}

function onBeforeInput(ev: InputEvent): void {
  if (!enabled) return;

  if (ev.inputType === "insertFromDrop") {
    ev.preventDefault(); // v1: no drag/drop
    return;
  }

  const units = unitsOfEvent(ev);
  if (!units || units.length === 0) {
    ev.preventDefault();
    return;
  }
  // Cross-chapter edits would need multi-file structural commits — refuse.
  const chapters = new Set(units.map((u) => chapterOf(u)));
  if (chapters.size > 1) {
    ev.preventDefault();
    return;
  }
  for (const unit of units) ensureTracked(unit);

  if (ev.inputType === "insertFromPaste") {
    ev.preventDefault();
    const text = ev.dataTransfer?.getData("text/plain");
    // Plain-text re-insert flows through a fresh (allowed) insertText.
    if (text) document.execCommand("insertText", false, text);
  }
}

function onInput(ev: InputEvent): void {
  if (!enabled) return;
  // History events carry no target ranges; resolve from the selection.
  if (ev.inputType === "historyUndo" || ev.inputType === "historyRedo") {
    markDirtyFromSelection();
  }
  if (!hadDirty && dirty.size) {
    hadDirty = true;
    emit("editStateChanged", { dirty: true });
  }
  scheduleRelayout();
  scheduleAutosync();
}

// ── serialization + patch proposals ─────────────────────────────────────────

function scheduleAutosync(): void {
  clearTimeout(autosyncTimer);
  autosyncTimer = setTimeout(() => void autosync(), opts.autosyncDelayMs);
}

/** Serialize one dirty entry against its source slice. A split block (extent
 *  length > 1) serializes each clone and joins with blank lines; the slice's
 *  trailing blank-line run is preserved exactly once. */
function serializeEntry(entry: DirtyEntry, slice: string): SerializeResult {
  const extent = extentOf(entry);
  const options = { features: opts.features };
  if (extent.length === 0) {
    // The whole block was deleted; keep the boundary blanks so neighbors
    // don't merge (serialize.ts's trailing-blank rule, inverted).
    const run = /(?:\n[ \t]*)+$/.exec(slice);
    return { kind: "replacement", text: run ? run[0].replace(/^\n/, "") : "" };
  }
  if (extent.length === 1) {
    return serializeBlock({
      edited: extent[0] as unknown as ElementLike,
      pristineModel: entry.pristine,
      originalSlice: slice,
      options,
    });
  }
  // Split: serialize each piece against a blank-stripped slice, re-append the
  // original trailing run once. Footnote labels can't be attributed across
  // pieces — refuse those.
  if (/\[\^/.test(slice)) {
    return { kind: "refused", reason: "split a block containing footnote refs" };
  }
  const bare = slice.replace(/(?:\n[ \t]*)+$/, "");
  const parts: string[] = [];
  for (let i = 0; i < extent.length; i++) {
    const res = serializeBlock({
      edited: extent[i] as unknown as ElementLike,
      pristineModel: null,
      originalSlice: i === 0 ? bare : "",
      options,
    });
    if (res.kind !== "replacement") {
      return res.kind === "refused" ? res : { kind: "refused", reason: "empty split piece" };
    }
    parts.push(res.text);
  }
  const run = /(?:\n[ \t]*)+$/.exec(slice);
  return { kind: "replacement", text: parts.join("\n\n") + (run ? run[0] : "") };
}

async function autosync(): Promise<void> {
  if (!enabled || composing) {
    if (composing) scheduleAutosync();
    return;
  }
  const patches: EditPatch[] = [];
  const refusals: EditRefusal[] = [];

  for (const [key, entry] of [...dirty.entries()]) {
    const lines = await mirrorOf(entry.chapter);
    if (!lines) {
      refusals.push({ chapter: entry.chapter, range: entry.range, reason: "source unavailable" });
      dirty.delete(key);
      continue;
    }
    const slice = sliceOf(lines, entry.range);
    const res = serializeEntry(entry, slice);
    if (res.kind === "unchanged") {
      dirty.delete(key);
      continue;
    }
    if (res.kind === "refused") {
      dirty.delete(key);
      refusals.push({ chapter: entry.chapter, range: entry.range, reason: res.reason });
      continue;
    }
    if (res.text === slice) {
      dirty.delete(key); // byte-identical — nothing to write
      continue;
    }
    patches.push({
      chapter: entry.chapter,
      range: entry.range,
      expected: slice,
      replacement: res.text,
    });
  }

  if (!patches.length && !refusals.length) {
    if (hadDirty && dirty.size === 0) {
      hadDirty = false;
      emit("editStateChanged", { dirty: false });
    }
    return;
  }
  const batchId = ++batchCounter;
  if (patches.length) pendingBatches.set(batchId, patches);
  emit("editPatches", { batchId, patches, refusals });
}

// ── acks: mirror update + range shifting ────────────────────────────────────

function shiftRangesBelow(chapter: string, fromLine: number, delta: number): void {
  if (!delta) return;
  for (const el of document.querySelectorAll(
    `[data-source-range][data-chapter-src="${CSS.escape(chapter)}"]`,
  )) {
    const range = parseRangeAttr(el);
    if (!range || range[0] < fromLine) continue;
    el.setAttribute("data-source-range", `${range[0] + delta}:${range[1] + delta}`);
  }
}

export function ackPatches(spec: { batchId: number; results: PatchResult[] }): void {
  const batch = pendingBatches.get(spec.batchId) ?? [];
  pendingBatches.delete(spec.batchId);

  for (const result of spec.results) {
    const patch = batch.find(
      (p) => p.chapter === result.chapter &&
        p.range[0] === result.range[0] && p.range[1] === result.range[1],
    );
    if (!patch || result.status !== "applied") continue; // failed/refused: stays dirty on next edit

    const lines = mirrors.get(patch.chapter);
    if (lines) {
      const replacementLines = patch.replacement === "" ? [] : newlineSplit(patch.replacement);
      lines.splice(patch.range[0], patch.range[1] - patch.range[0], ...replacementLines);
      const delta = replacementLines.length - (patch.range[1] - patch.range[0]);
      // Committed extent keeps its start; everything below shifts.
      const extent = document.querySelectorAll(
        `[data-source-range="${patch.range[0]}:${patch.range[1]}"]` +
          `[data-chapter-src="${CSS.escape(patch.chapter)}"]`,
      );
      shiftRangesBelow(patch.chapter, patch.range[1], delta);
      const newEnd = patch.range[0] + replacementLines.length;
      for (const el of extent) {
        el.setAttribute("data-source-range", `${patch.range[0]}:${newEnd}`);
        if (CONTENT_TAGS.has(el.tagName)) {
          try {
            committedModels.set(
              el,
              extractBlockModel(el as unknown as ElementLike, { features: opts.features }),
            );
          } catch {
            committedModels.delete(el);
          }
        }
      }
      dirty.delete(keyOf(patch.chapter, patch.range));
    }
    scheduleVerify(patch.chapter);
  }
  if (hadDirty && dirty.size === 0) {
    hadDirty = false;
    emit("editStateChanged", { dirty: false });
  }
}

// ── converge-on-drift verifier ──────────────────────────────────────────────

function scheduleVerify(chapter: string): void {
  clearTimeout(verifyTimers.get(chapter));
  verifyTimers.set(
    chapter,
    setTimeout(() => void verifyChapter({ chapter }), 1500),
  );
}

export async function verifyChapter(spec: {
  chapter: string;
}): Promise<{
  healed: number;
  mismatch?: string;
  degraded?: Array<{ chapter: string; range: [number, number] }>;
}> {
  const chapter = spec.chapter;
  verifyTimers.delete(chapter);
  if (!enabled) return { healed: 0 };

  // Authoritative source + render, straight from the preview server.
  mirrors.delete(chapter);
  const [lines, res] = await Promise.all([
    mirrorOf(chapter),
    fetch(opts.chapterUrl?.(chapter) ?? `/__chapter?file=${encodeURIComponent(chapter)}`, {
      cache: "no-store",
    }).catch(() => null),
  ]);
  if (!lines || !res?.ok) return { healed: 0, mismatch: "fetch failed" };

  const fresh = new DOMParser().parseFromString(await res.text(), "text/html");
  const freshBlocks = discoverContentBlocks(fresh.body as unknown as ElementLike) as unknown as Element[];
  const liveBlocks = (
    discoverContentBlocks(document.body as unknown as ElementLike, {
      skip: (el) =>
        (el as unknown as Element).classList?.contains("gp-layer") ?? false,
    }) as unknown as Element[]
  ).filter((el) => chapterOf(el) === chapter);

  if (freshBlocks.length !== liveBlocks.length) {
    const detail = { chapter, healed: 0, mismatch: "block count" };
    emit("editDrift", detail);
    return detail;
  }

  let healed = 0;
  const degraded: Array<{ chapter: string; range: [number, number] }> = [];
  const options = { features: opts.features };
  for (let i = 0; i < freshBlocks.length; i++) {
    const live = liveBlocks[i]!;
    const freshEl = freshBlocks[i]!;
    // Authoritative re-annotation, drifted or not.
    const freshRange = findBlockRangeAttr(freshEl as unknown as ElementLike);
    if (freshRange) live.setAttribute("data-source-range", freshRange);

    const liveRange = parseRangeAttr(live);
    const liveChapter = chapterOf(live);
    if (liveRange && liveChapter && dirty.has(keyOf(liveChapter, liveRange))) {
      continue; // uncommitted edits — never heal over them
    }
    if (live.contains(getSelection()?.anchorNode ?? null)) continue; // deferred while focused

    let same = false;
    try {
      same = modelsEqual(
        extractBlockModel(live as unknown as ElementLike, options),
        extractBlockModel(freshEl as unknown as ElementLike, options),
      );
    } catch {
      continue; // unextractable on either side — overlay territory, not healable
    }
    if (!same) {
      const imported = document.importNode(freshEl, true) as Element;
      const healKey = freshRange ? keyOf(chapter, freshRange.split(":").map(Number) as [number, number]) : null;
      const heals = healKey ? (healCounts.get(healKey) ?? 0) + 1 : 1;
      if (healKey) healCounts.set(healKey, heals);
      if (heals >= DEGRADE_AFTER_HEALS) {
        imported.setAttribute(DEGRADED_ATTR, "");
        const range = parseRangeAttr(imported);
        if (range) degraded.push({ chapter, range });
      }
      live.replaceWith(imported);
      committedModels.delete(live);
      healed++;
    }
  }
  if (healed) safeRelayout();
  const detail = { chapter, healed, degraded };
  emit("editDrift", detail);
  return detail;
}

// ── selection state (for the Phase 4 formatting chrome) ─────────────────────

export function getSelectionState(): {
  collapsed: boolean;
  rects: Array<{ top: number; left: number; width: number; height: number }>;
  formats: { strong: boolean; em: boolean; s: boolean; code: boolean };
  block: { chapter: string; range: [number, number]; tag: string } | null;
} {
  const sel = getSelection();
  const empty = {
    collapsed: true,
    rects: [],
    formats: { strong: false, em: false, s: false, code: false },
    block: null,
  };
  if (!sel || sel.rangeCount === 0) return empty;
  const range = sel.getRangeAt(0);
  const unit = commitUnitOf(sel.anchorNode);
  const anchorEl =
    sel.anchorNode?.nodeType === Node.ELEMENT_NODE
      ? (sel.anchorNode as Element)
      : sel.anchorNode?.parentElement ?? null;
  const has = (selector: string) => anchorEl?.closest(selector) != null;
  return {
    collapsed: sel.isCollapsed,
    rects: [...range.getClientRects()].map((r) => ({
      top: r.top, left: r.left, width: r.width, height: r.height,
    })),
    formats: { strong: has("strong,b"), em: has("em,i"), s: has("s,del"), code: has("code") },
    block: unit
      ? {
          chapter: chapterOf(unit) ?? "",
          range: parseRangeAttr(unit) ?? [0, 0],
          tag: unit.tagName.toLowerCase(),
        }
      : null,
  };
}

// ── lifecycle ───────────────────────────────────────────────────────────────

/**
 * Cross-strip caret hop: each `.gp-strip` is its own contenteditable host,
 * so the caret cannot leave a strip natively. Detection over boundary math:
 * let the browser attempt the arrow move; if the selection did not move and
 * a neighboring strip exists in that direction, place the caret at its
 * nearest text position. (Backspace/Delete across a strip boundary stays a
 * native no-op — deliberate v1: no cross-page-run merges.)
 */
function onKeyDown(ev: KeyboardEvent): void {
  if (!enabled || composing) return;
  const forward = ev.key === "ArrowRight" || ev.key === "ArrowDown";
  const backward = ev.key === "ArrowLeft" || ev.key === "ArrowUp";
  if ((!forward && !backward) || ev.shiftKey || ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const sel = getSelection();
  if (!sel?.isCollapsed || !sel.anchorNode) return;
  const strip = (sel.anchorNode.parentElement ?? (sel.anchorNode as Element))?.closest?.(".gp-strip");
  if (!strip) return;
  const before = { node: sel.anchorNode, offset: sel.anchorOffset };
  setTimeout(() => {
    const after = getSelection();
    if (!after?.isCollapsed || after.anchorNode !== before.node || after.anchorOffset !== before.offset) {
      return; // the browser moved it — no hop needed
    }
    const strips = [...document.querySelectorAll(".gp-strip")];
    const idx = strips.indexOf(strip);
    const target = strips[idx + (forward ? 1 : -1)];
    if (!target) return;
    const walker = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: (n) =>
        (n as Text).data.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT,
    });
    let node: Text | null = null;
    if (forward) {
      node = walker.nextNode() as Text | null;
    } else {
      for (let t = walker.nextNode(); t; t = walker.nextNode()) node = t as Text;
    }
    if (!node) return;
    after.setBaseAndExtent(node, forward ? 0 : node.length, node, forward ? 0 : node.length);
    node.parentElement?.scrollIntoView({ block: "nearest" });
  }, 0);
}

function onCompositionStart(): void {
  composing = true;
}
function onCompositionEnd(): void {
  composing = false;
  markDirtyFromSelection();
  scheduleRelayout();
  scheduleAutosync();
}
function onRelayout(): void {
  if (enabled) applyEditability();
}
function onDragStart(ev: Event): void {
  if (enabled) ev.preventDefault(); // v1: no drags out of/within the book
}

export function enable(options: EnableOptions = {}): boolean {
  opts = { relayoutDelayMs: 300, autosyncDelayMs: 600, ...options };
  if (!enabled) {
    enabled = true;
    try {
      // Enter must split a <p> into another <p> (Chromium's default block
      // separator is <div>, which the closed-set serializer refuses).
      document.execCommand("defaultParagraphSeparator", false, "p");
    } catch {
      // Non-fatal: the beforeinput policy still refuses bad structures.
    }
    document.addEventListener("beforeinput", onBeforeInput as EventListener, true);
    document.addEventListener("input", onInput as EventListener, true);
    document.addEventListener("compositionstart", onCompositionStart, true);
    document.addEventListener("compositionend", onCompositionEnd, true);
    document.addEventListener("dragstart", onDragStart, true);
    document.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("gp:relayout", onRelayout);
  }
  applyEditability();
  return true;
}

export function disable(): void {
  if (!enabled) return;
  enabled = false;
  document.removeEventListener("beforeinput", onBeforeInput as EventListener, true);
  document.removeEventListener("input", onInput as EventListener, true);
  document.removeEventListener("compositionstart", onCompositionStart, true);
  document.removeEventListener("compositionend", onCompositionEnd, true);
  document.removeEventListener("dragstart", onDragStart, true);
  document.removeEventListener("keydown", onKeyDown, true);
  window.removeEventListener("gp:relayout", onRelayout);
  clearTimeout(relayoutTimer);
  clearTimeout(autosyncTimer);
  for (const t of verifyTimers.values()) clearTimeout(t);
  verifyTimers.clear();
  dirty.clear();
  pendingBatches.clear();
  applyEditability();
}

export const isEnabled = (): boolean => enabled;

/** Synchronous "propose everything now" — the shell calls this before an
 *  external-change swap so sub-debounce keystrokes aren't lost. */
export function flushPatches(): Promise<void> {
  clearTimeout(autosyncTimer);
  return autosync();
}

// IIFE global for the bundle.
(window as unknown as { GutterpressEdit: unknown }).GutterpressEdit = {
  enable,
  disable,
  isEnabled,
  ackPatches,
  verifyChapter,
  getSelectionState,
  flushPatches,
};

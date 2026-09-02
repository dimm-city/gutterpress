/**
 * The attributes the pipeline left on an authored block, put back on the
 * elements the editor builds for it.
 *
 * A plugin that wraps rather than rewrites leaves the author's heading a
 * heading and adds a class to it, or a `data-tier`; leaves the author's
 * table a table and marks each row's tier on the row. The printed page is
 * styled through those attributes and the editor renders the block from
 * source without them. The projection carries each one keyed by the
 * block's evidence range and the path to the element inside the block
 * (`GutterpressProjection.blockAttributes`), and this applies them to the
 * block the fork built for the same source text — matched by exact text,
 * the way every other projected block is, so an edit elsewhere in the
 * document never moves it. Two blocks with the same text cannot be told
 * apart: they get the attributes only when the pipeline gave both the
 * same ones (a skill card's heading repeated for its continuation, one
 * outcome ladder pasted into several cards), and nothing when the two
 * differ, rather than each other's.
 */
import type { GutterpressProjection } from "gutterpress/render";

export interface PipelineAttributeEntry {
  /** Empty for the block's own element, else a child path of `tag:nth-of-type(n)` steps below it. */
  readonly path: string;
  readonly attributes: Readonly<Record<string, string>>;
}

/** One block's entries, with where the block starts - what tells two blocks with the same text apart. */
export interface PipelineAttributeBlock {
  readonly from: number;
  readonly entries: readonly PipelineAttributeEntry[];
}

export type PipelineAttributeIndex = ReadonlyMap<string, readonly PipelineAttributeBlock[]>;

export function buildPipelineAttributeIndex(projection: GutterpressProjection, source: string): PipelineAttributeIndex {
  const index = new Map<string, { from: number; entries: PipelineAttributeEntry[] }[]>();
  for (const block of projection.blockAttributes ?? []) {
    const key = source.slice(block.from, block.to).trimEnd();
    if (!key) continue;
    const blocks = index.get(key) ?? [];
    let own = blocks.find((b) => b.from === block.from);
    if (!own) {
      own = { from: block.from, entries: [] };
      blocks.push(own);
    }
    own.entries.push({ path: block.path, attributes: block.attributes });
    index.set(key, blocks);
  }
  return index;
}

/**
 * The entries for the block at `sourceText`: the one block with that text,
 * the nearest of several when the editor says where this one starts, or -
 * with no position to go by - what they all share, and nothing when they
 * differ, rather than each other's.
 */
export function pickPipelineAttributes(
  index: PipelineAttributeIndex,
  sourceText: string,
  absoluteStart?: number,
): readonly PipelineAttributeEntry[] | undefined {
  const blocks = index.get(sourceText.trimEnd());
  if (!blocks?.length) return undefined;
  if (blocks.length === 1) return blocks[0]!.entries;
  if (absoluteStart !== undefined) {
    let best = blocks[0]!;
    for (const b of blocks) if (Math.abs(b.from - absoluteStart) < Math.abs(best.from - absoluteStart)) best = b;
    return best.entries;
  }
  const [first, ...rest] = blocks;
  return rest.every((b) => sameEntries(b.entries, first!.entries)) ? first!.entries : undefined;
}

function sameEntries(a: readonly PipelineAttributeEntry[], b: readonly PipelineAttributeEntry[]): boolean {
  if (a.length !== b.length) return false;
  const serialize = (e: PipelineAttributeEntry) => e.path + "|" + JSON.stringify(Object.entries(e.attributes).sort());
  const bs = b.map(serialize).sort();
  return a.map(serialize).sort().every((s, i) => s === bs[i]);
}

/** `decorateInactiveBlock` half: apply the pipeline's attributes for this block's source text. */
export function applyPipelineAttributes(element: HTMLElement, sourceText: string, index: PipelineAttributeIndex, absoluteStart?: number): void {
  const entries = pickPipelineAttributes(index, sourceText, absoluteStart);
  if (!entries) return;
  // The fork mounts a table inside a scroll box and hands the box over; the
  // book's attributes are on the table and the elements inside it.
  const root = element.classList.contains("md-table-wrapper") ? (element.querySelector("table") ?? element) : element;
  for (const { path, attributes } of entries) {
    // An element the editor's rendering of the block does not have at that
    // path (a table's body rows before the reader's view groups them) gets
    // nothing, never a neighbour's attributes.
    const target = path ? root.querySelector(`:scope > ${path}`) : root;
    if (!target) continue;
    for (const [name, value] of Object.entries(attributes)) {
      if (name === "class") {
        for (const cls of value.split(/\s+/).filter(Boolean)) target.classList.add(cls);
      } else if (!/^on/i.test(name)) {
        target.setAttribute(name, value);
      }
    }
  }
}

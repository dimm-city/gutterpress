/**
 * SFE-P2b Lane B — `createGutterpressBlockProvider`: the bridge from a
 * `GutterpressProjection` (D6, `gutterpress/render`) to the fork's
 * `renderCustomBlock` seam (P1b2, `BlockViewOptions.renderCustomBlock`).
 *
 * IMPORT-BOUNDARY NOTE (D5: "No application code outside
 * packages/editor/src/vscode-adapter/ may import package internals"): this
 * file imports `BlockAstNode`/`CustomBlockRendering` as TYPE-ONLY
 * (`import type`, erased at build — `verbatimModuleSyntax` enforces this)
 * directly from `@dimm-city/vscode-markdown-editor`, not via
 * `../vscode-adapter/index.ts` (which does not currently re-export them —
 * verified by reading that file). This is a deliberate, narrow read of D5:
 * the rule's own text and its "mandatory compatibility cases" list (case 4:
 * "custom inactive Gutterpress block rendering" — exactly this deliverable)
 * govern the ADOPTED ADAPTER's *construction* boundary — not building a
 * second `EditorModel`/`EditorView`/`EditorController` wiring outside
 * `vscode-adapter/`. A type-only import of the package's own PUBLIC surface
 * (these three interfaces are exported at the top level of
 * `dist/index.d.ts`, not reached through some internal subpath) carries
 * zero runtime coupling and constructs nothing — it only names the shape
 * `EditorViewOptions.renderCustomBlock` already requires any implementation
 * to have. The alternative (adding these re-exports to
 * `vscode-adapter/index.ts`) would require writing a file outside this
 * lane's write ownership (`packages/editor/src/vscode-adapter/**` is
 * explicitly out of bounds for SFE-P2b Lane B). Recorded here explicitly
 * per this run's "record every design decision" instruction, for a
 * reviewer to evaluate.
 *
 * MATCHING (G-05): delegated entirely to `match.ts` — see that file's
 * header for the exact-range-anchored (not fuzzy) design.
 *
 * STALENESS (G-11): `opts.isStale` is a LIVE callback, not a value baked in
 * at construction — the mounted document's version can advance (an
 * accepted edit) at any point after this provider is built, without a new
 * projection being built to match. `renderCustomBlock` checks it FIRST,
 * before any matching or DOM work, so a stale projection falls through to
 * `undefined` (the fork's own default rendering) for EVERY block, never a
 * chip built from now-outdated ranges. `needsRefresh` is exposed
 * separately as a plain, pull-based query (`match.ts`'s
 * `projectionNeedsRefresh`) so a host can decide WHEN to rebuild the
 * projection and remount, independent of the push-style `isStale` gate
 * used internally. `projectionNeedsRefresh` also folds in D13's `limited`
 * flag (a block-count-capped projection is stale-equivalent by that
 * module's own contract) — this provider does not duplicate that check.
 */
import type { BlockAstNode, BlockGroupCandidate, BlockGroupSpec, CustomBlockRendering } from "@dimm-city/vscode-markdown-editor";
import { markerElementAttributes, parseMarkerLine } from "gutterpress/render";
import type { GutterpressProjection, ProjectedBlock, ProjectedBlockKind } from "gutterpress/render";
import { buildBlockIndex, matchProjectedBlock, projectionNeedsRefresh, type BlockIndex } from "./match.ts";
import { buildChipPlan } from "./plan.ts";
import { renderChipPlan, renderCloseMarkerChip } from "./render-chip.ts";

export interface CreateGutterpressBlockProviderOptions {
  readonly source: string;
  readonly ownerDocument: Document;
  /**
   * G-11 — LIVE staleness gate (see this file's header). Checked FIRST in
   * `renderCustomBlock`, before any classification or DOM work, so a stale
   * or D13-capped projection renders no chip at all and every block falls
   * through to the fork's own default view.
   */
  readonly isStale?: () => boolean;
}

export interface GutterpressBlockProvider {
  readonly renderCustomBlock: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
  /** Fork Patch 3 hook: the container runs (`@section`…`@end-section`, `@page`, `@spread`, `@chapter` scopes) to mount inside real `div.section`/`div.page`/… wrappers carrying the print pipeline's own classes and attributes. */
  readonly groupBlocks: (blocks: readonly BlockGroupCandidate[]) => readonly BlockGroupSpec[] | undefined;
  readonly needsRefresh: (currentVersion: number) => boolean;
}

type ContainerKind = "chapter" | "spread" | "page" | "section";
const CONTAINER_KINDS: ReadonlySet<string> = new Set(["chapter", "spread", "page", "section"]);

/**
 * Which opener kinds close an open scope of a given kind — markers.js's own
 * scope cascade (chapter ⊃ spread ⊃ page ⊃ section): opening an outer or
 * sibling scope closes everything inside it. `@end-section` closes the
 * innermost section explicitly; the other kinds have no explicit closer.
 */
const CLOSED_BY: Readonly<Record<ContainerKind, ReadonlySet<string>>> = {
  chapter: new Set(["chapter"]),
  spread: new Set(["chapter", "spread"]),
  page: new Set(["chapter", "spread", "page"]),
  section: new Set(["chapter", "spread", "page", "section"]),
};

interface ParsedMarker {
  readonly kind: string;
  readonly name: string | null;
  readonly attrs: Record<string, string>;
}

/**
 * Marker lines are classified from TEXT with the pipeline's own grammar
 * (`parseMarkerLine`, the exact function `layout_transform` runs), never
 * from a projection snapshot: the editor's document changes on every
 * keystroke and a marker must keep rendering as a marker through all of
 * them. A marker is a single-line paragraph whose first character is `@`.
 */
function markerOf(node: { readonly kind: string } | undefined, sourceText: string): ParsedMarker | null {
  if (node && node.kind !== "paragraph") return null;
  const line = sourceText.trim();
  if (!line.startsWith("@") || line.includes("\n")) return null;
  return parseMarkerLine(line) as ParsedMarker | null;
}

const scopeKindOf = (marker: ParsedMarker): string => (marker.kind === "continue" ? "section" : marker.kind);

function mergeClass(existing: string | undefined, extra: string): string {
  const classes = (existing ?? "").split(/\s+/).filter(Boolean);
  if (extra && !classes.includes(extra)) classes.push(extra);
  return classes.join(" ");
}

export function createGutterpressBlockProvider(
  projection: GutterpressProjection,
  opts: CreateGutterpressBlockProviderOptions,
): GutterpressBlockProvider {
  const index: BlockIndex = buildBlockIndex(projection, opts.source);
  /** AST ids of this render's top-level blocks, from `groupBlocks`. */
  let topLevel: ReadonlySet<number> = new Set();

  function renderCustomBlock(node: BlockAstNode, sourceText: string): CustomBlockRendering | undefined {
    // G-11 FIRST, before classification: a projection whose `sourceVersion`
    // the document has moved past — or one D13 capped — describes a document
    // that no longer exists, so it renders nothing at all rather than a chip
    // whose generated preview would be showing outdated output.
    if (opts.isStale?.()) return undefined;

    // Only a TOP-LEVEL paragraph can be a marker: the pipeline's own
    // `layout_transform` transforms nothing nested inside a blockquote or a
    // list item, so a marker-looking line there is plain text in the book
    // and must stay plain text here. `groupBlocks` is handed exactly the
    // top-level blocks, and the fork calls it before it builds any view
    // (fork Patch 3), so this set is populated by the time this runs.
    const marker = topLevel.has(node.id) ? markerOf(node, sourceText) : null;
    if (marker) {
      if (marker.kind === "end-section") return renderCloseMarkerChip(opts.ownerDocument, sourceText);
      // The projection is still the authority when it recognizes this exact
      // line: it carries the pipeline's own generated views (a `@page`
      // marker's chapter-opener, for instance), which text alone cannot
      // produce. Text classification is the FALLBACK, for a marker the
      // author has just typed or edited — the case the projection cannot
      // describe because it predates the edit.
      const match = matchProjectedBlock(index, sourceText);
      const kind = scopeKindOf(marker) as ProjectedBlockKind;
      const block: ProjectedBlock = match?.block ?? {
        id: `marker:${kind}`,
        kind,
        from: 0,
        to: sourceText.length,
        editMode: "structured",
        viewAttributes: markerElementAttributes(marker),
      };
      return renderChipPlan(buildChipPlan(block, match?.generatedPreviews ?? [], sourceText), opts.ownerDocument);
    }

    // Plugin regions and raw HTML still come from the projection (they need
    // the pipeline's own rendering); matched by exact text, so an edit
    // elsewhere in the document never un-renders them.
    const match = matchProjectedBlock(index, sourceText);
    if (!match) return undefined;
    const plan = buildChipPlan(match.block, match.generatedPreviews, sourceText);
    return renderChipPlan(plan, opts.ownerDocument);
  }

  function groupBlocks(blocks: readonly BlockGroupCandidate[]): readonly BlockGroupSpec[] | undefined {
    topLevel = new Set(blocks.map((candidate) => candidate.ast.id));
    const markers = blocks.map((candidate) => markerOf(candidate.ast, candidate.sourceText));
    const groups: BlockGroupSpec[] = [];
    // The two context-dependent attribute rules markers.js applies while
    // walking (see `markerElementAttributes`'s doc): pages inherit the open
    // chapter's `.chapter-N`, and `@continue` inherits the previous section.
    let chapterCounterClass = "";
    let lastSectionAttrs: Record<string, string> | undefined;

    markers.forEach((marker, i) => {
      if (!marker) return;
      const kind = scopeKindOf(marker);
      if (!CONTAINER_KINDS.has(kind)) return;

      let attrs: Record<string, string> = { ...markerElementAttributes(marker) };
      if (marker.kind === "continue" && lastSectionAttrs) {
        attrs = { ...lastSectionAttrs, class: mergeClass(lastSectionAttrs["class"], "gp-continued") };
      }
      if (kind === "chapter") {
        const explicit = (attrs["class"] ?? "").match(/(?:^|\s)(chapter-\d+)(?=\s|$)/)?.[1] ?? "";
        chapterCounterClass = explicit || (marker.attrs["ch"] ? `chapter-${marker.attrs["ch"]}` : "");
      }
      if (kind === "page" && chapterCounterClass) attrs["class"] = mergeClass(attrs["class"], chapterCounterClass);
      if (kind === "section") lastSectionAttrs = attrs;

      const closers = CLOSED_BY[kind as ContainerKind];
      let end = i + 1;
      while (end < blocks.length) {
        const other = markers[end];
        if (other && closers.has(scopeKindOf(other))) break;
        if (kind === "section" && other?.kind === "end-section") {
          end += 1; // the explicit closer belongs to the section it closes
          break;
        }
        end += 1;
      }
      const { class: className, ...attributes } = attrs;
      groups.push({ start: i, end, key: `${kind}:${blocks[i]!.ast.id}`, className, attributes });
    });
    return groups;
  }

  return {
    renderCustomBlock,
    groupBlocks,
    needsRefresh: (currentVersion: number) => projectionNeedsRefresh(projection, currentVersion),
  };
}

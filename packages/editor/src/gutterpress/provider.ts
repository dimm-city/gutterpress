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
import type { BlockAstNode, CustomBlockRendering } from "@dimm-city/vscode-markdown-editor";
import type { GutterpressProjection } from "gutterpress/render";
import { buildBlockIndex, matchProjectedBlock, projectionNeedsRefresh, type BlockIndex } from "./match.ts";
import { buildChipPlan } from "./plan.ts";
import { renderChipPlan } from "./render-chip.ts";

export interface CreateGutterpressBlockProviderOptions {
  /** The exact source text `projection` was built against. */
  readonly source: string;
  /** The document to create chip elements in — required, never the bare `document` global (see `render-chip.ts`'s header on iframe safety). */
  readonly ownerDocument: Document;
  /**
   * G-11 — called before every match attempt. Returning `true` makes
   * `renderCustomBlock` return `undefined` unconditionally for THIS call,
   * regardless of whether a real match would otherwise be found. Omit only
   * when the caller has some other way to guarantee freshness (e.g. a
   * throwaway provider built fresh for a single, already-verified render) —
   * `mountGutterpressEditor` always supplies a live one.
   */
  readonly isStale?: () => boolean;
}

export interface GutterpressBlockProvider {
  /** Pass directly as `EditorViewOptions.renderCustomBlock`. */
  readonly renderCustomBlock: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;
  /** G-11 — pull-based staleness query against the projection this provider was built from. */
  readonly needsRefresh: (currentVersion: number) => boolean;
}

/**
 * Builds a `GutterpressBlockProvider` for `projection`. The returned
 * `renderCustomBlock` is a pure function of its own two arguments plus this
 * provider's captured `projection`/`opts` — no additional state is created
 * beyond the one-time `BlockIndex` built here.
 */
export function createGutterpressBlockProvider(
  projection: GutterpressProjection,
  opts: CreateGutterpressBlockProviderOptions,
): GutterpressBlockProvider {
  const index: BlockIndex = buildBlockIndex(projection, opts.source);

  function renderCustomBlock(_node: BlockAstNode, sourceText: string): CustomBlockRendering | undefined {
    if (opts.isStale?.()) return undefined;

    const match = matchProjectedBlock(index, sourceText);
    if (!match) return undefined;

    const plan = buildChipPlan(match.block, match.generatedPreviews, sourceText);
    return renderChipPlan(plan, opts.ownerDocument);
  }

  return {
    renderCustomBlock,
    needsRefresh: (currentVersion: number) => projectionNeedsRefresh(projection, currentVersion),
  };
}

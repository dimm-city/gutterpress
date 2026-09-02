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
import { htmlFragmentNesting, markerElementAttributes, parseMarkerLine } from "gutterpress/render";
import type { GutterpressProjection, ProjectedBlock, ProjectedBlockKind } from "gutterpress/render";
import { buildBlockIndex, matchProjectedBlock, projectionNeedsRefresh, type BlockIndex } from "./match.ts";
import { buildChipPlan } from "./plan.ts";
import { renderChipPlan, renderCloseMarkerChip, renderContainerTagChip } from "./render-chip.ts";

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
  /** A kind core does not own — a project plugin's own branded marker. */
  readonly unknownKind?: boolean;
}

/**
 * Marker lines are classified from TEXT with the pipeline's own grammar
 * (`parseMarkerLine`, the exact function `layout_transform` runs), never
 * from a projection snapshot: the editor's document changes on every
 * keystroke and a marker must keep rendering as a marker through all of
 * them. A marker is a single-line paragraph whose first character is `@`.
 */
function markersOf(node: { readonly kind: string } | undefined, sourceText: string): ParsedMarker[] {
  if (node && node.kind !== "paragraph") return [];
  const lines = sourceText.trim().split("\n");
  if (!lines.length || !lines[0]!.startsWith("@")) return [];
  const markers: ParsedMarker[] = [];
  for (const line of lines) {
    // `allowUnknownKinds`: a project plugin's own marker (`@lede`, `@toc`) is
    // layout syntax the book consumes, exactly like a core one. Classifying
    // it as a marker is what keeps it off the editor's page — as body text
    // it adds a line the printed page does not have. Only core kinds get
    // structure (containers, breaks) below; an unknown kind gets a chip and
    // nothing else, because core cannot know what the plugin did with it.
    const parsed = parseMarkerLine(line.trim(), { allowUnknownKinds: true }) as ParsedMarker | null;
    // EVERY line has to be a marker, or this is prose that merely starts
    // with one.
    if (!parsed) return [];
    markers.push(parsed);
  }
  return markers;
}

const scopeKindOf = (marker: ParsedMarker): string => (marker.kind === "continue" ? "section" : marker.kind);

/** `@end-x` closes `@x` — the closing convention core uses and plugins follow. */
const closedKindOf = (marker: ParsedMarker): string | null =>
  marker.kind.startsWith("end-") ? marker.kind.slice(4) : null;

/**
 * The container an author opened by hand.
 *
 * A book may wrap blocks in its own HTML — the field guide's credits page
 * writes `<div class="colophon-grid">` around them and closes it with
 * `</div>`, and its CSS lays that grid out in two columns. The editor
 * rendered the two tags as blocks and left the content between them
 * unwrapped, so the credits ran the full page width instead of two columns.
 * Whether a raw HTML block opens or closes a container is read from the tags
 * themselves, the same way a plugin's own wrapper is.
 */
function rawHtmlNesting(candidate: BlockGroupCandidate): { opened: readonly { tag: string; attributes: Readonly<Record<string, string>> }[]; closed: number } {
  if (candidate.ast.kind !== "unhandledBlock") return { opened: [], closed: 0 };
  return htmlFragmentNesting(candidate.sourceText);
}

/**
 * The wrapper a PLUGIN's own container marker opens.
 *
 * A project plugin's markers are containers just as core's are — the Dimm
 * City plugin's `@specialty .augmerc` wraps a role's whole spread, and its
 * CSS sizes the art inside it. Chipping the marker without building that
 * wrapper leaves the content unwrapped: those portraits rendered at their
 * natural 690px against the book's 80px, and one chapter came out 39 pages
 * against 25.
 *
 * Core cannot know what element the plugin emits, so this follows the
 * convention core documents and plugins mirror: the kind as a class, plus
 * the author's own classes and id. A plugin that emits some other class
 * gets a wrapper its CSS does not match — no worse than the nothing it had
 * before, and right for every plugin that follows the convention.
 */
function pluginContainerAttributes(marker: ParsedMarker): Record<string, string> {
  const authored = (marker.attrs["class"] ?? "").split(/\s+/).filter(Boolean);
  const out: Record<string, string> = { class: [marker.kind, ...authored].join(" ") };
  const id = marker.attrs["id"];
  if (id) out["id"] = id;
  return out;
}

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
  /**
   * The wrappers the project's plugins actually opened, per kind, in
   * document order — the pipeline's own answer, so the editor reproduces a
   * plugin's `dc-specialty` rather than guessing `specialty` from the
   * marker's name. Consumed in order per kind, matching the order the
   * markers appear in.
   */
  const pluginWrappers = new Map<string, { tag: string; attributes: Record<string, string> }[][]>();
  for (const container of projection.pluginContainers ?? []) {
    const list = pluginWrappers.get(container.kind) ?? [];
    list.push(container.wrappers.map((w) => ({ tag: w.tag, attributes: { ...w.attributes } })));
    pluginWrappers.set(container.kind, list);
  }
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
    // The pipeline reads markers LINE by line, so two of them on consecutive
    // lines are two markers — while this editor's parser sees one paragraph.
    // Rejecting a multi-line block left `@page`/`@section` written without a
    // blank line between them printed as body text on the editor's page.
    const markers = topLevel.has(node.id) ? markersOf(node, sourceText) : [];
    const marker = markers[0];
    if (marker) {
      if (markers.length === 1 && (marker.kind === "end-section" || closedKindOf(marker))) {
        return renderCloseMarkerChip(opts.ownerDocument, sourceText);
      }
      // The projection is still the authority when it recognizes this exact
      // line: it carries the pipeline's own generated views (a `@page`
      // marker's chapter-opener, for instance), which text alone cannot
      // produce. Text classification is the FALLBACK, for a marker the
      // author has just typed or edited — the case the projection cannot
      // describe because it predates the edit.
      const match = matchProjectedBlock(index, sourceText);
      const kind = (marker.unknownKind ? "plugin-marker" : scopeKindOf(marker)) as ProjectedBlockKind;
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

    // A raw HTML tag that opens or closes a container is mounted as the
    // container itself by `groupBlocks`; rendering its HTML here as well
    // would put a second, empty copy of the wrapper on the page.
    if (node.kind === "unhandledBlock") {
      const nesting = htmlFragmentNesting(sourceText);
      if (nesting.opened.length || nesting.closed) return renderContainerTagChip(opts.ownerDocument, sourceText);
    }

    // Plugin regions and raw HTML still come from the projection (they need
    // the pipeline's own rendering); matched by exact text, so an edit
    // elsewhere in the document never un-renders them.
    const match = matchProjectedBlock(index, sourceText);
    if (!match) return undefined;
    const plan = buildChipPlan(match.block, match.generatedPreviews, sourceText);
    return renderChipPlan(plan, opts.ownerDocument);
  }

  /**
   * A container holds the blocks AFTER its marker, never the marker itself.
   *
   * In the book a marker line produces the wrapper; it leaves nothing inside
   * it. Mounting the marker's own chip as the wrapper's first child made the
   * editor disagree with every structural selector a book writes about its
   * first and last child — the design guide styles a section heading with
   * `.section > h3:first-child` (a full-bleed banner with negative margins)
   * and closes its cards with `.dc-card-body > p:last-child`. With a chip in
   * the way none of them matched, and a heading came out at the fork theme's
   * own size instead of the book's. `display: none` does not help:
   * `:first-child` counts elements, not boxes. The same reasoning excludes
   * `@end-section` from the section it closes.
   *
   * An empty group (a marker with nothing after it, or `@section` closed
   * immediately) is not emitted: it would be a wrapper around no blocks.
   */
  function groupBlocks(blocks: readonly BlockGroupCandidate[]): readonly BlockGroupSpec[] | undefined {
    // Each render consumes the wrappers from the top; the queues are rebuilt
    // per render so a re-render sees the same document the last one did.
    const takeWrapper = (() => {
      const cursors = new Map<string, number>();
      return (kind: string) => {
        const list = pluginWrappers.get(kind);
        if (!list) return undefined;
        const at = cursors.get(kind) ?? 0;
        cursors.set(kind, at + 1);
        return list[at];
      };
    })();
    topLevel = new Set(blocks.map((candidate) => candidate.ast.id));
    /** Every marker each top-level block carries, in source order. */
    const markers = blocks.map((candidate) => markersOf(candidate.ast, candidate.sourceText));
    /** Does any marker in block `i` close a scope of `kind`? */
    const closesAt = (i: number, closers: ReadonlySet<string>): boolean =>
      markers[i]!.some((m) => !m.unknownKind && closers.has(scopeKindOf(m)));
    const groups: BlockGroupSpec[] = [];
    // The two context-dependent attribute rules markers.js applies while
    // walking (see `markerElementAttributes`'s doc): pages inherit the open
    // chapter's `.chapter-N`, and `@continue` inherits the previous section.
    let chapterCounterClass = "";
    let lastSectionAttrs: Record<string, string> | undefined;

    markers.forEach((blockMarkers, i) => {
      for (const marker of blockMarkers) {
      if (marker.unknownKind) {
        // A plugin's own container. It runs to its `@end-<kind>`, to the
        // next `@<kind>` (the auto-close every such plugin documents), or to
        // the end of the core scope enclosing it — a new page or section
        // ends it, because the plugin's own wrapper cannot span one.
        if (closedKindOf(marker)) continue; // a closer opens nothing
        let end = i + 1;
        while (end < blocks.length) {
          const others = markers[end]!;
          const ends = others.some(
            (m) =>
              closedKindOf(m) === marker.kind ||
              (m.unknownKind && m.kind === marker.kind) ||
              (!m.unknownKind && CONTAINER_KINDS.has(scopeKindOf(m))),
          );
          if (ends) break;
          end += 1;
        }
        // The pipeline's own wrappers when the projection captured them;
        // otherwise the convention-derived fallback, which is right for a
        // plugin that names its wrapper after the marker and harmless for
        // one that does not. A decorated container is several nested
        // wrappers, mounted outermost first over the same blocks.
        const emitted = takeWrapper(marker.kind);
        const chain = emitted ?? [{ tag: "div", attributes: pluginContainerAttributes(marker) }];
        if (end > i + 1) {
          chain.forEach((wrapper, depth) => {
            const { class: pluginClass, ...pluginAttrs } = { ...wrapper.attributes };
            groups.push({
              start: i + 1,
              end,
              key: `${marker.kind}:${depth}:${blocks[i]!.ast.id}`,
              tagName: wrapper.tag,
              className: pluginClass,
              attributes: pluginAttrs,
            });
          });
        }
        continue;
      }
      const kind = scopeKindOf(marker);
      if (!CONTAINER_KINDS.has(kind)) continue;

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
        if (closesAt(end, closers)) break;
        // `@end-section` closes the section and is not inside it.
        if (kind === "section" && markers[end]!.some((m) => m.kind === "end-section")) break;
        end += 1;
      }
      const { class: className, ...attributes } = attrs;
      // The key carries the KIND as well as the block: one block can open
      // two scopes (`@page` and `@section` on consecutive lines), and two
      // groups sharing a key would be one wrapper reused for both.
      if (end > i + 1) {
        groups.push({ start: i + 1, end, key: `${kind}:${blocks[i]!.ast.id}`, className, attributes });
      }
      }
    });

    blocks.forEach((candidate, i) => {
      const { opened } = rawHtmlNesting(candidate);
      if (!opened.length) return;
      let depth = opened.length;
      let end = i + 1;
      for (; end < blocks.length; end++) {
        const nesting = rawHtmlNesting(blocks[end]!);
        depth += nesting.opened.length - nesting.closed;
        if (depth <= 0) break;
      }
      if (end <= i + 1) return;
      opened.forEach((wrapper, depthIndex) => {
        const { class: className, ...attributes } = { ...wrapper.attributes };
        groups.push({
          start: i + 1,
          end,
          key: `html:${depthIndex}:${candidate.ast.id}`,
          tagName: wrapper.tag,
          className,
          attributes,
        });
      });
    });
    return groups;
  }

  return {
    renderCustomBlock,
    groupBlocks,
    needsRefresh: (currentVersion: number) => projectionNeedsRefresh(projection, currentVersion),
  };
}

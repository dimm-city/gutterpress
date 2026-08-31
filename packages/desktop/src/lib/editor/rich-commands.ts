/**
 * rich-commands.ts (SFE-P3ab, Lane B)
 *
 * The adapter that lets the SAME shared P2a command vocabulary
 * (`@dimm-city/gutterpress-editor/core`'s `EditorCommand` +
 * `/standard`'s `applyCommand`/`commandState`) drive the RICH editing
 * surface. In source mode a toolbar action manipulates a live CodeMirror
 * `EditorView` (`toolbar-actions.ts`); in rich mode there is no `EditorView`
 * to dispatch a transaction against — every function below instead computes
 * a `SourceEdit` and applies it through the document's
 * `EditorDocumentHost.applyEdit` (D3/D7), the same seam
 * `DesktopDocumentHost` (`../editor-host/desktop-document-host.ts`)
 * implements and `RichEditor.svelte` mounts against as `richDocHost`.
 *
 * Zero Svelte imports, zero CodeMirror imports, zero DOM — every export here
 * is a pure function of `(host, ...)`, matching this repo's existing
 * `toolbar-actions.ts`/`image-classes.ts`/`context-menu-actions.ts` posture
 * (PWA-clean, `bun test`-able without a browser).
 *
 * ## The selection accessor — CLOSED (SFE-P3ab, Lane D)
 *
 * A prior run of this module anchored every command at the document end
 * (`documentEndSelection`) because nothing in `packages/editor`'s mount
 * surface exposed the fork's live caret/selection, and reported the exact
 * missing accessor. That gap is now closed:
 *
 *   - `VscodeEditorAdapter.getSelection()`
 *     (`packages/editor/src/vscode-adapter/adapter.ts`) reads the fork's
 *     own `model.selection` observable and returns it as UTF-16 D3 source
 *     offsets (`{ from, to } | undefined`) — `undefined` exactly when the
 *     mounted surface has no caret yet (never focused).
 *   - `EditorMount.getSelection()` (`packages/editor/src/web/mount.ts`) and
 *     `GutterpressEditorMount.getSelection()`
 *     (`packages/editor/src/gutterpress/mount.ts`) are thin passthroughs to
 *     the adapter — the SAME accessor, additive on both mount return
 *     shapes.
 *   - `RichEditor.svelte` exposes it upward as an imperative
 *     `getSelection()` export (bound via `bind:this`, mirroring
 *     `MarkdownEditor.svelte`'s `editorRef` pattern) so `+page.svelte` can
 *     read the live caret at the moment a toolbar action or shortcut fires.
 *
 * Every `applyRich*` function below now resolves its edit position through
 * {@link resolveRichSelection}: the LIVE caret/selection when the caller
 * supplies one (a real, focused mount), {@link documentEndSelection} as an
 * explicit, DOCUMENTED FALLBACK only when no caret exists (the surface has
 * never been focused, or the caller has no mount reference yet — e.g. a
 * drag-and-drop insert that arrives before the editor has focus). The
 * compromise this header used to document is now the exceptional path, not
 * the norm — pressing Bold with a caret mid-document formats AT the caret;
 * `documentEndSelection` only fires when there is genuinely nothing better
 * to anchor on.
 *
 * This also matches how the mounted rich editor actually OBSERVES an edit
 * applied this way: `createVscodeEditorAdapter`'s `host.subscribe` listener
 * cannot tell "a toolbar pushed this edit via `host.applyEdit` from outside"
 * apart from any other external actor's accepted edit (`submittingOwnEdit`
 * is only true for edits the PACKAGE's own `onWillApplySourceEdit` handler
 * is mid-flight submitting) — so every edit this module produces still
 * lands in the mounted view as a full `model.replaceSourceText(...)`
 * external replacement, the same as an out-of-band file change. There is
 * still no "select the placeholder text afterward" step to add here even in
 * principle: the adapter exposes no selection SETTER, only the getter this
 * run added.
 */
import type {
  Diagnostic,
  DocumentSnapshot,
  EditorCommand,
  EditorDocumentHost,
  LayoutBlockKind,
  SourceEdit,
} from "@dimm-city/gutterpress-editor/core";
import { diagnosticForEditRejection } from "@dimm-city/gutterpress-editor/core";
import { applyCommand, commandState, type CommandSelection } from "@dimm-city/gutterpress-editor/standard";
import { descriptorForLayoutBlock } from "./toolbar-actions";
import {
  IMAGE_LAYER_OPTIONS,
  IMAGE_PIN_ALIGNMENT_OPTIONS,
  IMAGE_PIN_CLASS,
  IMAGE_POSITION_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  IMAGE_SPACING_OPTIONS,
  serializeImageAttrs,
  setFlushClass,
  setLayerClass,
  setPinAlignment,
  setPositionClass,
  setShapeClass,
  setSizeClass,
  setSpacingClass,
  setWidth,
  type ImagePropertiesValue,
} from "./image-classes";
import type { ToolbarAction, ToolbarPayload } from "./toolbar-actions";

// ── The result shape every rich-mode apply function below returns ──────────

/**
 * The uniform result of a rich-mode command: either the accepted snapshot
 * (D3), or a `Diagnostic` (D14) describing why nothing changed — whether the
 * refusal came from `applyCommand` itself (e.g. `set-heading` inside a
 * fenced code block) or from `host.applyEdit` rejecting the computed edit
 * (stale/readonly/invalid-range). Callers (`+page.svelte`) surface the
 * diagnostic the same way regardless of which layer produced it.
 */
export type RichCommandOutcome =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * The document-end FALLBACK anchor every insert/toggle below resolves
 * to when no live caret is available — see this file's header. A collapsed
 * selection at the end of the document.
 */
export function documentEndSelection(snapshot: DocumentSnapshot): CommandSelection {
  return { start: snapshot.text.length, endExclusive: snapshot.text.length };
}

/**
 * The live caret/selection shape `EditorMount.getSelection()` /
 * `GutterpressEditorMount.getSelection()` (`@dimm-city/gutterpress-editor/
 * web` and `/gutterpress`) report — UTF-16 D3 source offsets, `from <= to`
 * always (the adapter normalizes a backward drag). Declared locally rather
 * than imported: this module only needs the two fields structurally, and a
 * consumer-shaped type belongs with the consuming domain (plan D4), not
 * coupled to `packages/editor`'s own export surface.
 */
export interface LiveSelection {
  readonly from: number;
  readonly to: number;
}

/**
 * The ONE place every `applyRich*` function below resolves "where does this
 * edit happen": `live` (the mount's CURRENT `getSelection()` result, read by
 * the caller at the moment the command fires) converted to the shared
 * command layer's `{start, endExclusive}` shape when a caret exists;
 * {@link documentEndSelection} — the documented fallback — when it does
 * not (`live` is `undefined` or omitted: the surface has never been
 * focused, or the caller has no mount reference yet).
 *
 * No bounds-clamping here: a `live` value describing a position outside the
 * current `snapshot` (a caret reported for a stale text version, in the
 * narrow window before the mount observes a newer one) is passed through
 * as-is and refused downstream through the SAME `EDITOR_INVALID_RANGE`
 * path an out-of-range selection already takes (`applyCommand`'s own
 * `invalidSelection` check, `@dimm-city/gutterpress-editor/web/standard`) —
 * one refusal path, not a second silent-clamp behavior that could mask a
 * real staleness bug.
 */
export function resolveRichSelection(
  snapshot: DocumentSnapshot,
  live?: LiveSelection,
): CommandSelection {
  return live ? { start: live.from, endExclusive: live.to } : documentEndSelection(snapshot);
}

function finishEdit(host: EditorDocumentHost, edit: SourceEdit): RichCommandOutcome {
  const applied = host.applyEdit(edit);
  if (!applied.ok) return { ok: false, diagnostic: diagnosticForEditRejection(applied.reason) };
  return { ok: true, snapshot: applied.snapshot };
}

/**
 * `set-heading` toggles off when the pressed level is already active — the
 * SAME decision `toolbar-actions.ts`'s `applyHeading` makes via
 * `commandState`, reproduced here (not imported: `applyHeading` is
 * CodeMirror-`EditorView`-shaped, this needs only the pure snapshot/selection
 * inputs `commandState` itself takes) so rich mode's heading button toggles
 * identically to source mode's.
 */
function resolveHeadingToggle(
  snapshot: DocumentSnapshot,
  selection: CommandSelection,
  command: EditorCommand,
): EditorCommand {
  if (command.kind !== "set-heading" || command.level === "none") return command;
  const active = commandState(snapshot, selection)["set-heading"].level;
  return active === command.level ? { kind: "set-heading", level: "none" } : command;
}

/**
 * Applies one shared `EditorCommand` (P2a vocabulary) against `host`,
 * anchored at `live` (the mount's current caret/selection) when supplied,
 * falling back to {@link documentEndSelection} otherwise — see
 * {@link resolveRichSelection}. Covers every mapped toolbar action EXCEPT
 * image insertion (its full `gp-*` attribute vocabulary has no room in
 * `insert-image`'s minimal `{src, alt?}` shape — see
 * {@link applyRichImageInsert}) and layout markers (a separate template
 * vocabulary — see {@link applyRichLayoutBlock}).
 */
export function applyRichCommand(
  host: EditorDocumentHost,
  command: EditorCommand,
  live?: LiveSelection,
): RichCommandOutcome {
  const snapshot = host.getSnapshot();
  const selection = resolveRichSelection(snapshot, live);
  const resolved = resolveHeadingToggle(snapshot, selection, command);
  const result = applyCommand(snapshot, selection, resolved);
  if ("refused" in result) return { ok: false, diagnostic: result.refused };
  return finishEdit(host, result.edit);
}

/**
 * Inserts a `@marker` layout skeleton (chapter/section/two-column/
 * page-break/spread) at `live`'s current position when supplied, falling
 * back to the document end otherwise (`resolveRichSelection`), via the SAME
 * templates `toolbar-actions.ts`'s `applyLayoutBlock` inserts into
 * CodeMirror (`descriptorForLayoutBlock` — one template, two thin
 * appliers; G-09). Every descriptor's own `insert` text is padded with
 * leading/trailing `"\n\n"` (verified against `toolbar-actions.ts`'s
 * templates), so splicing it at an arbitrary mid-line caret — unlike source
 * mode's `insertionPointAfterCurrentLine`, this does not first walk to the
 * end of the caret's line — still lands the marker on its own, correctly
 * isolated line; it may split the surrounding prose into two paragraphs
 * where source mode would not, an accepted, documented divergence rather
 * than reproducing CodeMirror's line-boundary walk against plain source
 * text.
 */
export function applyRichLayoutBlock(
  host: EditorDocumentHost,
  kind: LayoutBlockKind,
  live?: LiveSelection,
): RichCommandOutcome {
  const snapshot = host.getSnapshot();
  const at = resolveRichSelection(snapshot, live).endExclusive;
  const d = descriptorForLayoutBlock(kind);
  return finishEdit(host, { from: at, to: at, insert: d.insert, expectedVersion: snapshot.version });
}

/** Replaces `live`'s current selection (or a collapsed caret at the
 *  document end when no caret is available — `resolveRichSelection`) with
 *  `text` — a snippet body. The rich counterpart of
 *  `MarkdownEditor.insertSnippet`, which does the same thing against the
 *  live CodeMirror selection (`view.dispatch({changes: {from, to, insert:
 *  text}, ...})` — replace, not append-after). */
export function applyRichAppend(
  host: EditorDocumentHost,
  text: string,
  live?: LiveSelection,
): RichCommandOutcome {
  const snapshot = host.getSnapshot();
  const { start, endExclusive } = resolveRichSelection(snapshot, live);
  return finishEdit(host, { from: start, to: endExclusive, insert: text, expectedVersion: snapshot.version });
}

// ── Images (G-10/AP-17, G-09) ───────────────────────────────────────────────
//
// `ImagePropertiesDialog.svelte` + `image-classes.ts` already own the FULL
// `gp-*` image vocabulary (width/position/pinAlignment/size/spacing/shape/
// flush/layer) — the same dialog `+page.svelte`'s preview-context-menu path
// uses to EDIT an existing image (`context-menu-controller.svelte.ts`,
// "Set properties…"). Rich mode reuses that dialog and this module's own
// serialization (built from the SAME `image-classes.ts` setter functions
// that path uses, not a reimplementation) to build a brand-new image token,
// appended at the document end.
//
// This is a strict CAPABILITY SUPERSET of `toolbar-actions.ts`'s own
// `applyImage`/`buildImageAttrsString` (which cover only width/position/
// size/shape) — intentional: those exist to preserve CodeMirror's
// pre-P2a-mapping behavior byte-for-byte (see that file's header), while
// rich mode has no prior behavior to preserve and the run spec explicitly
// names `ImagePropertiesDialog`/`image-classes.ts` as what to reuse here.

/** Validates a value collected from `ImagePropertiesDialog` before it is
 *  turned into source — the SAME rules
 *  `context-menu-controller.svelte.ts`'s "Set properties…" action applies
 *  before writing back an edited image, reproduced here (that controller is
 *  outside this lane's write ownership) against the identical shared option
 *  tables so the two paths cannot silently drift apart on WHAT counts as
 *  valid, even though each owns its own copy of the check. */
export function validateImageProperties(value: ImagePropertiesValue): string | undefined {
  if (!value.src.trim()) return "Choose an image path or URL.";
  const validPosition = !value.position || IMAGE_POSITION_OPTIONS.some((o) => o.class === value.position);
  const validAlignment = IMAGE_PIN_ALIGNMENT_OPTIONS.some((o) => o.value === value.pinAlignment);
  const validSize = !value.size || IMAGE_SIZE_OPTIONS.some((o) => o.class === value.size);
  const validSpacing = !value.spacing || IMAGE_SPACING_OPTIONS.some((o) => o.class === value.spacing);
  const validLayer = !value.layer || IMAGE_LAYER_OPTIONS.some((o) => o.class === value.layer);
  if (!validPosition || !validAlignment || !validSize || !validSpacing || !validLayer) {
    return "Choose image options from the lists.";
  }
  if (value.width.trim() && value.size) {
    return "Choose either a custom width or a preset size, not both.";
  }
  return undefined;
}

/**
 * Serializes a FULL `ImagePropertiesValue` into a fresh
 * `\n\n![alt](src){…attrs}\n\n` snippet, built by running the same
 * `image-classes.ts` setter chain the existing "edit an image" path uses —
 * starting from an EMPTY token list (there is no prior token set to diff
 * against for a brand-new image, unlike that path's incremental update).
 * Caller must validate first ({@link validateImageProperties}); this
 * function does not itself refuse.
 */
export function buildImageInsertText(value: ImagePropertiesValue): string {
  let tokens: string[] = [];
  tokens = setWidth(tokens, value.width.trim() || null);
  tokens = setPositionClass(tokens, value.position || null);
  if (value.position === IMAGE_PIN_CLASS) {
    tokens = setPinAlignment(tokens, value.pinAlignment);
  }
  tokens = setSizeClass(tokens, value.size || null);
  tokens = setSpacingClass(tokens, value.spacing || null);
  tokens = setShapeClass(tokens, value.shape);
  tokens = setFlushClass(tokens, value.flush);
  tokens = setLayerClass(tokens, value.layer || null);
  const attrs = serializeImageAttrs(tokens);
  const alt = value.alt.trim() || "image";
  const src = value.src.trim();
  return `\n\n![${alt}](${src})${attrs}\n\n`;
}

/** Applies a validated {@link ImagePropertiesValue} as a new image, inserted
 *  at `live`'s current position when supplied, falling back to the document
 *  end otherwise (`resolveRichSelection`) — the SAME leading/trailing
 *  `"\n\n"`-padded self-isolation `applyRichLayoutBlock` relies on (see its
 *  own doc comment) makes a mid-line insertion point safe here too.
 *  Callers should run {@link validateImageProperties} first and surface its
 *  message instead of calling this on an invalid value (mirrors the
 *  existing context-menu image-properties flow). */
export function applyRichImageInsert(
  host: EditorDocumentHost,
  value: ImagePropertiesValue,
  live?: LiveSelection,
): RichCommandOutcome {
  const snapshot = host.getSnapshot();
  const at = resolveRichSelection(snapshot, live).endExclusive;
  const insert = buildImageInsertText(value);
  return finishEdit(host, { from: at, to: at, insert, expectedVersion: snapshot.version });
}

// ── Command routing (source vs. rich path selection) ───────────────────────

/** Where a toolbar action's edit is computed, once page-level actions
 *  ("snippet"/"focus-mode", handled entirely in `+page.svelte` before either
 *  editing surface is consulted) are excluded. */
export type RichToolbarRoute =
  | { readonly kind: "command"; readonly command: EditorCommand }
  | { readonly kind: "layout"; readonly layout: LayoutBlockKind }
  /** "image" — handled by the `ImagePropertiesDialog` flow
   *  (`applyRichImageInsert`), not a plain `EditorCommand`; routed
   *  separately by the caller rather than through this function's result. */
  | { readonly kind: "image" }
  /** No rich-mode equivalent exists for this action (today: none of the
   *  mapped toolbar actions land here — every case below resolves to
   *  "command"/"layout"/"image" — this arm exists so the function stays
   *  total against `ToolbarAction` as that union grows). */
  | { readonly kind: "unsupported" };

/**
 * Decides how a toolbar action should be applied in RICH mode — the pure
 * "command routing" half of this run's command-surface requirement (the
 * SOURCE-mode decision is trivial and unchanged: every action already
 * dispatches through `editorRef.runToolbarAction`, `toolbar-actions.ts`).
 * Every `ToolbarAction` this switch does not special-case in `+page.svelte`
 * (bold/italic/strikethrough/code/link/blockquote/ul/ol/heading/hr/table/
 * page-break/layout-block) maps onto the P2a shared vocabulary — rich mode
 * has a working equivalent for the full mapped set, not a subset.
 */
export function routeToolbarAction(action: ToolbarAction, payload?: ToolbarPayload): RichToolbarRoute {
  switch (action) {
    case "bold":
      return { kind: "command", command: { kind: "toggle-bold" } };
    case "italic":
      // Rich mode has no PRE-EXISTING `_..._` behavior to preserve (unlike
      // `toolbar-actions.ts`'s own `applyItalic`, deliberately left unmapped
      // there for exactly that reason — see its header) — the shared
      // command's canonical `*...*` spelling is simply what italic means
      // here.
      return { kind: "command", command: { kind: "toggle-italic" } };
    case "strikethrough":
      return { kind: "command", command: { kind: "toggle-strike" } };
    case "code":
      return { kind: "command", command: { kind: "toggle-inline-code" } };
    case "link":
      // Same placeholder convention as `toolbar-actions.ts`'s `applyLink`
      // for an empty selection: "link text" / "url".
      return { kind: "command", command: { kind: "insert-link", href: "url", text: "link text" } };
    case "blockquote":
      return { kind: "command", command: { kind: "toggle-blockquote" } };
    case "ul":
      return { kind: "command", command: { kind: "toggle-list", variant: "bullet" } };
    case "ol":
      return { kind: "command", command: { kind: "toggle-list", variant: "ordered" } };
    case "heading": {
      const level = (payload as { level: 1 | 2 | 3 | 4 } | undefined)?.level ?? 2;
      return { kind: "command", command: { kind: "set-heading", level } };
    }
    case "hr":
      return { kind: "command", command: { kind: "insert-horizontal-rule" } };
    case "table": {
      const cols = (payload as { cols: number } | undefined)?.cols ?? 3;
      return { kind: "command", command: { kind: "insert-table", rows: 1, cols } };
    }
    case "page-break":
      return { kind: "layout", layout: "page-break" };
    case "layout-block": {
      const kind = (payload as { kind: LayoutBlockKind } | undefined)?.kind;
      return kind ? { kind: "layout", layout: kind } : { kind: "unsupported" };
    }
    case "image":
      return { kind: "image" };
    case "snippet":
    case "focus-mode":
      // Page-level actions — `+page.svelte` handles both before this
      // function is ever called for either surface. Reachable only if a
      // caller skips that pre-check, so treated as a safe no-op rather than
      // an error.
      return { kind: "unsupported" };
  }
}

// ── Block movement (SFE-P3ab, Lane D: now WIRED, via the live caret) ───────
//
// A prior run shipped the pure block-movement OPERATION (`splitIntoBlocks`/
// `moveBlock`/`applyBlockMove` below) without a way to wire it to a toolbar
// or keyboard control, because neither mount exposed a selection nor did
// `MarkdownEditor`'s `editorRef` expose a cursor OFFSET (only
// `getSelectionText()`, the selected TEXT) — so `+page.svelte` had no way to
// determine "which block" the move should target.
//
// The mount side of that gap is now closed (`EditorMount.getSelection()` /
// `GutterpressEditorMount.getSelection()`, this file's header). This
// section adds the other missing piece: {@link blockIndexAtOffset}, the
// pure mapping from "the live caret's offset" to "the `blockIndex` argument
// `applyBlockMove` already takes" — `+page.svelte`'s keyboard wiring
// (`EditorToolbar.svelte`/`toolbar-actions.ts` are another lane's files,
// so this run's control surface is a keyboard shortcut checked directly in
// `+page.svelte`'s `onGlobalKey`, exactly the pattern that file's own
// rich-mode-toggle shortcut already uses) reads
// `richEditorRef.getSelection()`, resolves it to a block with the function
// below, then calls `applyBlockMove` unchanged.

/**
 * Which {@link SourceBlock} (index into `splitIntoBlocks(text)`) OWNS a
 * given caret `offset` — the pure mapping block-movement's keyboard wiring
 * needs. A caret strictly inside a block belongs to that block; a caret
 * sitting in a GAP (a blank line, or the terminator between two adjacent
 * blocks — see {@link splitIntoBlocks}'s own header) belongs to the block
 * immediately BEFORE the gap — "the block the author was just in", not the
 * one ahead that has not been reached yet. A caret before every block
 * (leading blank lines, or an empty document) has no owning block.
 */
export function blockIndexAtOffset(text: string, offset: number): number | undefined {
  const blocks = splitIntoBlocks(text);
  let owner: number | undefined;
  for (let i = 0; i < blocks.length; i++) {
    if (blocks[i]!.from > offset) break;
    owner = i;
  }
  return owner;
}

/** One structural unit `moveBlock` can reorder. `isMarker` distinguishes a
 *  single `@name ...` directive line (core marker OR project-plugin marker —
 *  both share this syntax, so this module treats them identically without
 *  needing plugin-specific knowledge) from an ordinary prose/content run. */
export interface SourceBlock {
  readonly from: number;
  readonly to: number;
  readonly isMarker: boolean;
}

const MARKER_LINE_RE = /^@[A-Za-z][\w-]*(?:[ \t].*)?$/;

function lineKind(trimmed: string): "blank" | "marker" | "text" {
  if (trimmed === "") return "blank";
  return MARKER_LINE_RE.test(trimmed) ? "marker" : "text";
}

/**
 * One physical line's extent, split three ways so a block's `to` can stop at
 * `contentEnd` — the line's own text, EXCLUDING its trailing `"\n"` — rather
 * than `fullEnd`. This is load-bearing: a block must never own the newline
 * that separates it from whatever comes next, or that separator silently
 * disappears when {@link moveBlock} relocates the block elsewhere (the
 * newline was never independently recoverable as a "gap" if a block's own
 * span had already swallowed it — verified against a doc with NO blank line
 * between two blocks, e.g. `"@sidebar\ncontent\n@end-sidebar"`: the FIRST
 * version of this function attached each line's own `"\n"` to that line
 * itself, so swapping two such ordinarily-adjacent lines produced
 * `"@end-sidebarcontent"` — bytes preserved, but glued together with no
 * separator at all. Stopping at `contentEnd` and letting the gap recover
 * every terminator — a block's own trailing one AND any further blank
 * lines — fixes this uniformly for both the "blank-line-separated" and the
 * "just one ordinary line break" case.
 */
interface LineExtent {
  readonly start: number;
  readonly contentEnd: number;
  readonly fullEnd: number;
  readonly kind: "blank" | "marker" | "text";
}

function lineExtents(text: string): LineExtent[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const lastIndex = parts.length - 1;
  const lines: LineExtent[] = [];
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const content = parts[i]!;
    const hasTerminator = i < lastIndex;
    const start = pos;
    const contentEnd = start + content.length;
    const fullEnd = hasTerminator ? contentEnd + 1 : contentEnd;
    lines.push({ start, contentEnd, fullEnd, kind: lineKind(content.trim()) });
    pos = fullEnd;
  }
  return lines;
}

/**
 * Splits `text` into contiguous, non-overlapping blocks — every consecutive
 * run of non-blank, non-marker lines is one "text" block (spanning from its
 * first line's start to its LAST line's `contentEnd`); every `@name ...`
 * line is its OWN solo "marker" block (never merged with a neighbor, even an
 * adjacent marker line with no blank line between — the conservative
 * reading of "preserve marker/plugin boundaries": a block move must never
 * assume two adjacent markers were meant to travel together). Blank lines
 * and every block's own trailing line terminator are NOT part of any block
 * — they are the (possibly empty) gap between two blocks, recovered on
 * demand by {@link moveBlock} as `text.slice(prev.to, next.from)` so a swap
 * preserves the exact original separator instead of re-deriving spacing
 * (see {@link LineExtent}'s header for why this split point is load-bearing).
 *
 * A document containing only blank lines (or the empty string) yields `[]`
 * — there is nothing to move.
 */
export function splitIntoBlocks(text: string): SourceBlock[] {
  const lines = lineExtents(text);
  const blocks: SourceBlock[] = [];
  let openFrom: number | null = null;
  let openContentEnd = 0;

  const closeOpenTextBlock = (): void => {
    if (openFrom !== null) {
      blocks.push({ from: openFrom, to: openContentEnd, isMarker: false });
      openFrom = null;
    }
  };

  for (const line of lines) {
    if (line.kind === "blank") {
      closeOpenTextBlock();
    } else if (line.kind === "marker") {
      closeOpenTextBlock();
      blocks.push({ from: line.start, to: line.contentEnd, isMarker: true });
    } else {
      if (openFrom === null) openFrom = line.start;
      openContentEnd = line.contentEnd;
    }
  }
  closeOpenTextBlock();
  return blocks;
}

/** Why {@link moveBlock} produced no edit. */
export type BlockMoveRefusalReason = "out-of-range" | "first-block" | "last-block";

export type BlockMoveResult =
  | { readonly edit: { readonly from: number; readonly to: number; readonly insert: string } }
  | { readonly refused: true; readonly reason: BlockMoveRefusalReason };

/**
 * Computes the smallest-range replacement that swaps the block at
 * `blockIndex` with its immediate up/down neighbor, preserving the ORIGINAL
 * gap text between them (see {@link splitIntoBlocks}'s header) and every
 * other block's bytes untouched — a single contiguous `[from, to)` splice
 * spanning exactly the two swapped blocks and the gap between them, nothing
 * more (D3: "the smallest safe common source range").
 *
 * Refuses (no edit) when `blockIndex` is out of range, or the move would
 * cross the start/end of the document — moving the first block up, or the
 * last block down. A single-block document always refuses both directions
 * (its only block has no neighbor either way).
 */
export function moveBlock(text: string, blockIndex: number, direction: "up" | "down"): BlockMoveResult {
  const blocks = splitIntoBlocks(text);
  if (blockIndex < 0 || blockIndex >= blocks.length) {
    return { refused: true, reason: "out-of-range" };
  }
  const neighborIndex = direction === "up" ? blockIndex - 1 : blockIndex + 1;
  if (neighborIndex < 0) return { refused: true, reason: "first-block" };
  if (neighborIndex >= blocks.length) return { refused: true, reason: "last-block" };

  const [firstIdx, secondIdx] = neighborIndex < blockIndex
    ? [neighborIndex, blockIndex]
    : [blockIndex, neighborIndex];
  const first = blocks[firstIdx]!;
  const second = blocks[secondIdx]!;
  const gap = text.slice(first.to, second.from);
  const firstText = text.slice(first.from, first.to);
  const secondText = text.slice(second.from, second.to);

  return {
    edit: { from: first.from, to: second.to, insert: secondText + gap + firstText },
  };
}

/** Applies {@link moveBlock}'s edit through `host`, mapping a refusal to a
 *  `Diagnostic`. Wired to `+page.svelte`'s Alt+Shift+ArrowUp/Down keyboard
 *  shortcut via {@link blockIndexAtOffset} — see this section's header. */
export function applyBlockMove(
  host: EditorDocumentHost,
  blockIndex: number,
  direction: "up" | "down",
): RichCommandOutcome {
  const snapshot = host.getSnapshot();
  const result = moveBlock(snapshot.text, blockIndex, direction);
  if ("refused" in result) {
    const message =
      result.reason === "first-block"
        ? "This is already the first block — it can't move up."
        : result.reason === "last-block"
          ? "This is already the last block — it can't move down."
          : "Couldn't find that block to move.";
    return { ok: false, diagnostic: { category: "EDITOR_INVALID_RANGE", message } };
  }
  return finishEdit(host, { ...result.edit, expectedVersion: snapshot.version });
}

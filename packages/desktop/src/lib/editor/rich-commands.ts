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
 * ## The selection accessor — CLOSED (SFE-P3ab, Lane B)
 *
 * A prior run of this module anchored every command at the document end
 * (`documentEndSelection`) because nothing in `packages/editor`'s mount
 * surface exposed the fork's live caret/selection, and reported the exact
 * missing accessor. That gap is now closed:
 *
 *   - `VscodeEditorAdapter.getSelection()`
 *     (`packages/editor/src/vscode-adapter/adapter.ts`) reads the fork's
 *     own `model.selection` observable and returns it as UTF-16 D3 source
 *     offsets (`{ from, to } | undefined`).
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
 * SFE-P3ab review round 1 (CONFIRMED finding): `undefined` does NOT mean
 * "never focused" — it means "no caret at THIS INSTANT", and it recurs
 * after real interaction. Verified live against the installed fork: a caret
 * placed by keyboard navigation is CLEARED by clicking the mounted surface's
 * own left gutter (the `--md-editor-content-inline-start-padding` strip
 * before `.md-document` begins) or its top padding — still inside the
 * mounted surface, not a click outside it. See
 * `packages/editor/tests/web/mount.btest.ts`'s "clears again after a real
 * caret exists" case. The adapter/mount layer deliberately does NOT paper
 * over this by retaining a "last known" position (that would make
 * `getSelection()` lie about whether a caret currently exists, which some
 * callers — e.g. a future cursor-position indicator — legitimately need to
 * know); every `applyRich*` function below still resolves its edit position
 * through {@link resolveRichSelection}, which still falls back to
 * {@link documentEndSelection} when `live` is `undefined`, and that fallback
 * remains correct for a GENUINELY anchorless caller (image insertion via
 * drag-and-drop from outside the mounted surface, or before the surface has
 * ever been focused at all — `applyRichImageInsert`). But a caller that
 * represents an explicit, caret-relative user gesture — a toolbar click, a
 * keyboard shortcut, "insert snippet" — must NOT silently reuse that same
 * fallback: one stray click in the gutter between two keystrokes and the
 * very next Bold press would otherwise format text at the END of the
 * document instead of at the caret the author was just looking at. Those
 * callers (`+page.svelte`'s `handleRichToolbarAction` and its
 * `SnippetPicker` `onInsert` handler) check `live` themselves and refuse
 * with a diagnostic ("place the cursor first") instead of calling into this
 * module at all when there is no live caret — see the review log for
 * SFE-P3ab round 1.
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
// SFE-P3d-parity, Lane D — the shared pure locate/compute core for the
// caret-driven image-properties/image-unwrap/link-edit commands below (see
// caret-token-commands.ts's header for the full division of labor).
import {
  computeImagePropertiesEdit,
  computeLinkEditEdit,
  locateImageAtCaret,
  locateImageUnwrapEdit,
  locateLinkAtCaret,
  type ImageCaretMatch,
  type LinkCaretMatch,
  type LocateResult,
} from "./caret-token-commands";
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
 * not (`live` is `undefined` or omitted). `undefined` is NOT proof the
 * surface was never focused (see this file's header) — a caller invoking a
 * caret-relative command in response to an explicit user gesture (a
 * toolbar click, a keyboard shortcut) should check `live` itself and refuse
 * BEFORE calling in here rather than let an ambiguous "no caret right now"
 * silently resolve to the document end.
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
 * `routeToolbarAction`'s "link" case unconditionally sets `text: "link
 * text"` — a fixed placeholder that is correct ONLY for a collapsed caret
 * (nothing selected). `computeInsertLink` (`web/standard/link-image.ts`)
 * uses that `text` as an OVERRIDE whenever it is anything but `undefined`,
 * always replacing `[start, endExclusive)` — so passed through unconditioned,
 * a non-collapsed selection's own words are silently discarded and replaced
 * with the literal placeholder (SFE-P3ab review round 1, CONFIRMED finding:
 * a divergence from source mode's `applyLink`, which computes exactly this
 * override itself — `const overrideText = from === to ? "link text" :
 * undefined;`, `toolbar-actions.ts`). Reproduces that same rule here so
 * rich mode's Link button wraps a real selection instead of eating it.
 */
function resolveLinkOverride(selection: CommandSelection, command: EditorCommand): EditorCommand {
  if (command.kind !== "insert-link") return command;
  if (selection.start === selection.endExclusive) return command;
  // A real, non-collapsed selection exists — let computeInsertLink wrap it
  // as the link text (its own `overrideText ?? selected` fallback), the
  // same as source mode's `applyLink` does for this exact case.
  return { kind: "insert-link", href: command.href, text: undefined };
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
  const headingResolved = resolveHeadingToggle(snapshot, selection, command);
  const resolved = resolveLinkOverride(selection, headingResolved);
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
    case "image-properties":
    case "image-unwrap":
    case "link-edit":
      // These three DO have real rich-mode replacements — below:
      // `locateRichImagePropertiesAtCaret`/`applyRichImagePropertiesEdit`,
      // `applyRichImageUnwrapAtCaret`, and `locateRichLinkEditAtCaret`/
      // `applyRichLinkEditEdit` (SFE-P3d-parity repair round 1: this
      // comment used to name `applyRichImagePropertiesAtCaret`/
      // `applyRichLinkEditAtCaret`, which do not exist — see the real
      // locate/apply split documented in this file's next section header)
      // — but the image-properties/link-edit pair needs a dialog `await`
      // this function's synchronous `RichToolbarRoute` return shape has no
      // room for, so
      // `+page.svelte`'s `onAction` calls them directly instead of routing
      // through here (same pre-check pattern "snippet"/"focus-mode" already
      // use above, for a different reason). Reachable here only if a caller
      // skips that pre-check, so treated the same safe no-op way.
      return { kind: "unsupported" };
  }
}

// ── Image properties / unwrap / link edit at the caret (SFE-P3d-parity, Lane D) ──
//
// The rich-mode counterparts to `toolbar-actions.ts`'s
// `locateImagePropertiesAtCaret`/`applyImagePropertiesEdit`/
// `applyImageUnwrapAtCaret`/`locateLinkEditAtCaret`/`applyLinkEditEdit` —
// same pure locate/compute core (`caret-token-commands.ts`), same D14
// outcome shape (`RichCommandOutcome`, reused rather than a second type),
// different write seam (`EditorDocumentHost.applyEdit` instead of
// `view.dispatch`). `live` here is MANDATORY, not an optional fallback to
// `documentEndSelection` like every OTHER `applyRich*` function in this
// file — there is no sensible "locate the image at the document end"
// reading of these commands (mirrors `handleRichToolbarAction`'s own
// `NO_LIVE_CARET_DIAGNOSTIC` pre-check in `+page.svelte`).
//
// image-properties and link-edit are split into a LOCATE step and an APPLY
// step for the SAME reason `toolbar-actions.ts`'s equivalents are: the
// caller (`+page.svelte`) owns the `promptImageProperties`/`promptText`
// dialog AND the document-identity staleness check
// (`captureRichSelection`/`isRichSelectionCaptureFresh` — SFE-P3ab review
// round 1's fix for a captured `richDocHost` reference going stale across
// an `await`, reused here rather than reinvented) — this file must not
// swallow either. `expectedVersion` is threaded through explicitly from the
// caller's OWN captured version (not re-read from `host` at apply time)
// so a caller that already re-verified freshness via
// `isRichSelectionCaptureFresh` gets exactly the guard it asked for; D3/D7
// still make `applyEdit` itself refuse if it does not match.

/**
 * Locate step for "Image properties…" (rich mode) — resolves the image at
 * `live`'s caret and seeds an {@link ImagePropertiesValue}, ready for the
 * caller to hand to `ImagePropertiesDialog`. Reuses `caret-token-commands`'
 * `ImageCaretMatch`/`LocateResult` shapes directly — this function is a
 * thin `(host, live)` -> `(text, offset)` adapter, nothing more.
 */
export function locateRichImagePropertiesAtCaret(
  host: EditorDocumentHost,
  live: LiveSelection,
): LocateResult<ImageCaretMatch> {
  return locateImageAtCaret(host.getSnapshot().text, live.from);
}

/** Apply step for "Image properties…" (rich mode) — computes and applies
 *  the diff between `located.initial` and `next`
 *  (`caret-token-commands.ts#computeImagePropertiesEdit`), against
 *  `expectedVersion` (the caller's own captured, re-verified version — see
 *  this section's header). Caller is expected to have already validated
 *  `next` (`validateImageProperties`). */
export function applyRichImagePropertiesEdit(
  host: EditorDocumentHost,
  located: ImageCaretMatch,
  next: ImagePropertiesValue,
  expectedVersion: number,
): RichCommandOutcome {
  const edit = computeImagePropertiesEdit(located.match, located.initial, next);
  if (!edit) return { ok: true, snapshot: host.getSnapshot() }; // nothing actually changed
  return finishEdit(host, { ...edit, expectedVersion });
}

/** "Unwrap image" (rich mode) — removes an existing image's enclosing link
 *  wrapper at `live`'s caret, leaving the image itself untouched. No
 *  dialog, so no staleness window: locate and apply happen back to back
 *  against the SAME `host.getSnapshot()`, so no split is needed. */
export function applyRichImageUnwrapAtCaret(host: EditorDocumentHost, live: LiveSelection): RichCommandOutcome {
  const snapshot = host.getSnapshot();
  const located = locateImageUnwrapEdit(snapshot.text, live.from);
  if (!located.ok) return { ok: false, diagnostic: located.diagnostic };
  return finishEdit(host, { ...located.value, expectedVersion: snapshot.version });
}

/** Locate step for "Edit link…" (rich mode) — resolves the link at `live`'s
 *  caret, ready to seed a text prompt with its current target. */
export function locateRichLinkEditAtCaret(host: EditorDocumentHost, live: LiveSelection): LocateResult<LinkCaretMatch> {
  return locateLinkAtCaret(host.getSnapshot().text, live.from);
}

/** Apply step for "Edit link…" (rich mode) — computes and applies the new
 *  href (`caret-token-commands.ts#computeLinkEditEdit` — `rewriteLinkToken`
 *  unchanged), against `expectedVersion` (see this section's header). */
export function applyRichLinkEditEdit(
  host: EditorDocumentHost,
  located: LinkCaretMatch,
  href: string,
  expectedVersion: number,
): RichCommandOutcome {
  const edit = computeLinkEditEdit(located.match, href);
  return finishEdit(host, { ...edit, expectedVersion });
}

// ── Block movement (SFE-P3ab, Lane B: now WIRED, via the live caret) ───────
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

/**
 * One structural unit `moveBlock` can reorder. `isMarker` is true only for a
 * line whose head matches Gutterpress's own core marker vocabulary
 * ({@link markerKindOf} below — an inlined copy of `markers.js`'s
 * `KNOWN_KINDS`, CLAUDE.md §5) or the generic `@end-<name>` closer
 * convention plugins share with core's `@end-section` — NOT any line that
 * merely starts with `@word`. A prior version of this module used a far
 * broader regex and misclassified CSS `@media` rules inside fenced code,
 * and ordinary `@name ...` prose (an @mention), as markers (SFE-P3ab review
 * round 1, CONFIRMED). One consequence of the narrower vocabulary: a
 * project-plugin's own OPENING marker (e.g. `@sidebar`) is outside this
 * module's known vocabulary, so `isMarker`/`markerKind` never flag it —
 * `splitIntoBlocks` keeps treating it as ordinary content, exactly as before.
 * `moveBlock` protects it anyway, by STRUCTURAL PAIRING rather than
 * vocabulary: {@link pluginRegionOpenerIndices} — see that function's header
 * (SFE-P3ab review round 2, CONFIRMED: the opener was unprotected while its
 * `@end-*` closer was, so one swap could evict a plugin region's entire body
 * and leave an empty opener/closer pair). Fenced code (``` / ~~~) is always
 * ONE indivisible block regardless of its contents, including any blank
 * lines or `@word` lines inside it — see {@link splitIntoBlocks}. */
export interface SourceBlock {
  readonly from: number;
  readonly to: number;
  readonly isMarker: boolean;
  /** The recognized marker kind ("section", "end-section", "page-break",
   *  "end-sidebar", ...) when {@link isMarker} is true, else `null`. */
  readonly markerKind: string | null;
}

/**
 * Inlined copy of `packages/cli/src/lib/markdown/markers.js`'s
 * `KNOWN_KINDS` (CLAUDE.md §5 — a narrow copy, not an import: this module
 * is browser-safe and Lane B may not import `packages/cli`). Kept in sync
 * by hand; `markers.js` is the grammar's source of truth.
 */
const KNOWN_MARKER_KINDS = new Set([
  "chapter",
  "spread",
  "page",
  "section",
  "continue",
  "page-break",
  "column-break",
  "end-section",
]);

/**
 * Marker kinds with NO open/close scope semantics — `markers.js` never
 * calls its internal `stack.open`/`stack.close` for either (they are
 * parsed as attrs-only leaf markers). Every OTHER recognized kind either
 * opens a scope (chapter/spread/page/section) or closes/reopens one
 * (end-section, continue, and any plugin `@end-*`) — moving a block across
 * one of those would move it into or out of a different scope, which is
 * exactly the corruption this module's `moveBlock` must refuse (SFE-P3ab
 * review round 1, CONFIRMED — proven via `@section`/`@end-section`
 * crossing). `page-break`/`column-break` are the only kinds
 * {@link moveBlock} may swap across.
 */
const NEUTRAL_MARKER_KINDS = new Set(["page-break", "column-break"]);

/**
 * The marker kind of a `@`-line, narrowed to Gutterpress's OWN grammar
 * ({@link KNOWN_MARKER_KINDS}) plus the generic `@end-<name>` closing
 * convention project plugins share with core's `@end-section` (CLAUDE.md
 * §6: plugins add their own marker families using the same
 * `@name`/`@end-name` syntax) — `null` for anything else, including a bare
 * `@word` this module does not recognize (an ordinary prose mention such as
 * `@sarah please review`, or a near-miss like `@sction`). This is
 * deliberately NARROWER than the real parser's near-miss tolerance
 * (`parseMarkerLine`'s `nearestKind`): a rich-mode block boundary only
 * needs to know "is this DEFINITELY a marker line", not "did the author
 * mistype one" — an unrecognized `@word` is ordinary content, not its own
 * movable structural unit for splitting purposes. `moveBlock` still protects
 * a genuine plugin OPENER by pairing it with its recognized `@end-<name>`
 * closer ({@link pluginRegionOpenerIndices}) rather than by widening this
 * function's vocabulary — widening it here would misclassify ordinary
 * `@mention` prose again (the exact SFE-P3ab round 1 regression).
 */
function markerKindOf(trimmed: string): string | null {
  if (!trimmed.startsWith("@")) return null;
  const head = trimmed.split(/[ \t]/, 1)[0]!.slice(1);
  if (!head) return null;
  if (KNOWN_MARKER_KINDS.has(head)) return head;
  if (head.startsWith("end-") && head.length > "end-".length) return head;
  return null;
}

/** True for a `SourceBlock` {@link moveBlock} must never swap across or
 *  relocate — every recognized marker kind except the two proven scope-
 *  neutral ones ({@link NEUTRAL_MARKER_KINDS}). Ordinary content blocks and
 *  fenced-code blocks are never boundaries UNLESS `pluginOpeners` says
 *  otherwise (a paired plugin-region opener — see
 *  {@link pluginRegionOpenerIndices}). */
function isBoundaryBlockAt(
  blocks: readonly SourceBlock[],
  index: number,
  pluginOpeners: ReadonlySet<number>,
): boolean {
  const block = blocks[index]!;
  return (block.isMarker && !NEUTRAL_MARKER_KINDS.has(block.markerKind ?? "")) || pluginOpeners.has(index);
}

/** The head token ("sidebar", "end-sidebar", "sarah", ...) of `trimmed`'s
 *  leading `@`-word, with NO vocabulary filter — unlike {@link markerKindOf}
 *  this returns a value for ANY `@word`, recognized or not. Used only by
 *  {@link pluginRegionOpenerIndices} to test whether a candidate block's
 *  first line names the same region a recognized `@end-<name>` closer is
 *  closing; never used to decide `isMarker`/`markerKind` — that stays
 *  {@link markerKindOf}'s job so ordinary `@mention` prose is unaffected. */
function atHeadOf(trimmed: string): string | null {
  if (!trimmed.startsWith("@")) return null;
  const head = trimmed.split(/[ \t]/, 1)[0]!.slice(1);
  return head || null;
}

/** `text.slice(block.from, block.to)`'s FIRST physical line, trimmed — the
 *  only part of a (possibly multi-line) block {@link pluginRegionOpenerIndices}
 *  inspects, since an opener's own `@name` line is always a block's first
 *  line whether or not a blank line separates it from the block's own body
 *  (`"@sidebar\nBody."` with no blank line still opens with `"@sidebar"`). */
function firstLineTrimmedOf(text: string, block: SourceBlock): string {
  const slice = text.slice(block.from, block.to);
  const nl = slice.indexOf("\n");
  return (nl === -1 ? slice : slice.slice(0, nl)).trim();
}

/**
 * Indices, into `blocks`, of blocks that OPEN a plugin region and must be
 * treated as a `moveBlock` boundary even though {@link markerKindOf} does
 * not recognize their head — a project plugin's own opening marker (CLAUDE.md
 * §6's own examples, `@sidebar`/`@callout`) is outside Gutterpress's core
 * vocabulary, so {@link splitIntoBlocks} correctly leaves it `isMarker:
 * false` (unchanged). Left unprotected there, one swap could evict an entire
 * plugin region's body and leave an empty opener/closer pair (SFE-P3ab
 * review round 2, CONFIRMED — the asymmetry: the closer was already a
 * protected boundary while its opener was not).
 *
 * This is STRUCTURAL evidence, not a vocabulary guess: for every recognized
 * `@end-<name>` closer block already in `blocks`, the NEAREST PRECEDING
 * block whose first line is headed `@<name>` ({@link atHeadOf}) is its
 * opener and is paired to it. A plain `@word` line with no matching
 * `@end-word` anywhere in the document — an ordinary prose `@mention`, e.g.
 * `@sarah please review` — pairs with nothing and stays ordinary, movable
 * content, exactly as SFE-P3ab round 1 fixed. Already-recognized openers
 * (`@section`, ...) are skipped here (`candidate.isMarker` true) since
 * {@link isBoundaryBlockAt}'s own `isMarker` check already protects them.
 */
function pluginRegionOpenerIndices(text: string, blocks: readonly SourceBlock[]): ReadonlySet<number> {
  const openers = new Set<number>();
  for (let closerIndex = 0; closerIndex < blocks.length; closerIndex++) {
    const closer = blocks[closerIndex]!;
    if (!closer.isMarker || closer.markerKind === null) continue;
    if (!closer.markerKind.startsWith("end-")) continue;
    const name = closer.markerKind.slice("end-".length);
    for (let i = closerIndex - 1; i >= 0; i--) {
      const candidate = blocks[i]!;
      if (candidate.isMarker) continue;
      if (atHeadOf(firstLineTrimmedOf(text, candidate)) === name) {
        openers.add(i);
        break;
      }
    }
  }
  return openers;
}

const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

/** The opening fence's character and run length, or `null` when `trimmed`
 *  does not open a fenced code block. */
function fenceOpen(trimmed: string): { readonly char: string; readonly len: number } | null {
  const m = FENCE_OPEN_RE.exec(trimmed);
  if (!m) return null;
  const run = m[1]!;
  return { char: run[0]!, len: run.length };
}

/** Whether `trimmed` closes an already-open `fence` — CommonMark 4.5: the
 *  SAME fence character repeated at least the opening run's length, with
 *  nothing else on the line but trailing whitespace (no info string on a
 *  closing fence). */
function fenceCloses(trimmed: string, fence: { readonly char: string; readonly len: number }): boolean {
  const runRe = fence.char === "`" ? /^`+/ : /^~+/;
  const m = runRe.exec(trimmed);
  if (!m || m[0]!.length < fence.len) return false;
  return trimmed.slice(m[0]!.length).trim() === "";
}

/** One physical line's extent, split so a block's `to` can stop at
 *  `contentEnd` — the line's own text, EXCLUDING its trailing `"\n"` —
 *  rather than `fullEnd`. This is load-bearing: a block must never own the
 *  newline that separates it from whatever comes next, or that separator
 *  silently disappears when {@link moveBlock} relocates the block elsewhere
 *  (verified against a doc with NO blank line between two blocks: attaching
 *  each line's own `"\n"` to that line itself made a swap glue two lines
 *  together with no separator at all). Stopping at `contentEnd` and letting
 *  the gap recover every terminator fixes this uniformly. */
interface RawLine {
  readonly start: number;
  readonly contentEnd: number;
  readonly fullEnd: number;
  readonly trimmed: string;
}

function rawLines(text: string): RawLine[] {
  if (text === "") return [];
  const parts = text.split("\n");
  const lastIndex = parts.length - 1;
  const lines: RawLine[] = [];
  let pos = 0;
  for (let i = 0; i < parts.length; i++) {
    const content = parts[i]!;
    const hasTerminator = i < lastIndex;
    const start = pos;
    const contentEnd = start + content.length;
    const fullEnd = hasTerminator ? contentEnd + 1 : contentEnd;
    lines.push({ start, contentEnd, fullEnd, trimmed: content.trim() });
    pos = fullEnd;
  }
  return lines;
}

/**
 * Splits `text` into contiguous, non-overlapping blocks:
 *
 *   - a fenced code region (``` or ~~~ through its matching closer, or to
 *     end-of-document if unterminated) is always ONE indivisible block —
 *     blank lines and `@word` lines INSIDE it never split or classify it
 *     (SFE-P3ab review round 1, CONFIRMED: a prior version tore a fence in
 *     half at a blank line, and flagged CSS `@media` inside a fenced block
 *     as a marker);
 *   - every consecutive run of non-blank, non-marker, non-fence lines
 *     (outside any fence) is one "text" block, spanning from its first
 *     line's start to its LAST line's `contentEnd`;
 *   - every recognized `@name ...` marker line ({@link markerKindOf}) is its
 *     OWN solo "marker" block (never merged with a neighbor, even an
 *     adjacent marker line with no blank line between).
 *
 * Blank lines and every block's own trailing line terminator are NOT part
 * of any block — they are the (possibly empty) gap between two blocks,
 * recovered on demand by {@link moveBlock} as `text.slice(prev.to,
 * next.from)` so a swap preserves the exact original separator instead of
 * re-deriving spacing.
 *
 * A document containing only blank lines (or the empty string) yields `[]`
 * — there is nothing to move.
 */
export function splitIntoBlocks(text: string): SourceBlock[] {
  const lines = rawLines(text);
  const blocks: SourceBlock[] = [];
  let openFrom: number | null = null;
  let openContentEnd = 0;
  let fence: { readonly char: string; readonly len: number } | null = null;
  let fenceFrom = 0;

  const closeOpenTextBlock = (): void => {
    if (openFrom !== null) {
      blocks.push({ from: openFrom, to: openContentEnd, isMarker: false, markerKind: null });
      openFrom = null;
    }
  };

  for (const line of lines) {
    if (fence) {
      if (fenceCloses(line.trimmed, fence)) {
        blocks.push({ from: fenceFrom, to: line.contentEnd, isMarker: false, markerKind: null });
        fence = null;
      }
      continue;
    }
    if (line.trimmed === "") {
      closeOpenTextBlock();
      continue;
    }
    const markerKind = markerKindOf(line.trimmed);
    if (markerKind !== null) {
      closeOpenTextBlock();
      blocks.push({ from: line.start, to: line.contentEnd, isMarker: true, markerKind });
      continue;
    }
    const opened = fenceOpen(line.trimmed);
    if (opened) {
      closeOpenTextBlock();
      fence = opened;
      fenceFrom = line.start;
      continue;
    }
    if (openFrom === null) openFrom = line.start;
    openContentEnd = line.contentEnd;
  }
  closeOpenTextBlock();
  if (fence) {
    // Unterminated fence — runs to the end of the document; still one
    // indivisible block rather than falling back to per-line splitting.
    blocks.push({ from: fenceFrom, to: lines[lines.length - 1]!.contentEnd, isMarker: false, markerKind: null });
  }
  return blocks;
}

/** Why {@link moveBlock} produced no edit. */
export type BlockMoveRefusalReason = "out-of-range" | "first-block" | "last-block" | "boundary";

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
 * Refuses (no edit) when: `blockIndex` is out of range; the move would
 * cross the start/end of the document (moving the first block up, or the
 * last block down — a single-block document always refuses both
 * directions, its only block has no neighbor either way); or EITHER block
 * in the swap is a scope-affecting marker or a paired plugin-region opener
 * ({@link isBoundaryBlockAt} / {@link pluginRegionOpenerIndices} —
 * SFE-P3ab review round 1, CONFIRMED: swapping a block across
 * `@section`/`@end-section`, or across any other non-neutral marker, moved
 * content into or out of that marker's scope; round 2, CONFIRMED: the same
 * corruption via a project plugin's unrecognized opener, e.g. `@sidebar`,
 * paired with its recognized `@end-sidebar` closer). `page-break`/
 * `column-break` markers stay freely movable past ordinary content — they
 * open no scope.
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
  const pluginOpeners = pluginRegionOpenerIndices(text, blocks);
  if (isBoundaryBlockAt(blocks, firstIdx, pluginOpeners) || isBoundaryBlockAt(blocks, secondIdx, pluginOpeners)) {
    return { refused: true, reason: "boundary" };
  }
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
          : result.reason === "boundary"
            ? "That would move content across a marker boundary — edit in source mode instead."
            : "Couldn't find that block to move.";
    return { ok: false, diagnostic: { category: "EDITOR_INVALID_RANGE", message } };
  }
  return finishEdit(host, { ...result.edit, expectedVersion: snapshot.version });
}

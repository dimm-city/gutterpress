/**
 * toolbar-actions.ts (#31)
 *
 * CodeMirror 6 transaction helpers that implement the EditorToolbar's named
 * edit actions. Each function accepts an EditorView and applies a single,
 * undoable transaction.
 *
 * Design rules:
 * - Every action is a SINGLE transaction (one undo step).
 * - Wrap/unwrap: with a non-empty selection, wrap the selected text;
 *   without a selection, insert the syntax with the cursor between the markers.
 * - Block-level actions (headings, blockquote, lists, hr, page-break) operate
 *   on the CURRENT line(s), not just the caret offset.
 * - The functions are pure CodeMirror state mutations — zero Svelte imports.
 *
 * Desktop -> shared-command mapping (SFE-P2a; `@dimm-city/gutterpress-editor
 * /standard`'s `applyCommand`/`commandState` — see that package's `web/
 * standard/**` for the pure transform math): `applyBold`, `applyStrikethrough`,
 * `applyInlineCode`, `applyHeading`, `applyBlockquote`, `applyUnorderedList`,
 * `applyOrderedList`, `applyHr`, `applyTable`, and `applyLink` below now
 * COMPUTE their edit by calling `applyCommand` and dispatch the returned
 * `SourceEdit` as this file's own CodeMirror transaction — same public
 * signature.
 *
 * This is NOT byte-identical output for every possible input (an earlier
 * version of this comment claimed "byte-identical output" / "strict
 * behavioral superset" — false; a round-1 repair caught the gap and this
 * paragraph replaces that claim with the actual, measured list). Every case
 * this run's PINNED tests exercise matches — that is what "mapped" means
 * here — but pinned tests do not cover every input, and for a handful of
 * INPUTS OUTSIDE the pinned set the shared command's answer differs from
 * this file's pre-mapping standalone logic. Two kinds of difference:
 *
 * FIXED this round (were unintended regressions, now restored to parity —
 * see the referenced functions for how):
 *   - `applyHeading`'s caret placement for a DIFFERENT-level rewrite (e.g.
 *     H2 -> H3 on `"## Old heading"`) used to land the caret INSIDE the new
 *     `"###"` run instead of after it, because `computeSetHeading`'s edit is
 *     a MINIMAL diff (D3) whose `insert` length is not the full prefix
 *     length. Fixed by computing the caret from the target level's own
 *     known prefix length instead of `edit.insert.length`.
 *   - `applyBlockquote`/`applyUnorderedList`/`applyOrderedList` used to
 *     leave the selection in a different place than before mapping (e.g.
 *     `"a\nb\nc"` with `[0,3)` selected, blockquote-toggled, used to leave
 *     `[0,7]` instead of the pre-mapping `[2,7]`) because dispatching ONE
 *     combined whole-span replacement maps a selection contained inside it
 *     differently than N narrow per-line changes do. Fixed by re-splitting
 *     the shared command's edit into minimal per-line changes
 *     (`minimalLineChange`), restoring the original per-line dispatch shape.
 *
 * INTENTIONAL, still-standing divergences (the shared command's answer is
 * MORE correct than this file's old standalone regex logic, and is kept —
 * restoring the old behavior would be a regression, not a fix; each is
 * pinned by a test in `tests/editor/toolbar-actions.test.ts` asserting the
 * CURRENT, shared-command answer):
 *   - `applyHeading` on a line with MORE than 6 leading `#` (e.g.
 *     `"####### seven"`, level 2) used to silently strip the whole
 *     (invalid) run and replace it with a clean `"## "` prefix
 *     (`"## seven"`). 7+ `#` is not a valid ATX heading under CommonMark;
 *     the shared command correctly leaves it untouched as plain text and
 *     PREPENDS the new prefix (`"## ####### seven"`) rather than guessing
 *     that the invalid run was meant as a heading marker.
 *   - `applyUnorderedList` on an ALREADY-task-marked line (e.g.
 *     `"- [ ] task"`) used to strip the leading `"- "` as if it were a
 *     plain bullet, corrupting the line into `"[ ] task"` with no marker at
 *     all. The shared command distinguishes task items from bullets and
 *     prepends a fresh bullet marker instead (`"- - [ ] task"` — visually
 *     odd, but the original task marker survives).
 *   - `applyUnorderedList` on an INDENTED bullet (e.g. `"  - item"`) used to
 *     prepend `"- "` before the existing indentation regardless
 *     (`"-   - item"`, doubled and misplaced); this file's own toggle
 *     detection never looked past column 0. The shared command preserves
 *     indentation and correctly toggles the existing marker off
 *     (`"  item"`).
 *   - `applyBold` on text already wrapped in `__..._` (e.g. `"__x__"`) used
 *     to treat `__` as unrelated to bold (this file only ever checked for
 *     `"**"`) and WRAP inside it (`"__**x**__"`). The shared `toggle-bold`
 *     command recognizes `__` as bold's documented alternate spelling (run
 *     spec "Toggle semantics": remove whichever spelling is present) and
 *     correctly toggles it off (`"x"`).
 *   - `applyHeading` on a SETEXT heading, same-level toggle (e.g.
 *     `"Title\n---\n\nbody"`, H2 pressed on a line `commandState` already
 *     reports as level 2) used to PREPEND a fresh `"## "` ATX prefix onto
 *     the existing text/underline pair, leaving the `"---"` underline
 *     behind untouched (`"## Title\n---\n\nbody"`, caret 3). A setext
 *     heading IS a heading, so the same-level rule correctly flips the
 *     target to `"none"` and `computeSetHeading` collapses the whole
 *     text+underline pair into the bare text line, exactly like an ATX
 *     same-level toggle-off does (`"Title\n\nbody"`, caret 0) — this is the
 *     underline getting cleaned up alongside the prefix, not data loss.
 *
 * Two actions are deliberately LEFT UNMAPPED entirely, with the divergence
 * recorded here rather than silently accepted (run spec: "if any pinned
 * behavior differs from your command semantics ... leave that action
 * unmapped with a documented divergence note"):
 *   - `applyItalic` — this file's own canonical italic spelling is `_..._`
 *     (pinned: "applyItalic: wraps selection with underscores"). The shared
 *     `toggle-italic` command's spec-mandated canonical spelling is `*...*`
 *     (run spec "Command list": wrap the selection with bold/italic/strike
 *     /code delimiters respectively).
 *     Mapping would change desktop's canonical output, so `applyItalic`
 *     keeps its own `toggleInlineWrap(view, "_")` call unchanged.
 *   - `applyImage` — the shared `insert-image` command's shape is the run
 *     spec's minimal `{src, alt?}`; this file's `applyImage` additionally
 *     supports width/position/size/shape attributes via
 *     `buildImageAttrsString` (pinned tests exercise all four). The shared
 *     command has no room for them without exceeding this run's bounded
 *     12-command union, so `applyImage` is unchanged.
 * Layout/marker actions (`applyPageBreak`, `applyChapterBlock`,
 * `applySectionBlock`, `applyTwoColumnBlock`, `applySpreadBlock`,
 * `applyLayoutBlock`) are OUT OF SCOPE for the shared vocabulary this run
 * (run spec: "NO layout/marker/plugin commands (P2b+)") and are unchanged.
 */
import type { EditorView } from "@codemirror/view";
import { EditorSelection, type Text } from "@codemirror/state";
import type { Diagnostic, EditorCommand, LayoutBlockKind } from "@dimm-city/gutterpress-editor/core";
import { applyCommand, commandState } from "@dimm-city/gutterpress-editor/standard";
import {
  IMAGE_POSITION_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  normalizeClassInput,
  serializeImageAttrs,
  setPositionClass,
  setShapeClass,
  setSizeClass,
  setWidth,
  type ImagePropertiesValue,
} from "./image-classes";
// SFE-P3d-parity, Lane D — the shared pure locate/compute core for the
// caret-driven image-properties/image-unwrap/link-edit commands below (see
// caret-token-commands.ts's header for the full division of labor between
// it and this file).
import {
  computeImagePropertiesEdit,
  computeLinkEditEdit,
  locateImageAtCaret,
  locateImageUnwrapEdit,
  locateLinkAtCaret,
  type LocateResult,
} from "./caret-token-commands";
import type { ImageTokenMatch, LinkTokenMatch } from "./context-menu-actions";

// ── Helper: single-range accessor ────────────────────────────────────────────

function mainSel(view: EditorView) {
  return view.state.selection.main;
}

/**
 * The document offset just after the line the cursor is on — the insertion
 * point every "insert a block after the current line" action uses (audit E4:
 * this three-statement idiom was hand-repeated in 8 functions below).
 */
function insertionPointAfterCurrentLine(view: EditorView): number {
  const { from } = mainSel(view);
  return view.state.doc.lineAt(from).to;
}

function selectedText(view: EditorView): string {
  const { from, to } = mainSel(view);
  return view.state.doc.sliceString(from, to);
}

// ── Shared-command dispatch helpers (SFE-P2a) ────────────────────────────────
// Every mapped action below computes its edit via `applyCommand` (pure,
// host-free — see `@dimm-city/gutterpress-editor/standard`) and dispatches
// the result as ONE CodeMirror transaction here, preserving this file's own
// "every action is a SINGLE transaction" rule. `applyCommand` never refuses
// for any command these helpers drive except `set-heading` (fenced-code-
// block refusal) — the `"refused" in result` check exists for type
// narrowing and as a safe no-op fallback, not because refusal is expected
// on the other paths.

/**
 * Dispatches a wrap/unwrap toggle (`toggle-bold`/`toggle-strike`/
 * `toggle-inline-code`), replicating this file's PRE-EXISTING
 * `toggleInlineWrap` cursor-placement convention exactly, computed
 * GENERICALLY from the edit's own shape rather than re-deriving wrap-vs-
 * unwrap detection a second time:
 *   - `edit.insert.length > originalLen` (the selected/caret span grew) is
 *     a toggle-ON: select the ORIGINAL content at its new offset —
 *     `[edit.from + canonicalLen, edit.from + canonicalLen + originalLen)`.
 *   - otherwise (shrank or unchanged) is a toggle-OFF: select
 *     `[edit.from, edit.from + edit.insert.length)` — the whole remaining
 *     unwrapped text.
 * Both formulas reduce, algebraically, to `toggleInlineWrap`'s own
 * `EditorSelection.range(from ± mLen, to ± mLen)` / `cursor(...)` calls in
 * every case (caret-only and partial-selection, both directions) — see
 * this run's report for the worked-out equivalence proof.
 */
function applyWrapCommand(view: EditorView, command: EditorCommand, canonicalLen: number): void {
  const { from, to } = mainSel(view);
  const text = view.state.doc.toString();
  const result = applyCommand({ text, version: 0 }, { start: from, endExclusive: to }, command);
  if ("refused" in result) return;
  const { edit } = result;
  const originalLen = to - from;
  const selection =
    edit.insert.length > originalLen
      ? EditorSelection.range(edit.from + canonicalLen, edit.from + canonicalLen + originalLen)
      : EditorSelection.range(edit.from, edit.from + edit.insert.length);
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection });
}

/**
 * Narrows a "line `lineFrom` currently reads `oldText`, should become
 * `newText`" change to the smallest range that still produces the
 * identical result, by trimming any common leading/trailing substring —
 * the same idea as the shared editor package's `line-utils.ts`
 * `minimalReplacement` (not imported: that module is a PRIVATE
 * implementation file of `src/web/standard/`, not part of the package's
 * `"./standard"` export surface), reimplemented locally because
 * `applyBlockLevelCommand` below needs it PER LINE, not for the one
 * combined multi-line edit `applyCommand` already returns.
 */
function minimalLineChange(
  lineFrom: number,
  oldText: string,
  newText: string,
): { from: number; to: number; insert: string } {
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  let suffix = 0;
  while (suffix < maxSuffix && oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]) {
    suffix++;
  }

  return {
    from: lineFrom + prefix,
    to: lineFrom + oldText.length - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}

/**
 * Dispatches a multi-line block toggle (`toggle-blockquote`/
 * `toggle-list`) as N PER-LINE MINIMAL changes — this file's own
 * pre-mapping convention for these three actions (a zero-width marker
 * insertion at each line's own start on toggle-ON, a narrow marker removal
 * on toggle-OFF) — rather than the ONE combined whole-span replacement
 * `applyCommand` computes, so CodeMirror's default "map the existing
 * selection through the dispatched changes" keeps producing the SAME
 * mapped selection it always did. A change that REPLACES each line's
 * entire text (even with per-line boundaries) still maps a selection
 * CONTAINED INSIDE that wide replacement differently than a narrow,
 * prefix-only insertion/deletion does (CodeMirror's position mapping snaps
 * an interior position to one edge of a wholesale replacement) — this was
 * a real, unintended selection-placement divergence the mapping introduced
 * (measured: "a\nb\nc" with [0,3) selected, blockquote-toggled, used to
 * leave the selection at [2,7]; a whole-line-replacement dispatch left it
 * at [0,7] instead — `minimalLineChange` per line is what restores [2,7]).
 *
 * Re-splitting `edit.insert` per line is safe: it is
 * `lines.map(transform).join("\n")` and never touches the newlines BETWEEN
 * touched lines (see `blockquote.ts`/`list.ts`'s own header comments), so
 * pairing each `"\n"`-split piece back with its ORIGINAL line reproduces
 * the exact same resulting text as the one combined edit, byte-for-byte —
 * holds for `toggle-list ordered`'s contiguous-neighbor extension too,
 * since `edit.from`/`edit.to` already span the FULL (possibly extended)
 * block either way.
 */
function applyBlockLevelCommand(view: EditorView, command: EditorCommand): void {
  const { from, to } = mainSel(view);
  const text = view.state.doc.toString();
  const result = applyCommand({ text, version: 0 }, { start: from, endExclusive: to }, command);
  if ("refused" in result) return;
  const { edit } = result;

  const startLine = view.state.doc.lineAt(edit.from).number;
  const endLine = view.state.doc.lineAt(edit.to).number;
  const insertedLines = edit.insert.split("\n");
  const changes = [];
  for (let n = startLine; n <= endLine; n++) {
    const l = view.state.doc.line(n);
    changes.push(minimalLineChange(l.from, l.text, insertedLines[n - startLine] ?? ""));
  }
  view.dispatch({ changes });
}

/** Dispatches an insert-only command (`insert-horizontal-rule`/
 *  `insert-table`) at the caret, placing the cursor right after the
 *  inserted text — matches `applyHr`/`applyTable`'s pre-existing
 *  `cursor(insertAt + snippet.length)` convention exactly. */
function applyInsertAtCaretCommand(view: EditorView, command: EditorCommand): void {
  const { from } = mainSel(view);
  const text = view.state.doc.toString();
  const result = applyCommand({ text, version: 0 }, { start: from, endExclusive: from }, command);
  if ("refused" in result) return;
  const { edit } = result;
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.cursor(edit.from + edit.insert.length),
  });
}

// ── Inline wrap helpers ───────────────────────────────────────────────────────

/**
 * Toggle an inline marker pair around the current selection.
 * With a selection: wrap it (or unwrap if already wrapped).
 * Without a selection: insert `marker…marker` with cursor between.
 */
function toggleInlineWrap(view: EditorView, marker: string): void {
  const { from, to } = mainSel(view);
  const sel = selectedText(view);
  const mLen = marker.length;

  if (from === to) {
    // Empty selection: if the cursor already sits directly between an
    // existing marker pair, remove it (toggle off) instead of inserting a
    // nested pair. Without this check, repeated Ctrl+B on an empty selection
    // piled up marker debris: "" -> "****" -> "******" -> "********" ... (L6).
    const existingBefore = view.state.doc.sliceString(Math.max(0, from - mLen), from);
    const existingAfter = view.state.doc.sliceString(to, to + mLen);
    if (existingBefore === marker && existingAfter === marker) {
      view.dispatch({
        changes: [
          { from: from - mLen, to: from, insert: "" },
          { from: to, to: to + mLen, insert: "" },
        ],
        selection: EditorSelection.cursor(from - mLen),
      });
      return;
    }
    // No selection: insert both markers and place cursor inside.
    view.dispatch({
      changes: { from, to, insert: marker + marker },
      selection: EditorSelection.cursor(from + mLen),
    });
    return;
  }

  // Check if the selection is already wrapped.
  const before = view.state.doc.sliceString(Math.max(0, from - mLen), from);
  const after = view.state.doc.sliceString(to, to + mLen);
  if (before === marker && after === marker) {
    // Unwrap: remove the surrounding markers.
    view.dispatch({
      changes: [
        { from: from - mLen, to: from, insert: "" },
        { from: to, to: to + mLen, insert: "" },
      ],
      selection: EditorSelection.range(from - mLen, to - mLen),
    });
    return;
  }

  // Wrap the selection.
  view.dispatch({
    changes: { from, to, insert: marker + sel + marker },
    selection: EditorSelection.range(from + mLen, to + mLen),
  });
}

// ── Bold ─────────────────────────────────────────────────────────────────────
// Mapped to the shared `toggle-bold` command (SFE-P2a) — canonical `**`
// matches this file's own pre-existing marker exactly.

export function applyBold(view: EditorView): void {
  applyWrapCommand(view, { kind: "toggle-bold" }, 2);
}

// ── Italic ───────────────────────────────────────────────────────────────────
// NOT mapped — see this file's header ("desktop -> shared-command mapping")
// for why: canonical spelling diverges (`_` here vs the shared command's
// `*`).

export function applyItalic(view: EditorView): void {
  toggleInlineWrap(view, "_");
}

// ── Strikethrough ─────────────────────────────────────────────────────────────
// Mapped to the shared `toggle-strike` command — canonical `~~` matches.

export function applyStrikethrough(view: EditorView): void {
  applyWrapCommand(view, { kind: "toggle-strike" }, 2);
}

// ── Inline code ───────────────────────────────────────────────────────────────
// Mapped to the shared `toggle-inline-code` command — canonical `` ` ``
// matches.

export function applyInlineCode(view: EditorView): void {
  applyWrapCommand(view, { kind: "toggle-inline-code" }, 1);
}

// ── Link ─────────────────────────────────────────────────────────────────────
// Mapped to the shared `insert-link` command. Desktop's own placeholder
// href (`"url"`) and no-selection text placeholder (`"link text"`) are
// supplied explicitly as this file's own arguments — the shared command's
// OWN default placeholder (`"text"`) is never exercised here, only used by
// callers that pass no override at all.

export function applyLink(view: EditorView): void {
  const { from, to } = mainSel(view);
  const text = view.state.doc.toString();
  const sel = selectedText(view);
  const overrideText = from === to ? "link text" : undefined;

  const result = applyCommand(
    { text, version: 0 },
    { start: from, endExclusive: to },
    { kind: "insert-link", href: "url", text: overrideText },
  );
  if ("refused" in result) return;
  const { edit } = result;

  const linkText = overrideText ?? sel;
  const textStart = edit.from + 1;
  const hrefStart = textStart + linkText.length + 2;
  const selection =
    from === to
      ? EditorSelection.range(textStart, textStart + linkText.length)
      : EditorSelection.range(hrefStart, hrefStart + "url".length);

  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection });
}

// ── Blockquote ───────────────────────────────────────────────────────────────
// Mapped to the shared `toggle-blockquote` command — same all-or-nothing
// `"> "`-prefix detection/toggle this file used before mapping.

/** Toggle `> ` prefix on every selected line. */
export function applyBlockquote(view: EditorView): void {
  applyBlockLevelCommand(view, { kind: "toggle-blockquote" });
}

// ── Unordered list ────────────────────────────────────────────────────────────
// Mapped to the shared `toggle-list` (`variant: "bullet"`) command — same
// `"- "`/`"* "` detection and canonical `"- "` this file used before
// mapping, plus indentation preservation the shared command adds on top
// (no pinned test exercises an indented line, so this is additive).

export function applyUnorderedList(view: EditorView): void {
  applyBlockLevelCommand(view, { kind: "toggle-list", variant: "bullet" });
}

// ── Ordered list ─────────────────────────────────────────────────────────────
// Mapped to the shared `toggle-list` (`variant: "ordered"`) command — same
// digit-prefix detection/renumbering this file used before mapping for the
// pinned single-line case, plus the "touched contiguous list" renumbering
// extension the shared command adds for a selection adjacent to an
// existing numbered list (no pinned test has an adjacent list, so this is
// additive too).

export function applyOrderedList(view: EditorView): void {
  applyBlockLevelCommand(view, { kind: "toggle-list", variant: "ordered" });
}

// ── Heading ───────────────────────────────────────────────────────────────────
// Mapped to the shared `set-heading` command. The shared command SETS a
// specific level (or strips via `level: "none"`) — it does not itself
// toggle "same level pressed again removes it" the way this file's old
// inline logic did, so that toggle DECISION is made here, via
// `commandState`'s reported active level, before delegating the actual
// line rewrite to `applyCommand`.

export function applyHeading(view: EditorView, level: 1 | 2 | 3 | 4): void {
  const { from } = mainSel(view);
  const text = view.state.doc.toString();
  const snapshot = { text, version: 0 };
  const selection = { start: from, endExclusive: from };

  const active = commandState(snapshot, selection)["set-heading"].level;
  const targetLevel = active === level ? "none" : level;

  const result = applyCommand(snapshot, selection, { kind: "set-heading", level: targetLevel });
  if ("refused" in result) return;
  const { edit } = result;

  // Caret lands at the END of the rewritten heading prefix — NOT at
  // `edit.from + edit.insert.length`. `computeSetHeading`'s edit is a
  // MINIMAL diff (D3): rewriting "## " to "### " is a single "#" INSERTED
  // between the existing "##" and the trailing space, not a full-prefix
  // replacement, so `edit.from + edit.insert.length` lands INSIDE the new
  // "###" run (before the space) instead of after the whole prefix — a
  // caret regression from this file's pre-mapping behavior, which always
  // placed the caret at `line.from + prefix.length`. `view.state.doc`
  // still reflects the PRE-dispatch document here, and `lineAt(edit.from)`
  // always resolves to the heading's own resulting line — whether the
  // caret was originally on a setext text line or its underline — because
  // `computeSetHeading` never touches any OTHER line (run spec: "ONLY the
  // targeted heading's lines change").
  const lineStart = view.state.doc.lineAt(edit.from).from;
  const targetPrefixLength = targetLevel === "none" ? 0 : targetLevel + 1; // "#".repeat(n) + " "
  view.dispatch({
    changes: { from: edit.from, to: edit.to, insert: edit.insert },
    selection: EditorSelection.cursor(lineStart + targetPrefixLength),
  });
}

// ── Horizontal rule ───────────────────────────────────────────────────────────
// Mapped to the shared `insert-horizontal-rule` command — same
// `"\n\n---\n\n"` snippet at the same line-boundary insertion point this
// file used before mapping.

export function applyHr(view: EditorView): void {
  applyInsertAtCaretCommand(view, { kind: "insert-horizontal-rule" });
}

// ── Page break ───────────────────────────────────────────────────────────────
// The canonical Gutterpress author token is `@page-break` on its own line.
// Source: packages/cli/src/lib/markdown/markers.js line 13.

export function applyPageBreak(view: EditorView): void {
  dispatchLayoutDescriptor(view, pageBreakDescriptor());
}

// ── Table ─────────────────────────────────────────────────────────────────────
// Mapped to the shared `insert-table` command with `rows: 1` — this file's
// skeleton has always been exactly one body row, so `rows: 1` reproduces it
// byte-for-byte (including the `[1, 10]` column clamp, which the shared
// command's own implementation preserves).

export function applyTable(view: EditorView, cols: number): void {
  applyInsertAtCaretCommand(view, { kind: "insert-table", rows: 1, cols });
}

// ── Image ─────────────────────────────────────────────────────────────────────
// The supported class vocabulary (positions, sizes, and their permanent
// legacy aliases) lives in ONE place: `$lib/editor/image-classes` — the
// option tables there drive the insert dialog, the context menu, and the
// attrs round-trip helpers alike.

/**
 * Build the `{…}` markdown-it-attrs suffix for a NEW image from the insert
 * dialog's width/position/size/shape picks (empty string when none are
 * set). Position/size inputs are canonicalized through the option tables,
 * so a caller still holding a removed legacy name ("full-bleed") writes the
 * live gp-* class, never a dead one. Extracted out of `applyImage` below
 * (inline-editing plan §4.4) so the context menu's image actions can share
 * the exact same suffix rule — though for EXISTING tokens they go through
 * image-classes' tokenize → set-facet → serialize instead, which preserves
 * attrs this builder doesn't know about.
 */
export function buildImageAttrsString(
  width?: string,
  position?: string,
  size?: string,
  shape?: boolean,
): string {
  let tokens: string[] = [];
  tokens = setWidth(tokens, width || null);
  tokens = setPositionClass(
    tokens,
    position ? (normalizeClassInput(IMAGE_POSITION_OPTIONS, position) ?? null) : null,
  );
  tokens = setSizeClass(
    tokens,
    size ? (normalizeClassInput(IMAGE_SIZE_OPTIONS, size) ?? null) : null,
  );
  tokens = setShapeClass(tokens, shape === true);
  return serializeImageAttrs(tokens);
}

export function applyImage(
  view: EditorView,
  src: string,
  alt: string,
  width?: string,
  position?: string,
  size?: string,
  shape?: boolean,
): void {
  const attrStr = buildImageAttrsString(width, position, size, shape);
  const snippet = `\n\n![${alt}](${src})${attrStr}\n\n`;
  const insertAt = insertionPointAfterCurrentLine(view);
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: snippet },
    selection: EditorSelection.cursor(insertAt + snippet.length),
  });
}

// ── Insert layout block (UX M26) ─────────────────────────────────────────────
// The toolbar previously exposed none of Gutterpress's own layout primitives
// beyond @page-break (UX finding M26). These helpers insert a correct core
// `@marker` skeleton (the core marker whitelist — chapter/spread/
// page/section/continue/page-break/column-break/end-section; see the
// plugin's own header comment) as its own block after the CURRENT line,
// blank-line padded — the same convention applyHr/applyPageBreak above
// already use. Project-plugin markers (@sidebar, @callout, …) are NOT core
// (CLAUDE.md §5/§6) and have no helper here; a project plugin that wants a
// picker entry should contribute its own toolbar item, not extend this one.

/** Which layout skeleton `applyLayoutBlock` inserts — re-exported from the
 *  shared `@dimm-city/gutterpress-editor/core` command vocabulary
 *  (`commands.ts`, SFE-P1c) rather than declared locally, so there is
 *  exactly one definition of this union (D1 vocabulary; D4: "Svelte
 *  components do not define core editor command or protocol types" — this
 *  module is CodeMirror/desktop code, not a Svelte component, but the same
 *  one-vocabulary rule applies to it as the union's other consumer). */
export type { LayoutBlockKind };

/**
 * A layout-block insertion, decoupled from ANY editing surface (SFE-P3ab).
 * `insert` is the exact text to splice in; `selectFrom`/`selectTo` are
 * OFFSETS RELATIVE TO THE INSERTION POINT (not absolute document offsets —
 * the caller adds its own `insertAt`) marking the range a caller should
 * place the selection/caret over afterward (`selectFrom === selectTo` is a
 * collapsed cursor, matching `EditorSelection.range(x, x)` === `cursor(x)`).
 *
 * Split out of `applyChapterBlock`/`applySectionBlock`/`applyTwoColumnBlock`/
 * `applySpreadBlock`/`applyPageBreak` below (byte-identical templates, only
 * the CARET MATH was hoisted into a documented `{insert, selectFrom,
 * selectTo}` shape) so `rich-commands.ts` — which has no `EditorView` to
 * dispatch a transaction against — can compute the exact same `@marker`
 * skeletons via {@link descriptorForLayoutBlock} and apply them through
 * `EditorDocumentHost.applyEdit` instead (G-09: one template, two thin
 * per-surface appliers, not two copies of the marker text).
 */
export interface LayoutInsertDescriptor {
  readonly insert: string;
  readonly selectFrom: number;
  readonly selectTo: number;
}

function pageBreakDescriptor(): LayoutInsertDescriptor {
  const insert = "\n\n@page-break\n\n";
  return { insert, selectFrom: insert.length, selectTo: insert.length };
}

/** The placeholder is QUOTED (`@chapter "Chapter Title"`), not bare. A bare
 *  multi-word label tokenizes into more than one bare token in
 *  `parseMarkerLine`, which fails its "exactly one bare token" name rule and
 *  silently degrades to no `data-chapter-label` / no `.chapter-opener` —
 *  exactly the opposite of what this control advertises. Quoting collapses
 *  the label to a single token regardless of internal spaces, so it actually
 *  produces the label + chapter-opener (verified against the core marker
 *  renderer). See marker-completions.ts's `applyChapterCompletion` for the
 *  identical fix applied to the completion source's `@chapter` template. */
function chapterBlockDescriptor(): LayoutInsertDescriptor {
  const label = "Chapter Title";
  const prefix = '\n\n@chapter "';
  const suffix = '"';
  const insert = `${prefix}${label}${suffix}\n\n@page\n\n`;
  return { insert, selectFrom: prefix.length, selectTo: prefix.length + label.length };
}

function sectionBlockDescriptor(): LayoutInsertDescriptor {
  const prefix = "\n\n@section\n";
  const insert = `${prefix}\n@end-section\n\n`;
  return { insert, selectFrom: prefix.length, selectTo: prefix.length };
}

/** A working two-column section. `.col-split` (not bare `.two-column`) is
 *  required because `@column-break` is structural within that authoring
 *  primitive; plain CSS multicol does not create the explicit left/right
 *  wrappers the fixed split needs. */
function twoColumnBlockDescriptor(): LayoutInsertDescriptor {
  const prefix = "\n\n@section .col-split\n";
  const insert = `${prefix}\n@column-break\n\nRight column content.\n\n@end-section\n\n`;
  return { insert, selectFrom: prefix.length, selectTo: prefix.length };
}

function spreadBlockDescriptor(): LayoutInsertDescriptor {
  const insert = "\n\n@spread\n\n@page\n\n";
  return { insert, selectFrom: insert.length, selectTo: insert.length };
}

/** The single source of truth for every `@marker` skeleton `applyLayoutBlock`
 *  (this file, CodeMirror) and `applyRichLayoutBlock` (`rich-commands.ts`,
 *  the rich surface) insert. `"page-break"` reuses {@link pageBreakDescriptor}
 *  — one canonical `@page-break` token, not a second copy. */
export function descriptorForLayoutBlock(kind: LayoutBlockKind): LayoutInsertDescriptor {
  switch (kind) {
    case "chapter":     return chapterBlockDescriptor();
    case "section":     return sectionBlockDescriptor();
    case "two-column":  return twoColumnBlockDescriptor();
    case "page-break":  return pageBreakDescriptor();
    case "spread":      return spreadBlockDescriptor();
  }
}

/** Dispatches one {@link LayoutInsertDescriptor} as a single CodeMirror
 *  transaction, inserted after the current line (this file's own
 *  `insertionPointAfterCurrentLine` convention). */
function dispatchLayoutDescriptor(view: EditorView, d: LayoutInsertDescriptor): void {
  const insertAt = insertionPointAfterCurrentLine(view);
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: d.insert },
    selection: EditorSelection.range(insertAt + d.selectFrom, insertAt + d.selectTo),
  });
}

/** `@chapter` + a nested `@page`, with the title placeholder selected so
 *  typing immediately replaces it (mirrors applyLink's "select link text"
 *  placeholder pattern above). */
export function applyChapterBlock(view: EditorView): void {
  dispatchLayoutDescriptor(view, chapterBlockDescriptor());
}

/** `@section` / `@end-section` pair, cursor left on the blank line between
 *  them (same shape as the marker-completions.ts inline template, just
 *  block-inserted after the current line instead of typed in place). */
export function applySectionBlock(view: EditorView): void {
  dispatchLayoutDescriptor(view, sectionBlockDescriptor());
}

/** A working two-column section — see {@link twoColumnBlockDescriptor}. */
export function applyTwoColumnBlock(view: EditorView): void {
  dispatchLayoutDescriptor(view, twoColumnBlockDescriptor());
}

/** `@spread` with a first nested `@page`, cursor left ready to write. */
export function applySpreadBlock(view: EditorView): void {
  dispatchLayoutDescriptor(view, spreadBlockDescriptor());
}

/** Dispatches to the right layout-block helper for `kind`. `"page-break"`
 *  reuses the existing {@link applyPageBreak} — one canonical implementation
 *  of the `@page-break` token, not a second copy. */
export function applyLayoutBlock(view: EditorView, kind: LayoutBlockKind): void {
  switch (kind) {
    case "chapter":     applyChapterBlock(view); break;
    case "section":     applySectionBlock(view); break;
    case "two-column":  applyTwoColumnBlock(view); break;
    case "page-break":  applyPageBreak(view); break;
    case "spread":      applySpreadBlock(view); break;
  }
}

/** Picker entries for the "Insert layout block" toolbar control — the order
 *  shown in the popup. */
export interface LayoutBlockItem {
  kind: LayoutBlockKind;
  label: string;
  detail: string;
}

export const LAYOUT_BLOCK_ITEMS: readonly LayoutBlockItem[] = [
  { kind: "chapter", label: "Chapter", detail: "@chapter — wraps content, auto chapter-opener" },
  { kind: "section", label: "Section", detail: "@section … @end-section — keeps content together" },
  { kind: "two-column", label: "Two columns", detail: "@section .col-split … @column-break … @end-section" },
  { kind: "page-break", label: "Page break", detail: "@page-break — hard break, no page wrapper" },
  { kind: "spread", label: "Spread", detail: "@spread — a two-page facing spread" },
] as const;

// ── Image properties / unwrap / link edit at the caret (SFE-P3d-parity, Lane D) ──
//
// Closes the parity-matrix's former `image-properties`/`image-unwrap`/
// `link-edit` waiver rows: before this run, no command in either surface
// edited an EXISTING image or link in place — `applyImage` above and
// `applyLink` only ever INSERT a new one. The ONE path that edited an
// existing image/link was the preview context menu (soon deleted by P4).
//
// Each function below resolves its target from the CURRENT CARET
// (`mainSel(view).from`) rather than a payload, delegating the entire
// locate/compute decision to `caret-token-commands.ts`'s pure functions
// (the same ones `context-menu-controller.svelte.ts`'s "Set properties…"/
// "Unwrap image"/"Edit link…" logic is built from — see that module's
// header) — this file only supplies the CodeMirror read/dispatch, matching
// every other function above's `(view: EditorView, …)` shape.
//
// image-properties and link-edit are each split into a LOCATE step and an
// APPLY step, rather than one function owning an internal
// `promptImageProperties`/`promptText` await, so `+page.svelte` — which
// owns both dialogs AND `validateImageProperties` (image-properties only) —
// can inject validation and re-verify the target between them; the CALLER
// awaits its own dialog and re-checks staleness itself (mirroring
// `openRichImageProperties`'s existing shape) rather than this file
// swallowing that orchestration. image-unwrap has no dialog, so locate and
// apply happen back to back in one function with no staleness window to
// guard. Refusals are D14 `Diagnostic`s, never a generic "failed" —
// `CaretTokenCommandOutcome` mirrors `rich-commands.ts`'s own
// `RichCommandOutcome` shape so a caller reports both surfaces' refusals
// identically.

/** The uniform result of a caret-driven token command: `ok:true` covers
 *  BOTH "applied an edit" and "nothing changed" — callers that need to
 *  distinguish those can inspect the dispatched transaction themselves;
 *  every refusal carries a specific D14 `Diagnostic`, never a bare
 *  boolean. */
export type CaretTokenCommandOutcome =
  | { readonly ok: true }
  | { readonly ok: false; readonly diagnostic: Diagnostic };

/**
 * D14 diagnostic for a caret-token command whose target document changed
 * underneath it between locating the token and applying the edit — an
 * intervening dialog (`promptImageProperties`/`promptText`, owned by the
 * caller) gives real time for an external reload, a FILE SWITCH, or the
 * author's own typing to land. CodeMirror's `view.dispatch` has no
 * staleness check of its own (unlike the rich surface's
 * `EditorDocumentHost.applyEdit`, which is versioned — see
 * `rich-commands.ts`'s equivalent functions), so this is the proportionate
 * replacement: re-verify DOCUMENT IDENTITY, not just the target span's own
 * bytes, immediately before dispatching. "Must never guess a range" (this
 * run's own instruction) is exactly what this check prevents.
 *
 * SFE-P3d-parity repair round 1 (CONFIRMED finding): a bare byte compare at
 * the ORIGINAL offsets (`sliceString(match.start, match.end) !==
 * originalSpan`) has no notion of document identity. This desktop app keeps
 * ONE `EditorView` alive across every open file — `MarkdownEditor.svelte`'s
 * own header: "the view itself is never torn down between files" — and
 * `switchFile()` replaces the view's state via `view.setState(...)`, a
 * WHOLESALE state replacement, not an incremental edit. So while a dialog
 * is open the author (or an external reload) can switch to a DIFFERENT
 * file entirely; the byte-compare alone could pass if the new file happens
 * to have the SAME bytes at the SAME offsets (two chapters sharing a
 * boilerplate `![Logo](logo.png)` at the same position is entirely
 * plausible in a book), silently writing the edit into the WRONG document.
 * `EditorState` in CodeMirror 6 is immutable and the `doc` (`Text`) field is
 * REPLACED — not merely mutated — by any accepted transaction OR by
 * `setState()`, and is reference-EQUAL to its prior value only when the
 * document truly did not change (a selection-only transaction reuses the
 * same `Text`). Capturing `view.state.doc` at locate time and comparing by
 * REFERENCE at apply time is therefore both a document-identity check (a
 * file switch always produces a brand-new `Text`) and a strictly stronger
 * substitute for the byte compare (any accepted edit anywhere in the
 * document invalidates the capture) — the SAME strictness the rich
 * surface's `captureRichSelection`/`isRichSelectionCaptureFresh` already
 * applies via `richDocHost.getSnapshot().version`, just proven a different
 * way on this surface's plain `EditorView` (no `DocumentSnapshot.version`
 * to compare here). The original exact-span byte compare is KEPT alongside
 * it as defense in depth (belt and suspenders — a future change to either
 * surface's identity semantics should not silently reopen this gap).
 */
function staleCaretTokenSpanDiagnostic(): Diagnostic {
  return {
    category: "EDITOR_STALE_EDIT",
    message: "This part of the document changed before the edit could be applied. Try again.",
  };
}

/** Locate step for "Image properties…": resolves the image at the caret
 *  and seeds an {@link ImagePropertiesValue} from its current token, ready
 *  for the caller to hand to `ImagePropertiesDialog`. `originalSpan` is the
 *  exact text, and `capturedDoc` the exact document IDENTITY,
 *  {@link applyImagePropertiesEdit} re-verifies before dispatching (see
 *  {@link staleCaretTokenSpanDiagnostic}'s header). */
export interface ImagePropertiesAtCaret {
  readonly match: ImageTokenMatch;
  readonly initial: ImagePropertiesValue;
  readonly originalSpan: string;
  readonly capturedDoc: Text;
}

export function locateImagePropertiesAtCaret(view: EditorView): LocateResult<ImagePropertiesAtCaret> {
  const { from } = mainSel(view);
  const text = view.state.doc.toString();
  const located = locateImageAtCaret(text, from);
  if (!located.ok) return located;
  const { match, initial } = located.value;
  return {
    ok: true,
    value: { match, initial, originalSpan: text.slice(match.start, match.end), capturedDoc: view.state.doc },
  };
}

/** Apply step for "Image properties…": re-verifies `located`'s document
 *  identity AND its span's exact bytes, then computes and dispatches the
 *  diff between `located.initial` and `next`
 *  (`caret-token-commands.ts#computeImagePropertiesEdit` — the exact same
 *  diff rule `context-menu-controller.svelte.ts`'s "Set properties…" uses).
 *  Caller is expected to have already validated `next`
 *  (`validateImageProperties`). */
export function applyImagePropertiesEdit(
  view: EditorView,
  located: ImagePropertiesAtCaret,
  next: ImagePropertiesValue,
): CaretTokenCommandOutcome {
  if (
    view.state.doc !== located.capturedDoc ||
    view.state.doc.sliceString(located.match.start, located.match.end) !== located.originalSpan
  ) {
    return { ok: false, diagnostic: staleCaretTokenSpanDiagnostic() };
  }
  const edit = computeImagePropertiesEdit(located.match, located.initial, next);
  if (!edit) return { ok: true }; // nothing actually changed
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert } });
  return { ok: true };
}

/** "Unwrap image" — removes an existing image's enclosing link wrapper at
 *  the caret, leaving the image itself untouched. No dialog, so no
 *  intervening staleness window: locate and dispatch happen back to back
 *  against the SAME live `view`. */
export function applyImageUnwrapAtCaret(view: EditorView): CaretTokenCommandOutcome {
  const { from } = mainSel(view);
  const text = view.state.doc.toString();
  const located = locateImageUnwrapEdit(text, from);
  if (!located.ok) return { ok: false, diagnostic: located.diagnostic };
  const { from: editFrom, to: editTo, insert } = located.value;
  view.dispatch({ changes: { from: editFrom, to: editTo, insert } });
  return { ok: true };
}

/** Locate step for "Edit link…": resolves the link at the caret, ready to
 *  seed a text prompt with its current target. `originalSpan` is the exact
 *  text, and `capturedDoc` the exact document IDENTITY,
 *  {@link applyLinkEditEdit} re-verifies before dispatching (see
 *  {@link staleCaretTokenSpanDiagnostic}'s header). */
export interface LinkEditAtCaret {
  readonly match: LinkTokenMatch;
  readonly initialHref: string;
  readonly originalSpan: string;
  readonly capturedDoc: Text;
}

export function locateLinkEditAtCaret(view: EditorView): LocateResult<LinkEditAtCaret> {
  const { from } = mainSel(view);
  const text = view.state.doc.toString();
  const located = locateLinkAtCaret(text, from);
  if (!located.ok) return located;
  const { match, initialHref } = located.value;
  return {
    ok: true,
    value: { match, initialHref, originalSpan: text.slice(match.start, match.end), capturedDoc: view.state.doc },
  };
}

/** Apply step for "Edit link…": re-verifies `located`'s document identity
 *  AND its span's exact bytes, then computes and dispatches the new href
 *  (`caret-token-commands.ts#computeLinkEditEdit` — `rewriteLinkToken`
 *  unchanged). */
export function applyLinkEditEdit(view: EditorView, located: LinkEditAtCaret, href: string): CaretTokenCommandOutcome {
  if (
    view.state.doc !== located.capturedDoc ||
    view.state.doc.sliceString(located.match.start, located.match.end) !== located.originalSpan
  ) {
    return { ok: false, diagnostic: staleCaretTokenSpanDiagnostic() };
  }
  const edit = computeLinkEditEdit(located.match, href);
  view.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert } });
  return { ok: true };
}

// ── Toolbar action vocabulary (SFE-P3ab) ─────────────────────────────────────
//
// Declared HERE (a plain `.ts` module) rather than inside `EditorToolbar.svelte`
// (where they used to live) because `rich-commands.ts` — also a plain `.ts`
// module, so it runs under `bun test` without svelte-check's preprocessing —
// needs them too: TypeScript's ambient `*.svelte` declaration exposes only a
// component's default export, so `import type { ToolbarAction } from
// "….svelte"` fails to typecheck outside svelte-check (see
// `components/crash-recovery-types.ts`'s header for the same rule applied to
// an earlier case). `EditorToolbar.svelte` now imports and re-exports these
// two names so its own existing public contract (`import type { ToolbarAction,
// ToolbarPayload } from "$lib/components/EditorToolbar.svelte"`, used by
// `+page.svelte`) is unchanged.

/** The set of named edit actions the toolbar can fire. */
export type ToolbarAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "code"
  | "link"
  | "blockquote"
  | "ul"
  | "ol"
  | "heading"
  | "hr"
  | "page-break"
  | "table"
  | "image"
  | "snippet"
  | "focus-mode"
  | "layout-block"
  // SFE-P3d-parity, Lane D: replacements for the three preview context-menu
  // actions that edit an EXISTING image/link in place (parity-matrix.md's
  // former waiver rows `image-properties`/`image-unwrap`/`link-edit`) — as
  // opposed to "link"/"image" above, which only ever INSERT a NEW one. All
  // three resolve their target from the CURRENT CARET rather than a
  // payload; `+page.svelte`'s `onAction` intercepts them before they would
  // otherwise reach `runToolbarAction`/`handleRichToolbarAction` (the same
  // interception "snippet"/"focus-mode" already get), so neither this
  // module's `TOOLBAR_ITEMS` entry below nor `MarkdownEditor.svelte`'s
  // switch needs a case for the actual edit — only the vocabulary.
  | "image-properties"
  | "image-unwrap"
  | "link-edit";

export type ToolbarPayload =
  | { level: 1 | 2 | 3 | 4 } // heading
  | { cols: number } // table
  | { src: string; alt: string; width?: string; position?: string; size?: string; shape?: boolean } // image
  | { kind: LayoutBlockKind }; // layout-block

// ── Toolbar item declarations (single source of truth — M23) ────────────────
//
// EditorToolbar renders BOTH the always-visible toolbar groups AND the
// narrow-width "More" overflow menu from this ONE array. Previously the More
// menu was a hand-duplicated second list of buttons that had already drifted
// from the toolbar — it silently omitted Save and Snippet, so Save vanished
// entirely once the container narrowed enough to hide the primary group.
// Deriving both surfaces from the same filtered list makes that class of
// drift structurally impossible: an item is either in this array (and shows
// up everywhere it should) or it isn't declared at all.
//
// Pure data + a pure filter function — zero Svelte imports, so it is testable
// the same way the transaction helpers above are.

/** Which visually-grouped section of the always-visible toolbar an item renders in. */
type ToolbarGroup = "save" | "primary" | "block" | "insert";

/**
 * How an item behaves when activated:
 * - "save"/"action": a single button that fires a callback directly.
 * - "heading"/"table"/"image"/"layout-block": opens a picker (popup or
 *   dialog) — the component supplies the bespoke markup for these, but
 *   membership, ordering, and group/visibility rules still come from this
 *   array.
 */
type ToolbarItemKind = "save" | "action" | "heading" | "table" | "image" | "layout-block";

export interface ToolbarItemDef {
  /** Stable identity — also the {#each} key. */
  id: string;
  kind: ToolbarItemKind;
  /** For kind "action": the ToolbarAction name fired via onAction(action). */
  action?: string;
  /** Icon name (EditorToolbar resolves this against its own IconName type). */
  icon: string;
  /** Tooltip (title attribute) for the icon-only toolbar button. */
  title: string;
  /** aria-label for the icon-only toolbar button (may differ from the More-menu label). */
  ariaLabel: string;
  /** Plain-text label shown for this item inside the More menu. */
  label: string;
  group: ToolbarGroup;
  /** Only shown when isDesktop() — image insert and snippet need host IPCs. */
  desktopOnly?: boolean;
}

export const TOOLBAR_ITEMS: ToolbarItemDef[] = [
  {
    id: "save",
    kind: "save",
    icon: "save",
    title: "Save changes now",
    ariaLabel: "Save changes now",
    label: "Save",
    group: "save",
  },
  {
    id: "bold",
    kind: "action",
    action: "bold",
    icon: "bold",
    title: "Bold (Ctrl+B)",
    ariaLabel: "Bold",
    label: "Bold",
    group: "primary",
  },
  {
    id: "italic",
    kind: "action",
    action: "italic",
    icon: "italic",
    title: "Italic (Ctrl+I)",
    ariaLabel: "Italic",
    label: "Italic",
    group: "primary",
  },
  {
    id: "strikethrough",
    kind: "action",
    action: "strikethrough",
    icon: "strikethrough",
    title: "Strikethrough",
    ariaLabel: "Strikethrough",
    label: "Strikethrough",
    group: "primary",
  },
  {
    id: "code",
    kind: "action",
    action: "code",
    icon: "code",
    title: "Inline code",
    ariaLabel: "Inline code",
    label: "Inline code",
    group: "primary",
  },
  {
    id: "link",
    kind: "action",
    action: "link",
    icon: "link-2",
    title: "Link (Ctrl+K)",
    ariaLabel: "Insert link",
    label: "Link",
    group: "primary",
  },
  {
    id: "blockquote",
    kind: "action",
    action: "blockquote",
    icon: "quote",
    title: "Blockquote",
    ariaLabel: "Blockquote",
    label: "Blockquote",
    group: "block",
  },
  {
    id: "ul",
    kind: "action",
    action: "ul",
    icon: "list",
    title: "Bullet list",
    ariaLabel: "Unordered list",
    label: "Bullet list",
    group: "block",
  },
  {
    id: "ol",
    kind: "action",
    action: "ol",
    icon: "list-ordered",
    title: "Numbered list",
    ariaLabel: "Ordered list",
    label: "Numbered list",
    group: "block",
  },
  {
    id: "heading",
    kind: "heading",
    icon: "heading",
    title: "Insert heading",
    ariaLabel: "Insert heading",
    label: "Heading",
    group: "block",
  },
  {
    id: "hr",
    kind: "action",
    action: "hr",
    icon: "minus",
    title: "Horizontal rule",
    ariaLabel: "Insert horizontal rule",
    label: "Horizontal rule",
    group: "insert",
  },
  {
    id: "layout-block",
    kind: "layout-block",
    icon: "columns-2",
    title: "Insert layout block (chapter, section, columns, spread…)",
    ariaLabel: "Insert layout block",
    label: "Insert layout block…",
    group: "insert",
  },
  {
    id: "page-break",
    kind: "action",
    action: "page-break",
    icon: "file-separator",
    title: "Page break (@page-break)",
    ariaLabel: "Insert page break",
    label: "Page break",
    group: "insert",
  },
  {
    id: "table",
    kind: "table",
    icon: "table",
    title: "Insert table",
    ariaLabel: "Insert table",
    label: "Insert table…",
    group: "insert",
  },
  {
    id: "image",
    kind: "image",
    icon: "image",
    title: "Insert image",
    ariaLabel: "Insert image",
    label: "Insert image…",
    group: "insert",
    desktopOnly: true,
  },
  {
    id: "snippet",
    kind: "action",
    action: "snippet",
    icon: "puzzle",
    title: "Insert snippet (Ctrl/Cmd+Shift+S)",
    ariaLabel: "Insert snippet",
    label: "Insert snippet",
    group: "insert",
    desktopOnly: true,
  },
  // SFE-P3d-parity, Lane D: replacements for the preview context menu's
  // "Set properties…"/"Unwrap image"/"Edit link…" — each resolves its
  // target from the CURRENT CARET (place the cursor on an existing image or
  // link first) rather than a dialog-collected payload, so — like every
  // other `kind: "action"` item — no bespoke template branch is needed in
  // EditorToolbar.svelte; `+page.svelte`'s `onAction` intercepts these
  // three by name before the generic `runToolbarAction`/
  // `handleRichToolbarAction` fallback (the same interception
  // "snippet"/"focus-mode" already get).
  {
    id: "image-properties",
    kind: "action",
    action: "image-properties",
    icon: "settings",
    title: "Edit image properties (place cursor on an existing image)",
    ariaLabel: "Edit image properties",
    label: "Image properties…",
    group: "insert",
  },
  {
    id: "image-unwrap",
    kind: "action",
    action: "image-unwrap",
    icon: "external-link",
    title: "Remove this image's link wrapper (place cursor on a wrapped image)",
    ariaLabel: "Unwrap image",
    label: "Unwrap image",
    group: "insert",
  },
  {
    id: "link-edit",
    kind: "action",
    action: "link-edit",
    icon: "link-2",
    title: "Edit this link's target (place cursor on an existing link)",
    ariaLabel: "Edit link target",
    label: "Edit link…",
    group: "insert",
  },
  {
    // Focus mode lives on the EDITOR toolbar (not the main toolbar): it is an
    // editing posture, and this bar stays visible inside focus mode so the
    // same button toggles back out (Esc works too).
    id: "focus-mode",
    kind: "action",
    action: "focus-mode",
    icon: "maximize",
    title: "Focus mode (Ctrl+Shift+F)",
    ariaLabel: "Toggle focus mode",
    label: "Focus mode",
    group: "insert",
  },
];

/**
 * Filters `TOOLBAR_ITEMS` down to what should be visible right now. Both the
 * grouped toolbar buttons (filtered further by `.group`) and the flat More
 * menu (rendered unfiltered) must be derived from this same list so neither
 * surface can omit an item the other one shows.
 */
export function visibleToolbarItems(opts: {
  hasSave: boolean;
  desktop: boolean;
}): ToolbarItemDef[] {
  return TOOLBAR_ITEMS.filter((item) => {
    if (item.kind === "save" && !opts.hasSave) return false;
    if (item.desktopOnly && !opts.desktop) return false;
    return true;
  });
}

/**
 * caret-token-commands.ts (SFE-P3d-parity, Lane D)
 *
 * Closes the three parity-matrix waiver rows condition 2 names by name:
 * `image-properties`, `image-unwrap`, `link-edit`. Before this run, the ONLY
 * path that edited an EXISTING image or link in place was the preview
 * context menu (`context-menu-controller.svelte.ts`, `imageItems`/
 * `linkItems`) — P4 deletes that surface, and per the run specification a
 * waiver cannot satisfy condition 2 ("Image/link/layout context-menu source
 * changes have replacement editor commands").
 *
 * This module is the PURE computation shared by both editing surfaces
 * (G-09 — one implementation per authoring concept): given the live
 * document TEXT and a CARET offset (both surfaces already expose this —
 * CodeMirror's `view.state.selection.main`, the rich mount's
 * `getSelection()`, which reports the SAME D3 source-offset space — see
 * `rich-commands.ts`'s header), locate the enclosing image/link token and
 * compute the exact replacement bytes. It reuses, rather than reimplements,
 * every existing tested primitive:
 *   - `context-menu-actions.ts`'s `findImageTokenAtOffset`/
 *     `findLinkTokenAtOffset` (this run's new caret-based finders, built on
 *     the SAME lexical scanners `findImageToken`/`resolveLinkToken` already
 *     use) to locate the target;
 *   - `findImageWrapper`/`rewriteImageToken`/`rewriteLinkToken`/
 *     `spliceToken` (pre-existing, tested) to compute the replacement;
 *   - `image-classes.ts`'s setter functions (pre-existing, tested — also
 *     used by `EditorToolbar`/`ImagePropertiesDialog`/`toolbar-actions.ts`)
 *     to apply an `ImagePropertiesValue` diff onto an existing token's
 *     attrs, reproducing `context-menu-controller.svelte.ts`'s own
 *     "Set properties…" diff rule (that controller is outside this lane's
 *     write ownership, so the RULE is reproduced here against the same
 *     shared setters, not imported from a private closure).
 *
 * Zero Svelte imports, zero CodeMirror imports, zero DOM — matches this
 * repo's existing `toolbar-actions.ts`/`rich-commands.ts`/
 * `context-menu-actions.ts` posture (PWA-clean, `bun test`-able without a
 * browser). This module is deliberately NOT one of `parity-matrix.md`'s
 * "known command files" (`toolbar-actions.ts`/`rich-commands.ts`/
 * `commands.ts`) — the per-surface, NAMED command a caller actually invokes
 * (and that the matrix cites as each row's "Replacement command(s)") lives
 * in those files. SFE-P3d-parity repair round 1 (CONFIRMED finding): the
 * six names this paragraph used to give — `applyImagePropertiesAtCaret`/
 * `applyLinkEditAtCaret` (source) and `applyRichImagePropertiesAtCaret`/
 * `applyRichLinkEditAtCaret` (rich), each said to take "the live
 * `EditorView`/host … plus the dialog callback it needs" — do not exist and
 * never did; only `applyImageUnwrapAtCaret`/`applyRichImageUnwrapAtCaret`
 * (no dialog, so no locate/apply split) match that description. The REAL
 * shape, correctly documented 300 lines below in `toolbar-actions.ts`
 * (search that file for "LOCATE step" / "APPLY step") and mirrored in
 * `rich-commands.ts`, is a LOCATE/APPLY SPLIT, not a single function taking
 * a dialog callback: `toolbar-actions.ts#locateImagePropertiesAtCaret` /
 * `#applyImagePropertiesEdit`, `#applyImageUnwrapAtCaret`,
 * `#locateLinkEditAtCaret` / `#applyLinkEditEdit` for source (each LOCATE
 * function takes the live `EditorView` and returns a `LocateResult`; each
 * APPLY function takes the view, the located result, and the caller-
 * resolved value — no callback), and `rich-commands.ts#locateRichImageProp
 * ertiesAtCaret` / `#applyRichImagePropertiesEdit`,
 * `#applyRichImageUnwrapAtCaret`, `#locateRichLinkEditAtCaret` /
 * `#applyRichLinkEditEdit` for rich (same `(host: EditorDocumentHost, …,
 * live: LiveSelection)` shape as this file's other `applyRich*` functions).
 * The split exists because the CALLER (`+page.svelte`) owns both the
 * `promptImageProperties`/`promptText` dialog AND the document-identity
 * staleness re-check that must happen AFTER the dialog's `await` resolves
 * and BEFORE the edit dispatches — see `toolbar-actions.ts`'s
 * `staleCaretTokenSpanDiagnostic` header for the full rationale. Each set
 * of five wrappers (plus the two single-step unwrap functions) is thin:
 * read text/caret from their own surface, delegate the ENTIRE locate/
 * compute decision to the pure functions below, and dispatch through their
 * own surface's existing write seam (`view.dispatch`/`host.applyEdit`) —
 * one implementation, two thin appliers (G-09), exactly like
 * `descriptorForLayoutBlock`/`applyLayoutBlock`/`applyRichLayoutBlock`
 * already do for layout markers.
 */
import type { Diagnostic } from "@dimm-city/gutterpress-editor/core";
import {
  findImageTokenAtOffset,
  findImageWrapper,
  findLinkTokenAtOffset,
  rewriteImageToken,
  rewriteLinkToken,
  type ImageTokenMatch,
  type LinkTokenMatch,
} from "./context-menu-actions";
import {
  IMAGE_PIN_CLASS,
  IMAGE_POSITION_OPTIONS,
  getLayerClass,
  getPinAlignment,
  getPositionClass,
  getSizeClass,
  getSpacingClass,
  getWidth,
  hasFlushClass,
  hasShapeClass,
  normalizeClassInput,
  serializeImageAttrs,
  setFlushClass,
  setLayerClass,
  setPinAlignment,
  setPositionClass,
  setShapeClass,
  setSizeClass,
  setSpacingClass,
  setWidth,
  tokenizeImageAttrs,
  type ImagePropertiesValue,
} from "./image-classes";

/** A `[from, to)` replacement, in the same shape D3's `SourceEdit` uses
 *  (minus `expectedVersion`, which each surface's own applier supplies). */
export interface TextEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
}

/** Why a caret-driven command found nothing safe to act on — D14: "Generic
 *  'failed' errors at a boundary are a confirmed review finding unless no
 *  more specific classification is possible." Three distinct, real causes:
 *  - `"no-token"` — no well-formed image/link token's span contains the
 *    caret (covers "genuinely nothing here", a reference-style link, and a
 *    "linkified" bare URL alike — see `findLinkTokenAtOffset`'s own header
 *    for why this module does not further distinguish those three).
 *  - `"fenced-code-block"` — the caret sits inside a region markdown-it
 *    treats as literal text: a fenced code block, an indented code block,
 *    or an inline code span ({@link isInsideLiteralMarkdownRegion} — this
 *    reason id predates that widening and is kept as-is rather than
 *    renamed, since it is a stable D14-adjacent identifier callers and
 *    tests already match on). Markdown-it never parses inline syntax in
 *    any of the three, so text that LOOKS like `![alt](src)` there is not
 *    a real image — refusing here is what the run's own fixture
 *    requirement ("that is not a real image") describes.
 *  - `"no-wrapper"` — a real image token WAS found, but it has no enclosing
 *    link wrapper for `image-unwrap` to remove. */
export type CaretTokenRefusalReason = "no-token" | "fenced-code-block" | "no-wrapper";

/** D14 category + user-facing message for each {@link CaretTokenRefusalReason}. */
export function caretTokenDiagnostic(reason: CaretTokenRefusalReason): Diagnostic {
  switch (reason) {
    case "no-token":
      return {
        category: "EDITOR_INVALID_RANGE",
        message: "Place the cursor on an image or link, then try that again.",
      };
    case "fenced-code-block":
      return {
        category: "EDITOR_UNSUPPORTED_PROJECTION",
        message:
          "This looks like markdown, but it's inside a code block, so it isn't a real image or link. Edit it as plain text instead.",
      };
    case "no-wrapper":
      return {
        category: "EDITOR_INVALID_RANGE",
        message: "This image isn't wrapped in a link, so there's nothing to unwrap.",
      };
  }
}

export type LocateResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: CaretTokenRefusalReason; readonly diagnostic: Diagnostic };

function refuse<T>(reason: CaretTokenRefusalReason): LocateResult<T> {
  return { ok: false, reason, diagnostic: caretTokenDiagnostic(reason) };
}

// ── Fenced code block detection ─────────────────────────────────────────────

const FENCE_OPEN_RE = /^(`{3,}|~{3,})/;

/**
 * Strips container-indentation the fence match itself doesn't care about:
 * an optional single-level blockquote marker (`>` with an optional trailing
 * space — repeated, so a nested blockquote is handled too) THEN any amount
 * of leading whitespace. SFE-P3d-parity repair round 1 (CONFIRMED finding):
 * this used to strip only `{0,3}` leading spaces and never a `>`, so a
 * blockquoted fence (`` > ``` ``) and a list-nested fence indented 4+
 * columns were both invisible to this scanner — real committed content
 * (`examples/with-design-guide/design-guide`) quotes both shapes. Widening
 * this to "any amount of whitespace, after stripping blockquote markers" is
 * deliberately MORE permissive than strict CommonMark fence recognition
 * (which caps container indentation) — this module's whole posture is
 * fail-CLOSED (refuse a real target rather than risk rewriting literal
 * text), so over-refusing a few edge shapes that aren't really fenced code
 * is the safe direction to be wrong in.
 */
function stripFenceContainerPrefix(line: string): string {
  let s = line;
  for (;;) {
    const stripped = s.replace(/^ {0,3}>[ \t]?/, "");
    if (stripped === s) break;
    s = stripped;
  }
  return s.replace(/^\s*/, "");
}

/**
 * Whether `offset` sits inside a fenced code block (``` or ~~~, including
 * its own opening/closing fence lines, up to an unterminated fence's
 * end-of-document; blockquoted and arbitrarily-indented fences included —
 * see {@link stripFenceContainerPrefix}). Independent of, and deliberately
 * not sharing an implementation with, `rich-commands.ts`'s
 * `splitIntoBlocks` — that function does not distinguish a fenced block
 * from an ordinary paragraph in its own returned shape (both are
 * `isMarker:false`), so reusing it here would mean reaching into its
 * internals rather than its public contract; this is a small, self-
 * contained check with the one property this module needs. The two DO now
 * agree on the RESULT for a list-nested (4+ column indented) fence — both
 * treat it as literal — even though they remain separate implementations;
 * `splitIntoBlocks` is canonical for pagination/block segmentation, this
 * function is canonical for the caret-token refusal decision.
 */
export function isInsideFencedCodeBlock(text: string, offset: number): boolean {
  const lines = text.split("\n");
  let pos = 0;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let fenceFrom = 0;
  for (const line of lines) {
    const contentEnd = pos + line.length;
    const trimmed = stripFenceContainerPrefix(line);
    const fenceMatch = FENCE_OPEN_RE.exec(trimmed);
    if (fenceChar) {
      const closes =
        fenceMatch !== null &&
        fenceMatch[1]!.startsWith(fenceChar) &&
        fenceMatch[1]!.length >= fenceLen &&
        trimmed.slice(fenceMatch[1]!.length).trim() === "";
      if (closes) {
        if (offset >= fenceFrom && offset <= contentEnd) return true;
        fenceChar = null;
      } else if (offset >= pos && offset <= contentEnd) {
        return true;
      }
    } else if (fenceMatch) {
      fenceFrom = pos;
      fenceChar = fenceMatch[1]![0]!;
      fenceLen = fenceMatch[1]!.length;
      if (offset >= pos && offset <= contentEnd) return true;
    }
    pos = contentEnd + 1; // account for the "\n" split() consumed
  }
  if (fenceChar && offset >= fenceFrom) return true; // unterminated fence
  return false;
}

/**
 * Whether `offset`'s line is part of a CommonMark INDENTED code block — four
 * or more columns of leading indentation (or a leading tab), forming its
 * OWN block: preceded by a blank line or the start of the file, not a
 * continuation of a shallower paragraph or list item. SFE-P3d-parity
 * repair round 1 (CONFIRMED finding): markdown-it treats this region as
 * literal exactly like a fenced block, and this scanner had no notion of
 * it at all — a caret on `    ![a](b.png)` (4-space indent, no fence)
 * resolved as a real image token.
 *
 * Deliberately conservative rather than a full CommonMark list-context
 * resolver (see this file's header on why this module is a scanner, not a
 * parser): a run of indented, non-blank lines (blank-line gaps inside the
 * run are tolerated, matching CommonMark) that is NOT preceded by a
 * shallower, non-blank line is treated as one indented code block. This
 * intentionally also swallows some genuinely-indented list-continuation
 * content that is not really "code" — over-refusing here is the SAME safe
 * direction {@link stripFenceContainerPrefix} documents.
 */
function isInsideIndentedCodeBlock(text: string, offset: number): boolean {
  const lines = text.split("\n");
  const lineStart: number[] = [];
  let pos = 0;
  for (const line of lines) {
    lineStart.push(pos);
    pos += line.length + 1;
  }
  const isIndented = (line: string) => /^( {4,}|\t)/.test(line);
  let i = 0;
  let prevWasBlankOrStart = true;
  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === "") {
      prevWasBlankOrStart = true;
      i++;
      continue;
    }
    if (isIndented(line) && prevWasBlankOrStart) {
      const blockStartLine = i;
      let j = i;
      while (j < lines.length) {
        const l = lines[j]!;
        if (l.trim() === "") {
          let k = j + 1;
          while (k < lines.length && lines[k]!.trim() === "") k++;
          if (k < lines.length && isIndented(lines[k]!)) {
            j = k;
            continue;
          }
          break;
        }
        if (!isIndented(l)) break;
        j++;
      }
      const blockEndLine = j - 1;
      const from = lineStart[blockStartLine]!;
      const to = lineStart[blockEndLine]! + lines[blockEndLine]!.length;
      if (offset >= from && offset <= to) return true;
      i = j;
      prevWasBlankOrStart = false;
      continue;
    }
    prevWasBlankOrStart = false;
    i++;
  }
  return false;
}

/**
 * Whether `offset` sits inside an inline code span (`` `…` ``) within its
 * OWN paragraph. CommonMark inline code spans are backtick runs of equal
 * length delimiting literal content markdown-it never parses as further
 * markdown — exactly the same "not a real token" case
 * {@link isInsideFencedCodeBlock} exists for, scoped to the paragraph (a
 * code span cannot cross a blank line). SFE-P3d-parity repair round 1
 * (CONFIRMED finding): `` Use `![a](b.png)` in markdown. `` resolved as a
 * real image token before this existed — real committed documentation
 * (this project's own user guide and design guide) is exactly the corpus
 * most likely to quote markdown syntax this way.
 *
 * A best-effort scan, not a full CommonMark inline-code-span resolver
 * (greedy pairing of equal-length backtick runs in source order) — good
 * enough for the fail-closed refusal this function backs.
 */
function isInsideInlineCodeSpan(text: string, offset: number): boolean {
  // Find the contiguous non-blank-line "paragraph" containing `offset` — a
  // code span cannot cross a blank line, so scoping to it both bounds the
  // scan and avoids false matches from backticks in unrelated paragraphs.
  let paraStart = offset;
  while (paraStart > 0 && text[paraStart - 1] !== "\n") paraStart--;
  for (;;) {
    if (paraStart === 0) break;
    let lineStart = paraStart - 1;
    while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart--;
    const line = text.slice(lineStart, paraStart - 1);
    if (line.trim() === "") break;
    paraStart = lineStart;
  }
  let paraEnd = offset;
  while (paraEnd < text.length && text[paraEnd] !== "\n") paraEnd++;
  for (;;) {
    if (paraEnd >= text.length) break;
    let lineEnd = paraEnd + 1;
    while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd++;
    const line = text.slice(paraEnd + 1, lineEnd);
    if (line.trim() === "") break;
    paraEnd = lineEnd;
  }
  const para = text.slice(paraStart, paraEnd);
  const localOffset = offset - paraStart;

  const runRe = /`+/g;
  const runs: { start: number; end: number; len: number }[] = [];
  let m: RegExpExecArray | null;
  while ((m = runRe.exec(para))) {
    runs.push({ start: m.index, end: m.index + m[0].length, len: m[0].length });
  }
  let idx = 0;
  while (idx < runs.length) {
    const open = runs[idx]!;
    let matched = false;
    for (let j = idx + 1; j < runs.length; j++) {
      const close = runs[j]!;
      if (close.len === open.len) {
        if (localOffset >= open.start && localOffset < close.end) return true;
        idx = j + 1;
        matched = true;
        break;
      }
    }
    if (!matched) idx++;
  }
  return false;
}

/**
 * Whether `offset` sits inside ANY markdown region markdown-it treats as
 * literal text — a fenced code block, an indented code block, or an inline
 * code span. This is the check every locate function below actually uses;
 * `isInsideFencedCodeBlock` stays separately exported (and separately
 * tested) for the sabotage-fixture and probe-test callers that care about
 * that one region specifically.
 */
export function isInsideLiteralMarkdownRegion(text: string, offset: number): boolean {
  return (
    isInsideFencedCodeBlock(text, offset) ||
    isInsideIndentedCodeBlock(text, offset) ||
    isInsideInlineCodeSpan(text, offset)
  );
}

// ── Image properties (waiver row: image-properties) ────────────────────────

export interface ImageCaretMatch {
  readonly match: ImageTokenMatch;
  readonly wrapper: { readonly start: number; readonly end: number; readonly imageToken: string } | null;
  /** Seeded EXACTLY the way `context-menu-controller.svelte.ts`'s
   *  `imageItems` seeds `ImagePropertiesDialog` from an existing token —
   *  reproduced here (that controller's closure is not importable) against
   *  the same shared `image-classes.ts` accessors. */
  readonly initial: ImagePropertiesValue;
}

/** Locates the image at `caret` and seeds an {@link ImagePropertiesValue}
 *  from its current token — ready to hand to `ImagePropertiesDialog`. Also
 *  used by `image-unwrap` (below) for its own locate step. */
export function locateImageAtCaret(text: string, caret: number): LocateResult<ImageCaretMatch> {
  if (isInsideLiteralMarkdownRegion(text, caret)) return refuse("fenced-code-block");
  const match = findImageTokenAtOffset(text, caret);
  if (!match) return refuse("no-token");
  const wrapper = findImageWrapper(text, match);
  const tokens = tokenizeImageAttrs(match.attrsRaw);
  const position = getPositionClass(tokens);
  const initial: ImagePropertiesValue = {
    src: match.src,
    alt: match.alt,
    width: getWidth(tokens),
    position: position ? (normalizeClassInput(IMAGE_POSITION_OPTIONS, position) ?? "") : "",
    pinAlignment: getPinAlignment(tokens) ?? "center",
    size: getSizeClass(tokens) ?? "",
    spacing: getSpacingClass(tokens) ?? "",
    shape: hasShapeClass(tokens),
    flush: hasFlushClass(tokens),
    layer: getLayerClass(tokens) ?? "",
  };
  return { ok: true, value: { match, wrapper, initial } };
}

/**
 * Computes the replacement for an edited image, diffing `next` against
 * `initial` field by field and touching ONLY the attrs/src/alt that
 * actually changed — the exact rule
 * `context-menu-controller.svelte.ts`'s "Set properties…" action applies,
 * reproduced here against the same shared setters (see this module's
 * header). `null` means nothing changed — the caller applies no edit.
 * Caller is expected to have validated `next` already (this repo's shared
 * `validateImageProperties`, `rich-commands.ts`).
 */
export function computeImagePropertiesEdit(
  match: ImageTokenMatch,
  initial: ImagePropertiesValue,
  next: ImagePropertiesValue,
): TextEdit | null {
  const tokens = tokenizeImageAttrs(match.attrsRaw);
  let updated = tokens;
  const width = next.width.trim();
  if (width !== initial.width) updated = setWidth(updated, width || null);
  if (next.position !== initial.position) updated = setPositionClass(updated, next.position || null);
  if (
    next.position === IMAGE_PIN_CLASS &&
    (initial.position !== IMAGE_PIN_CLASS || next.pinAlignment !== initial.pinAlignment)
  ) {
    updated = setPinAlignment(updated, next.pinAlignment);
  }
  if (next.size !== initial.size) updated = setSizeClass(updated, next.size || null);
  if (next.spacing !== initial.spacing) updated = setSpacingClass(updated, next.spacing || null);
  if (next.shape !== initial.shape) updated = setShapeClass(updated, next.shape);
  if (next.flush !== initial.flush) updated = setFlushClass(updated, next.flush);
  if (next.layer !== initial.layer) updated = setLayerClass(updated, next.layer || null);

  const changes: { src?: string; alt?: string; attrsRaw?: string } = {};
  if (updated !== tokens) changes.attrsRaw = serializeImageAttrs(updated);
  const nextSrc = next.src.trim();
  if (nextSrc !== initial.src) changes.src = nextSrc;
  if (next.alt !== initial.alt) changes.alt = next.alt;
  if (Object.keys(changes).length === 0) return null;

  const token = rewriteImageToken(match, changes);
  return { from: match.start, to: match.end, insert: token };
}

// ── Image unwrap (waiver row: image-unwrap) ─────────────────────────────────

/** Locates the image at `caret` and, when it has an enclosing link wrapper,
 *  computes the edit that removes the wrapper while leaving the image
 *  itself untouched (`findImageWrapper`/`spliceToken`, unchanged). Refuses
 *  with `"no-wrapper"` when the image exists but is not wrapped — there is
 *  nothing to unwrap, not an error in locating the image. */
export function locateImageUnwrapEdit(text: string, caret: number): LocateResult<TextEdit> {
  if (isInsideLiteralMarkdownRegion(text, caret)) return refuse("fenced-code-block");
  const match = findImageTokenAtOffset(text, caret);
  if (!match) return refuse("no-token");
  const wrapper = findImageWrapper(text, match);
  if (!wrapper) return refuse("no-wrapper");
  return { ok: true, value: { from: wrapper.start, to: wrapper.end, insert: wrapper.imageToken } };
}

// ── Link edit (waiver row: link-edit) ───────────────────────────────────────

export interface LinkCaretMatch {
  readonly match: LinkTokenMatch;
  readonly initialHref: string;
}

/** Locates the link at `caret`, ready to seed a text prompt with its
 *  current target. */
export function locateLinkAtCaret(text: string, caret: number): LocateResult<LinkCaretMatch> {
  if (isInsideLiteralMarkdownRegion(text, caret)) return refuse("fenced-code-block");
  const match = findLinkTokenAtOffset(text, caret);
  if (!match) return refuse("no-token");
  return { ok: true, value: { match, initialHref: match.href } };
}

/** Computes the replacement for an edited link's target — `rewriteLinkToken`
 *  unchanged, wrapped as a document-absolute {@link TextEdit}. */
export function computeLinkEditEdit(match: LinkTokenMatch, href: string): TextEdit {
  const token = rewriteLinkToken(match, href);
  return { from: match.start, to: match.end, insert: token };
}

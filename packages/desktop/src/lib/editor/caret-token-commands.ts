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
import { createMarkdownRenderer } from "gutterpress/render";
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
 *    for why this module does not further distinguish those three), OR a
 *    candidate span WAS found but the real pipeline's parsed token stream
 *    for its enclosing block does not actually contain a matching image/
 *    link token there — an inline code span, escaped syntax, or any other
 *    shape the real parser treats as literal (SFE-P3e: the SAME "not
 *    really a token here" fact the base case already covers, now also
 *    established by parser evidence — see "Real-parser literal-region
 *    evidence" below — instead of only a missing regex candidate).
 *  - `"fenced-code-block"` — the caret's line falls inside a REAL `fence`/
 *    `code_block` block token, per that token's own `.map` range (SFE-P3e:
 *    the real parser resolving top-level, indented, blockquoted, and
 *    list-nested code correctly, in place of the three hand-rolled
 *    scanners — `isInsideFencedCodeBlock`/`isInsideIndentedCodeBlock`/
 *    `isInsideInlineCodeSpan` — this reason used to be backed by).
 *    Markdown-it never parses inline syntax inside either kind of block,
 *    so text that LOOKS like `![alt](src)` there is not a real image.
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

// ── Real-parser literal-region evidence (SFE-P3e) ───────────────────────────
//
// Replaces `isInsideFencedCodeBlock` / `isInsideIndentedCodeBlock` /
// `isInsideInlineCodeSpan` / `stripFenceContainerPrefix` /
// `isInsideLiteralMarkdownRegion` — a hand-rolled second Markdown parser
// (SFE-P3d-parity's own three scanners plus fence-prefix stripping) — with
// ONE question asked of the REAL pipeline: does `md.parse()` actually
// produce this image/link token here? See docs/plans/source-first-editor/
// runs/SFE-P3e.md, "Product-owner ruling" ("a hand-rolled markdown scanner
// next to the real parser is machinery we do not need") and G-05
// ("Source origin is never inferred from presentation... use parser
// ranges... otherwise fail closed" — restated for deletion in that run's
// binding decisions as: "is the caret on a real image/link token" is
// answered by whether the real markdown-it pipeline produces that token
// for the enclosing block).
//
// Two real-parser facts settle every case the deleted scanners existed for:
//   1. A `fence`/`code_block` block token's own `.map` range already
//      correctly covers top-level, indented, list-nested, and blockquoted
//      code — because it IS the parser resolving container/list context,
//      not a scanner approximating it with regexes and prefix-stripping.
//   2. A prose block's `inline` token's `.children` is the pipeline's own
//      answer to "what real inline tokens does this text contain" — an
//      inline code span, escaped syntax (`\!`), or any other literal shape
//      simply never produces an `image`/`link_open` child, so "no matching
//      child" is the same "not really a token here" fact the old scanners
//      existed to approximate, without a bespoke check for each shape.
//
// The regex-based candidate finders (`findImageTokenAtOffset`/
// `findLinkTokenAtOffset`, `context-menu-actions.ts`) are UNCHANGED and
// still locate the candidate span and its raw src/href — this section is
// the gate in front of them, not a replacement for them.

type MarkdownRenderer = ReturnType<typeof createMarkdownRenderer>;
type MarkdownToken = ReturnType<MarkdownRenderer["parse"]>[number];

/** 0-based line number of `offset`, matching markdown-it's own `.map`
 *  convention (which line-indexes the ORIGINAL source, not any internal
 *  normalization) — see markdown-it's `Token.map`. */
function lineNumberAt(text: string, offset: number): number {
  let line = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === "\n") line++;
  }
  return line;
}

/** Whether `line` falls inside a real `fence` or `code_block` token's own
 *  `.map` range — the real parser's answer to "is this literal code",
 *  already correct for top-level, indented, list-nested, and blockquoted
 *  placement because it comes from parsing, not from guessing at container
 *  indentation the way the deleted scanners did. */
function caretLineIsCodeBlock(tokens: readonly MarkdownToken[], line: number): boolean {
  for (const token of tokens) {
    if (token.type !== "fence" && token.type !== "code_block") continue;
    if (!token.map) continue;
    const [from, to] = token.map;
    if (line >= from && line < to) return true;
  }
  return false;
}

/** The real inline children of the prose block (paragraph, heading, list
 *  item, …) whose `inline` token's `.map` range covers `line` — `null` when
 *  no such block covers it (a blank line, an `html_block`, or any other
 *  leaf with no inline content at all). */
function enclosingProseChildren(tokens: readonly MarkdownToken[], line: number): readonly MarkdownToken[] | null {
  for (const token of tokens) {
    if (token.type !== "inline" || !token.map) continue;
    const [from, to] = token.map;
    if (line >= from && line < to) return token.children ?? [];
  }
  return null;
}

/**
 * Does the real pipeline produce an IMAGE token at `offset` whose `src`
 * equals `candidateSrc`? Returns `null` when it does (the candidate is
 * real — proceed), or the {@link CaretTokenRefusalReason} to refuse with.
 *
 * `md.normalizeLink()` is applied to `candidateSrc` before comparing:
 * markdown-it percent-encodes spaces and non-ASCII bytes in every href/src
 * it resolves (the image/link core rules both call it internally), so a
 * bare string compare against the DECODED candidate would wrongly refuse
 * ordinary images whose filename has a space or an accented character.
 * Comparing through the SAME normalization the pipeline itself applies is
 * what makes this an evidence-based check rather than a second, subtly
 * different one.
 */
function pipelineImageRefusal(text: string, offset: number, candidateSrc: string): CaretTokenRefusalReason | null {
  const md = createMarkdownRenderer();
  const tokens = md.parse(text, {});
  const line = lineNumberAt(text, offset);
  if (caretLineIsCodeBlock(tokens, line)) return "fenced-code-block";
  const children = enclosingProseChildren(tokens, line) ?? [];
  const normalizedSrc = md.normalizeLink(candidateSrc);
  const isReal = children.some((child) => child.type === "image" && child.attrGet("src") === normalizedSrc);
  return isReal ? null : "no-token";
}

/** The link counterpart of {@link pipelineImageRefusal} — matches against
 *  a real `link_open` token's `href` instead of an `image` token's `src`. */
function pipelineLinkRefusal(text: string, offset: number, candidateHref: string): CaretTokenRefusalReason | null {
  const md = createMarkdownRenderer();
  const tokens = md.parse(text, {});
  const line = lineNumberAt(text, offset);
  if (caretLineIsCodeBlock(tokens, line)) return "fenced-code-block";
  const children = enclosingProseChildren(tokens, line) ?? [];
  const normalizedHref = md.normalizeLink(candidateHref);
  const isReal = children.some((child) => child.type === "link_open" && child.attrGet("href") === normalizedHref);
  return isReal ? null : "no-token";
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
  const match = findImageTokenAtOffset(text, caret);
  if (!match) return refuse("no-token");
  const refusal = pipelineImageRefusal(text, caret, match.src);
  if (refusal) return refuse(refusal);
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
  const match = findImageTokenAtOffset(text, caret);
  if (!match) return refuse("no-token");
  const refusal = pipelineImageRefusal(text, caret, match.src);
  if (refusal) return refuse(refusal);
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
  const match = findLinkTokenAtOffset(text, caret);
  if (!match) return refuse("no-token");
  const refusal = pipelineLinkRefusal(text, caret, match.href);
  if (refusal) return refuse(refusal);
  return { ok: true, value: { match, initialHref: match.href } };
}

/** Computes the replacement for an edited link's target — `rewriteLinkToken`
 *  unchanged, wrapped as a document-absolute {@link TextEdit}. */
export function computeLinkEditEdit(match: LinkTokenMatch, href: string): TextEdit {
  const token = rewriteLinkToken(match, href);
  return { from: match.start, to: match.end, insert: token };
}

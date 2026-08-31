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
 * in those files: `toolbar-actions.ts#applyImagePropertiesAtCaret`/
 * `#applyImageUnwrapAtCaret`/`#applyLinkEditAtCaret` for source (each takes
 * the live `EditorView` — the same shape every other function in that file
 * uses — plus the dialog callback it needs), and
 * `rich-commands.ts#applyRichImagePropertiesAtCaret`/
 * `#applyRichImageUnwrapAtCaret`/`#applyRichLinkEditAtCaret` for rich (same
 * `(host: EditorDocumentHost, …, live: LiveSelection)` shape as this file's
 * other `applyRich*` functions). Both sets of six wrappers are thin: read
 * text/caret from their own surface, delegate the ENTIRE locate/compute
 * decision to the pure functions below, and dispatch through their own
 * surface's existing write seam (`view.dispatch`/`host.applyEdit`) — one
 * implementation, two thin appliers (G-09), exactly like
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
 *  - `"fenced-code-block"` — the caret sits inside a fenced code span.
 *    Markdown-it never parses inline syntax there, so text that LOOKS like
 *    `![alt](src)` inside a fence is not a real image — refusing here is
 *    what the run's own fixture requirement ("that is not a real image")
 *    describes.
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
 * Whether `offset` sits inside a fenced code block (``` or ~~~, including
 * its own opening/closing fence lines, up to an unterminated fence's
 * end-of-document). Independent of, and deliberately not sharing an
 * implementation with, `rich-commands.ts`'s `splitIntoBlocks` — that
 * function does not distinguish a fenced block from an ordinary paragraph
 * in its own returned shape (both are `isMarker:false`), so reusing it here
 * would mean reaching into its internals rather than its public contract;
 * this is a small, self-contained check with the one property this module
 * needs.
 */
export function isInsideFencedCodeBlock(text: string, offset: number): boolean {
  const lines = text.split("\n");
  let pos = 0;
  let fenceChar: string | null = null;
  let fenceLen = 0;
  let fenceFrom = 0;
  for (const line of lines) {
    const contentEnd = pos + line.length;
    const trimmed = line.replace(/^ {0,3}/, "");
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
  if (isInsideFencedCodeBlock(text, caret)) return refuse("fenced-code-block");
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
  if (isInsideFencedCodeBlock(text, caret)) return refuse("fenced-code-block");
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
  if (isInsideFencedCodeBlock(text, caret)) return refuse("fenced-code-block");
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

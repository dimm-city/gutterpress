/**
 * marker-completions.ts (UX review M26)
 *
 * CodeMirror completion source for Gutterpress's CORE `@marker` family — the
 * markdown-it-paged layout markers (`@chapter`, `@spread`, `@page`,
 * `@section`, `@continue`, `@page-break`, `@column-break`, `@end-section`).
 * The whitelist below is copied verbatim from `parseMarkerLine`'s `.includes`
 * check in `packages/cli/src/lib/markdown/markers.js` — the single
 * source of truth for which `@` tokens are real markers.
 *
 * Mirrors css-editor.ts's `pagedMediaCompletions` craftsmanship: a hand-
 * maintained static table (no generated schema, no runtime data read) plus a
 * small completion-source function. The CSS editor already gets a 38-entry
 * curated Paged Media table; this gives markdown authors the same assistance
 * for Gutterpress's own layout syntax (UX finding M26 — CSS authors previously
 * got more help than markdown authors in a markdown-first product).
 *
 * IMPORTANT — core only (CLAUDE.md §5/§6): `@sidebar`, `@callout`, and the
 * rest of the DC plugin's `@marker` family are PROJECT-PLUGIN markers, not
 * core. They MUST NOT be added to this table — a plugin that wants its own
 * marker completions should register its own CodeMirror extension instead of
 * extending this one, exactly as plugins register their own markdown-it
 * rules rather than reaching into `markdown-it-paged`'s internals.
 *
 * Trigger contract: markers are only meaningful as the FIRST token on a line
 * (optionally after leading whitespace) — `parseMarkerLine` trims the raw
 * line and requires the trimmed result to start with `@`. The completion
 * source below matches that contract exactly (line-start, not "anywhere a
 * word boundary precedes `@`"), so the popup never appears mid-sentence for
 * an email address or an inline "@mention".
 */
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  pickedCompletion,
  type CompletionContext,
  type CompletionResult,
  type Completion,
} from "@codemirror/autocomplete";

/**
 * A single core marker completion entry.
 */
export interface MarkerCompletion {
  /** The `@marker` token itself — both the match label and, for simple
   *  entries, the literal inserted text. */
  label: string;
  /** One-line description shown in the completion popup's detail column. */
  detail: string;
  /**
   * Inserted text. A plain string is CodeMirror's default replace-and-
   * cursor-to-end behavior (used for markers with no author-filled body:
   * `@spread`, `@page`, `@continue`, `@page-break`, `@column-break`,
   * `@end-section`). A function gets custom cursor/selection placement for
   * the two markers that benefit from a filled-in skeleton: `@chapter`
   * (title placeholder, selected for immediate overwrite) and `@section`
   * (paired with `@end-section`, cursor left on the blank line between).
   */
  apply: string | ((view: EditorView, completion: Completion, from: number, to: number) => void);
}

const CHAPTER_TITLE_PLACEHOLDER = "Chapter Title";

/**
 * `@chapter` — inserts the marker with a QUOTED, selected title placeholder.
 *
 * The quotes are load-bearing, not cosmetic: `parseMarkerLine` tokenizes a
 * marker line on whitespace unless a token is wrapped in quotes. An unquoted
 * multi-word bare label (`@chapter Chapter Title`) tokenizes into TWO bare
 * tokens, which — since there is more than one bare token and no explicit
 * attr/shorthand present — fails the "exactly one bare token" name rule and
 * silently falls through to being treated as class shorthand-less filler,
 * i.e. `data-chapter-label` is never set and no `.chapter-opener` is
 * injected. Quoting (`@chapter "Chapter Title"`) collapses the label to a
 * single token regardless of internal spaces, so it satisfies the
 * `bareTokens.length === 1` name rule and actually produces
 * `data-chapter-label="Chapter Title"` + the chapter-opener element — the
 * exact behavior this completion's `detail` string advertises. Verified by
 * feeding both forms through the real markdown-it-paged plugin.
 */
function applyChapterCompletion(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  const prefix = '@chapter "';
  const suffix = '"';
  const insert = `${prefix}${CHAPTER_TITLE_PLACEHOLDER}${suffix}`;
  const placeholderStart = from + prefix.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(
      placeholderStart,
      placeholderStart + CHAPTER_TITLE_PLACEHOLDER.length,
    ),
    annotations: pickedCompletion.of(completion),
  });
}

/** `@section` — inserts the `@section` / `@end-section` pair with the
 *  cursor collapsed on the blank line between them, ready for content. */
function applySectionPairCompletion(
  view: EditorView,
  completion: Completion,
  from: number,
  to: number,
): void {
  const insert = "@section\n\n@end-section";
  // "@section\n" (one newline) lands exactly on the blank line's start — the
  // SECOND '\n' is what ends that blank line, so including it in the offset
  // would overshoot onto "@end-section" itself.
  const cursorPos = from + "@section\n".length;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.cursor(cursorPos),
    annotations: pickedCompletion.of(completion),
  });
}

/**
 * The curated core marker completion table — one entry per marker
 * `parseMarkerLine` recognizes, in the same order as the plugin's own header
 * comment.
 */
export const markerCompletions: readonly MarkerCompletion[] = [
  {
    label: "@chapter",
    detail: 'Wrap content in a chapter — a quoted label (e.g. "C.01") auto-injects the chapter-opener',
    apply: applyChapterCompletion,
  },
  {
    label: "@spread",
    detail: "Start a two-page spread group",
    apply: "@spread",
  },
  {
    label: "@page",
    detail: "Start a new page (optionally named and/or classed)",
    apply: "@page",
  },
  {
    label: "@section",
    detail: "Group content to avoid a mid-section break — pairs with @end-section",
    apply: applySectionPairCompletion,
  },
  {
    label: "@continue",
    detail: "Close the current @section and reopen a matching one, marked .gp-continued",
    apply: "@continue",
  },
  {
    label: "@page-break",
    detail: "Hard page break with no page wrapper emitted",
    apply: "@page-break",
  },
  {
    label: "@column-break",
    detail: "Force a column break inside a .col-split @section",
    apply: "@column-break",
  },
  {
    label: "@end-section",
    detail: "Close the current @section (no-op if none is open); stays on the same page",
    apply: "@end-section",
  },
] as const;

function toCompletion(m: MarkerCompletion): Completion {
  return {
    label: m.label,
    type: "keyword",
    detail: m.detail,
    apply: m.apply,
    boost: 1,
  };
}

const MARKER_OPTIONS: Completion[] = markerCompletions.map(toCompletion);

// Matches: optional leading whitespace, then an optional `@` token made of
// word characters and hyphens — i.e. everything from line start up to the
// cursor, with nothing else in between. This is deliberately NOT
// `context.matchBefore(/@[\w-]*/)` (which would match `@` anywhere a word
// boundary precedes it, e.g. mid-sentence) — markers are only ever the first
// token on their line.
const LINE_START_MARKER = /^(\s*)(@[\w-]*)?$/;

/**
 * CodeMirror completion source backed by {@link markerCompletions}. Triggers
 * as soon as `@` is typed at the start of a line (optionally after leading
 * whitespace) and keeps filtering as more marker characters are typed.
 * Explicit invocation (Ctrl+Space) also offers the family when the caret
 * sits at a bare line start, before `@` has been typed.
 */
export function markerCompletionSource(context: CompletionContext): CompletionResult | null {
  const line = context.state.doc.lineAt(context.pos);
  const beforeCursor = line.text.slice(0, context.pos - line.from);
  const match = LINE_START_MARKER.exec(beforeCursor);
  if (!match) return null;

  const [, indent, word] = match;
  // Require the '@' itself (or an explicit Ctrl+Space invoke) before
  // popping up — same "don't nag on an empty match" rule as
  // pagedMediaCompletionSource in css-editor.ts.
  if (!word && !context.explicit) return null;

  return {
    from: line.from + indent.length,
    options: MARKER_OPTIONS,
    validFor: /^@[\w-]*$/,
  };
}

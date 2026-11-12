/**
 * version-diff.ts — the Version history file compare, on @codemirror/merge.
 *
 * Two read-only layouts of the same two texts: Inline (one editor showing
 * the newer text, the removed lines above each change) and Side by side
 * (two editors, unchanged lines aligned). Both mark the words that changed
 * inside a line, number the lines, wrap them (prose), collapse unchanged
 * stretches to a few lines of context, and use the source editor's
 * language and syntax colours (#lib/editor/syntax.ts). The colours of
 * added and removed text are the app's `--app-diff-*` tokens.
 *
 * {@link mountVersionDiff} returns how many changes there are and a way to
 * scroll to one, for the view's "Change 2 of 5".
 */
import { getChunks, MergeView, unifiedMergeView, type Chunk } from "@codemirror/merge";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, lineNumbers } from "@codemirror/view";
import { languageForPath } from "./css-editor.ts";
import { languageExtension, syntaxColours } from "./syntax.ts";

export type DiffMode = "inline" | "split";

export interface VersionDiff {
  /** How many changed passages there are. */
  count: number;
  /** Scroll change `index` (0-based) to the top, with a line of context above it. */
  goTo(index: number): void;
  destroy(): void;
}

/** Lines of unchanged text kept around each change. */
const CONTEXT_LINES = 3;

// Each override is one class deeper than the package's own light/dark rule
// it replaces, so it wins without !important.
const diffTheme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px", backgroundColor: "var(--app-bg)", color: "var(--cm-text)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--app-font-mono)", lineHeight: "1.6", overflow: "auto" },
  ".cm-gutters": { backgroundColor: "var(--cm-gutter-bg)", color: "var(--cm-gutter-text)", border: "none" },
  "&.cm-merge-a .cm-content .cm-changedLine, & .cm-content .cm-deletedChunk": {
    backgroundColor: "var(--app-diff-removed-bg)",
  },
  "&.cm-merge-b .cm-content .cm-changedLine": { backgroundColor: "var(--app-diff-added-bg)" },
  "&.cm-merge-a .cm-content .cm-changedText, & .cm-content .cm-deletedChunk .cm-deletedLine .cm-deletedText": {
    background: "var(--app-diff-removed-word)",
    borderRadius: "2px",
  },
  "&.cm-merge-b .cm-content .cm-changedText": { background: "var(--app-diff-added-word)", borderRadius: "2px" },
  "&.cm-merge-a .cm-gutters .cm-changeGutter .cm-changedLineGutter, & .cm-gutters .cm-changeGutter .cm-deletedLineGutter": {
    background: "var(--app-diff-removed-mark)",
  },
  "&.cm-merge-b .cm-gutters .cm-changeGutter .cm-changedLineGutter": { background: "var(--app-diff-added-mark)" },
  "&.cm-editor .cm-content .cm-collapsedLines": {
    padding: "3px 10px",
    color: "var(--app-text-muted)",
    background: "var(--app-surface-sunken)",
    fontSize: "12px",
  },
});

function baseExtensions(path: string): Extension {
  return [
    lineNumbers(),
    EditorView.lineWrapping,
    EditorState.readOnly.of(true),
    EditorView.editable.of(false),
    languageExtension(languageForPath(path)),
    syntaxColours,
    diffTheme,
  ];
}

/** Scroll `view` so the line above `pos` is at the top. */
function scrollAbove(view: EditorView, pos: number): void {
  const doc = view.state.doc;
  const line = doc.lineAt(Math.min(pos, doc.length)).number;
  const top = doc.line(Math.max(1, line - 1)).from;
  view.dispatch({ effects: EditorView.scrollIntoView(top, { y: "start", yMargin: 4 }) });
}

/** Show `before` → `after` in `parent`, as one inline editor or two side by side. */
export function mountVersionDiff(
  parent: HTMLElement,
  options: { before: string; after: string; path: string; mode: DiffMode },
): VersionDiff {
  const collapseUnchanged = { margin: CONTEXT_LINES, minSize: 4 };
  let chunks: readonly Chunk[];
  let scrollView: EditorView;
  let destroy: () => void;
  if (options.mode === "inline") {
    const view = new EditorView({
      parent,
      doc: options.after,
      extensions: [
        baseExtensions(options.path),
        unifiedMergeView({ original: options.before, mergeControls: false, collapseUnchanged }),
      ],
    });
    chunks = getChunks(view.state)?.chunks ?? [];
    scrollView = view;
    destroy = () => view.destroy();
  } else {
    const merge = new MergeView({
      parent,
      a: { doc: options.before, extensions: baseExtensions(options.path) },
      b: { doc: options.after, extensions: baseExtensions(options.path) },
      collapseUnchanged,
    });
    chunks = merge.chunks;
    // The two editors scroll together in the merge view's own scroller.
    scrollView = merge.b;
    destroy = () => merge.destroy();
  }
  return {
    count: chunks.length,
    goTo(index) {
      const chunk = chunks[index];
      if (chunk) scrollAbove(scrollView, chunk.fromB);
    },
    destroy,
  };
}

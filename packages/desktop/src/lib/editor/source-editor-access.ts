/**
 * source-editor-access.ts (SFE-P3d-parity, Lane D)
 *
 * Reads the live SOURCE `EditorView` from OUTSIDE `MarkdownEditor.svelte` —
 * that component is not in this lane's write ownership (the run's WRITE
 * OWNERSHIP list covers `packages/desktop/src/lib/editor/**` and
 * `EditorToolbar.svelte`, not `lib/components/MarkdownEditor.svelte`), and
 * its existing exported surface (`getSelectionText()`, `applyRangeEditIn`,
 * …) has no way to hand out the underlying `EditorView` or a caret OFFSET —
 * only `getSelectionText()`, which returns the selected TEXT and gives no
 * information at all for a collapsed caret (the common case: placing the
 * cursor inside an image span with nothing selected). Guessing an offset
 * from selected text (e.g. `content.indexOf`) would violate this run's own
 * "must never guess a range" rule the moment the text repeats, or return
 * nothing for a collapsed caret at all — not an acceptable substitute.
 *
 * Instead of adding a new export to that component, this module uses
 * CodeMirror 6's own PUBLIC, documented escape hatch for exactly this
 * situation — tooling that needs a live `EditorView` without owning the
 * component that constructed it: `EditorView.findFromDOM(dom)` walks `dom`
 * for its `.cm-content` descendant and returns the mounted view, or `null`.
 * `@codemirror/view` is imported DYNAMICALLY here, matching `+page.svelte`'s
 * existing lazy-load of `MarkdownEditor.svelte` itself (`loadEditorModule`,
 * a dynamic `import()`) — this module must not force CodeMirror into the
 * app's eagerly-loaded bundle merely by existing.
 *
 * The returned `EditorView` is the SAME live instance `toolbar-actions.ts`'s
 * `apply*AtCaret` functions read/dispatch against — callers pass it
 * straight through, matching every other toolbar-actions.ts function's own
 * `(view: EditorView, …)` shape.
 */
import type { EditorView } from "@codemirror/view";

/**
 * Finds the live CodeMirror `EditorView` mounted somewhere inside `root`
 * (its `.cm-content` descendant — `EditorView.findFromDOM`'s own contract),
 * or `null` when no view is currently mounted there (root is null/
 * undetached, or the source surface isn't the active one).
 */
export async function findMountedSourceView(root: Element | null | undefined): Promise<EditorView | null> {
  if (!root) return null;
  const { EditorView } = await import("@codemirror/view");
  return EditorView.findFromDOM(root as HTMLElement);
}

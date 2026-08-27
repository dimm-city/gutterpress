/**
 * `EditorCommand` — the shared source-edit command vocabulary (SFE-P1c, Lane C).
 *
 * D1/D2/D3: a command is a request to make an explicit, named change to
 * SOURCE — never a request to touch a rendered/derived view. Nothing here
 * describes HOW a command is applied (that stays surface-specific — desktop
 * applies these as CodeMirror 6 transactions today; a future VS Code host
 * would apply them as `WorkspaceEdit`s) — this module only names WHAT a
 * command is, so every surface that edits Gutterpress source agrees on the
 * same vocabulary (pr158-lessons.md §8.7 "Shared authoring commands": "The
 * desktop toolbar, rich web UI, source editor, and VS Code commands consume
 * the same vocabulary. Surface-specific code decides only presentation and
 * command routing."; AP-18 "Build similar authoring logic twice" — one
 * vocabulary, thin per-surface adapters).
 *
 * This is a TYPE-ONLY relocation (this run's "Allowed behavior changes"):
 * every member below is a mechanical extraction of an existing, already-
 * shipped desktop editor action — see the per-member doc comment for the
 * exact `packages/desktop/src/lib/editor/toolbar-actions.ts` function it
 * names. The union is deliberately NOT exhaustive of `EditorToolbar.svelte`'s
 * `ToolbarAction` type: `"save"`, `"snippet"`, and `"focus-mode"` are toolbar
 * actions with no corresponding `apply*` source-transformation function in
 * toolbar-actions.ts (save persists, snippet inserts host-supplied
 * arbitrary text via a separate flow, focus-mode toggles UI chrome) — they
 * are not source-edit commands and are intentionally excluded (plan
 * abstraction rubric: "the smallest command union covering EXISTING desktop
 * toolbar/source actions — no speculative members").
 *
 * `packages/editor` stays framework-free (D4): nothing here imports
 * `@codemirror/*`, Svelte, or any desktop type. `toolbar-actions.ts`
 * continues to own the actual `EditorView` transactions; this module only
 * gives the request shape a name so it can be reused outside desktop.
 */

/**
 * Heading levels the shared vocabulary supports today. Mirrors
 * `applyHeading(view: EditorView, level: 1 | 2 | 3 | 4)` in
 * toolbar-actions.ts EXACTLY — desktop's toolbar has no H5/H6 command, so
 * this type does not invent one (no speculative members).
 */
export type HeadingLevel = 1 | 2 | 3 | 4;

/**
 * Which layout skeleton `insert-layout-block` inserts. Mirrors
 * toolbar-actions.ts's own `LayoutBlockKind` (driving `applyLayoutBlock`)
 * member-for-member, including `"page-break"` — toolbar-actions.ts's
 * `applyLayoutBlock` dispatches that member to the SAME `applyPageBreak`
 * implementation `insert-page-break` below names; the type still lists it
 * because it is a real, existing member of the source `LayoutBlockKind`
 * union, not an invented one.
 */
export type LayoutBlockKind = "chapter" | "section" | "two-column" | "page-break" | "spread";

/**
 * The image attributes an `insert-image` command carries. Mirrors
 * `applyImage`'s parameter shape in toolbar-actions.ts one-for-one (that
 * function takes these as discrete positional parameters today; this
 * object shape is the command-vocabulary equivalent a future caller sends
 * across a process/webview boundary, where discrete positional parameters
 * are not an option).
 */
export interface ImageCommandValue {
  readonly src: string;
  readonly alt: string;
  readonly width?: string;
  readonly position?: string;
  readonly size?: string;
  readonly shape?: boolean;
}

/**
 * The shared source-edit command union (D1 vocabulary). Each member's doc
 * comment names the exact toolbar-actions.ts function it replaces/names.
 */
export type EditorCommand =
  /** Replaces: `applyBold` — toggle a `**…**` wrap around the selection. */
  | { readonly kind: "toggle-bold" }
  /** Replaces: `applyItalic` — toggle a `_…_` wrap around the selection. */
  | { readonly kind: "toggle-italic" }
  /** Replaces: `applyStrikethrough` — toggle a `~~…~~` wrap around the selection. */
  | { readonly kind: "toggle-strikethrough" }
  /** Replaces: `applyInlineCode` — toggle a `` `…` `` wrap around the selection. */
  | { readonly kind: "toggle-inline-code" }
  /** Replaces: `applyLink` — insert/wrap a `[text](url)` link. */
  | { readonly kind: "insert-link" }
  /** Replaces: `applyBlockquote` — toggle a `> ` prefix on the selected lines. */
  | { readonly kind: "toggle-blockquote" }
  /** Replaces: `applyUnorderedList` — toggle a `- ` prefix on the selected lines. */
  | { readonly kind: "toggle-bullet-list" }
  /** Replaces: `applyOrderedList` — toggle a numbered-list prefix on the selected lines. */
  | { readonly kind: "toggle-ordered-list" }
  /** Replaces: `applyHeading(view, level)` — set/toggle an ATX heading on the current line. */
  | { readonly kind: "set-heading"; readonly level: HeadingLevel }
  /** Replaces: `applyHr` — insert a `---` horizontal rule after the current line. */
  | { readonly kind: "insert-hr" }
  /** Replaces: `applyPageBreak` — insert the `@page-break` marker after the current line. */
  | { readonly kind: "insert-page-break" }
  /** Replaces: `applyTable(view, cols)` — insert a `cols`-wide Markdown table skeleton. */
  | { readonly kind: "insert-table"; readonly columns: number }
  /** Replaces: `applyImage(view, src, alt, width?, position?, size?, shape?)` — insert an image. */
  | { readonly kind: "insert-image"; readonly value: ImageCommandValue }
  /** Replaces: `applyLayoutBlock(view, kind)` — insert a Gutterpress layout marker skeleton. */
  | { readonly kind: "insert-layout-block"; readonly block: LayoutBlockKind };

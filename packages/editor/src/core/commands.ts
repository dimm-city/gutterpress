/**
 * `EditorCommand` — the shared source-edit command vocabulary.
 *
 * D1/D2/D3: a command is a request to make an explicit, named change to
 * SOURCE — never a request to touch a rendered/derived view. Nothing here
 * describes HOW a command is applied (that stays surface-specific:
 * `packages/editor/src/web/standard/` implements every member below as a
 * pure `(snapshot, selection) -> edit` function; desktop's
 * `toolbar-actions.ts` maps its CodeMirror actions onto that surface where
 * the semantics line up byte-for-byte, and applies the returned
 * `SourceEdit` as a CodeMirror 6 transaction) — this module only names WHAT
 * a command is, so every surface that edits Gutterpress source agrees on
 * the same vocabulary (pr158-lessons.md §8.7 "Shared authoring commands":
 * "The desktop toolbar, rich web UI, source editor, and VS Code commands
 * consume the same vocabulary. Surface-specific code decides only
 * presentation and command routing."; AP-18 "Build similar authoring logic
 * twice" — one vocabulary, thin per-surface adapters).
 *
 * SFE-P2a supersedes P1c's union with this run's OWN full extent — the run
 * spec's "Command list" section, verbatim: "the union's full extent this
 * run — nothing more." P1c's union (`toggle-strikethrough`,
 * `toggle-bullet-list`/`toggle-ordered-list`, `insert-hr`,
 * `insert-page-break`, `insert-layout-block`, a `1|2|3|4`-only
 * `set-heading`, and an attribute-rich `insert-image`) was itself a
 * mechanical, not-yet-consumed extraction (see its own prior header,
 * preserved in history) — `EditorCommand` had ZERO production importers
 * before this run (only the co-located `LayoutBlockKind`/`HeadingLevel`
 * names were separately re-used), so reshaping it to exactly this run's 12
 * members changes no caller. `insert-page-break` and `insert-layout-block`
 * are Gutterpress layout/marker commands — explicitly OUT of scope this run
 * ("NO layout/marker/plugin commands (P2b+)"); desktop's own
 * `applyPageBreak`/`applyLayoutBlock` keep working unchanged, just not
 * routed through this vocabulary yet. `LayoutBlockKind` itself survives
 * below, unchanged in shape, because desktop's "Insert layout block"
 * picker (`toolbar-actions.ts`, `EditorToolbar.svelte`) still imports it —
 * it was never part of `EditorCommand`'s discriminated union, only a
 * neighboring standalone type.
 *
 * `packages/editor` stays framework-free (D4): nothing here imports
 * `@codemirror/*`, Svelte, or any desktop type.
 */

/**
 * ATX heading levels `set-heading` supports. Widened from P1c's `1 | 2 | 3
 * | 4` (desktop's toolbar UI offers only H1-H4) to the run spec's full
 * `1-6` — the WIDER range is a pure superset, so it changes nothing for
 * desktop's existing H1-H4 callers.
 */
export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;

/**
 * `set-heading`'s level argument — a specific ATX level, or `"none"` to
 * strip an existing heading down to a plain paragraph line (run spec:
 * "level none strips").
 */
export type SetHeadingLevel = HeadingLevel | "none";

/** `toggle-list`'s marker family (run spec: "toggle-list
 *  bullet/ordered/task"). Replaces P1c's two separate
 *  `toggle-bullet-list`/`toggle-ordered-list` members with ONE parameterized
 *  member, matching the run spec's own naming exactly. */
export type ListVariant = "bullet" | "ordered" | "task";

/**
 * Which layout skeleton `applyLayoutBlock` inserts (desktop
 * `toolbar-actions.ts`'s "Insert layout block" picker) — UNRELATED to
 * `EditorCommand` (layout/marker commands are P2b+ scope; see this file's
 * header), kept here only because it was already declared alongside
 * `EditorCommand` and desktop imports it from this module today
 * (`import type { LayoutBlockKind } from "@dimm-city/gutterpress-editor/core"`).
 * Unchanged from P1c.
 */
export type LayoutBlockKind = "chapter" | "section" | "two-column" | "page-break" | "spread";

/**
 * The shared source-edit command union — exactly the run spec's "Command
 * list" section, nothing more. Each member's doc comment cites that
 * section and, where one exists, the desktop `toolbar-actions.ts` function
 * its semantics were checked against.
 */
export type EditorCommand =
  /** Toggle a `**…**` wrap (or `__…__`, whichever spelling is present) —
   *  checked against desktop's `applyBold` (marker `"**"` matches; mapped). */
  | { readonly kind: "toggle-bold" }
  /** Toggle a `*…*` wrap (or `_…_`, whichever spelling is present). Desktop's
   *  `applyItalic` uses `"_"` as ITS canonical spelling — a genuine
   *  divergence from this command's spec-mandated canonical `"*"`, so
   *  desktop's toolbar mapping leaves `applyItalic` UNMAPPED (documented in
   *  `toolbar-actions.ts`) rather than changing desktop's canonical output. */
  | { readonly kind: "toggle-italic" }
  /** Toggle a `~~…~~` wrap — checked against desktop's `applyStrikethrough`
   *  (marker matches; mapped). */
  | { readonly kind: "toggle-strike" }
  /** Toggle a `` `…` `` wrap — checked against desktop's `applyInlineCode`
   *  (marker matches; mapped). */
  | { readonly kind: "toggle-inline-code" }
  /** Set (or, for `"none"`, strip) the current line's ATX heading level —
   *  checked against desktop's `applyHeading(view, level)` for levels 1-4
   *  (mapped; desktop decides "none" vs a level via its own current-level
   *  detection, then delegates the actual rewrite here). */
  | { readonly kind: "set-heading"; readonly level: SetHeadingLevel }
  /** Toggle a `"> "` prefix on every selected line — checked against
   *  desktop's `applyBlockquote` (mapped). */
  | { readonly kind: "toggle-blockquote" }
  /** Toggle a bullet/ordered/task marker per selected line — bullet checked
   *  against desktop's `applyUnorderedList` (mapped) and ordered against
   *  `applyOrderedList` (mapped); task has no desktop analog. */
  | { readonly kind: "toggle-list"; readonly variant: ListVariant }
  /** Insert (or wrap the selection as the text of) a `[text](href)` link —
   *  checked against desktop's `applyLink` (mapped). */
  | { readonly kind: "insert-link"; readonly href: string; readonly text?: string }
  /** Insert (or wrap the selection as the alt text of) an `![alt](src)`
   *  image. Desktop's `applyImage` additionally supports width/position/
   *  size/shape attributes this minimal `{src, alt?}` shape does not carry
   *  — a genuine capability gap, so desktop's mapping leaves `applyImage`
   *  UNMAPPED (documented in `toolbar-actions.ts`). */
  | { readonly kind: "insert-image"; readonly src: string; readonly alt?: string }
  /** Fence the selection as a ` ```lang ` code block, or unfence it when the
   *  selection is exactly one fenced block. No desktop analog. */
  | { readonly kind: "toggle-code-block"; readonly lang?: string }
  /** Insert a `---` horizontal rule on its own line at the caret's line
   *  boundary — checked against desktop's `applyHr` (mapped). */
  | { readonly kind: "insert-horizontal-rule" }
  /** Insert a `rows` x `cols` Markdown table skeleton at the caret's line
   *  boundary — checked against desktop's `applyTable(view, cols)` with
   *  `rows: 1` (mapped). */
  | { readonly kind: "insert-table"; readonly rows: number; readonly cols: number };

# Issue #39 — In-app CSS editor (design + delivery plan)

Status: IMPLEMENTED. All phases below shipped in one pass. The CSS editor is a
language-mode + diagnostics + completions layer on the existing #38 editor —
no new editor, no new platform capability, no Git/GitHub surface. Delivered:

- `packages/viewer/src/lib/editor/css-editor.ts` — `languageForPath`,
  `toCssDiagnostic`, `cssDiagnosticsSource` (reuses lib `checkCss`),
  `pagedMediaCompletions` + `pagedMediaCompletionSource`.
- `packages/viewer/src/lib/components/MarkdownEditor.svelte` — language /
  CSS-lint / CSS-completion `Compartment`s, reconfigured on file switch (one
  EditorView, swapped mode).
- New viewer deps: `@codemirror/lang-css`, `@codemirror/lint`,
  `@codemirror/autocomplete`. No new CLI/lib runtime dep — CLI `bun build
  --compile` re-verified clean.
- Tests: `packages/viewer/tests/editor/css-editor.test.ts` (9 tests).
- Auto-save and CSS-in-file-tree were already satisfied by #38/#41.

The original design (unchanged) follows.

## Goal

Add a CSS editing surface to the existing in-app editor (#38) so authors can
edit their project's stylesheets without leaving print-md, with:

- CSS syntax highlighting (CodeMirror 6 `lang-css`), Paged Media at-rule aware.
- Auto-save on change → drives the existing file-watcher rebuild loop.
- Inline gutter diagnostics for CSS parse errors **and** print-unsafe properties.
- At-rule / property completions for common `@page` + margin-box patterns.

This is the foundation for the theme selector (#32), visual layout editor (#37),
and assistant layout suggestions (#36), all of which write into the CSS editor.

## What already exists (do not rebuild)

#38 and #41/#42 landed most of the substrate. Verified in tree:

- `packages/viewer/src/lib/components/MarkdownEditor.svelte` — a thin CodeMirror 6
  wrapper (mount once, swap docs by dispatching a full-document replace, guarded
  `onChange`, exported `focus()`).
- `packages/viewer/src/lib/components/FileTree.svelte` — already lists `.css`
  files: `EDITABLE_EXT = /\.(md|markdown|yaml|yml|css|txt)$/i`. **CSS files are
  already clickable** and call `selectEditorFile(path)`.
- `packages/viewer/src/routes/+page.svelte` — owns `editorFilePath` /
  `editorContent`, the `readFile` load effect, and the 500 ms debounced
  `writeFile` save in `onEditorChange`. **This path is file-type agnostic** — it
  already loads and saves `.css` files today; the only gap is that the editor
  renders them with the markdown language mode and offers no CSS diagnostics.
- Platform seam (#41): `PlatformAdapter.readFile/writeFile/listDir` in
  `packages/lib/src/platform.ts`, delegated by `electron-adapter.ts`, stubbed by
  `web-adapter.ts`. **No new native capability is required for #39** — read/write
  already exist; auto-save reuses them.
- Print-safety engine: `packages/lib/src/lib/printsafe.ts` exports
  `checkCss(css, from?) => PrintSafeWarning[]` with `{ rule, severity, line,
  column, message }`. This is the diagnostics source for the gutter. It runs on
  postcss (pure JS, bundles into the renderer). **It is not yet re-exported from
  `packages/lib/src/index.ts`** — Phase 1 fixes that.

### Consequence

#39 is mostly a **language-mode + diagnostics + completions** layer on the
existing editor, not a new editor or new platform surface. No new IPC, no new
`PlatformAdapter` method. This keeps it inside the architecture rules (no new
`window.electron` reference; everything goes through the existing read/write
seam).

## Architecture

### Language mode selection

`MarkdownEditor.svelte` is generalised (or wrapped) so its CodeMirror language
extension is chosen from the active file's extension rather than hard-wired to
markdown. A small pure helper:

```
type EditorLanguage = "markdown" | "css" | "plain";
function languageForPath(path: string | null): EditorLanguage
```

- `.css` → `@codemirror/lang-css`
- `.md` / `.markdown` → existing `@codemirror/lang-markdown`
- everything else (`.yaml`, `.txt`) → plaintext (no language extension)

The language is held in a CodeMirror `Compartment` so switching files
reconfigures the language without tearing down the view (same pattern the
existing doc-swap uses). This avoids a second editor component and keeps one
CodeMirror instance per the issue ("same CodeMirror 6 instance, different
language mode").

### Diagnostics (gutter)

A CodeMirror `linter` source (from `@codemirror/lint`) that, **only when the
active language is `css`**, runs `checkCss(doc)` (re-exported from the lib) and
maps each `PrintSafeWarning` to a CM `Diagnostic`:

- `from`/`to`: computed from the warning's `line`/`column` (1-based → CM offset
  via `EditorState.doc.line(n).from + (column-1)`), defaulting to the whole line
  when only a line is known.
- `severity`: `"error"` for print-safety errors / parse errors, `"warning"` for
  risky-property findings — a 1:1 map of `PrintSafeWarning.severity`.
- `message`: the warning message; `source`: the `rule` id (e.g.
  `printsafe/no-pagedjs-crash-selectors`).

The linter is debounced (CM's `linter` has a `delay`) and runs entirely in the
renderer — `checkCss` is synchronous and pure, no host round-trip. This reuses
the **same** print-safety rules the CLI/validation pipeline uses, so the editor
gutter and `print-md validate` never disagree.

The `lintGutter()` extension renders the markers in the gutter.

### Completions (at-rules + margin boxes)

A CodeMirror `autocompletion` source (from `@codemirror/autocomplete`), active
only in CSS mode, offering a curated, **static** list of CSS Paged Media
constructs the issue calls out:

- At-rules: `@page`, `@page :first`, `@page :left`, `@page :right`, named pages.
- Margin boxes: `@top-center`, `@top-left`, `@top-right`, `@bottom-center`,
  `@bottom-left`, `@bottom-right`, `@left-middle`, etc.
- Page properties with value hints as snippets: `size: A4 portrait`,
  `size: letter landscape`, `margin: 20mm`, `bleed: 3mm`, `marks: crop cross`,
  and the supported `prince-*` extensions actually used by the project.

The completion list is a hand-maintained constant (`pagedMediaCompletions`)
co-located with the CSS editor module — a small, reviewable data table, not a
generated schema. No network, no runtime data file (consistent with the
no-runtime-data-read rule).

### No Git / no GitHub surface

CLAUDE.md §7 (Node-native, no shelling to `git`/`gh`) governs the source/version
features. **#39 touches none of that surface** — it edits local files already
loaded through the platform seam. There is no Git or REST work in this issue.
(Noted explicitly because the task brief asks the plan to address §7 "if Git is
involved" — it is not.)

### Platform-adapter surface it needs

None added. #39 consumes only the already-shipped:

- `PlatformAdapter.readFile(path)` — load CSS into the editor.
- `PlatformAdapter.writeFile(path, content)` — debounced auto-save.
- `PlatformAdapter.listDir(path)` — already feeds `FileTree` (CSS included).

The `WebAdapter` stubs for these already exist (#41); when the PWA lands (#0.6.0)
the CSS editor works through the File System Access API with no #39-specific
changes. **The web build must guard CSS diagnostics behind nothing host-specific**
— `checkCss` is pure JS and runs in any renderer, so the gutter works on web too.

### Persisted settings

No new store. The CSS editor inherits the existing editor settings
(`AppSettings.editor.fontFamily/fontSize/lineHeight/autoSaveDelay`) and the
per-project `ProjectState` (#43) for last-open file. If a "show print-safety
gutter" toggle is wanted, it is **one line** added to `AppSettings.editor`
(e.g. `cssDiagnostics: boolean`) per the contract's documented single-line
extension pattern in `contract.ts` — deferred to the UI phase, not invented here.

## New dependencies (viewer only)

Added to `packages/viewer/package.json`, installed with `bun install` at the
workspace root. All are MIT, small, tree-shakeable, and part of the CodeMirror 6
family already vendored:

- `@codemirror/lang-css` — CSS language + highlighting.
- `@codemirror/lint` — `linter`, `lintGutter`, `Diagnostic`.
- `@codemirror/autocomplete` — `autocompletion`, completion sources.

No new dependency in `packages/cli` (the no-bundlers / self-contained-binary
rules are untouched). `postcss` is already a `lib` dependency and only runs in
the renderer via `checkCss`; no new runtime data reads.

## Phased delivery plan

**Phase 0 — design + stubs (this change).**
- This document.
- `packages/lib/src/index.ts`: re-export `checkCss`, `PrintSafeWarning`, and the
  `rule*` ids (type/value exports only — no behaviour change). Rebuild `dist`.
- `packages/viewer/src/lib/editor/css-editor.ts`: compile-clean **interface
  stubs only** — `EditorLanguage`, `languageForPath` signature, a
  `CssDiagnostic` shape, and the `CssDiagnosticsSource` /
  `PagedMediaCompletion` interfaces the later phases implement. No CodeMirror
  imports yet (keeps Phase 0 dependency-free and compile-clean).

**Phase 1 — language mode.** Add the three deps. Generalise `MarkdownEditor`
(or add a `languageCompartment`) to pick the language from `languageForPath`.
CSS files highlight correctly; markdown unchanged. Verify typecheck/check/build/test.

**Phase 2 — diagnostics gutter.** Wire `@codemirror/lint` `linter` +
`lintGutter` using `checkCss` for CSS docs. Map line/column → CM offsets. Manual
verify: a remote `url()`, a crash-selector, and a syntax error each show the
correct marker + message.

**Phase 3 — completions.** Add the static `pagedMediaCompletions` table and an
`autocompletion` source scoped to CSS mode. Verify `@page`, margin-box, and
`size:`/`margin:` hints fire.

**Phase 4 — polish + (optional) settings toggle.** Quick-reference tooltip/
sidebar for Paged Media properties; optional `AppSettings.editor.cssDiagnostics`
toggle (one-line contract extension + one SettingsDialog control). Three-judge
visual gate if any chrome is added.

Each phase is an independently shippable PR that keeps all four verification
commands green.

## Verification (every phase, from `packages/viewer`)

- `npm run typecheck`
- `npm run check`
- `npm run electron:build`
- `npm test`

If `packages/lib/src` changed: `(cd packages/lib && bun run build && bun test &&
bunx tsc --noEmit)`.

## Acceptance-criteria mapping

| Criterion | Where |
|---|---|
| CSS files accessible from file tree | Already done (`FileTree` `EDITABLE_EXT`). |
| CM6 CSS mode highlighting | Phase 1 (`@codemirror/lang-css` via compartment). |
| Auto-save to disk on change | Already done (`onEditorChange` debounced `writeFile`). |
| CSS parse errors inline in gutter | Phase 2 (`checkCss` syntax-error finding → `linter`). |
| At-rule completions for `@page`/margin-box | Phase 3 (`pagedMediaCompletions`). |
| Depends on #38 (shared CM instance) | Satisfied — same editor, language compartment. |

# CSS-File Editing — Audit Report

_Audit date: 2026-06-24 (v0.6.0-beta.4). Investigation by a 3-agent team: CSS
code-path trace, file-selection/manifest trace, and live desktop+mobile UI
testing. No code was changed during the audit._

## Summary

The CSS-editor capability is **viewport-independent and functional** — syntax
highlighting and the postcss print-safety lint engage purely from the file
extension and work identically on desktop and mobile, edits autosave, and there
were zero console errors in live testing. The problems are about **reachability,
file selection, and correctness**, not a missing engine:

1. The only _labeled_ "CSS" entry point is the narrow-viewport (#34) tab bar, so
   CSS editing reads as mobile-only.
2. There is no way to **choose which CSS file** to edit; the picker logic is
   root-only, alphabetical-first, single-pick.
3. The CSS files that actually matter — the manifest's active stylesheet and the
   `themes/<id>/theme.css` the Theme Manager (#32) creates — are **unreachable**
   or **not the file the editor opens**.
4. One real **data-loss** path when switching CSS → Markdown.

## 🔴 Bugs

### B1 — Data loss: switching CSS→Markdown discards unsaved CSS edits (verified)
`selectMobileTab("markdown")` calls `buf.reset()` (`+page.svelte:2086`) when a CSS
file is open. `reset()` (`buffer-state.svelte.ts:288`) only cancels the debounce
timer and clears content — it does **not** flush, unlike `selectEditorFile`
which flushes first (`+page.svelte:709-715`, the #44 close-flush guarantee).
Editing CSS then tapping "Markdown" within the autosave debounce window silently
drops the edit.
**Fix:** `await buf.flush()` before `buf.reset()`, or route through
`selectEditorFile` (which already flushes).

### B2 — CSS editor opens the wrong file after applying a theme (core misalignment)
`findProjectCssFile` (`+page.svelte:2056`) ignores the manifest `styles:` (the
actual active stylesheet) and returns the alphabetical-first **root** `.css`.
Theme Manager (#32) writes the active theme to `themes/<id>/theme.css` and wires
`manifest styles:`, but the CSS tab opens an unrelated root file — the author
edits a file that isn't styling their book. The manifest `styles:` array is also
**never exposed to the renderer** (no IPC).
**Fix:** expose the resolved manifest `styles:` to the renderer (new IPC or via
the preview-start result); make CSS-file resolution prefer `manifest.styles[…]`.

## 🟠 Gaps (the two headline requests)

### G1 — No CSS-file picker; single-file, root-only assumption
`findProjectCssFile` is root-only, non-recursive, alphabetical-first, single-pick.
Multiple stylesheets (`styles/print.css`, `styles/screen.css`) get no choice; the
mobile CSS tab shows **no filename and no switcher** (live test: silently opened
`print.css` over `style.css`). Nested CSS — including the `themes/<id>/theme.css`
the Theme Manager itself creates — is **unreachable anywhere in the UI**
(FileTree is also root-only: `FileTree.svelte:7-8`).
**Fix:** a CSS/"Styles" picker listing CSS from `manifest.styles:` plus a
recursive scan of `styles/`/`themes/*`; show the active file's name; allow
switching.

### G2 — No discoverable CSS entry point on desktop
The only labeled "CSS" affordance is the #34 tab bar, gated `{#if isNarrow}`
(≤820px). On desktop, CSS editing only works if the user opens Left panel →
**Files** and knows that `.css` files in the (generic, root-only) FileTree are
clickable. The plumbing (`findProjectCssFile`, `selectEditorFile`, the CSS lang
mode) is fully viewport-agnostic — only the _trigger_ is gated.
**Fix:** a viewport-independent "Edit styles / CSS" affordance (editor toolbar or
Document menu) on all screen sizes, reusing the same path.

### G3 — CSS editing silently no-ops on web/PWA
Every load/edit path early-returns on `!isDesktop()` (`findProjectCssFile:2057`,
`selectEditorFile:706`, `onEditorChange:720`, `FileTree:35`). On a narrow **web**
viewport the CSS tab still renders but toasts "no CSS file to edit" — misleading.
**Fix:** hide editing affordances on web until the FSA WebAdapter wires file IO,
or show an explicit "editing requires the desktop app (for now)" message.

## 🟡 Misalignments / Nits

- **M1** — `editorSurface` vs `openFileIsCss` dual source of truth
  (`+page.svelte:2037/2040/2046`): transient divergence; the CSS-not-found path
  leaves `editorSurface="css"` stuck. Derive from `openFileIsCss` only, or set
  `editorSurface` after the load resolves.
- **M2** — Theme apply doesn't wire the editor (`ThemeManager.svelte:133-147`):
  after applying a theme nothing opens the new CSS. Optionally auto-open it.
- **N1** — No open-file name indicator in either mode (only a generic
  "CSS editor" aria-label) — the user can't tell which file they're editing.
- **N2** — FileTree mixes CSS with chapters; no "Styles" grouping/icon.

## What is NOT broken (scope guard)

- CSS syntax highlighting + postcss print-safety lint engage from the file
  extension and work identically on desktop and mobile (`css-editor.ts`,
  `MarkdownEditor.svelte:301-328`). No path/viewport-dependent mode bug.
- Desktop CSS editing _technically_ works today via the Files tree — so this is
  a reachability/correctness problem, not a missing engine.

## Recommended fix sequence

1. **B1** (data-loss flush) — tiny, ship first.
2. **G2 + G1** — one viewport-independent "Styles" entry point backed by a real
   CSS-file picker (the headline request).
3. **B2** — expose `manifest.styles` to the renderer; the picker/auto-open
   prefers the active stylesheet (resolves the theme-edit mismatch). Fold in M2.
4. **G3, M1, N1/N2** — polish.

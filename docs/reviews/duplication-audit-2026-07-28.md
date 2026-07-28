# Duplication audit — 2026-07-28

Follow-up to PR #127 (the preview serve-in-place rewrite, `claude/print-md-asset-analysis-amaj4k`).
That rewrite made several call sites go dead (the directory copiers) and made
the divergence between the renderer's file-set resolvers and validation/lint's
own approximations of the same thing actually observable. This audit
independently re-verified each reported item (grep for the identifier across
both packages, confirm the call sites, read the git history where relevant)
before deleting or consolidating anything, and records what was deliberately
left duplicated so it isn't "fixed" again later.

Branch: `claude/print-md-dedupe-followup`, based on `508f67a`.

---

## Part A — dead code removed

Each item below had **zero real call sites** after independent verification
(grep across `packages/cli` and `packages/viewer`, excluding the item's own
declaration/tests).

### 1. `missingSharedAssets`

Commit `2eb90ea` ("serve the project in place") deliberately dropped this
field from the CLI's `PreviewServerHandle` — "a missing stylesheet is a build
error now" (its own commit message). The viewer never got the memo: it kept
threading `missingSharedAssets` through ~11 sites end to end —
`electron/preview/controller.ts`, `electron/types.d.ts`,
`src/lib/platform/shared-types.ts`,
`src/lib/routes/project-lifecycle-controller.svelte.ts`, and into **live UI**
in `src/routes/+page.svelte`: a Problems-panel row and a toast that could
never fire, because `activePreview.missingSharedAssets` was always
`undefined` and `?? []` made it permanently `[]`.

Removed the whole path, including the UI (`onMissingSharedAssets`, the
`missingAssetProblems` state, the "Missing shared asset folder(s)" toast) and
`MISSING_ASSETS_SOURCE` in `src/lib/problems.ts` (verified it had no other
users before removing it from the `SOURCE_LABELS` table).

### 2. `src/lib/css-tokens.ts`

Superseded by `src/lib/style-tokens.ts`, which the live Design panel actually
uses (via `design-section-controller.svelte.ts`). The dead module's local
`StyleToken` had no `kind` discriminant at all (only an implicit
numeric-vs-text split via optional `number`/`unit`); the live one
(`src/lib/platform/dtos.ts`) has an explicit 5-value `StyleTokenKind`. No
non-test file imported `parseRootTokens`/`setRootToken`. Deleted the module and
its test file.

### 3. Orphaned ambient/module-local types

`electron/types.d.ts` (`declare global`) and `electron/preload.ts`
(module-local) both carried leftover type declarations from completed
IPC-to-server-route migrations (Phase 2B/2E, and the §8/ADR-0004 sync-recovery
seam): `StyleToken`, `ProjectClassification`, `ConflictPreview`,
`RecoveryConfirmRequest` in `types.d.ts`; `StyleToken`, `RecentFolderEntry`,
`FavoriteEntry`, `DiscoveredProject` in `preload.ts`. Every one of these
appeared exactly once — at its own declaration — confirmed individually. Every
real call site imports the actual type from `src/lib/platform/dtos.ts` or
`contract.ts` instead (e.g. `onRecoveryConfirm` in both files types its
callback as `(data: unknown)`, never as the ambient `RecoveryConfirmRequest`).
Removed all of them, plus the `ProjectSource`/`ProjectCapabilities` imports in
`types.d.ts` that only `ProjectClassification` had used.

### 4. `copyDir` and `copyDirectory`

`copyDir` (`packages/cli/src/lib/exec.ts`) and `copyDirectory`
(`packages/cli/src/utils/file-utils.ts`) both had zero callers left once the
preview stopped mirroring the project into a temp directory. `copyDir` had no
dedicated tests. `copyDirectory` — the safer, tested implementation (source
existence/type checks, per-file error aggregation into a `BuildError`,
symlink skipping) — **was flagged explicitly for objection** per the working
instructions rather than deleted quietly, since it was the more defensible of
the two: it had 4 passing tests and read as more "finished." It was deleted
anyway per CLAUDE.md's prime directive (reduce complexity, no unused code)
since grepping both packages confirmed zero callers, including the historical
comments in `preview/http-server.ts` and `preview/lifecycle.ts` that already
described it as "the old whole-tree copyDirectory this replaces." If this
call is wrong, `copyDirectory` is a 70-line, git-recoverable revert
(`git show <commit>^:packages/cli/src/utils/file-utils.ts`).

---

## Part A — consolidated (not deleted)

### 5. `relativeTime`

`src/lib/format.ts` documented itself as "Single source of truth... shared
across the renderer" for coarse time-ago rendering, but had zero production
callers. `src/lib/components/StatusBar.svelte`'s save-status popover
hand-rolled a second, differently-worded version instead. Consolidated onto
`format.ts`; StatusBar now imports and calls it.

**User-visible string change:** the "Latest version" popover text moves from
`"N minute(s)/hour(s)/day(s) ago"` to format.ts's `"N min(s)/hr(s)/day(s)
ago"`, and gains a locale-date fallback past 14 days (StatusBar's version had
no upper bound — it said "N days ago" forever for a project untouched for a
year). `format.ts` gained an optional `now` parameter (defaults to
`Date.now()`) purely so both call sites stay deterministically testable.

### 6. `STATIC_MIME` missing `.webp`/`.avif`

`packages/cli/src/lib/static-serve.ts`'s `STATIC_MIME` table (shared by the
live preview server and the build's pagination/PDF-render server) was missing
`.webp`/`.avif`, which `asset-inline.ts`'s `MIME_BY_EXT` already had. A
WebP/AVIF image over the inliner's size threshold (512KB, the point at which
it's copied instead of embedded as a `data:` URI) got copied as a real file
and then served as `application/octet-stream` by both servers. Added both
entries; the file's header already documented this exact
two-table-divergence class from a prior fix (finding #17) — extended the note
to record this recurrence. `MIME_BY_EXT` and `STATIC_MIME` answer genuinely
different questions (what Content-Type a `data:` URI needs vs. what
Content-Type an HTTP response needs) and `asset-inline.ts` is out of scope for
this PR, so this fix only touched `static-serve.ts`'s own table.

### 7. Two one-liners

- `src/lib/components/EditorToolbar.svelte` hand-rolled
  `imageSrc.split(/[\\/]/).pop()` at line 619 in a file that already imports
  `basenameOf` from `$lib/platform/paths` and uses it correctly at line 268.
  Switched to the helper.
- `src/lib/components/NewProjectWizard.svelte`'s `folderPreview` is a
  deliberate inline copy of `packages/cli/src/lib/slug.ts`'s `slugify`
  (NFKD normalize, strip diacritics, lowercase, collapse to hyphens, trim
  edge hyphens) — **required**, not a defect: CLAUDE.md §8 forbids the SPA
  from value-importing `@dimm-city/print-md` (no `node_modules` in the
  compiled binary for a value import to resolve against, and it would drag
  Node-target lib code into the browser bundle). The only real gap was a
  missing cross-reference comment, unlike `parentDirOf` two lines below it in
  the same file, which already documents itself the right way. Added the
  comment; did not attempt to import the lib.

---

## Part B — validation/lint re-derive the book's file set

`validation-exec.ts` and `lint-runner.ts` each independently approximated
"which markdown/CSS files make up this book" instead of calling the
renderer's own resolvers, via three different fallback chains:

- `validation-exec.ts`'s markdown fallback globbed `**/*.md` **recursively**
  across the whole project whenever `source.files` was unset, even though
  `renderChapters`' own fallback (`lib/markdown/index.ts`) is a **non-recursive
  root listing** — a book's chapters live at the project root by convention.
- Its CSS fallback similarly globbed `**/*.css` project-wide whenever
  `styles:` was unset, instead of calling `resolveActiveStyles`
  (`style-resolver.ts`) — the renderer's single source of truth for which
  stylesheet actually gets `<link>`ed into `book.html`.
- `lint-runner.ts` had a **third**, different fallback again:
  `.build/**/*.css`, then `example/**/*.css`/`demos/**/*.css` — leftover
  scaffolding for linting this repo's own dogfooding examples, unrelated to
  any given project's manifest, and (unlike every other project-wide scan in
  this package) it never applied `ASSET_SCAN_IGNORE_GLOBS`
  (`checks/asset/extensions.ts`), so it didn't even exclude
  `node_modules`/`.git`/`dist`.

**Why this mattered beyond validate-time cosmetics:** `print-md build`'s own
lint gate (`runQualityGates` in `build-runner.ts`) calls
`runLint({ manifest: opts.manifestPath ?? inputDir })` with no `styles:`
override — which is the common case for a project that relies on the
`styles/book.css` convention instead of an explicit manifest `styles:` key.
For that (majority) case, `lint-runner.ts`'s third fallback chain never found
anything except in this repo's own `example`/`demos` folders — meaning the
build's print-safety CSS gate was silently a no-op for an ordinary author's
project.

### The fix

Extracted `resolveActiveMarkdownFiles` (`lib/markdown/index.ts`) out of
`renderChapters`'s own inline fallback — the markdown counterpart to
`resolveActiveStyles` (`style-resolver.ts`):

1. the manifest `source.files` list, in order, if it has entries; else
2. every `.md` file directly inside the input directory (not recursive),
   alphabetically.

`renderChapters`, `validation-exec.ts`, and `lint-runner.ts` (for its CSS
resolution) now all call these same two resolvers instead of re-deriving
their own approximation. Both are anchored on `inputDir`, matching exactly
what the build anchors `renderChapters`/`resolveActiveStyles` on — the old
glob code anchored on `manifestDir`, which only differs from `inputDir` when
an explicit `--manifest` flag points outside `--input`, but in that edge case
`manifestDir` was the wrong anchor (the build itself renders from
`inputDir`).

`assetDirs` (the asset/image/font scan) is untouched — it deliberately stays
"the project root, wholesale" per its own existing comment; pruning happens
at the glob level (`ASSET_SCAN_IGNORE_GLOBS`), not by choosing directories.
That is a different, already-correct problem shape from "which specific
markdown/CSS files does the book use," so Part B left it alone.

Downstream consumers are unaffected in shape, only in which files they
receive: `ctx.cssFiles` → `checks/source/stylelint.ts`; `ctx.markdownFiles` →
`local-refs.ts`, `accessibility-heading-order.ts`, `markdownlint.ts`,
`accessibility-alt-text.ts`, `heuristic/section-density.ts`. All still get
absolute, readable paths — just the correctly-narrowed set.

New tests pin the resolved sets against the build's own behavior:
non-recursive root listing and unreferenced-theme exclusion
(`validation-exec.test.ts`), the removed `.build`/`example` scaffolding no
longer matching anything (`lint-runner.test.ts`), and direct coverage of
`resolveActiveMarkdownFiles`'s two branches (`markdown/index.test.ts`).

---

## Deliberately left duplicated

Two cases were reviewed and are **correct as-is** — do not "fix" these later.

### The three URL predicates

- `isNonFileUrl` — `packages/cli/src/lib/asset-inline.ts`
- `isRemoteUrl` — `packages/cli/src/lib/printsafe.ts`
- `isLocalRef` — `packages/cli/src/checks/source/local-refs.ts`

All three classify a URL/ref string, and all three start with the same
3-line core (`http://`/`https://`/protocol-relative `//`) — **that** core is
genuinely duplicated and would be safe to extract. But the three diverge on
purpose past that core:

- `isNonFileUrl` (the CSS inliner) also treats `data:` URIs and `#fragment`
  refs as non-file — a `data:` URI is already inline, and `#gradient` is an
  intra-document SVG fragment reference, neither of which the inliner should
  try to resolve as a file path.
- `isRemoteUrl` (the print-safety lint) does **not** exempt `#` — it isn't
  answering "is this a file," it's flagging remote-fetch risk in CSS, where a
  bare fragment isn't a URL fetch at all and is simply out of scope for this
  predicate's question.
- `isLocalRef` (the markdown link checker) additionally excludes `mailto:`,
  `tel:`, and `javascript:` — link schemes that are common in markdown prose
  but meaningless as local-file references.

Merging these into one shared predicate would make the CSS inliner try to
file-resolve `url(#gradient)` as if it were a path, which it is not. Only the
shared http/https/protocol-relative core is worth ever extracting, and even
that has limited value at 3 lines apiece.

### `NewProjectWizard`'s slugify copy

Covered under Part A item 7 above — required by CLAUDE.md §8's ban on the
SPA value-importing `@dimm-city/print-md`. Recorded here again because it's
exactly the kind of thing a future pass might otherwise "consolidate" back
into a shared import and quietly break the PWA-clean renderer bundle.

---

## Known, unfixed inconsistency (not touched in this PR)

Path-separator normalization to forward slashes is split across two
different idioms, roughly 16 sites in `packages/cli/src` alone (plus more of
the same pattern in `packages/viewer`):

- `p.split(path.sep).join("/")` — e.g. `asset-inline.ts`, `project-source.ts`,
  `plugin-vendor.ts`, `style-resolver.ts`, `remote-auth/recovery/backup.ts`
  (two call sites).
- `p.replace(/\\/g, "/")` — e.g. `markdown/chapter-id.ts`'s
  `canonicalChapterId`, `theme-import.ts` (four call sites),
  `ghostscript.ts`, `pagedjs.ts`, `preview/file-watcher.ts` (three call
  sites), and the embedded `assets/preview/scripts/preview-shell.js`.

These are **not equivalent**: `split(path.sep)` only splits on the *current
platform's* separator, so on POSIX it never touches a literal backslash in a
filename — a legal (if unusual) POSIX filename character — while
`replace(/\\/g, "/")` unconditionally mangles it. On Windows the two mostly
agree, since `path.sep` is `\` there.

This is a real, known inconsistency, and reconciling it would touch on the
order of 11 files across both packages for a purely defensive edge case
(literal backslashes in filenames). That is out of scope for this PR —
recorded here so it isn't rediscovered as a "surprise" later, and so nobody
attempts the full reconciliation as an incidental drive-by in an unrelated
change.

# File-operations audit: repo-root orientation & multi-project support (2026-07-29)

> **Status: RESOLVED (2026-07-30).** Every finding below was worked through
> test-first — a failing test that reproduces the defect, then the fix. Two were
> refuted on closer inspection and one is deferred pending a product decision;
> both are called out inline and summarised in [Resolution](#resolution) at the
> end. The findings text is kept in its original form as the record of what was
> found; read the Resolution section for what changed.

Scope: every surface that resolves paths, copies files, watches, serves, or runs
git — reviewed against the multi-project contract in `docs/open-design/*`,
`docs/design-guides.md`, `docs/ARCHITECTURE.md`, `docs/best-practices.md`,
`CLAUDE.md` §7, and the repo-root-session commits (`13b127b`, `2eb90ea`,
`70d5601`, `c310ef2`). Method: the contract was distilled into 16 normative
rules (appendix), nine parallel area reviews produced 41 raw findings, the top
18 were each adversarially re-verified against the code (all 18 confirmed, with
noted corrections), and a completeness pass covered the surfaces the areas
missed. Every claim below was re-derived from the code as written, with
file:line evidence.

## Verdict

The repo-root reorientation is real and the core pipeline implements it well:

- **Serve-in-place preview** (R7): the temp dir holds only `book.html`; every
  other request resolves against the real book directory through the shared
  separator-aware containment guards (`static-serve.ts`), dotfile requests 404.
- **Watcher closure** (R8): the CLI preview watches the book folder plus the
  full per-file asset closure of all active stylesheets (`@import` chains and
  `url()` targets, book-local or shared) and authored plugin paths
  (`preview/file-watcher.ts:294-350`).
- **Repo-aware fs authorization** (R11): `projectRoots()` = opened book +
  host-detected enclosing `repoRoot` (`main.ts:1499-1504`, commit `c310ef2`),
  symlink-safe and separator-aware (`server-bridge/fs-guard.ts`).
- **Whole-repo git** (R9): every git operation funnels through
  `repoDirFor`/`gitScopeFor` → `repoRoot`; `subPath` is location, never scope;
  no shell-outs (isomorphic-git only).
- **Styles by reference** (R3/R6): manifest `styles:` entries flow through
  verbatim (`../../shared/...` works), and `url()`/`@import` resolve relative
  to the containing stylesheet with cross-boundary tests.
- **Per-book vendoring** (R10), **manifest-anchored output** (R12), and
  home-capped `findEnclosingRepoDir` are all correct as documented.

But the reorientation is **incomplete at the edges**. The confirmed issues
cluster into five themes, roughly in priority order below.

---

## Theme 1 — `requireWithinProjectRoot` was never rolled out past fs/media (HIGH)

`fs/*`, `media/*`, `log/read`, `sync/get-conflict-preview`, and
`plugin/add-npm` confine renderer-supplied paths to the host-owned roots. The
rest of the route surface still authorizes real filesystem work (and worse)
against **any absolute path** via bare `requireAbsolute`:

| Routes | What an arbitrary `projectDir` gets you | Evidence |
|---|---|---|
| `vcs/save-snapshot`, `vcs/restore-snapshot`, `vcs/list-snapshots-page`, `vcs/enable-version-history`, `remote/sync`, `remote/resolve-sync-conflicts`, `remote/diagnose-project` | git writes on **any repo on disk** — restore is a `git.checkout({force:true})` (`source-provider.ts:613-620`); `remote/sync` runs a **credentialed push/pull** with the app token store | `vcs/restore-snapshot/+server.ts:10`, `remote/sync/+server.ts:14` |
| `publish/run`, `publish/set-config`, `publish/connect`, `publish/list`, `publish/preflight` | `publish:run` forwards a renderer-supplied `artifactPath` to an upload — a **local-file-to-network exfiltration primitive**; `set-config` writes a `publish:` section into any manifest | `publish/run/+server.ts:25` |
| `theme/apply`, `theme/remove`, `theme/read-css`, `theme/import-from-url/-file/-folder`, `style/set-active`, `project/list-styles` | copy a theme tree into, or `rm -rf` a `themes/<slug>` under, any dir; rewrite any `manifest.yaml` (`theme-manager.ts:605-608`, `manifest-doc.ts:46-70` mkdirs the target) | `theme/apply/+server.ts:13` |
| `manifest/read`, `manifest/set-fields` | read/overwrite any file named `manifest.yaml` (write confined to that filename; YAML round-trip, not arbitrary bytes) | `manifest/set-fields/+server.ts:8` |
| `plugin/set-enabled`, `plugin/list`, `plugin/add-local`, `plugin/validate` | manifest writes anywhere; **`plugin/validate` dynamic-`import()`s whatever JS the target dir's manifest references — an execute primitive** (`plugin-manager.ts:537` → `plugins.ts:1003`) | `plugin/set-enabled/+server.ts:8` |
| `snip/save`, `snip/read`, `snip/delete`, `snip/list` | read/delete files inside any directory named `snippets/` anywhere on disk; write into it (leaf name slug-confined — `snippets.ts:66-73`) | `snip/save/+server.ts:8` |
| `tpl/save-as-template` | recursively copy **any folder on disk** into `userData/templates`, readable back via `tpl/custom` and the scaffold wizard | `tpl/save-as-template/+server.ts:11` |
| `lint/project` | lint (read) any dir | `lint/project/+server.ts` |
| `shell/show-in-folder` | reveal any path in the OS file manager (no `requireAbsolute` even) | `shell/show-in-folder/+server.ts:15` |

This is exactly the threat model `fs-guard.ts:5-14` documents (same-origin
fetch from a preview XSS / malicious plugin script / compromised dep), and the
same P1 class fixed for `fs:watchFolder` and `sync/get-conflict-preview` in
PR #98 — it just never reached these route families. It is also a
**multi-project correctness** gap: these routes are the ones the Styles,
Themes, Plugins, Publish, and Version-history panels call, and confining them
to `projectRoots()` (book + repoRoot) is what makes their semantics match the
repo-root session.

**Caveat for the fix:** routes that legitimately run *before* a session exists
(`app/classify-project`, `app/adopt-folder`, `app/create-project`,
`app/discover-projects`, `remote/clone-repository`'s `parentDir`,
`app/gutterpress-project-state`, `recovery/*` — whose own store is
userData-side) cannot use `requireWithinProjectRoot` as-is (empty
`projectRoots()` fails closed). They need either dialog-capability gating like
`picked-files.ts` or explicit host-side policy — not a blanket guard.

## Theme 2 — Shared-asset parity: preview ≠ build (HIGH)

- **Large shared CSS images 404 in preview.** `inlineOne` rewrites an
  out-of-project CSS image > 512 KB to `assets/<contentHash><ext>`
  unconditionally and returns a copy plan (`asset-inline.ts:289-294`). Only
  `build-runner.ts:339` consumes the plan (`onCssAssets`); the preview render
  path (`preview/file-watcher.ts:68-95`) calls `renderChapters` without it and
  `http-server.ts` has no `/assets/*` route — so shared repo-root art over the
  inline cap renders broken in the live preview while the built PDF is
  correct. Violates R6 and the preview/build-parity intent of `2eb90ea`.
  Fix options: serve the plan from memory in preview, or resolve `assets/…`
  requests back through the recorded copy map.
- **Shared stylesheets are second-class in the Styles picker.**
  `discoverCssFiles` scans only the book (`style-resolver.ts:77-102`), so a
  `../../shared/...` sheet appears only while listed in the manifest;
  unchecking it in the desktop Styles panel removes the manifest entry and the
  next `loadStyles` drops it from the list entirely — no way to re-enable or
  add one from the UI (`styles-section-controller.svelte.ts:69-74`).
- **Shipped shared assets are never validated.** `executeValidation` sets
  `assetDirs = [inputDir]` (`validation-exec.ts:256`), so image/color/TAC/
  font checks skip the repo-root `shared/` closure that R6 embeds into the PDF.
- **Crash-draft recovery is immediate-children-only.** `listRecovery` filters
  with `path.dirname(entry.filePath) !== projectDir`
  (`electron/recovery.ts:163`): drafts for `styles/book.css`,
  `chapters/ch01.md`, or authorized repo-root shared files are written but
  never offered after a crash, then deleted as stale.

## Theme 3 — Desktop change-detection ignores the repo root (MEDIUM)

- **The desktop folder watch is one non-recursive `fs.watch` on the book root**
  (`folder-watch/watcher.ts:109`), and `fs:watchFolder` rejects any other dir
  (`main.ts:1010-1014`). External edits to nested book files or repo-root
  `shared/` files produce no `fs:folderChanged` (editor never reconciles) and
  no edit signal — while the embedded CLI preview watcher *does* see the same
  edit and rebuilds. Two observers, two answers, same change.
- **Auto-snapshot/auto-sync never arm for shared-file writes.**
  `scheduleAutoWriteEffects` fires only when the write lands inside the
  watched book dir (`write-hooks.ts:39-43`) — but fs authorization now
  deliberately allows writes under `repoRoot` (`c310e2`'s whole point). An
  author edits `shared/styles/components.css` in the app; version history
  quietly gets nothing. The debounce gate should test against
  `projectRoots()`, not `getWatchedDir()`.
- **Shared authored plugins go stale across concurrent previews.** The
  hot-reload shadow link is named by mtime alone in the plugin's own directory
  (`plugins.ts:883-888`); two previews sharing `../../shared/plugins/x.js`
  collide, the loser falls back to a plain `import()` the never-evicting ESM
  registry serves stale, and the stale module is re-cached under the new mtime
  (`plugins.ts:907-933`). Add a per-process token to the shadow name.

## Theme 4 — book-dir vs repoRoot key mixups (MEDIUM, one HIGH)

- **HIGH — Conflict previews are blank in any multi-book repo.** Conflict
  paths are repo-root-relative (`conflict-resolution.ts:421-424`), but the
  dialog passes the opened book dir and `getConflictPreviewImpl` joins them:
  `path.resolve(projectDir, relativePath)` (`recovery-bridge.ts:308`) →
  `/repo/books/x/books/x/file.md`, read fails, `mine`/`theirs` silently
  render empty. Resolve against the session's `repoRoot` instead.
- **Pre-export sync-conflict gate keyed by book dir**
  (`export/controller.ts:217`): a conflict latched while book A was active
  does not block exporting sibling book B, though the conflict is repo-wide.
- **Operation-log slug uses the opened book's basename**
  (`main.ts:354`, `orchestrator.ts:540,850`, `save-snapshot/+server.ts:50`)
  while `buildRecoveryContext` slugs the repo root — monorepo logs fragment
  per book, and same-named books in different repos interleave into one file,
  against `recovery-paths.ts:27-28`'s own guarantee.
- **`resolveActiveBookDir` falls back to `books[0]` for ANY unmatched path**
  (`project-session-controller.svelte.ts:73-76`; the doc comment scopes the
  fallback to "the bare repo root was picked"). Exact `===` match only: open a
  subfolder of book B (or a trailing-slash spelling) and the app opens book A.
- **Per-project restore state: read at the picked dir, written at the resolved
  book dir** (`+page.svelte:698` vs `:2049`), so a repo-root-keyed open skips
  the book's saved page/view state (state survives for later direct opens);
  and **`switchBook` passes `restoreState: null`** (`+page.svelte:1993`), so
  switching books always lands on page 1 even when saved state exists.

## Theme 5 — CLI root-resolution inconsistencies & path bugs

- **HIGH — Windows `%5C` dotfile bypass in the preview server.**
  `isDotfileRequest` splits the decoded path on `/` only
  (`http-server.ts:359-367`), but `path.win32.resolve` treats `\` as a
  separator: `/%5C.env` decodes to `/\.env`, passes the guard, and
  `resolveWithinRoot` resolves it to `<book>\.env` inside the root — serving
  `.env` / `.git\config` with 200 on Windows (plain spellings correctly 404).
  Reachable from a LAN peer with `--host 0.0.0.0` or via DNS rebinding.
  Fix: split on both separators (or reject `\` outright in request paths).
- **`styles:`/chapters resolve against `inputDir` while plugins and the lint
  gate resolve against `manifestDir`** (`build-runner.ts:315` vs `:327`,
  `lint-runner.ts:46-48`). Identical in the normative layout; diverges under
  explicit `--manifest`, making lint check different files than the ones that
  ship. Pick one anchor (manifestDir, per R3) for all four.
- **The pre-build local-refs check green-lights `../`/absolute prose images
  the build rejects** (`checks/source/local-refs.ts:189` — bare existence
  check), inverting R5 at validate time.

## Doc drift & low-priority hardening (unverified batch)

Reported by reviewers but not individually re-verified; treat as a triage list:
`docs/ARCHITECTURE.md` §Preview Server/File Watching still describes the
pre-serve-in-place copy-into-temp model (~349-414; flagged as contract-rule
R16); `manifest-config.ts:11` promises a `manifest.yml` fallback that no longer
exists; stale `main.ts:319` comment ("nested folders NEVER auto-snapshotted");
static-serve containment is lexical (symlinks inside the book escape the served
root — consistent with fs-guard's canonical checks being the authz layer, but
worth an explicit decision); preview watcher doesn't exclude `dist/` (a build
triggers a spurious rebuild); `build-fingerprint.json` records the ephemeral
workDir as `keyConfig.outputDir`; discovery/recents dedup compares repo-root
keys against book paths (`ProjectsListBody.svelte:208,431`,
`discover-projects/+server.ts:15`); `create-project`/`adopt-folder` accept
arbitrary renderer paths incl. `templateDir`; save-as-template of a repo-nested
book keeps `../../shared` refs that break when scaffolded elsewhere
(`project-templates.ts:137`); inline `style="url(...)"` refs in raw HTML never
enter the copy plan (`markdown/images.ts:55`); `..*`-named root files falsely
rejected by a bare `startsWith("..")` (`asset-inline.ts:444`); PDF `--out
<file>.pdf` logs a `book.html` path that is never delivered
(`build-runner.ts:652`); `adoptFolder` inside an enclosing repo surfaces a raw
nesting error (`project-scaffold.ts:472`).

## Surfaces verified clean

CLI `server.ts` and the pagination static server (shared `resolveStaticPath`
guard), `lint-runner.ts`, publish lib anchoring (manifestDir, R12),
`recovery-paths.ts`, `pdf-export.ts`, `picked-files.ts`, `open-path.ts`,
`embedded-assets.ts`, `log/read`, `dialog/*`, `sveltekit-host.ts`,
`repair.ts` (repoRoot via `detectProjectSource`), `snippets.ts` leaf handling,
`output-paths.ts` (+ regression tests for CWD independence and multi-book
separation), `plugin-vendor.ts` per-book containment, `project-source.ts`
(home-capped ancestor walk, worktree/submodule handling).

## Recommended order of work

1. Roll `requireWithinProjectRoot` out to the vcs/remote-sync/publish/theme/
   style/manifest/plugin/snip/tpl/lint route families (Theme 1), with a
   deliberate pre-session policy for classify/adopt/create/clone.
2. Fix the Windows `%5C` dotfile bypass (Theme 5, one-line guard fix + test).
3. Wire the preview to the CSS asset copy plan (Theme 2, first bullet) and
   resolve the conflict-preview repoRoot join (Theme 4, first bullet).
4. Arm auto-snapshot/auto-sync from `projectRoots()` and widen desktop change
   detection (or delegate it to the CLI watcher's events) (Theme 3).
5. The book-switch/session-state key fixes and `resolveActiveBookDir` exact-
   match fallback (Theme 4).
6. Shared-stylesheet picker support, validation `assetDirs` closure, crash-
   draft scoping (Theme 2 remainder); then the doc-drift/hardening triage list.

## Appendix — the distilled contract (16 rules)

R1 Sessions anchor at the repo root: any folder inside a repo classifies as
`local-git-folder` with `repoRoot` + `subPath` ("" when the project IS the
root); no subPath special cases. R2 Rendering targets exactly one book (its
manifest dir); design tools open the repo root. R3 A `styles:` entry is a path
Gutterpress READS, manifest-relative; `../../shared/...` CSS is normative;
inlined in listed order, later wins. R4 A missing stylesheet/font is a build
error naming the file, never a silent 404. R5 Prose images must live in the
book folder; `../`/absolute prose refs are build errors; shared art in shared
CSS is fine. R6 `url()`/`@import` resolve relative to the containing
stylesheet; fonts embed as data: URIs; images ≤512 KB embed, larger ones are
copied content-addressed. R7 Preview serves the project in place; temp dir
holds only `book.html`; dot-segment requests 404. R8 The watcher covers each
active stylesheet's full asset closure per-file, plus authored plugin paths.
R9 Git ops always act on the whole repo at `repoRoot`; isomorphic-git only.
R10 Authored plugins may be shared by relative path; npm vendor trees are
strictly per-book under `plugins/npm/`. R11 Static serving confines to its
root via the shared guards; desktop fs routes are authorized against
host-owned `projectRoots()` (book + repoRoot), symlink-safe. R12 Builds write
to `<manifestDir>/dist/<title-slug>/`; `output:`/`source.assets` fail by name.
R13 Implicit manuscript discovery is top-level-only per book. R14 One active
local theme per book; replacement preserves cascade position. R15 Generated
output is never source. R16 (conflict) `docs/ARCHITECTURE.md`'s preview/watch
sections still describe the pre-serve-in-place model and need a rewrite.

---

## Resolution

Worked through 2026-07-29/30, test-first: each defect got a test that reproduces
it and fails, then the fix. Repo-wide state after: **4208 tests pass, 0 fail**
(CLI 2130 + desktop 2071 + plugin contract), `svelte-check` 0 errors, both
typechecks clean, eslint clean, the desktop SPA build's renderer-purity gate OK,
and the Electron main build OK.

### Theme 1 — the guard rollout

One named check, `requireProjectDir` (absolute **and** inside the host-owned
`projectRoots()` allow-list), now covers all 36 `projectDir` routes:
`vcs/*`, `remote/{sync,resolve-sync-conflicts,diagnose-project}`, `publish/*`,
`theme/*`, `style/set-active`, `project/list-styles`, `manifest/*`,
`plugin/{set-enabled,list,add-local,validate}`, `snip/*`,
`tpl/save-as-template`, `lint/project`. Pre-session routes
(classify/adopt/create/discover, clone destination, userData stores) are
deliberately excluded and documented — `projectRoots()` is empty until a project
opens, so they fail closed by design.

Two paths that are not a `projectDir` needed their own policy, both resolved the
way `fs:copyFile`'s `src` already was — inside the project, or a path a native
dialog produced this session:

- `publish/run`'s `artifactPath` (the upload source, and so the actual
  exfiltration primitive). `pick-pdf-file`/`open-directory` register their
  results; the capability is consumed and re-registered so the wizard's
  dry-run → publish sequence still works.
- `shell/show-in-folder`, which had no validation at all. The export controller
  registers the PDF it actually wrote after the atomic rename, so the reveal
  never trusts a renderer path and a failed export authorizes nothing.

The five publish routes also moved path validation out of the handler body into
`validate`: `handlePublishErrors` maps any non-`Error` throwable to a generic
500, so a 400/403 raised inside the body had been reaching the client as
"Publishing could not be completed."

### Theme 2 — shared-asset parity

- The inliner's CSS asset plan is kept on `ServerState.cssAssets` and resolved by
  the preview server before the project-root fallback, so a >512 KB shared image
  loads from its real location at the same URL the build uses. Making the
  parameter **required** immediately exposed the same bug in the initial render
  (`server.ts` rendered before `createServerState`) as a compile error.
- `listProjectStyles` takes the enclosing repo root and offers the repo's shared
  stylesheets as inactive options, named the way the manifest stores them — so
  unchecking one no longer removes it from the UI forever.
- Asset validation additionally scans the directories the active stylesheets'
  out-of-book asset closure lives in (asset files' own directories only).
- `listRecovery` offers drafts for anything **under** the project, not just
  immediate children, separator-aware.

### Theme 3 — change detection

- `scheduleAutoWriteEffects` accepts a write anywhere in the project's write
  scope (book **or** repository), using the same host-detected root the fs guard
  authorizes against, so "allowed to write" and "counts as an edit" can no longer
  diverge. The debounce is still scheduled for the watched dir.
- The desktop folder watch is recursive, with an ignore list for subtrees that
  are never source — `.git` at any depth, `dist`, `plugins/npm`,
  `node_modules` — matched segment-aware on both separators. The CLI preview
  watcher got the same in-project exclusions, so a build no longer triggers a
  spurious re-render.
- **Not** done: watching the whole repository recursively. External edits to
  shared files are covered for rendering by the preview watcher's
  declared-dependency closure and for history by periodic sync plus the
  project-close flush; a recursive repo watch is a cost this change did not take
  on.

### Theme 4 — repo-root keys

- Conflict previews resolve against the host-detected repo root
  (`conflictBaseDir`), never the renderer's `projectDir`, and the host's
  containment check is canonical so the P1 symlink escape stays closed.
- One `operationLogSlug` helper keys the operation log to the repo, applied at
  all seven call sites.
- `resolveActiveBookDir` matches by containment, deepest book first,
  separator-aware — so opening a folder inside book B opens B.
- The per-project restore-state read moved into the lifecycle controller, the
  only place that knows the resolved target; this fixed both the wrong-key read
  and `switchBook` dropping the state, and removed a parameter three callers were
  getting wrong.
- **Refuted:** the pre-export sync-conflict gate. It does read the latch under
  the export dir, but `cancelAll()` clears every latch on project switch and the
  gate independently re-runs the repo-scoped `syncProject` and blocks on its
  outcome — the "latch from book A misses book B" scenario does not reproduce.

### Theme 5 — CLI anchors and path bugs

- The `%5C` dotfile bypass is closed: the guard moved to `lib/static-serve.ts`
  as `hasDotSegment` and splits on both separators on every platform, which is
  also what lets a POSIX test run pin the Windows outcome.
- `BuildContext.renderDir` is the single anchor for every manifest-relative path;
  `validation-exec` follows it, so the lint gate and the render see the same
  stylesheets.
- The pre-build `local-refs` check now enforces R5 with the same wording as the
  build, for images only — a relative link to a sibling document stays legal.
- Both escape tests stopped over-rejecting a project-root file whose name begins
  with two dots.

### Doc drift and remaining hardening

Rewritten: `docs/ARCHITECTURE.md`'s Preview Server and File Watching sections
(serve-in-place, the two watchers, the dependency closure, the dotfile guard).
Corrected: the `manifest.yml` fallback claim in `manifest-config.ts`, and
`main.ts`'s "nested folders are NEVER auto-snapshotted" and "shallow watcher"
comments. Fixed: `build-fingerprint.json` recording the ephemeral work dir as
`keyConfig.outputDir` (`recordedOutputDir` separates where the file is written
from what it records); discovery/recents dedup missing `lastActiveBook`, so a
book already in Recents was suggested again; the recents `exists` badge checking
the repo root while the row opens the book; and a `--out file.pdf` build logging
a `book.html` path it never delivered. Documented as a deliberate choice:
`resolveWithinRoot`'s lexical containment, with a pointer to the canonicalizing
guard the desktop fs routes use.

**Deferred, needs a product decision:** `saveProjectAsTemplate` copies a book's
manifest verbatim, so a template saved from a repo-nested book keeps
`../../shared/...` entries that cannot resolve once scaffolded elsewhere. The
three plausible answers — drop the entries and warn, copy the shared files in and
rewrite them local, or refuse to template such a project — are product calls, not
bug fixes, so this one is left flagged rather than guessed at.

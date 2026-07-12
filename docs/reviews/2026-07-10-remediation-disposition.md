# 2026-07-10 Remediation Disposition

Closure record mapping every finding in the two 2026-07-10 review documents —
[`2026-07-10-ux-critical-review.md`](./2026-07-10-ux-critical-review.md) (UX,
H1–H5 / M1–M49 / L1–L15, plus a 3-claim appendix) and
[`2026-07-10-architecture-critical-review.md`](./2026-07-10-architecture-critical-review.md)
(Architecture, findings 1–65, plus a 4-claim appendix) — to its remediation
outcome on branch `claude/ux-architecture-reviews-lfrtau`.

**Method.** Every finding ID below was verified against the current code
and/or `git log e72daef..HEAD` (the 13 commits made after the review docs
landed), not taken on the commit message's word alone — see the row notes for
what was spot-checked. Commit hashes cited under "fixed"/"fixed-with-deviation"
all resolve with `git log --oneline <hash>`. Anything I could not pin to a
commit or a specific verified code state is marked **NEEDS-VERIFICATION**, not
guessed into "fixed."

**A note on timing.** At the moment this document was compiled, three UX
findings (**M9, M26, M38**) — plus additional work-in-progress on top of the
already-fixed **M35** — had real, matching code already in the working tree,
including new/updated tests, but **not yet committed** (a concurrent lane,
"W6: Feature gaps + final gates + push", was still in flight). Per the hard
rule that every "fixed" row needs a real, resolvable commit hash, M9/M26/M38
are marked NEEDS-VERIFICATION with a description of what the in-flight diff
does, rather than "fixed" against a hash that does not exist yet; M35 is
marked Fixed for its already-committed core defect, with the in-flight extra
work called out in its Notes cell and in the residual-risk section. Re-run
`git log --oneline -- <file>` on the listed files once that lane lands to
promote/update these.

## Executive summary

Counts are for the 69 UX findings (H1–H5, M1–M49, L1–L15) + 65 Architecture
findings (1–65) = **134 core findings**, plus the 7 appendix claims (3 UX + 4
Architecture) that were already resolved by the reviews' own adversarial
verification step before remediation began.

| Disposition | UX (of 69) | Architecture (of 65) | Total |
|---|---|---|---|
| Fixed | 62 | 59 | 121 |
| Fixed-with-deviation | 2 | 4 | 6 |
| Deferred | 2 | 2 | 4 |
| NEEDS-VERIFICATION (uncommitted at report time) | 3 | 0 | 3 |
| Refuted during remediation | 0 | 0 | 0 |
| Refuted by original review (appendix, pre-remediation) | 3 | 4 | 7 |

No finding was refuted *during* remediation — the 7 refuted/rejected claims in
the two appendices were investigated and dropped by the review documents
themselves (before the finding lists above were even numbered), so they carry
that pre-existing disposition, not a remediation-phase one.

---

## UX doc — High severity (H1–H5)

| ID | Title | Disposition | Commit |
|---|---|---|---|
| H1 | External-edit auto-reload updates buffer but not visible editor | Fixed | `a6bde2a` |
| H2 | Version-history restore unreachable from UI | Fixed | `30619f6` |
| H3 | User guide teaches a nonexistent `ttrpg` plugin | Fixed | `5d96eab` |
| H4 | `validate --phase` accepts documented values but runs zero checks, exits green | Fixed | `2c2dcc5` |
| H5 | `+page.svelte` 3,829-line god file | Fixed | `5bd8e33` |

## UX doc — Medium severity (M1–M49)

| ID | Title | Disposition | Commit | Notes |
|---|---|---|---|---|
| M1 | Ten dialogs hand-roll modal scaffolding; ~500+ lines of copy-pasted CSS | Fixed | `30619f6` (+`116f0e6`) | `dialog-shell.css` shared by 11 components; verified via grep. |
| M2 | Render-overlay Cancel silently closes the project | Fixed | `30619f6` | |
| M3 | "Book is ready" toast spam on every rebuild | Fixed | `a6bde2a` | |
| M4 | Sync-conflict PDF export discards host explanation | Fixed | `a6bde2a` | |
| M5 | Lint-runner failure shown as "No problems found" | Fixed | `a6bde2a` | |
| M6 | Re-applying a built-in theme overwrites customization | Fixed | `30619f6` | |
| M7 | Theme Remove is one-click, no confirm | Fixed | `30619f6` | |
| M8 | Undo/scroll destroyed on every file switch | Fixed | `30619f6` | |
| M9 | FileTree read-only, no CRUD/watcher/live cache | NEEDS-VERIFICATION | — (uncommitted) | Full CRUD (create/rename/delete + two-step confirm), staleness fix, and `file-tree-cache.ts` exist in the working tree with matching tests (`fs-crud-routes.test.ts`, `file-tree-open-file-rename-delete.test.ts`, `file-tree-cache.test.ts`) but are untracked/uncommitted as of this report. **Deviation documented in the code itself:** drag-and-drop / dedicated reorder control deliberately NOT built — renaming a chapter's numeric filename prefix is the reorder mechanism (`FileTree.svelte`'s own header comment explains the tradeoff: a dedicated renumber control would need cross-file atomic rename with no guaranteed numbering convention). |
| M10 | Two competing image-import implementations | Fixed | `30619f6` | |
| M11 | "Insert table…" dead in `display:none` group | Fixed | `30619f6` | |
| M12 | CrashRecoveryDialog inaccessible, blind destructive Discard | Fixed | `30619f6` | Adopts shared `dialogBehavior`. |
| M13 | Conflict dialog silently-disabled confirm | Fixed | `30619f6` | |
| M14 | `ProjectConfigPanel` 903-line god component | Fixed | `5bd8e33` | 903→261 lines, controller-per-section. |
| M15 | Guide Ch.8 documents env vars/manifest keys code never reads | Fixed | `5d96eab` | |
| M16 | Guide uses unrenderable markers, documents removed `[!NOTE]` as built-in | Fixed | `5d96eab` | Verified: `06-plugins.md` now explicitly documents `[!NOTE]` as **not** built in. |
| M17 | Guide Ch.3–4 document classes/HTML/themes core doesn't provide | Fixed | `ee5dd2a` (CSS) + `5d96eab` (docs) | Core layout utilities (`.center`/`.float-left`/`.float-right`/`.full-width`/`.full-bleed`) added to `PAGED_CSS`; guide rewritten to match. |
| M18 | CLI README omits 4 commands, documents nonexistent flags | Fixed | `5d96eab` | README regenerated from citty definitions + drift test. |
| M19 | Dismissing dialog mid-op lets it finish invisibly | Fixed | `30619f6` | `guardedClose` pattern in `dialog.ts`, `NewProjectWizard.svelte`, `AdvancedSetupDialog.svelte`. |
| M20 | Swallowed load errors render as false empty states | **Deferred** | — | Verified NOT fixed: `ProjectsListBody.svelte` still has `catch { /* non-fatal */ }` before "No recent projects yet"; `NewProjectWizard.svelte`'s `loadTemplates` still catches into `templates = []` silently. No `lastLoadError` tracking exists anywhere in the viewer. |
| M21 | New-book wizard forces native folder picker, no default location | Fixed | `30619f6` | `parentDir` now prefilled from last-used/platform docs dir. |
| M22 | `friendlyHostError` duplicated byte-identical in AdvancedSetupDialog | Fixed | `30619f6` | |
| M23 | Narrow More menu silently drops Save/Snippet | Fixed | `30619f6` | Verified: More menu now renders every `visibleItems` entry unfiltered by group. |
| M24 | Toolbar popup ARIA roles (menu/listbox) with no keyboard behavior | Fixed-with-deviation | `30619f6` | **Deviation:** rather than implementing full roving-tabindex menu/listbox keyboard semantics, the invented `role="menu"`/`role="listbox"` were removed — popups are now plain disclosure (code comment: "Plain disclosure, not role=menu... so the listbox contract would be a lie"). Verified: no `role="menu"`/`role="listbox"` remain in `EditorToolbar.svelte`. |
| M25 | Snippet delete: one-click destructive, no confirm | Fixed | `30619f6` | Two-step inline confirm in `SnippetPicker.svelte`. |
| M26 | Toolbar exposes no layout primitives beyond `@page-break` | NEEDS-VERIFICATION | — (uncommitted) | An "Insert layout block" picker (Chapter/Section/Two columns/Page break/Spread) plus `@marker` autocomplete (`marker-completions.ts`) exist in the working tree (`EditorToolbar.svelte`, `toolbar-actions.ts`, `MarkdownEditor.svelte`) with a matching test file, but uncommitted as of this report. |
| M27 | Second concurrent PDF export via keyboard shortcut | Fixed | `30619f6` | `savePdf` single-flight. |
| M28 | Export Cancel dead until first progress event | Fixed | `30619f6` | |
| M29 | `ExportProgressEvent` defined 3×, drifted `conflict` state | Fixed | `30619f6` | |
| M30 | Missing-asset warning via 5s auto-dismiss toast | Fixed | `30619f6` | Moved to Problems panel. |
| M31 | `PreviewClient` accepts/posts `postMessage` with `'*'` origin | Fixed | `30619f6` | Origin+source validated; skips attach in URL mode. |
| M32 | Problems panel leads with markdownlint rule-code jargon | Fixed | `63f8b59` (CLI) + `30619f6` (viewer rendering) | |
| M33 | Raw npm package ids/"npm" jargon in plugins list | Fixed | `30619f6` | |
| M34 | Plugin status stuck "Checking…" forever on validate failure | Fixed | `30619f6` | |
| M35 | Styling split across 3 dev-shaped sections; Styles lets writer uncheck every stylesheet | Fixed | `30619f6` | The concrete defect named in the finding — no minimum-one guard, so a writer could uncheck every stylesheet — is fixed and committed. The fuller recommended IA merge (Appearance/Styles/Design → one "Look & style" section with stylesheets demoted behind an "Advanced" disclosure) additionally exists in the uncommitted working tree (`ProjectConfigPanel.svelte`, `config/*Section.svelte`) as of this report — see residual risk section for that part. |
| M36 | Design token editor missing font/named-color/multi-line support | Fixed | `30619f6` | |
| M37 | Two overlapping log/activity surfaces, doc drift | Fixed | `30619f6` | One operation-log owner surface. |
| M38 | "Recovery" names two unrelated subsystems | NEEDS-VERIFICATION | — (uncommitted) | NAMING MAP comments + writer-facing copy changes ("Unsaved changes found" instead of "recovered", "Restore unsaved changes" instead of "Crash recovery") exist in the working tree (`CrashRecoveryDialog.svelte`, `SettingsDialog.svelte`, `electron/recovery.ts`, `electron/recovery-bridge.ts`) but are uncommitted. **Deviation (as instructed):** the rename is deliberately scoped to writer-facing copy and code comments only — internal identifiers (`recovery.ts`, `RecoveryItem`, `recoveryPath`, `electron.crashRecovery` setting key) are explicitly left unchanged to avoid a churn-only rename of stable internals. |
| M39 | Auto-snapshot failures silently swallowed | Fixed | `e0708a3` | Surfaces as "Version history needs attention" after repeated failures. |
| M40 | SyncStatusPill aria-live dead in prod, `error` masquerades as "Offline" | Fixed | `30619f6` | |
| M41 | Publish panel leaks raw errors, allows Publish while disconnected | Fixed | `30619f6` | |
| M42 | Onboarding docs never mention `print-md new` | Fixed | `5d96eab` | |
| M43 | Preview port documented as 3000, actual 3579 | Fixed | `5d96eab` | |
| M44 | Ch.2 presents guide-project CSS as core behavior | Fixed | `5d96eab` | |
| M45 | Ch.7 documents unread `validate.thresholds` key | Fixed | `5d96eab` | Corrected to `ink.maxTac`. |
| M46 | Inconsistent input conventions across commands | Fixed | `ee5dd2a` | Uniform optional positional dirs. |
| M47 | Inconsistent exit codes (lint 2, validate/audit 1) | Fixed | `ee5dd2a` | Exit-code contract 0/1/2/3; lint now exits 1. |
| M48 | Unknown `preset:` silently falls back to DTRPG | Fixed-with-deviation | `ee5dd2a` | Unknown presets now error instead of silently resolving to DTRPG. **Deviation:** the review's suggested fix was a neutral `book` default; remediation instead **kept `dtrpg` as the default** (for backward compatibility with existing projects) and added a `warnOnce()` notice when no `preset:` is set — verified in `presets.ts:226-246`. A `book` preset was added as an available option, not the default. |
| M49 | Root README tells desktop users they need Chromium | Fixed | `5d96eab` | Confined to CLI; viewer uses Electron's own Chromium. |

## UX doc — Low severity (L1–L15)

| ID | Title | Disposition | Commit | Notes |
|---|---|---|---|---|
| L1 | "Electron bridge unavailable" jargon toast ×4 | Fixed | `30619f6` | |
| L2 | Disconnecting a Git server: one un-confirmed click | Fixed | `30619f6` | Two-step inline confirm, `AdvancedSetupDialog.svelte`. |
| L3 | Splash comment says "60s", code fires at 15s | Fixed | `e0708a3` (+`fc0fb3c` regression test) | Comment corrected to match the real 15s value (not the value changed). |
| L4 | Vestigial dual open mechanism on NewProjectWizard | Fixed | `30619f6` | |
| L5 | Primary-button styling forks into a third visual variant | **Deferred (explicit)** | — | Verified: `dialog-shell.css` header comment explicitly states this is "Out of scope on purpose" — the flat vs. gradient button treatments were preserved as-is, not unified, during the CSS extraction. |
| L6 | Inline formatting toggle non-idempotent on empty selection | Fixed | `30619f6` | `toggleInlineWrap` now checks for an existing marker pair before inserting. |
| L7 | MediaPanel detail view has no race guard | Fixed | `30619f6` | |
| L8 | LeftPanel ships 3 no-op exported methods | Fixed | `30619f6` | Same fix as Architecture #41 (shared root cause). |
| L9 | Problems panel disappears below 820px | Fixed | `30619f6` | Count badge added. |
| L10 | Doctor route filters by display string `'chrome / chromium / msedge'` | Fixed | `63f8b59` | Diagnostics entries now carry a stable machine id. |
| L11 | GitHubDialog doesn't scrub Electron IPC prefix | Fixed | `30619f6` | |
| L12 | Divergent binary-file lists (conflict dialog vs. host) | Fixed | `30619f6` | Binary-file authority moved to host payload. |
| L13 | Code written to satisfy test greps, no-op transforms | Fixed | `30619f6` | |
| L14 | CONTRIBUTING.md contradicts license, describes nonexistent test layout | Fixed | `5d96eab` | License statement corrected to MPL-2.0. |
| L15 | Plugins empty-state copy points wrong direction | Fixed | `30619f6` | |

## UX doc appendix — 3 claims refuted by the original review

These were investigated and dropped by the review's own adversarial
verification step, before remediation began — no remediation action was
needed or taken.

| Claim | Disposition |
|---|---|
| "Missing/moved project folder gets misleading copy + doomed adopt CTA" | Refuted by original review |
| "Close silently discards unsaved Details/Publish drafts" | Refuted by original review |
| "GitHubDialog shows raw exception/IPC text to writers" | Refuted by original review (residual scrub gap retained as L11, fixed above) |

---

## Architecture doc — Critical (1) and High (2)

| ID | Title | Disposition | Commit |
|---|---|---|---|
| 1 | No `will-navigate` guard + permissive `window-open` handler reaches preload IPC bridge | Fixed | `7dd92f4` |
| 2 | Preset default styles defeat style-resolver's fallback chain | Fixed | `ee5dd2a` |

## Architecture doc — Medium, confirmed (3–14)

| ID | Title | Disposition | Commit |
|---|---|---|---|
| 3 | `exec.ts` hardcodes `:` as PATH separator (Windows) | Fixed | `ee5dd2a` |
| 4 | Layout warnings computed then discarded by every render path | Fixed | `63f8b59` |
| 5 | Plugin loader cache-busts with `Date.now()` on every render | Fixed | `ee5dd2a` |
| 6 | `main.ts` 2,010-line god file, 300-line `handlePreviewRequest` | Fixed | `fc0fb3c` |
| 7 | Auto-sync abstraction leaky: internals mutated outside orchestrator | Fixed | `e0708a3` |
| 8 | §8 "narrow IPC bridge" drifted: 19 invoke channels, dup folder-watch route | Fixed | `e0708a3` |
| 9 | `build-runner.ts` 1,119-line god-module | Fixed | `e032c3c` | 1,119→619 lines. |
| 10 | `+page.svelte` 3,829-line god-file | Fixed | `5bd8e33` |
| 11 | §8 recipe stale; `contract.ts` half tombstones; WebAdapter ~200 dead lines | Fixed-with-deviation | `5d96eab` (docs) + `5bd8e33` (code pruning) | **Deviation:** the review's fix offered two choices — delete the orphaned WebAdapter code, or route through `getPlatform()` on web if PWA (#33) remains a goal. Remediation chose neither deletion nor full wiring: WebAdapter is **kept as documented dormant scaffolding** for the future #33 PWA milestone (explicit in CLAUDE.md's "Dormant PWA scaffolding" section and `5bd8e33`'s commit message: "kept per the maintainer decision"). The doc-drift half (§8 rewritten to the route-first reality, false docstrings fixed) is fully resolved. |
| 12 | Viewer test suite never runs in CI, only at release | Fixed | `623b890` |
| 13 | §1 mandates `Bun.serve`, contradicting code and Node-compat requirement | Fixed | `5d96eab` |
| 14 | CLI typecheck non-blocking in CI (`continue-on-error: true`) | Fixed | `623b890` |

## Architecture doc — Medium, unverified in original review (15–49)

| ID | Title | Disposition | Commit | Notes |
|---|---|---|---|---|
| 15 | Install-hint copy in 3 diverging copies | Fixed | `ee5dd2a` | Canonical `install-hints.ts` module. |
| 16 | 4 parallel spawn-and-capture implementations, leaked kill timer | Fixed | `ee5dd2a` | One `execCapture` with cleared/unref'd timer. |
| 17 | Static file server + MIME table duplicated | Fixed | `ee5dd2a` | Shared `static-serve.ts`. |
| 18 | `diagnostics.ts` reads `package.json` off disk at runtime | Fixed | `ee5dd2a` | Static import, reports real version. |
| 19 | Pagination failure stalls silently 60 minutes | Fixed | `ee5dd2a` | Liveness polling replaces silent stall. |
| 20 | `build-fingerprint` shells out to system git binary | Fixed | `ee5dd2a` | Now via isomorphic-git per §7. |
| 21 | Hand-rolled deep clone; dtrpg defaults applied to all PDF validations | Fixed-with-deviation | `ee5dd2a` | Same deviation as M48: dtrpg kept as default preset with a `warnOnce()` notice rather than switching the default to the neutral `book` preset. `structuredClone` replaces the hand-rolled clone. |
| 22 | `pagedjs.ts` detects via forbidden bare `/pagedjs/i` substring test | Fixed | `ee5dd2a` | Uses the stable marker only. |
| 23 | `index.ts` comment falsely claims `checkCss` runs in renderer | Fixed | `ee5dd2a` | Verified: comment now says "runs HOST-SIDE ONLY." |
| 24 | `resolveConfig` 130-line hand-rolled 3-way merge, mutable warn state | Fixed | `ee5dd2a` | Typed deep-merge + deprecated-keys table. |
| 25 | Manifest handling fragmented across 5 modules, bypassed DRY extraction | Fixed | `ee5dd2a` | All manifest IO routed through `manifest-doc.ts`. |
| 26 | `markdown-it-paged.js` is CJS in an ESM/TS package | Fixed | `ee5dd2a` | Verified: file now uses `export default`/`export const`. |
| 27 | PDF export silently truncates on Paged.js timeout | Fixed | `e0708a3` | Typed author-friendly error instead. |
| 28 | SvelteKit host-boot failure swallowed, raw 503 page | Fixed | `e0708a3` | Plain-language dialog + styled error pages. |
| 29 | `AppSettings`/`DEFAULT_SETTINGS` hand-duplicated | Fixed | `e0708a3` | One shared module. |
| 30 | Preference state fragmented, deprecated/dead fields | Fixed | `e0708a3` | |
| 31 | 11 stringly-keyed `globalThis` service locators | Fixed | `e0708a3` | Collapsed to one typed `__printMdHost__`. |
| 32 | 3 module-level state mirrors kept "solely for byte-identical reads" | Fixed | `e0708a3` | Deleted. |
| 33 | Main window runs `sandbox: false`, no justification | Fixed | `7dd92f4` | `sandbox: true`, justified in a comment. |
| 34 | Store files written non-atomically, corrupt prefs silently reset | Fixed | `e0708a3` | tmp+rename, `.corrupt-<ts>` preservation. |
| 35 | 85+ near-identical route files, 3 lib-loading mechanisms | Fixed | `e0708a3` | One `defineRoute` factory across all 100 routes. |
| 36 | Inconsistent absolute-path validation across projectDir routes | Fixed | `e0708a3` | Universal `requireAbsolute` in the factory. |
| 37 | fs routes have no project-scoping | Fixed | `e0708a3` | `requireWithinProjectRoot` containment check. |
| 38 | 3 inconsistent error-envelope patterns | Fixed | `e0708a3` | One error envelope in `defineRoute`. |
| 39 | `contract.ts` 926-line god file | Fixed | `5bd8e33` | 926→650 lines; DTOs split into `platform/dtos.ts`. |
| 40 | `api.ts` re-inlines DTO shapes, ad-hoc casts | Fixed | `5bd8e33` | Fully typed endpoints, contract-dto type-test extended. |
| 41 | LeftPanel 3 empty no-op methods, 10 ceremonial call sites | Fixed | `30619f6` | Same fix as UX L8. |
| 42 | 3 coexisting modal focus-trap implementations | **Deferred (partial)** | — | Verified: 11 of 13 dialog-like components now share `dialogBehavior`/`trapFocus` (`30619f6`), shrinking the original 3 implementations toward 1. But `EditorToolbar.svelte`'s image/table popups still hand-roll a separate `trapFocusIn`/`focusableElementsIn` pair, and `a11y.ts`'s `trapFocus` remains exported (the finding's "unexport trapFocus" fix step not done). Two implementations remain, not one. |
| 43 | Build configs describe defunct "adapter-static + IPC-only" architecture | Fixed | `623b890` | Verified: build-config comments now describe the adapter-node reality. |
| 44 | CHANGELOG missing every release 0.3.x–0.7.1 except 0.5.x/0.6.1 | Fixed-with-deviation | `5d96eab` | **Deviation:** 0.5.3–0.7.1 backfilled from source control; **0.3.x and 0.4.x remain unfillable** because those tags were purged by the recorded v0.5.1 history reset — verified in `CHANGELOG.md`: "0.3.x–0.4.x: no release notes are available for this range, on GitHub or elsewhere," documented as a permanent gap rather than fabricated. |
| 45 | security-audit CI job is theater, can't fail | Fixed | `623b890` | Verified: `bun audit --json \|\| true` for the artifact, plus a real severity-gated step after it. |
| 46 | Unused `pagedjs` runtime dependency ships everywhere | Fixed | `623b890` | Verified: moved to `devDependencies` in `packages/cli/package.json`. |
| 47 | Docker runtime deps installed unpinned | Fixed | `623b890` | Pinned from tested resolution. |
| 48 | Release workflow silently deletes/re-points published tags | Fixed | `623b890` | Verified: stable tags now `exit 1` with an explicit error if re-dispatched; only prerelease tags may be replaced. |
| 49 | Core CLI host-integration modules have no direct tests | Fixed-with-deviation | `ee5dd2a` | Test files added for `chromium.ts`, `manifest.ts`, `pagedjs.ts`, `validation-exec.ts`, `preview/lifecycle.ts`, plus command-level tests for `audit`/`build`/`lint`/`new`/`validate` — verified via `git log --diff-filter=A`. **Gap:** `browser-pool.ts` (87 lines, explicitly named in the finding) still has no direct test file as of `HEAD`. |

## Architecture doc — Low (50–65)

| ID | Title | Disposition | Commit | Notes |
|---|---|---|---|---|
| 50 | Pooled Chromium leaks on failed builds in library hosts | Fixed | `ee5dd2a` | Verified: `try { … } finally { if (!opts.keepBrowserAlive) await closeBrowser(); }` wraps the whole `runBuild` body. |
| 51 | `getPerPageInkCoverage` swallows Ghostscript failures into `[]` | Fixed | `ee5dd2a` | Discriminated result. |
| 52 | Cache-header comments contradict code; `cacheControl` param dead | Fixed | `ee5dd2a` | Verified: `cacheControl` param now used in the `writeHead` call. |
| 53 | Two `renderBook` functions, duplicated plugin-loading, `any[]` typing | Fixed | `63f8b59` | Verified: preview copy renamed `renderPreviewBook`, comment cites "ARCH finding #53." |
| 54 | 2-module status dispatcher for one hard-coded endpoint | Fixed | `ee5dd2a` | Inlined to a 5-line branch. |
| 55 | Unescaped class interpolation, O(n²) col-split lookahead, redundant rules | Fixed | `ee5dd2a` | |
| 56 | Stale architecture comments (DC plugin, moved code) | Fixed | `ee5dd2a` | |
| 57 | `isFilePath` doc/behavior mismatch on bare relative paths | Fixed | `ee5dd2a` | |
| 58 | Splash comment "60s", code sets 15s | Fixed | `e0708a3` (+`fc0fb3c`) | Duplicate of UX L3; same fix. |
| 59 | Vestigial "config" editor-view state, unreachable branch | Fixed | `30619f6` | |
| 60 | Duplicated folder-open picker flows, hand-rolled basename splitting | Fixed | `30619f6` | |
| 61 | Settings store: manual subscriber array alongside rune reactivity | **Deferred** | — | Verified NOT fixed: `settings.svelte.ts` still maintains a `subscribers` array notified inside `set()`; `+page.svelte` still calls `settings.subscribe(...)` imperatively rather than via `$effect`. |
| 62 | Windows viewer build duplicated (composite action + release.yml) | Fixed | `623b890` | Verified: release.yml comment "Finding #62: the composite action is the single Windows-viewer..." |
| 63 | Renderer-purity gate's own self-test never run in CI | Fixed | `623b890` | Verified: `ci.yml` runs `node tools/check-render-purity.test.mjs` before the real gate. |
| 64 | CLAUDE.md/build configs cite nonexistent ADRs (0002, 0004, 0006) | Fixed | `5d96eab` | Verified: `docs/adr/0001–0006*.md` all exist. |
| 65 | `docs/` mixes user docs with one-off internal audit artifacts | Fixed | `5d96eab` | Dated review artifacts moved to `docs/reviews/`. |

## Architecture doc appendix — 4 claims rejected by the original review

| Claim | Disposition |
|---|---|
| "Unauthenticated localhost server exposes arbitrary file read/write + `shell.openExternal`" | Rejected by original review (residual defense-in-depth folded into finding 37, fixed above) |
| "`$lib/api.ts` is a second host seam that bypasses §8" | Rejected by original review (doc-drift residue folded into finding 11, fixed above) |
| "fs surface reached through two seams — web breaks inconsistently" | Rejected by original review (forward-looking PWA-milestone note, not a shipping defect) |
| "Controller pattern injects thunks instead of sharing reactive state" | Rejected by original review (god-file itself retained as finding 10, fixed above) |

---

## Residual risk / follow-ups

**Deferred (explicit or verified-still-present):**

1. **UX M20** — swallowed load errors (recents list, template list, discover-projects scan) still render as false empty states with no retry affordance. No `lastLoadError` tracking exists. Real gap, not addressed.
2. **UX L5** — primary-button styling still forks into a flat-fill vs. gradient "third visual variant"; the `dialog-shell.css` extraction explicitly preserved both rather than unifying them ("Out of scope on purpose").
3. **Architecture #42** — modal focus-trap consolidation is partial: 11/13 dialog-like components now share `dialogBehavior`, but `EditorToolbar`'s image/table popups still hand-roll their own trap, and `trapFocus` is still exported from `a11y.ts` for that reason.
4. **Architecture #61** — the settings store's manual `subscribers` array (a second notification channel alongside Svelte runes) is still present; `+page.svelte` still subscribes imperatively rather than via `$effect`.

**Fixed-with-deviation, carrying forward risk:**

5. **UX M48 / Architecture #21** — unknown `preset:` values now error (good), but the default preset for a manifest with no `preset:` set remains `dtrpg` (TTRPG trim size/TAC/PDF-X profile) rather than a neutral `book` default, with only a `warnOnce()` console notice. Non-TTRPG authors who never set `preset:` still get TTRPG-shaped PDFs by default; this is a conscious backward-compatibility tradeoff, not a fix of the underlying UX mismatch the review flagged.
6. **Architecture #11** — WebAdapter's ~200 lines of dormant PWA implementation were kept (not deleted, not wired live) pending the future #33 PWA milestone. This is a documented decision, not an oversight, but it means the "half-finished seam" surface area itself did not shrink — only the false docstrings claiming it works today were fixed.
7. **Architecture #44** — CHANGELOG 0.3.x/0.4.x history is permanently unfillable (source tags purged in the recorded v0.5.1 history reset); documented as such rather than fabricated, but the gap in the historical record is real and will remain.
8. **Architecture #49** — `browser-pool.ts` (87 lines) is the one CLI host-integration module named in the finding that still has no direct test, despite a broad test backfill covering the other five named modules plus command-level tests.

**NEEDS-VERIFICATION — implemented but uncommitted at report time:**

9. **UX M9** (FileTree CRUD/staleness), **M26** (toolbar layout-block insert + marker completions), the fuller **M35** IA merge (Appearance/Styles/Design → "Look & style"), and **M38** (crash-recovery vocabulary/naming) all have matching code and new tests in the working tree, attributed to the concurrent "W6: Feature gaps + final gates + push" lane, but no commit hash exists for them as of this document. Re-verify against `git log` once that lane's commit lands and promote these four rows to "Fixed" / "Fixed-with-deviation" with the real hash. Two deliberate deviations are already visible in that uncommitted code and should carry through once committed:
   - **M9**: no drag-and-drop/dedicated reorder control — rename-the-numeric-prefix is the reorder mechanism, by design (documented in `FileTree.svelte`'s own header comment).
   - **M38**: the "recovery" naming split is scoped to writer-facing copy and code comments only; internal identifiers (`recovery.ts`, `RecoveryItem`, `recoveryPath`, the `editor.crashRecovery` settings key) are deliberately left unrenamed.

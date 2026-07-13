# Architecture Critical Review — print-md

**Date:** 2026-07-10
**Panel:** Architecture Critical Review (6 expert reviewers, adversarially verified)
**Scope:** CLI build/PDF pipeline; markdown/rendering subsystem; Electron host layer; viewer HTTP API routes and platform-adapter seam; viewer SPA frontend; build/CI/release/test/hygiene cross-cutting.

Findings marked **[Confirmed]** survived adversarial verification against the code; severities reflect the verifier's adjustments. Findings marked **[Unverified]** are medium/low findings from the reviewers that were not adversarially checked. Four claims were investigated and rejected — see the appendix.

---

## Executive summary

**1. One genuinely critical security hole in the Electron host.** The main window has no `will-navigate` guard, `setWindowOpenHandler` allows any https URL a full BrowserWindow, and no `ipcMain.handle` validates sender origin. Combined with an unsandboxed cross-origin preview iframe rendering author markdown with `html:true`, a malicious project needs exactly one user click on a `target="_top"` link to hand a remote origin the full preload bridge — including arbitrary-path PDF write, arbitrary-directory repo clone, and preview/watch control. For a product whose core workflow is opening shared/cloned untrusted markdown projects, this is release-blocking. The fix is small and standard Electron checklist work.

**2. Documentation drift is systemic — and this repo is unusually vulnerable to it.** This codebase is explicitly driven by AI sessions that treat CLAUDE.md and in-file architecture comments as binding. Yet CLAUDE.md §1 instructs the exact `Bun.serve` pattern that would break the viewer under Electron's Node (contradicting both the code and CLAUDE.md's own layout section); §8's "exactly one seam" recipe describes an adapter-first flow the codebase deliberately abandoned in the Phase 2B–2F route migration; `index.ts` documents the precise renderer value-import anti-pattern that shipped the 0.4.0-beta.4 crash as if it were the sanctioned design; the viewer's vite configs still claim "adapter-static, never fetch()"; and cited ADRs (0002, 0004, 0006) do not exist anywhere in the repo. In a comment-heavy, instruction-driven codebase, stale load-bearing comments are not cosmetic — they are latent regression generators.

**3. Every composition root is a god file, and the refactors stalled halfway.** `build-runner.ts` (1,119 lines, ~10 responsibilities, four test files split along the seams the module refuses to), `main.ts` (2,010 lines with a ~300-line handler containing a 140-line recovery IIFE that reaches into the auto-sync orchestrator's private state), `+page.svelte` (3,829 lines, 102 runes, 85 functions), and `contract.ts` (926 lines, half tombstones). The extraction work that *did* happen is disciplined — but it left behind mirrors kept "SOLELY so reads stay byte-identical", no-op exported methods still called from 10 sites, and tombstone comments totalling hundreds of lines.

**4. Duplication in the CLI is systemic, and one copy has already rotted into a shipped bug.** Four parallel spawn-and-capture implementations, three copies of the install-hint text, two MIME tables and static file servers, two `renderBook` functions, two git implementations (one violating §7), and two version-reading mechanisms (one broken in the compiled binary). The proof of the cost: `exec.ts` hardcodes `:` as the PATH separator while `tool-probe.ts`'s copy of the same logic correctly uses `delimiter` — so on Windows the preflight probe reports Ghostscript available while the actual spawn can fail with ENOENT.

**5. The project fails its own primary user at the failure boundaries.** The stated goal is non-technical writers producing print-ready PDFs, but: the plugin computes 8 classes of author layout warnings and every real render path throws them away; a manifest without `styles:` silently links a phantom `css/print.css` while the resolver's careful fallback chain is dead code; a Paged.js timeout in the viewer silently writes a *truncated* PDF and reports success; a wedged pagination stalls silently for 60 minutes; and a Ghostscript failure makes the ink-coverage check silently pass. Each is individually small; together they define the product's worst-case experience for exactly its target audience.

**6. CI gates are weaker than they look.** The viewer's ~70-file test suite and its eslint run in no PR workflow — a viewer regression is first discovered when someone cuts a release. The published CLI package's typecheck runs with `continue-on-error: true`. The security-audit job cannot fail and discards its output. The renderer-purity gate's own self-test is never executed.

**7. Resource lifecycle and durability are held together by the happy path.** The pooled Chromium is closed only on the success path; the plugin loader cache-busts every path-plugin import with `Date.now()`, leaking module instances in long-lived hosts; prefs/settings/credential stores are written non-atomically and silently reset to empty on corruption — in an app whose pitch is protecting writers' state.

**8. Release machinery is well-engineered but has destructive edges.** The release workflow silently deletes and re-points published tags and releases; npm can publish a version whose GitHub release never materializes; and the Docker runtime stage resolves caret ranges fresh from the registry on every build, so shipped images can diverge from every tested lockfile.

---

## Findings

### Critical

#### 1. No `will-navigate` guard + permissive window-open handler lets remote web content reach the full preload IPC bridge — **[Confirmed]**

`severity: critical` · `effort: small` · `category: security` · panel: electron-host

Files: `packages/viewer/electron/main.ts:702`, `packages/viewer/electron/main.ts:759`, `packages/viewer/electron/preload.ts:138`, `packages/viewer/src/lib/components/PreviewFrame.svelte:37`

**What's wrong.** The main window has no `will-navigate` handler (grep across `electron/` and `src/` finds zero hits, likewise `setPermissionRequestHandler`), and `setWindowOpenHandler` (main.ts:702-720) returns `{ action: "allow" }` with a full BrowserWindow for *every* `/^https?:/i` URL — and the popup inherits the parent's preload (`overrideBrowserWindowOptions` sets `sandbox: true` but never clears `preload`). No `ipcMain.handle` in main.ts checks `event.senderFrame.url`. If the top frame navigates to a remote origin, the preload keeps running there, and the remote page gets `window.electron` — including `build()` (writes a PDF to any absolute `out` path), `cloneRemoteRepository` (writes attacker-controlled repo content to any `parentDir`), `startPreview`, and `watchFolder`.

**Evidence (verified exploit chain).** `PreviewFrame.svelte:37` embeds the preview as a plain `<iframe src={url}>` with **no `sandbox` attribute**, and its own comment documents it is cross-origin (`http://127.0.0.1` inside `app://local`). `renderer.ts:140` renders author markdown with `html: true`, so a raw `<a target="_top" href="https://evil.example">` in a shared project passes straight into the preview. A non-sandboxed cross-origin iframe is permitted to navigate the top frame on a user click; the preload persists across that navigation, so the remote origin receives the full bridge. One click on a crafted link in an opened project is the entire attack. No mitigation (CSP, sanitizer, sandbox attribute, sender check) exists on any cited path.

**Recommended fix.** Add `mainWindow.webContents.on("will-navigate", ...)` denying everything except `app://local` and the dev URL (route http(s) to `shell.openExternal`). Validate `event.senderFrame.url` starts with `app://local` in every `ipcMain.handle`. For auth popups, set `webPreferences.preload: undefined` in `overrideBrowserWindowOptions` and restrict to the specific auth hosts. Add `sandbox` to the preview iframe.

---

### High

#### 2. Preset default styles (`["css/print.css"]`) defeat the style-resolver's documented fallback chain, producing exactly the phantom `<link>` the resolver promises never to emit — **[Confirmed]**

`severity: high` · `effort: small` · `category: leaky-abstraction` · panel: markdown

Files: `packages/cli/src/lib/manifest.ts:164`, `packages/cli/src/lib/presets.ts:6`, `packages/cli/src/lib/style-resolver.ts:117`, `packages/cli/src/lib/markdown/index.ts:46`, `packages/cli/src/lib/build-runner.ts:765`, `packages/cli/src/preview/file-watcher.ts:143`

**What's wrong.** Two competing "default stylesheet" mechanisms. `resolveActiveStyles` (style-resolver.ts:104-141) documents an honest fallback chain — manifest `styles:`, else `FALLBACK_PRIORITY` starting with `styles/book.css` (what `print-md new` scaffolds), else discovered CSS, else `[]` — "never a phantom link". But `resolveConfig` does `styles: c.styles ?? m.styles ?? preset.styles` (manifest.ts:164), where `DTRPG_PRESET.styles` is `["css/print.css"]` (presets.ts:6) and every project defaults to the dtrpg preset (manifest.ts:115). Both primary render paths (build-runner.ts:688→765; preview lifecycle.ts:139-141 → file-watcher.ts:143) pass the resolved value into `renderChapters`, whose `resolveActiveStyles` returns any non-empty configured list verbatim with no `existsSync` check (style-resolver.ts:126-127). The fallback chain is dead code on the two paths that matter.

**Evidence.** Verification traced the full chain and found it *worse* than claimed: `assemble.ts:103` emits the `<link>` unconditionally, and the editor path `listProjectStyles` (style-resolver.ts:149-157) reads the *raw* manifest styles — so for a `styles:`-less project the CSS editor edits `styles/book.css` while the preview links `css/print.css`: the exact "editing the design doesn't change the preview" bug the resolver module's header says it exists to prevent. Scaffolded projects are unaffected (all scaffold paths write `styles:`), but hand-written manifests and plain adopted folders are supported flows (`loadManifestWithPath` explicitly handles no-manifest; `style-resolver.test.ts:117-184` tests a fallback that build/preview can never reach). The failure mode is a silently unstyled book for a non-technical author.

**Recommended fix.** Remove the styles default from the preset (or have `resolveConfig` leave `styles` undefined when neither CLI nor manifest sets it) so `resolveActiveStyles` is the single source of default-stylesheet truth it claims to be. Add an integration test: manifest with no `styles:` plus `styles/book.css` on disk must link `book.css` in a real build.

---

### Medium — confirmed

#### 3. `exec.ts` hardcodes `:` as the PATH separator — corrupts PATH on Windows, contradicting `tool-probe.ts`'s correct copy of the same logic — **[Confirmed]**

`severity: medium` · `effort: small` · `category: correctness` · panel: cli-core

Files: `packages/cli/src/lib/exec.ts:7`, `packages/cli/src/lib/tool-probe.ts:29`

exec.ts:6-7 builds ``PATH: `${localBin}:${process.env.PATH ?? ""}` `` with a literal colon; tool-probe.ts:29-30 does the identical localBin prepend correctly with `delimiter` from `node:path` — and tool-probe.ts:18 even says "One implementation; one place to fix bugs". The corrupted env reaches every gs/qpdf spawn: `ghostscript.ts` (run), `pdf-parse.ts:54`, `checks/pdf/pdfx-metadata.ts:21`, `checks/pdf/pdfx-markers.ts:20`, `checks/asset/image-tac.ts:27`. The preflight/pipeline inconsistency is real: build-runner.ts:154,161 gates on `isToolAvailable` (correct delimiter) while the actual spawns use exec.ts (broken). On Windows — a shipped, smoke-tested release target (`release.yml` `bun-windows-x64` + `verify-windows`) — the first PATH entry gets fused with localBin, so a user whose Ghostscript resolves solely via the first PATH directory sees "probe says available, spawn says ENOENT" — the exact confusing failure the preflight exists to prevent.

**Fix.** Use `delimiter` from `node:path` in exec.ts and extract the shared localBin/enhanced-PATH constant into one module.

#### 4. Layout warnings are computed by markdown-it-paged and then discarded by every real render path — authors never see them — **[Confirmed]**

`severity: medium` · `effort: small` · `category: missing-feedback` · panel: markdown

Files: `packages/cli/src/lib/markdown/markdown-it-paged.js:168`, `packages/cli/src/lib/markdown/assemble.ts:79`

`warn()` (markdown-it-paged.js:168-171) pushes typed, line-numbered warnings onto `env.layoutWarnings` from 8 call sites covering the author-mistake classes (`ambiguous_marker_token`, `section_without_page`, `nested_spread`, `continue_without_section`, `spread_without_pages`, `spread_eof_close`, `page_outside_spread`, `implicit_page`), with dedup logic for silent parser probes. Repo-wide grep for `layoutWarnings` matches exactly two files: the plugin and its test. `assemble.ts:79` calls `md.render(content)` with **no env**, so every warning lands in markdown-it's throwaway internal env; neither `renderChapters` nor the preview/build paths thread one through, and no lint surface covers markdown markers (`lint-runner.ts` is CSS-only). An author whose `@continue` is silently ignored gets zero feedback anywhere — for a product whose primary goal is non-technical writers.

**Fix.** Pass a per-chapter env into `md.render(content, env)`, collect `env.layoutWarnings` keyed by chapter, surface them in the build log, the preview `warn()`, and eventually the viewer's problems panel. This activates ~150 lines of already-written, already-tested diagnostic code.

#### 5. Plugin loader cache-busts every path-plugin import with `Date.now()`, reloading plugins on every preview render and leaking module instances in long-lived hosts — **[Confirmed]**

`severity: medium` · `effort: small` · `category: efficiency` · panel: markdown

Files: `packages/cli/src/lib/markdown/plugins.ts:157`, `packages/cli/src/preview/file-watcher.ts:137`

plugins.ts:160 unconditionally appends `?v=${Date.now()}` to every file-based plugin import; there is no mode flag, so the same path serves the one-shot build (build-runner.ts:756) and the preview. The preview reloads plugins on every render with no caching layer — `renderBook` (file-watcher.ts:137) is called both on each watcher rebuild (file-watcher.ts:416) and per `/__chapter` HTTP request (http-server.ts:419) — so one edit typically triggers at least two fresh ESM imports per plugin. ESM module-map entries with unique URLs are never evicted, and the preview server is embedded in the long-lived Electron host, so growth is unbounded (save-proportional, small per unit — a slow leak, not a fast one). The cache-bust exists to fix a real stale-plugin bug, so it needs a smarter fix, not deletion.

**Fix.** Cache loaded plugins keyed by resolved path + mtime (or content hash); cache-bust only when the file changed; skip busting entirely in the fail-fast build mode.

#### 6. `main.ts` is a 2,010-line god file; `handlePreviewRequest` alone is ~300 lines with a 140-line embedded recovery IIFE — **[Confirmed]**

`severity: medium` · `effort: large` · `category: god-file` · panel: electron-host

Files: `packages/viewer/electron/main.ts:1447`, `packages/viewer/electron/main.ts:1597`, `packages/viewer/electron/main.ts:1`

Despite the Phase-5b extractions (orchestrator, scheduler, watcher, export controller, stores), main.ts is 2,010 lines (next largest electron file: 587) mixing splash lifecycle, window creation, CSP header sniffing for URL previews (587-635), 19 `ipcMain.handle` channels, GitHub device-flow state (1148-1210), the preview-open pipeline, preflight repo recovery, updater wiring, network polling (setInterval at 1969), and quit choreography. `handlePreviewRequest` (1447-1746) does preview start + manifest title + recents upsert + heartbeat + a fire-and-forget local-status IIFE with a delayed re-emit hack (1546-1583) + a ~138-line preflight-recovery IIFE (1597-1734). Verification found the concurrency concern *worse* than claimed: the preflight IIFE mutates the orchestrator's private single-flight state (`syncState.inFlight` in 5 places) from outside the orchestrator, and the code's own comments cite a prior defect ("BUG 3") caused by exactly this inline lock juggling. 19+ "migrated to server routes" tombstone comment blocks sit between lines 904-1427.

**Fix.** Extract the preview-open pipeline into a `PreviewOpenController` class like `ExportController`; move the GitHub device-flow trio into a small module; delete the ~200 lines of tombstone comments (git history records the migration). Pair with finding 7.

#### 7. Auto-sync abstraction is leaky: main.ts preflight and ExportController mutate `AutoSyncState` internals the orchestrator claims to own — **[Confirmed]**

`severity: medium` · `effort: medium` · `category: leaky-abstraction` · panel: electron-host

Files: `packages/viewer/electron/main.ts:1604`, `packages/viewer/electron/main.ts:1709`, `packages/viewer/electron/main.ts:1354`, `packages/viewer/electron/export/controller.ts:173`, `packages/viewer/electron/auto-sync/orchestrator.ts:164`

main.ts:448-453 claims the orchestrator "owns ALL auto-sync state + timers + the single-flight / runAgain / conflict-latch control logic". In reality the preflight IIFE takes the lock itself (`syncState.inFlight = true`, main.ts:1604), releases it at **four** sites (1613, 1624, 1656, 1729), and hand-writes `conflictLatched`/`runAgain` (1688, 1709-1710, 1722); `remote:resolveSyncConflicts` clears the latch at main.ts:1354; `ExportController` latches at controller.ts:172-174 through a deliberately mutable `ExportSyncGate` slice. The orchestrator exposes no acquire/release/latch API — the mutable bag from `getOrCreateState` is the only mutation surface — and `decideRunAgainAfterPreflight` (orchestrator.ts:318) exists solely for main.ts's preflight. The `mapRecoveryResultToEmit` follow-up branching is near-duplicated (main.ts:1681-1725 vs orchestrator.ts:472-515). Everything is currently correct and commented, but the invariants the class was extracted to protect are enforced by convention across three files.

**Fix.** Add explicit orchestrator methods — `acquire(dir)/release(dir)`, `latch(dir)/unlatch(dir)`, and a `runPreflight(dir, source)` owning the whole flow — and make `AutoSyncState` private. The export gate should call `orchestrator.latchConflict(dir, files)` instead of reaching in.

#### 8. CLAUDE.md §8's "narrow IPC bridge" has drifted: 19 invoke channels, ~5-6 plain request/response, and folder-watch exposed via BOTH IPC and a dead server route — **[Confirmed]**

`severity: medium` · `effort: medium` · `category: rule-violation` · panel: electron-host (merged with api-routes "dead api-client wrappers", low/unverified)

Files: `packages/viewer/electron/main.ts:928`, `packages/viewer/src/routes/api/fs/watch-folder/+server.ts:6`, `packages/viewer/electron/main.ts:1401`, `packages/viewer/electron/main.ts:1813`, `packages/viewer/electron/main.ts:1299`, `packages/viewer/src/lib/api.ts:193`

§8 says IPC carries "only the push-event streams … and the preview/build pipeline calls that need a live BrowserWindow". Verified count: 19 `ipcMain.handle` channels + 9 push channels. After §8's own carve-outs (preview/build, flush, recovery-confirm, updater-apply, watch lifecycle), ~5-6 channels are genuinely misplaced plain request/response: `sync:setAutoSync` (1401, a pure settings write), `updater:getStatus/check/download` (1813-1826), `remote:resolveSyncConflicts` (1299) and `remote:cloneRepository` (1233) — while their `remote:*` siblings were all migrated to routes (comment at 1294-1297), forcing the next maintainer to guess which side a new op belongs on. `fs:watchFolder` exists twice: the IPC path is the one actually used (preload.ts:177, electron-adapter.ts:87); the `/api/fs/watch-folder` route and its `api.fs.watchFolder`/`unwatchFolder` client wrappers have **zero callers**, and the route silently returns `{ok:true}` when hooks are unregistered instead of the 503 its ~30 siblings return. `api.app.flushDone` and `api.status()` are similarly dead wrappers.

**Fix.** Migrate the plain request/response channels to server routes; delete either the `fs:watchFolder` IPC pair or the watch-folder routes (plus the dead `flushDone`/`status` wrappers); update §8's wording to match reality.

#### 9. `build-runner.ts` is an 1,119-line god-module with ~10 distinct responsibilities — its four test files split exactly along the seams the module refuses to — **[Confirmed]**

`severity: medium` · `effort: medium` · `category: god-file` · panel: cli-core

Files: `packages/cli/src/lib/build-runner.ts:1`, plus `build-runner.test.ts`, `build-runner.orchestration.test.ts`, `build-runner.render.test.ts`, `build-runner.staging.test.ts`

One file owns: CLI arg splitting (`splitOutPath`, :87), tool preflight + install-hint copy (:115-175), gate computation (:177), an embedded static HTTP file server + MIME table (:201-272), puppeteer page driving (`paginateAndCapture`, :340), the default PDF renderer (:383), static-HTML pagination (:442), three HTML string-rewriting passes (:485-540), staging (:582), ICC resolution (:798), fingerprint finalization (:835), two `OutputStrategy` classes (:875, :953), and the orchestrator (:1085). Imports span ~20 modules. All cited symbols/line numbers verified. Mitigations noted by the verifier: the module has already been through a deliberate stages+strategies refactor with named stage functions and injection seams used by the viewer, and the four test files are characterization guards with different runtime requirements — so this is a maintainability finding, not a correctness one. It still directly conflicts with the repo's ALERT-level reduce-complexity mandate.

**Fix.** Split along the seams the tests already use: (1) render/pagination → `lib/pagination.ts`; (2) staging + HTML rewriting → `lib/build-staging.ts`; (3) preflight + gates → `lib/build-preflight.ts`; keep `build-runner.ts` as the ~250-line orchestrator + strategies. This also absorbs findings 17 (static-server duplication) and 15 (install hints).

#### 10. `+page.svelte` is a 3,829-line god-file: 2,265-line script with ~102 runes and 85 functions, plus a 776-line style block — **[Confirmed]**

`severity: medium` · `effort: large` · `category: god-file` · panel: viewer-frontend

Files: `packages/viewer/src/routes/+page.svelte:1`, `:2265`, `:3053`

The single route component owns essentially the whole application: startup/landing decisions, the folder-open pipeline with a hand-rolled epoch-based concurrency scheme (`folderOpenEpoch` at 1505, `superseded()` checks threaded through `startFolderPreview` 1523-1668, plus a second epoch consumer at 260-283), editor buffer lifecycle, crash recovery (~1023), problems panel, save-as-template dialog state (~718-750), mobile tabs, keyboard shortcuts, PDF/HTML export, split-pane drag glue, a 90-line startup-prefs continuation inline in `onMount` (~1199), virtual-keyboard inset handling (2215-2229) — plus a ~790-line template and 776 lines of scoped CSS. All figures reproduce exactly; ten controllers are already extracted yet the file remains ~4x the next-largest component (`EditorToolbar.svelte`, 940 lines). Decomposition is demonstrably in flight (Phase 4b/5 comments), so the risk is change-friction, not breakage.

**Fix.** Split by feature seam, moving state *out* with each extraction: an `OpenProjectController` owning the folder-open pipeline + epoch; a child editor-pane component owning buffer wiring/recovery/external-edit; a Toolbar component owning its template+styles; dialog-local state into the dialogs. (Note: the companion claim that the existing controller-thunk pattern *prevents* shrinking was refuted — see appendix — so continue the established rune-class-controller pattern rather than redesigning it.)

#### 11. CLAUDE.md §8's prescriptive recipe no longer describes the host-access architecture; contract.ts is half tombstones and WebAdapter carries ~200 lines of dead, unreachable implementations with false "works on web" claims — **[Confirmed]**

`severity: medium` · `effort: medium` · `category: docs-drift / dead-code` · panels: viewer-frontend + api-routes (merged: "Two parallel host-access seams" [confirmed medium], "WebAdapter orphaned implementations" [confirmed low], "WebAdapter dead settings/prefs implementations" [unverified medium], "CLAUDE.md WebAdapter 'stub' description" [unverified low])

Files: `packages/viewer/src/lib/api.ts:1`, `packages/viewer/src/lib/platform/contract.ts:726`, `packages/viewer/src/lib/platform/web-adapter.ts:1`, `:469-611`, `packages/viewer/src/lib/settings.svelte.ts:11`, `packages/viewer/src/lib/components/ProjectsListBody.svelte:85`, `CLAUDE.md`

**What's wrong.** The verifier established the route-first split itself is *intentional and documented* — §8's transport paragraph explicitly says the bulk of capabilities are `+server.ts` routes the SPA calls with `fetch("/api/…")`, and `api.ts`'s header documents the division. But §8's residual prose still asserts "exactly one seam", "All host work goes through the platform adapter", "the renderer only ever calls getPlatform().X(...)", and its 4-step "Adding a new host capability" recipe requires adding every capability to `HostServices` plus both adapters — a flow the codebase abandoned in Phases 2B–2F. 26 files import `$lib/api` (`+page.svelte` alone has 33 `api.*` call sites); `contract.ts:723-856` is almost entirely "migrated to server routes — removed from HostServices" tombstones; the same class mixes seams (`buffer-state.svelte.ts` uses `platform.readFile/statFile/writeFile` at 124/126/238 but `api.recovery.write/clear` at 205/241). Meanwhile WebAdapter retains genuinely unreachable implementations of removed methods — `getSettings`/`setSettings` via localStorage (web-adapter.ts:501-521, whose comment claims they are "genuinely implemented on web … so the settings store works even outside Electron" — now false), IndexedDB prefs/recents/favorites (469-611), `reopenFolder` (314-353, removed from the contract at contract.ts:889) — because live callers go through `api.app.*` (settings.svelte.ts:45-46, ProjectsListBody.svelte:85). `settings.svelte.ts:11-13`'s claim that settings persist "to localStorage on web" is false. `web-adapter.ts:1-13` still calls itself a stub while carrying a 925-line partial PWA implementation. No runtime defect exists today (renderer purity is independently enforced by `tools/check-render-purity.mjs`, and web callers are `isDesktop()`-gated or fall back safely), but an AI session following §8's stale recipe will build new capabilities in the abandoned pattern.

**Fix.** Bless the route-first seam: rewrite §8's recipe to define which capability classes still belong on `Platform` (push streams, preview/build orchestration, FSA-divergent fs primitives) and that everything else is a server route + `api.ts` wrapper; prune the contract tombstones; delete the orphaned WebAdapter methods (or route the api client through `getPlatform()` on web if PWA #33 remains a goal — decide once); fix the false docstrings in `web-adapter.ts` and `settings.svelte.ts`.

#### 12. Viewer test suite (~70 test files) never runs in CI — only at release time — **[Confirmed]**

`severity: medium` · `effort: small` · `category: ci-gap` · panel: build-crosscutting

Files: `.github/workflows/ci.yml:38`, `.github/workflows/release.yml:69`, `packages/viewer/package.json:13`

ci.yml:38 runs `bun --filter @dimm-city/print-md test` (CLI only). The viewer has 67 test files under `packages/viewer/tests/{updater,platform,recovery,editor,media}` plus `pagedjs-interface.test.mjs` and `preview-bridge.test.mjs`; the only workflow that runs them is release.yml:69 (`bun --filter '*' test`), so a viewer regression merged on a PR is first discovered at release cut. The viewer's eslint `lint` script runs in no workflow at all. Mitigation: ci.yml does gate viewer PRs with `svelte-check`, a full build, and the purity check, and the release gate prevents regressions from actually shipping — the damage is late detection and bisection cost.

**Fix.** Add a viewer-test job to ci.yml: build the CLI dist (the documented prerequisite, per release.yml's own comment), then `bun --cwd packages/viewer test` and `run lint`. Reuse the release gate steps so the two stay identical.

#### 13. CLAUDE.md §1 mandates `Bun.serve` for the preview server — contradicting both the code and CLAUDE.md's own Node-compatibility requirement — **[Confirmed]**

`severity: medium` · `effort: small` · `category: docs-drift` · panel: build-crosscutting

Files: `CLAUDE.md`, `packages/cli/src/preview/http-server.ts:4`, `CONTRIBUTING.md:113`, `docs/ARCHITECTURE.md:111`

CLAUDE.md is self-contradictory: the layout section (line 45) requires the lib runtime to have "no Bun.serve/Bun.file/runtime Bun APIs" (so Electron's Node can run it), while §1 instructs "use **Bun.serve**" for exactly the preview-server use case. The code agrees with line 45: http-server.ts:4,11,15 uses `node:http` + `ws`, with a header explaining it replaced Bun.serve for Electron compatibility. CONTRIBUTING.md:100,113 ("Use Bun.serve for any server needs") and docs/ARCHITECTURE.md:111,295,305-333,596-611 repeat the dead story (ARCHITECTURE.md even contradicts itself at 624-627). Verified aggravator: no CI gate scans the lib for Bun APIs and tests run under Bun, so a reintroduced `Bun.serve` would pass CI and crash only in the packaged viewer at runtime. In a repo where AI sessions treat CLAUDE.md as overriding, §1 as written directs a future regression — the realistic vector being a *new* server module built per CONTRIBUTING.md's blanket instruction, where no in-file guard exists.

**Fix.** Rewrite §1's dev-server guidance to "`node:http` + `ws` (Node-compatible; see preview/http-server.ts)"; sweep CONTRIBUTING.md and docs/ARCHITECTURE.md; consider a drift-guard test that greps the docs for `Bun.serve` outside historical notes.

#### 14. CLI TypeScript typecheck is non-blocking in CI (`continue-on-error: true`) — **[Confirmed]**

`severity: medium` · `effort: small` · `category: ci-gap` · panel: build-crosscutting

Files: `.github/workflows/ci.yml:82`

ci.yml:80-82 runs the published package's `tsc --noEmit` with `continue-on-error: true`, while the viewer's `svelte-check` in the same job is blocking — the primary package is held to a lower standard than the app. CONTRIBUTING.md:148's claim that "The enforced gates are TypeScript and the test suite" is false for the CLI. Verification found the flag is *vestigial*: the typecheck currently exits 0 after `bun install`, so nothing motivates it and it can simply be deleted.

**Fix.** Delete `continue-on-error: true`. One-line change.

---

### Medium — unverified

*(Reviewer findings not adversarially checked. Treat file:line evidence as reviewer-reported.)*

#### 15. Install-hint copy exists in three diverging copies while diagnostics.ts claims it "stays in one place"

`effort: small` · `category: duplication` · panel: cli-core · Files: `packages/cli/src/lib/build-runner.ts:115`, `packages/cli/src/lib/diagnostics.ts:45`, `packages/cli/src/lib/chromium.ts:94`

The gs/qpdf/Chromium install instructions — the text a stuck non-technical author actually reads — are hand-copied three times: `INSTALL_HINTS` in build-runner.ts (:115-118), a second `INSTALL_HINTS` record in diagnostics.ts (:45-62, differently worded), and an inline copy in chromium.ts's `requireChromiumExecutable` throw (:94-106). diagnostics.ts's header (:4-8) explicitly claims the copy "stays in one place" — false. Any fix to an install command must be made three times or the CLI error, doctor output, and viewer Help dialog silently diverge. **Fix:** `lib/install-hints.ts` exporting the canonical per-tool strings; correct the header comment.

#### 16. Four parallel spawn-and-capture implementations; diagnostics' copy holds the event loop and never clears its kill timer

`effort: small` · `category: duplication` · panel: cli-core · Files: `packages/cli/src/lib/exec.ts:31`, `packages/cli/src/lib/build-fingerprint.ts:78`, `packages/cli/src/lib/diagnostics.ts:91`, `packages/cli/src/lib/tool-probe.ts:56`

The same "spawn, buffer stdout/stderr, resolve on exit" wrapper exists four times with different bug profiles: `exec.execCapture` (:31, **no timeout** — a hung gs blocks a build forever, including gs inkcov over arbitrary user PDFs via pdf-parse.ts:54), `build-fingerprint.runCapture` (:78, 4s timeout, correct settled-guard), `diagnostics.getVersion` (:91, 2s SIGKILL timer never cleared on normal exit and not unref'd — diagnostics.ts:105 vs the correct clearing in build-fingerprint.ts:94-99), and `tool-probe.findTool` (:56). Each new caller picks one at random; each bug gets fixed in one copy. **Fix:** one `execCapture` in exec.ts with optional `{ timeoutMs, cwd }` and a cleared/unref'd timer; delete the other three.

#### 17. Static file server + MIME table duplicated between build-runner and preview/http-server

`effort: small` · `category: duplication` · panel: cli-core · Files: `packages/cli/src/lib/build-runner.ts:201`, `packages/cli/src/preview/http-server.ts:134`

`STATIC_MIME` (build-runner.ts:201-218) and `MIME` (http-server.ts:134-151) list the identical 17 extensions in the identical order; both carry the same path-traversal guard (`candidate !== root && !startsWith(root + path.sep)` — build-runner.ts:246 vs http-server.ts:239) and their own serve functions. A new asset type must be added to both tables or renders differently in preview vs build-time pagination — a silent divergence class. **Fix:** extract `lib/static-serve.ts` (MIME map, `resolveStaticPath`, minimal `serveFile`); also shrinks the build-runner god-module (finding 9).

#### 18. diagnostics.ts reads package.json off disk at runtime — the exact pattern §3/build-fingerprint bans — and reports "unknown" in the compiled binary

`effort: small` · `category: rule-violation` · panel: cli-core · Files: `packages/cli/src/lib/diagnostics.ts:110`, `packages/cli/src/lib/build-fingerprint.ts:8`

build-fingerprint.ts:5-8 documents the rule (static JSON import so the compiled binary never reads package.json off disk inside `/$bunfs/`). `readLibVersion` (diagnostics.ts:110-143) does the banned thing: `fileURLToPath(import.meta.url)` + a 6-level directory walk reading package.json files at runtime, falling through to `"unknown"`. So `print-md doctor` / the viewer About dialog reports libVersion "unknown" in the flagship distribution format — to exactly the user filing a bug report — while `writeBuildFingerprint` in the same process knows the real version. **Fix:** delete `readLibVersion`; share the static import (e.g. `lib/version.ts` exporting `PACKAGE_META.version`).

#### 19. Pagination failure stalls silently for 60 minutes before warning

`effort: small` · `category: error-handling` · panel: cli-core · Files: `packages/cli/src/lib/build-runner.ts:307`, `:354`

`RENDER_TIMEOUT_MS = 60 * 60 * 1000` (:307) serves as both the large-book budget and the wait for `__PAGED_RENDERED__` (waitForFunction, :354-379). If Paged.js crashes before signaling (a plugin script error, CSS that wedges the chunker — realistic for author CSS), the build produces no output, no progress, and no message for a full hour, then a warn and a likely-blank PDF. No liveness signal distinguishes "still paginating a 400-page book" from "dead"; a non-technical writer will force-quit long before the hour elapses. See also finding 22, which creates inputs guaranteed to hit this stall. **Fix:** poll `.pagedjs_page` count every ~10s; fail fast with "pagination stalled at page X — check plugin/CSS errors" when the count stops advancing; log progress so long builds visibly advance.

#### 20. build-fingerprint shells out to the system git binary despite §7's Node-native-git rule

`effort: small` · `category: rule-violation` · panel: cli-core · Files: `packages/cli/src/lib/build-fingerprint.ts:159`, `:165`

CLAUDE.md §7: "Do NOT shell out to the system git binary." `getGitRevision` (:145-190) spawns `git rev-parse --show-toplevel`, `git rev-parse HEAD`, `git rev-parse --short HEAD`, and `git status --porcelain` on every build. It degrades to null when git is absent — but the repo already ships isomorphic-git (source-provider.ts consumes it per §7), so this is a second, rule-violating git implementation in the same package, and gitless machines silently lose provenance data the pure-JS path could provide. **Fix:** replace with isomorphic-git `findRoot`/`resolveRef`/`statusMatrix`, sharing the provider layer.

#### 21. validation-profile: 40-line hand-rolled deep clone that must track every schema change, plus dtrpg-branded defaults silently applied to ALL PDF validations

`effort: small` · `category: leaky-abstraction` · panel: cli-core · Files: `packages/cli/src/lib/validation-profile.ts:13`, `packages/cli/src/lib/validation-exec.ts:111`, `packages/cli/src/lib/validation-profile.ts:62`

`cloneConfig` (:13-51) manually spreads 14 nested fields of `ResolvedConfig`; any future field is silently shared by reference — a mutation-aliasing bug waiting for the next schema addition. Separately, `executeValidation` applies `applyDtrpgPdfDefaults` to **every** pdf validation unconditionally (validation-exec.ts:111-113), despite the name implying an opt-in profile, and that function (:62-73) is a near-duplicate of `enforceStrictPdfChecks` (:53-60) differing only in an undefined-check. **Fix:** `structuredClone(config)`; rename to `applyDefaultPdfStrictChecks` (or genuinely profile-gate it) and implement via `enforceStrictPdfChecks` with an overwrite flag.

#### 22. pagedjs.ts detects Paged.js with a bare `/pagedjs/i` substring test — the exact heuristic pagedjs-marker.ts documents as forbidden

`effort: small` · `category: rule-violation` · panel: cli-core · Files: `packages/cli/src/lib/pagedjs.ts:128`, `packages/cli/src/lib/pagedjs-marker.ts:42`

pagedjs-marker.ts:37-44 establishes the contract: match the stable `data-pagedjs-polyfill` marker or the polyfill filename, "deliberately never a bare pagedjs substring". `patchHtmlForPagedjs` violates it: `const hasPaged = /paged\.(polyfill|js)/i.test(html) || /pagedjs/i.test(html)` (pagedjs.ts:128). HTML whose body *text* mentions "pagedjs" (the project's own user guide documents Paged.js!) or that carries only the nav scripts sets `hasPaged=true`; if the marker regex then finds no slot (:143-152), the code injects only `BREAK_INSIDE_HANDLER` and never the polyfill — producing a document that never signals `__PAGED_RENDERED__` and hits the 60-minute stall (finding 19). `renderHtmlToPdf` is exported, so arbitrary caller HTML reaches this path. **Fix:** `hasPaged = pagedjsPolyfillTagRegex().test(html)` only; fall through to the injection branch when the slot is absent so the polyfill is always present.

#### 23. index.ts comment claims checkCss "runs in the renderer" — directly contradicting CLAUDE.md §8 and the actual viewer implementation, inviting the documented 0.4.0-beta.4 crash class

`effort: small` · `category: docs-drift` · panel: markdown · Files: `packages/cli/src/index.ts:42`, `packages/viewer/src/lib/editor/css-editor.ts:12`, `packages/viewer/src/routes/api/lint/check-css/+server.ts:23`

index.ts:41-44 — sitting directly above `export { checkCss }`, the first thing a contributor reads when deciding where to call it — says the viewer "runs `checkCss` in the renderer (postcss is pure JS)". §8 names a renderer value-import of `checkCss` as the exact mistake that shipped the 0.4.0-beta.4 `fileURLToPath is not a function` crash, and the viewer's real code agrees (css-editor.ts:12-13: the lint gutter calls `api.lint.checkCss(...)`, "NOT by importing the lib"). A contributor following this comment re-introduces a release-blocking regression the repo already shipped once. **Fix:** rewrite the comment: checkCss is host-side, reached via the `api/lint/check-css` route per §8.

#### 24. resolveConfig is a 130-line hand-rolled three-way merge with module-level mutable warn state and deprecated fields still threaded through

`effort: medium` · `category: god-function` · panel: markdown · Files: `packages/cli/src/lib/manifest.ts:111`, `:104`, `packages/cli/src/lib/presets.ts:54`, `packages/cli/src/lib/validation-profile.ts:37`

`resolveConfig` (manifest.ts:111-245) merges CLI > manifest > preset by hand-writing `c.x ?? m.x ?? preset.x` for ~40 leaf fields, three levels deep (`validate.heuristics.textDensityRange.min` at :238); every new manifest field must be added in three places or silently never resolves. Two module-level mutable booleans (:104-105) reproduce the module-closure-state pattern §6 banned from the renderer. Dead fields are still fully merged: `allowedCallouts` is deprecated-and-ignored per its own warning (:136-150) yet resolved at :215-217, kept in the preset (presets.ts:60), and copied into validation profiles (validation-profile.ts:37); the `stylelint` config key survives although the tool was dropped. **Fix:** a small typed deep-merge over (preset, manifest, cliOverrides) plus a deprecated-keys table; delete `allowedCallouts` from ResolvedConfig/preset/profile; move warn-once tracking out of module state.

#### 25. Manifest handling is fragmented across five modules with duplicated read paths and two write conventions — the DRY extraction (manifest-doc.ts) is bypassed by its own callers

`effort: medium` · `category: duplication` · panel: markdown · Files: `packages/cli/src/lib/manifest-config.ts:114`, `packages/cli/src/lib/theme-manager.ts:269`, `:502`, `packages/cli/src/lib/manifest-doc.ts:44`

manifest-doc.ts exists to unify manifest Document IO ("One implementation, three historical call sites"), yet: `readManifestFields` (manifest-config.ts:114-121) re-implements `loadManifestDoc` inline; theme-manager's `setActiveThemeStyle` (:282-283) and `removeProjectTheme` (:509) bypass `writeManifestDoc` and call `writeFile` directly; the `styles:` list has two independent mutators with different semantics (manifest-config replaces the whole list, :153-167; theme-manager regex-filters and appends, :275-280); and `unwrapScalar` (manifest-config.ts:40-48) / `styleHrefOf` (theme-manager.ts:232-238) are near-duplicate Scalar helpers. A future atomic-write/recovery-journaling change must be made in multiple places or silently diverge. **Fix:** route every read through `loadManifestDoc`, every write through `writeManifestDoc`; one styles-list owner module.

#### 26. markdown-it-paged.js is CJS in an otherwise ESM/TS package, forcing default-unwrap interop hacks across three files

`effort: small` · `category: inconsistent-patterns` · panel: markdown · Files: `packages/cli/src/lib/markdown/markdown-it-paged.js:674`, `packages/cli/src/lib/markdown/renderer.ts:145`, `packages/cli/src/lib/markdown/plugins.ts:74`

The repo owns this file outright (§6), yet it ships as CJS with a manual interop shim (`module.exports = plugin; module.exports.default = plugin;`, :674-677) — the exact shape renderer.ts must defensively unwrap (its :145-149 comment documents that Bun dev auto-unwraps `{default: fn}` but the standalone binary loader does not, so `md.use` "blows up with plugin.apply is not a function") and that plugins.ts handles as a "Double-wrapped (rare)" case (:91-100). The 677-line JSDoc'd body also forgoes tsc typechecking in a package that compiles everything else. **Fix:** convert to ESM (ideally .ts), keeping the same exports; keep `unwrapPlugin` for third-party npm plugins only.

#### 27. PDF export silently produces a truncated PDF when Paged.js rendering times out

`effort: small` · `category: error-handling` · panel: electron-host · Files: `packages/viewer/electron/pdf-export.ts:139`, `:167`

`electronPdfRenderer` polls for `window.__PAGED_RENDERED__` and breaks on `Date.now() > deadline` — then falls straight through to `printToPDF` and writes the file as if it succeeded (:139-173). Both loop exits are indistinguishable downstream; progress reports "finalizing" then "success". A large book on a slow machine gets a **partial** print-ready PDF with no warning — the project's primary user may send an incomplete book to a printer. **Fix:** track whether the loop exited via `status.done`; on deadline, throw a typed error ("Rendering did not finish after N minutes — the export was stopped to avoid an incomplete PDF").

#### 28. SvelteKit host-server boot failure is swallowed, stranding the author on a raw "503 SvelteKit server not started" page

`effort: small` · `category: error-handling` · panel: electron-host · Files: `packages/viewer/electron/main.ts:1906`, `packages/viewer/electron/sveltekit-host.ts:60`

If `startSvelteKitServer` throws (corrupt install, port exhaustion, missing handler.js), main.ts:1906-1913 only `console.error`s and continues; every `app://` request then returns the plain-text body "SvelteKit server not started" forever (sveltekit-host.ts:60-62), and later crashes yield raw "Proxy error" 502s. No retry, no `dialog.showErrorBox`, no in-window error page. **Fix:** show a plain-language error dialog on boot failure; make the 503/502 responses a small styled HTML page with retry guidance.

#### 29. AppSettings shape and DEFAULT_SETTINGS are hand-duplicated between the host store and the renderer contract

`effort: medium` · `category: duplication` · panel: electron-host · Files: `packages/viewer/electron/settings-store.ts:5`, `:72`, `packages/viewer/src/lib/platform/contract.ts`

settings-store.ts openly declares the hazard: "Shape mirrors AppSettings in src/lib/platform/contract.ts (kept in sync manually)" (:5) and "Keep in sync with the renderer's canonical DEFAULT_SETTINGS" (:72). Two hand-synced copies of a ~40-field structure with defaults on both sides; the paneMode comment shows a sync patch already happened once. §8 explicitly permits `import type` across the seam. **Fix:** move AppSettings + DEFAULT_SETTINGS to one shared module (bridge-types.ts already plays this role) and `import type` it.

#### 30. Preference state fragmented across overlapping stores with deprecated and dead schema fields

`effort: small` · `category: dead-code` · panel: electron-host · Files: `packages/viewer/electron/prefs-store.ts:36`, `packages/viewer/electron/project-state.ts:26`, `packages/viewer/electron/settings-store.ts:29`

viewer-prefs.json carries deprecated top-level `currentPage`/`viewMode` "kept ONE version as a migration fallback… Remove in a later release" (prefs-store.ts:32-41) — the release shipped, the fields remain. `ProjectState` declares four fields as "dead schema now" (#38/#42, project-state.ts:25-34); `sidebarOpen` also exists at ViewerPrefs top level; `viewMode` exists in **three** places (legacy prefs, ProjectState, AppSettings.preview). A corrupted read silently resets everything to `{}` (prefs-store.ts:102-104). **Fix:** complete the #43 migration; delete legacy fields and `migrateLegacyProjectState`; document which viewMode wins.

#### 31. Eleven stringly-keyed globalThis service locators form the host/route seam

`effort: medium` · `category: leaky-abstraction` · panel: electron-host · Files: `packages/viewer/electron/server-bridge/create-host-bridge.ts:13`, `packages/viewer/electron/main.ts:874`, `:1061`

The main-bundle ↔ SvelteKit-handler seam is 11 separate `__printMd*__` globalThis keys registered across 8 scattered call sites in main.ts. Every route null-checks "not registered" individually and inconsistently (read-file 503s; watch-folder silently succeeds). The prefs registration carries an ordering landmine ("Must be AFTER discoverScanDeps is initialized", :1059-1060) and a hand-narrowed `loadLib` cast (:1075-1080) erasing types at the seam. **Fix:** collapse to a single `__printMdHost__` object implementing one typed HostServices interface, registered once after all deps exist, with one shared 503 guard.

#### 32. Half-finished extraction: three module-level state mirrors maintained "SOLELY so reads stay byte-identical"

`effort: small` · `category: inconsistent-patterns` · panel: electron-host · Files: `packages/viewer/electron/main.ts:376`, `:399`, `:469`

main.ts keeps shadow copies of state owned by the extracted classes: `watchedDir` mirroring FolderWatcher (updated only via `onWatchedDirChanged`), `autoSnapshotPending` mirroring the scheduler's pending slot, `openRepoDir` "a mirror of watchedDir, kept in lock-step". Each mirror's comment admits it exists only to keep a refactor diff byte-identical; `FolderWatcher.getWatchedDir()` (watcher.ts:88) already exists and nothing uses it. Mirrored state = two writers, one convention. **Fix:** delete the mirrors; read the existing accessors directly.

#### 33. Main window runs with `sandbox: false` with no stated justification

`effort: small` · `category: security` · panel: electron-host · Files: `packages/viewer/electron/main.ts:653`

`createWindow` sets `sandbox: false` (main.ts:653) while every neighboring webPreferences flag gets a paragraph-length justification. The preload uses only `contextBridge` + `ipcRenderer`, which work fully sandboxed. Disabling the Chromium sandbox raises the blast radius of any renderer compromise — in a window that intentionally hosts third-party web content in URL-preview iframes, and in combination with finding 1. **Fix:** set `sandbox: true` (or delete the key — it is the Electron default since v20), verify the preload, and if something genuinely needs it off, document why inline.

#### 34. Store files written non-atomically; corrupt prefs silently reset to empty, losing recents/favorites/project state

`effort: small` · `category: error-handling` · panel: electron-host · Files: `packages/viewer/electron/prefs-store.ts:107`, `packages/viewer/electron/settings-store.ts:143`, `packages/viewer/electron/credential-store.ts:66`

`prefs-store.writeNow`, `settings-store.writeSettings`, and `credential-store.writeStore` all write JSON in place with a single `writeFile`; a crash mid-write truncates the file. On the next read, prefs-store's catch returns `{}` (:102-104), silently discarding recents, favorites, per-project state, and the last-project pointer; credential-store resets to empty (:60-63), silently disconnecting GitHub. The host's own state files have weaker durability than the documents the app exists to protect. **Fix:** write to `<file>.tmp` + rename (both stores already serialize writes); on parse failure, preserve `<file>.corrupt-<ts>` and log instead of starting fresh.

#### 35. 85+ near-identical route files with three different lib-loading mechanisms — boilerplate ceremony against the reduce-complexity mandate

`effort: medium` · `category: duplication` · panel: api-routes · Files: `packages/viewer/src/routes/api/theme/apply/+server.ts:1-21`, `packages/viewer/src/routes/api/snip/read/+server.ts:1-11`, `packages/viewer/src/routes/api/lint/check-css/+server.ts:19-24`, `packages/viewer/src/routes/api/remote/sync/+server.ts:12-33`

91 `+server.ts` files repeat the same 4-6 line skeleton, and the lib is obtained three incompatible ways: bare `await import('@dimm-city/print-md')` in the handler (23 routes — theme/plugin/snip/tpl), `getPrefsHooks().loadLib()` (doctor, lint, create-project, classify), and `getRemoteHooks().loadLib()` (remote/publish). The mechanisms are not functionally distinct — theme/apply direct-imports the same lib doctor loads via hooks — it is historical drift. **Fix:** one `loadLib()` accessor plus a declarative route factory (`defineRoute({ validate, call })`); deletes hundreds of lines.

#### 36. Inconsistent absolute-path validation: 8 projectDir routes skip the check others enforce

`effort: small` · `category: correctness` · panel: api-routes · Files: `packages/viewer/src/routes/api/snip/read/+server.ts:6`, `packages/viewer/src/routes/api/app/classify-project/+server.ts`, `packages/viewer/src/routes/api/tpl/save-as-template/+server.ts`, `packages/viewer/src/routes/api/_lib/handler.ts:47`

`_lib/handler.ts` provides `requireAbsolute()`, ~27 routes enforce absolute paths (some via the helper, some hand-rolling `isAbsolute` — itself an inconsistency), but 8 projectDir-accepting routes do no check at all: `snip/{read,save,delete,list}`, `app/classify-project`, `app/viewer-project-state/{get,set}`, `tpl/save-as-template`. A relative projectDir resolves against the host process cwd, silently operating on the wrong folder. **Fix:** route every path field through `requireAbsolute()`; delete the hand-rolled variants.

#### 37. fs routes enforce no project-scoping — arbitrary absolute-path read/write for any code that can fetch from the renderer

`effort: medium` · `category: security` · panel: api-routes · Files: `packages/viewer/src/routes/api/fs/read-file/+server.ts:6-11`, `packages/viewer/src/routes/api/fs/write-file/+server.ts:8-17`, `packages/viewer/electron/sveltekit-host.ts:42-56`

`/api/fs/read-file`, `write-file`, `list-dir`, `stat-file`, `copy-file` accept any absolute path; the only guard is `isAbsolute`. Any code that can issue a same-origin fetch inside the renderer (a preview XSS, a malicious plugin-injected script, a compromised dependency) can read or overwrite arbitrary files. Notably, write-file *already computes* a `path.resolve(watchedDir)` + `startsWith(root + sep)` containment test (:24-30) — but only to decide whether to snapshot, not to authorize. (Context: the related "unauthenticated localhost server" claim was refuted for the *external same-user attacker* threat model — see appendix — so the live threat here is renderer-context code, which finding 1 shows is reachable. Scoping the fs routes is defense-in-depth for that chain.) **Fix:** confine fs routes to the currently-open project root, reusing write-file's existing containment test.

#### 38. Three inconsistent error-envelope patterns across route groups

`effort: small` · `category: error-handling` · panel: api-routes · Files: `packages/viewer/src/routes/api/_lib/handler.ts:27-39`, `packages/viewer/src/routes/api/doctor/+server.ts:26-61`, `packages/viewer/src/routes/api/vcs/save-snapshot/+server.ts:22-50`, `packages/viewer/src/routes/api/media/thumbnail/+server.ts:24-77`

Errors are signalled three ways: the `jsonRoute` helper (thrown → `error(500, msg)`); doctor's bare `new Response(msg, {status:500})` with manual try/catch; and vcs/media hand-rolled `error(400,...)` + bespoke `friendlyVcsError`. The 9 routes not using `jsonRoute` each reimplement body-parsing and error mapping the helper already owns, making the client's error extraction (api.ts:18-21 reads `r.text()`) fragile against shape drift. **Fix:** extend `jsonRoute` (GET support + friendly-error classifier callback) and route everything through it.

#### 39. contract.ts is a 926-line god file mixing the whole host surface with settings defaults and ~30 DTOs

`effort: medium` · `category: god-file` · panel: api-routes · Files: `packages/viewer/src/lib/platform/contract.ts:1-927`

The "contract" carries lib type re-exports, the half-tombstoned HostServices interface, the ElectronBridge interface, ~30 locally-mirrored DTOs, the SyncState/RecoveryActionKey unions, and a *runtime value* export `DEFAULT_SETTINGS` (:591-623) amid pure type declarations. **Fix:** split into `contract.ts` (seam interfaces only), `dtos.ts`, and `settings-defaults.ts`; remove the tombstones as part of finding 11.

#### 40. api.ts re-inlines DTO shapes and unknown-typed returns at the host boundary — the exact drift the file warns about, forcing ad-hoc casts in consumers

`effort: small` · `category: duplication` · panels: api-routes + viewer-frontend (merged) · Files: `packages/viewer/src/lib/api.ts:204`, `:236-300`, `packages/viewer/src/lib/platform/contract.ts:138-141`, `packages/viewer/src/routes/+page.svelte:1169`, `:1203`

api.ts's header (:34-43) explains DTOs were centralized because a copy had drifted; yet `classifyProject` returns `{ source: unknown; capabilities: unknown; … }` (should be `ProjectClassification`, contract.ts:138 — the typed imports sit three lines up in the same file), `getViewerPrefs` → `Record<string, unknown>` (:204), `getViewerProjectState` → `Record<string, unknown> | null`, `createProject`/`adoptFolder`/`doctor` → `unknown`, and media/lint methods inline full object literals duplicating `MediaImageEntry`/`MediaImageDetails`/`PrintSafeWarning`/`ProblemEntry`. Consumers re-invent shapes with local casts (+page.svelte:1203-1207, :1169; ProjectSessionController), so drift is invisible to the compiler. **Fix:** use the existing contract types on these endpoints, delete the casts, extend `api.contract-dto.type-test.ts` to cover them.

#### 41. LeftPanel exports three empty no-op methods that +page.svelte and a controller still ceremonially call from 10 sites

`effort: small` · `category: dead-code` · panel: viewer-frontend · Files: `packages/viewer/src/lib/components/LeftPanel.svelte:90`, `:99`, `:119`, `packages/viewer/src/routes/+page.svelte:338`, `packages/viewer/src/lib/routes/project-session-controller.svelte.ts:99`

`notifyOpened()`, `notifyHistoryRefresh()`, and `resetHistoryState()` have empty bodies — the History tab they served was removed ("Kept as a no-op so ProjectSessionController… don't need to change", LeftPanel.svelte:95-98). +page.svelte still calls them from 10 places; `ProjectSessionController` declares `notifyHistoryRefresh` as a *required* injected dependency; comments still describe behavior that no longer exists ("Bump historyRefreshKey so the History tab reloads", +page.svelte:1613-1614). **Fix:** delete the exports, the 10 call sites, the dependency, and the stale comments.

#### 42. Three coexisting modal focus-trap implementations

`effort: medium` · `category: duplication` · panel: viewer-frontend · Files: `packages/viewer/src/lib/dialog.ts:1`, `packages/viewer/src/lib/components/EditorToolbar.svelte:95`, `packages/viewer/src/lib/components/GitHubDialog.svelte:316`, `packages/viewer/src/lib/components/AdvancedSetupDialog.svelte:275`

The shared `dialogBehavior` action was written to own the a11y contract "every dialog shell used to re-implement by hand" — but only 4 dialogs adopted it; six others still hand-wire `trapFocus` + Escape + focus-restore; and EditorToolbar's image dialog re-implements the entire trap from scratch, including its own copy of the FOCUSABLE selector string (EditorToolbar.svelte:97-99 duplicating dialog.ts:31-33). Every new dialog author must guess which of three patterns to copy. **Fix:** finish the migration; unexport `trapFocus`.

#### 43. Viewer build configs describe a defunct "adapter-static + IPC-only, never fetch()" architecture

`effort: small` · `category: docs-drift` · panel: build-crosscutting · Files: `packages/viewer/vite.config.ts:4`, `packages/viewer/electron.vite.config.ts:6`, `packages/viewer/package.json:8`, `docs/ARCHITECTURE.md:620`

vite.config.ts:4-7 states "adapter-static + IPC architecture: the renderer talks to Electron's main process via window.electron.*, never via fetch(). The SvelteKit build is pure client — no SSR, no server bundle". Every clause is now wrong: svelte.config.js uses adapter-node, ~85 routes are called with fetch, and there is a server bundle. electron.vite.config.ts:6-8 and the package description repeat it; docs/ARCHITECTURE.md:620 claims adapter-static. This misleads contributors at exactly the seam §8 declares non-negotiable. **Fix:** update the comments and description to the adapter-node reality (accurate wording already exists in svelte.config.js); check whether `@sveltejs/adapter-static` in devDependencies is a leftover.

#### 44. CHANGELOG.md is missing every release from 0.3.x through 0.7.1 except 0.5.x and 0.6.1

`effort: small` · `category: docs-drift` · panel: build-crosscutting · Files: `CHANGELOG.md:6`, `packages/cli/package.json:3`

The package is at 0.7.1; the changelog's headings are Unreleased, 0.6.1, 0.5.4, 0.5.2, 0.5.1, 0.5.0, 0.2.1, 0.2.0 — missing all of 0.3.x, 0.4.x (a released line CLAUDE.md itself discusses), 0.5.3, 0.6.0, 0.7.0, 0.7.1. release.yml never touches CHANGELOG.md (`gh release create --generate-notes`). A half-maintained changelog silently tells users 0.7.x contains nothing new. **Fix:** add a release step that fails if CHANGELOG.md lacks the dispatched version and backfill — or delete the file and point at GitHub Releases.

#### 45. security-audit CI job is theater: cannot fail and its output goes nowhere

`effort: small` · `category: ci-gap` · panel: build-crosscutting · Files: `.github/workflows/ci.yml:87`

The job runs `bun audit || true` under `continue-on-error: true` (double-neutered), writes `audit-results.json` that is never uploaded or parsed, and echoes "Review audit-results.json for details" on a runner about to be discarded. A permanently green check implying security auditing happens is worse than no job. **Fix:** fail on high/critical advisories (or at least upload the artifact), or delete the job in favor of a scheduled audit that opens an issue.

#### 46. Unused `pagedjs` runtime dependency ships in every npm install, the Docker image, and the packaged Electron app

`effort: small` · `category: dead-code` · panel: build-crosscutting · Files: `packages/cli/package.json:78`, `packages/cli/src/lib/embedded-assets.ts:40`, `packages/cli/src/assets/vendor/PAGEDJS-PATCHES.md:10`, `Dockerfile:75`

`pagedjs: ^0.4.3` sits in `dependencies` but no source file imports it — the runtime artifact is the patched vendored `paged.polyfill.js` (904K) embedded via `with { type: "file" }`; PAGEDJS-PATCHES.md confirms node_modules/pagedjs is only a diff base for manual re-vendoring. It is therefore installed by every npm consumer, the Docker runtime stage, and electron-builder's dep walker. **Fix:** move to devDependencies; verify artifacts shrink.

#### 47. Docker runtime dependencies are installed unpinned — the shipped image can diverge from every tested lockfile

`effort: medium` · `category: release-fragility` · panel: build-crosscutting · Files: `Dockerfile:73`

The runtime stage synthesizes a package.json from packages/cli's caret-ranged `dependencies` and runs `npm install --no-package-lock` (Dockerfile:73-76); bun.lock — the versions CI tested — plays no part. A bad patch release of any of ~20 runtime deps ships straight into ghcr.io images, including rebuilds of an old tag; two builds of the same git tag can differ. **Fix:** pin the runtime install (copy the resolved node_modules subset from the builder, or emit exact versions from bun.lock).

#### 48. Release workflow silently deletes and re-points published tags and releases; npm can publish with no matching GitHub release

`effort: medium` · `category: release-fragility` · panel: build-crosscutting · Files: `.github/workflows/release.yml:149`, `:506`, `:350`

(1) The version job deletes an existing `v<VERSION>` tag locally and on origin and re-pushes (:149-158); github-release deletes any existing release before recreating it (:506-509). Re-dispatching a shipped version silently replaces the artifacts behind a published tag — breaking checksum reproducibility, the electron-updater feed, and tag pinners — with no confirmation. (2) `publish-npm` needs only `[version, build-cli]` (:350); if a viewer build fails, npm has published, the tag exists, but there is no release page, binaries, or updater feed. The workflow's "no partial-artifact window" comment (:439) covers only the GitHub release itself. **Fix:** refuse to overwrite an existing tag for stable versions (allow only `-` prereleases); move npm publish behind the full artifact set.

#### 49. Core host-integration modules of the CLI have no direct tests

`effort: medium` · `category: test-coverage` · panel: build-crosscutting · Files: `packages/cli/src/lib/chromium.ts`, `packages/cli/src/lib/browser-pool.ts`, `packages/cli/src/preview/lifecycle.ts`, `packages/cli/src/lib/validation-exec.ts`, `packages/cli/src/lib/manifest.ts`, `packages/cli/src/lib/pagedjs.ts`

Overall coverage is strong, but a cluster on the critical build path has none: `chromium.ts` (107 lines — Chromium discovery, the thing most likely to fail on end-user machines), `browser-pool.ts` (87), `preview/lifecycle.ts` (232), `validation-exec.ts` (292 — only its summary formatting is tested), `manifest.ts` (245 — see findings 2 and 24), `pagedjs.ts` (156 — see finding 22). Commands `audit`/`build`/`lint`/`new`/`validate` also lack command-level tests. These are exactly the environment-dependent paths where a regression strands a non-technical author. **Fix:** prioritize chromium.ts (discovery matrix with fake fs/env) and pagedjs.ts (pure string work), then lifecycle.ts and validation-exec.ts with stubbed exec.

---

### Low

#### 50. Pooled headless Chromium leaks on failed builds in library hosts — **[Confirmed, downgraded]**

`effort: small` · `category: resource-lifecycle` · panel: cli-core · Files: `packages/cli/src/lib/build-runner.ts:1110`, `:847`, `packages/cli/src/lib/browser-pool.ts:77`

`runBuild` pre-warms Chromium (:1110) before the quality gates, but `closeBrowser()`'s only pipeline call site is inside `finalizeBuild` (:847) — the success-only tail; no try/finally wraps the body. Verification bounded the impact: the pool is an idempotent singleton (at most ONE retained Chromium, closed by the next successful build), and the shipping viewer's default export path injects the Electron renderer and never prewarms — so the common-path-leak claim did not hold. Residual exposure: the `PRINTMD_VIEWER_PUPPETEER` debug opt-out and future library consumers on the puppeteer path retain one idle headless Chromium after a failed build. **Fix:** wrap `runBuild` after the prewarm in `try/finally { if (!opts.keepBrowserAlive) await closeBrowser(); }` and delete the close from `finalizeBuild` — one structural close point instead of a success-path side effect.

#### 51. `getPerPageInkCoverage` swallows every Ghostscript failure into an empty array — **[Unverified]**

`effort: small` · `category: error-handling` · panel: cli-core · Files: `packages/cli/src/lib/pdf-parse.ts:70`

The entire gs inkcov invocation sits in `try { … } catch { return []; }` (:53-72) with no logging: a gs crash, a corrupt PDF, or the Windows PATH corruption (finding 3) all return the same `[]` as a legitimately-empty result, so the ink-coverage check passes a book that was never measured — a user-harming false negative for a print-targeted tool whose point is catching TAC violations before an expensive print run. **Fix:** return a discriminated result (`{ok:true, pages} | {ok:false, error}`) and emit a warning-severity check result ("ink coverage could not be measured").

#### 52. Preview HTTP server: cache-header comments contradict the code; `serveStatic`'s cacheControl parameter is dead — **[Unverified]**

`effort: small` · `category: docs-drift` · panel: cli-core · Files: `packages/cli/src/preview/http-server.ts:311`, `:386`, `:265`

The embedded-assets route is documented twice as cache-friendly ("long cache headers", :374-378; "lets Chrome's HTTP cache reuse the response", :307-312) but the call passes `'no-store'` (:386), so the 904 KB polyfill re-downloads on every load — defeating a design motivated by a real 1.5 GB cache/Defender incident (:258-263). `cacheControl` is only ever invoked with its own default. **Fix:** decide once — `public, max-age=31536000, immutable` for embedded assets, or delete the parameter and fix the comments.

#### 53. Two exported functions named `renderBook` with duplicated plugin-loading logic, and `any[]` plugin typing across the preview API — **[Unverified]**

`effort: small` · `category: duplication` · panel: cli-core · Files: `packages/cli/src/preview/file-watcher.ts:125`, `packages/cli/src/lib/build-runner.ts:743`, `packages/cli/src/preview/file-watcher.ts:127`

preview/file-watcher.ts exports `renderBook` (:125) while build-runner.ts has a private `renderBook` (:743); both do "load plugins → collectPluginCss → renderChapters" with duplicated preambles (file-watcher.ts:132-139 vs build-runner.ts:752-761), differing only in the deliberate onError mode. The preview types plugins as `any[]` in three exported signatures, and http-server.ts:422 casts `state.config` through an ad-hoc structural type despite `ServerState.config` already being `ResolvedConfig`. **Fix:** one `loadPluginsWithCss` helper; rename the preview function `renderPreviewBook`; use the real types.

#### 54. api-middleware.ts + routes.ts: a two-module dispatcher retained for a single hard-coded GET /api/status endpoint — **[Unverified]**

`effort: small` · `category: dead-code` · panel: cli-core · Files: `packages/cli/src/preview/api-middleware.ts:19`, `packages/cli/src/preview/routes.ts:32`, `packages/cli/src/preview/http-server.ts:357`

After the viewer extraction removed ~500 lines of handlers, what remains is a node-req→Web-Request→node-res round-trip (http-server.ts:357-372 + `pipeWebResponse` buffering the whole body), a 36-line dispatcher whose entire routing table is one if-statement, and a 38-line routes module — all to serve `{hasInput, currentPath}`. Un-collapsed scaffolding under the reduce-complexity mandate. **Fix:** inline the status endpoint as a 5-line node:http branch; delete both modules and `pipeWebResponse`.

#### 55. markdown-it-paged renderer: unescaped class interpolation, O(n²) col-split lookahead, and four redundant pass-through rules — **[Unverified]**

`effort: small` · `category: correctness` · panel: markdown · Files: `packages/cli/src/lib/markdown/markdown-it-paged.js:626`, `:617`, `:600`

(1) The col-split branch emits `` `<div class="${cls}">` `` (:626) with author-controlled classes and no attribute escaping — safe today only because `parseMarkerLine`'s tokenizer happens to consume quotes, an invariant nothing asserts (the file defines `escapeAttr` at :41 and uses it elsewhere). (2) The same branch scans the remaining token stream per section for a column break (:615-622) — O(n²) for section-heavy documents; the transform pass could precompute. (3) Four one-line renderer rules (:600-602, :607) duplicate markdown-it's default `renderToken` behavior — dead weight implying they do something. **Fix:** escape `cls` (and the attrGet fallbacks at :643/:651); precompute has-column-break on the open token; delete the redundant rules.

#### 56. Stale architecture comments in assemble.ts and chapter-id.ts attribute core behavior to the DC plugin and to moved code — **[Unverified]**

`effort: small` · `category: docs-drift` · panel: markdown · Files: `packages/cli/src/lib/markdown/assemble.ts:62`, `packages/cli/src/lib/markdown/chapter-id.ts:8`

assemble.ts:62-64 says "@chapter (DC plugin) owns chapter wrappers and IDs" — but @chapter is parsed, wrapped, and labeled by *core* markdown-it-paged (markdown-it-paged.js:464-468, `openChapter` :356-378), as CLAUDE.md itself states. chapter-id.ts:8-9 points at code that moved to assemble.ts:80-83. In a repo that leans on in-file architecture comments as documentation of record, these actively misdirect (a contributor would hunt in the dc-op-manual repo). **Fix:** correct both; sweep the other markdown/ headers for post-split drift.

#### 57. isFilePath doc/behavior mismatch: bare relative plugin paths (`plugins/foo.js`) are silently treated as npm package names — **[Unverified]**

`effort: small` · `category: error-handling` · panel: markdown · Files: `packages/cli/src/lib/manifest.ts:57`, `packages/cli/src/lib/markdown/plugins.ts:57`

The helper documents "File paths start with ./, ../, /, or contain path separators with extensions" but implements only the prefixes (+ Windows drive letters). An author writing `plugins:\n  - plugins/my-plugin.js` gets "Install it in your project: bun add plugins/my-plugin.js" — advice that can never work and never mentions the `./` fix (which the same error message demonstrates for a different failure mode). A dead-end error for the target audience. **Fix:** implement the documented heuristic (contains `/` and ends in .js/.mjs/.cjs → path), or detect the near-miss and suggest the `./` prefix.

#### 58. Splash fallback comment says 60s; the code sets 15s — **[Unverified]**

`effort: small` · `category: docs-drift` · panel: electron-host · Files: `packages/viewer/electron/main.ts:1920`, `:1924`

The comment argues for a "generous (60s)" timeout so slow machines aren't cut off mid-render; the code sets `setTimeout(showMainWindowAndCloseSplash, 15_000)`. Someone changed the value without the rationale — a future maintainer will draw the wrong conclusion about the exact scenario the comment argues about. **Fix:** reconcile comment and value; note why 15s is safe given `showInactive()`.

#### 59. Vestigial "config" editor-view state: an impossible template branch and two unused handlers — **[Unverified]**

`effort: small` · `category: dead-code` · panel: viewer-frontend · Files: `packages/viewer/src/routes/+page.svelte:668`, `:689`, `:713`, `:2735`

`editorView` is typed `"editor" | "config" | "activity"` but `"config"` is never assigned; the template still branches on it for an aria-label (:2735) — unreachable. `closeProjectConfig()` (:689-692) and `onThemeApplied()` (:713-715) are defined, doc-commented, and never referenced. **Fix:** shrink the union; delete the dead branch and handlers.

#### 60. Duplicated folder-open picker flows and hand-rolled basename splitting despite an imported helper — **[Unverified]**

`effort: small` · `category: duplication` · panel: viewer-frontend · Files: `packages/viewer/src/routes/+page.svelte:470`, `:1711`, `:96`, `:892`

`browseFromLanding` (:470-484) and `openFolder` (:1711-1733) are near-identical (same control flow, same "Electron bridge unavailable" literal — repeated 4 times in the file); `basenameOf` is imported (:46) and used elsewhere while the same split logic is hand-rolled three times (:96-98, :892-894, :1153). **Fix:** one `pickAndOpenFolder()`; use `basenameOf`.

#### 61. settings store maintains a manual subscriber array alongside rune reactivity — two notification channels for one state object — **[Unverified]**

`effort: small` · `category: duplication` · panel: viewer-frontend · Files: `packages/viewer/src/lib/settings.svelte.ts:31`, `:98`, `packages/viewer/src/routes/+page.svelte:918`, `:927`

settings.svelte.ts is `$state`-backed but also keeps a hand-rolled subscribers array notified inside `set()` and `_loadSettings()`; +page.svelte subscribes imperatively in onMount with its own `lastBg` dirty-check (:927-936) — re-implementing what a `$derived`/`$effect` would do. A setter that forgets the manual notify loop silently breaks half the consumers. **Fix:** remove the subscribe channel; convert the two subscribers to `$effect` (or document the no-$effect rule in CLAUDE.md if it is a real rule — currently it exists only in scattered comments).

#### 62. Windows viewer build exists twice: composite action and release.yml duplicate (and already diverge) — **[Unverified]**

`effort: small` · `category: duplication` · panel: build-crosscutting · Files: `.github/actions/build-viewer-windows-zip/action.yml`, `.github/workflows/release.yml:270`

The composite action (used only by viewer-debug-build.yml) and release.yml:279-294 run the same three commands, but the composite pins setup-node@v4 node 20 while the release job takes whatever the runner ships — and the electron-builder/npm/Node interaction is exactly the fragile part per release.yml's own "never bun run" comment (:248-253). **Fix:** one packaging path (release.yml uses the composite, or a reusable workflow).

#### 63. The renderer-purity gate's own self-test is never executed in CI — **[Unverified]**

`effort: small` · `category: ci-gap` · panel: build-crosscutting · Files: `tools/check-render-purity.test.mjs`, `.github/workflows/ci.yml:64`

`tools/check-render-purity.mjs` is the single enforcement point for §8, and it ships a self-test that appears only in a ci.yml *comment* (:64). A refactor that breaks the gate's regexes (e.g. the generated `BARE_BUILTIN_REQUIRE` pattern) would make the gate pass vacuously — a condition CLAUDE.md treats as release-blocking. **Fix:** add `node tools/check-render-purity.test.mjs` as a step before the gate run (it is dependency-free by design).

#### 64. CLAUDE.md and build configs cite ADRs (0002, 0004, 0006) that do not exist anywhere in the repo — **[Unverified]**

`effort: small` · `category: docs-drift` · panel: build-crosscutting · Files: `CLAUDE.md`, `packages/viewer/electron.vite.config.ts:20`, `.github/workflows/release.yml:29`

CLAUDE.md §8 says "See ADR 0004 … kept under `.docs-archive/`"; the layout section cites ADR 0002; release.yml:29 cites "ADR 0006 D1"; electron.vite.config.ts:20 cites the "ADR 0006 release checklist". There is no `.docs-archive/` directory and no ADR file anywhere in the repo. The decision-record trail the binding instructions point at is unreachable. **Fix:** restore the ADRs under `docs/adr/` or rewrite the citations to the sections that now carry the rationale.

#### 65. docs/ mixes user documentation with one-off internal audit and review artifacts — **[Unverified]**

`effort: small` · `category: repo-hygiene` · panel: build-crosscutting · Files: `docs/code-quality-review-2026-07.md`, `docs/pr-73-critical-review.md`, `docs/git-recovery-audit-2026-07-02.md`, `docs/css-editing-audit.md`, `docs/startup-landing-ux-options.md`, `docs/pwa-webadapter-plan.md`

Dated, one-shot working artifacts sit alongside the maintained user/contributor docs (docker.md, publishing.md, ARCHITECTURE.md). They go stale immediately and clutter the docs surface for a non-technical audience. **Fix:** move point-in-time output to issues/PR comments or a labeled `docs/archive/` (this review is being filed under `docs/reviews/` — the same convention should absorb the strays).

---

## Recommended refactor roadmap

### Phase 0 — release-blocking security (do first, small)

1. **Finding 1:** `will-navigate` deny-list + `senderFrame` origin validation on all `ipcMain.handle` + `preload: undefined` for popups + `sandbox` attribute on the preview iframe. Fold in **finding 33** (`sandbox: true` on the main window) — same file, same review.

### Phase 1 — quick wins (each ≤ a day; high user impact per line changed)

2. **Finding 2:** kill the preset `styles` default; add the no-`styles:`-manifest integration test.
3. **Finding 3:** `delimiter` in exec.ts; extract the shared localBin constant.
4. **Finding 4:** thread `env` through `md.render` and surface layout warnings in build log + preview.
5. **Finding 27:** typed error on PDF-export timeout instead of a silent truncated file.
6. **Finding 22 + 19:** fix the pagedjs substring detection, then add pagination liveness polling — together they eliminate the 60-minute-silent-stall class.
7. **Finding 50:** try/finally around `runBuild`'s browser lifecycle.
8. **Finding 5:** mtime-keyed plugin cache; no busting in fail-fast mode.
9. **Findings 12, 14, 45, 63:** CI batch — viewer tests + lint job, delete `continue-on-error`, make security-audit real or delete it, run the purity self-test.
10. **Finding 34:** atomic tmp+rename writes and `.corrupt-<ts>` preservation in the three stores.
11. **Findings 51, 57, 28:** error-handling batch — discriminated ink-coverage result, plugin-path near-miss hint, host-boot failure dialog.

### Phase 2 — documentation reconciliation (small individually; do as one sweep because the repo is AI-session-driven)

12. **Finding 13:** rewrite CLAUDE.md §1's dev-server guidance; sweep CONTRIBUTING.md + ARCHITECTURE.md; add the `Bun.serve` docs drift-guard.
13. **Finding 11 (doc half):** rewrite §8's "Adding a new host capability" recipe to the route-first reality; define what still belongs on `Platform`.
14. **Findings 23, 43, 56, 58, 64, 15's header lie, 52:** fix every comment that contradicts the code it sits above; restore or re-point the ADR citations.
15. **Finding 44:** changelog gate in release.yml + backfill, or delete the file.

### Phase 3 — deduplication (small-medium; shrinks the surface before the structural work)

16. **Finding 16:** one `execCapture`.
17. **Findings 15, 17:** `lib/install-hints.ts`, `lib/static-serve.ts`.
18. **Findings 18, 20, 21:** shared version module; isomorphic-git for the fingerprint; `structuredClone` + rename in validation-profile.
19. **Findings 25, 53:** manifest IO through manifest-doc; one plugin-loading helper.
20. **Findings 29, 40:** shared AppSettings/DEFAULT_SETTINGS module; type the remaining api.ts endpoints.
21. **Findings 41, 59, 60, 61, 54, 46, 62, 42:** dead-code and duplication batch (no-op LeftPanel exports, vestigial editorView, picker flows, settings subscriber channel, status dispatcher, pagedjs dep to devDeps, Windows build path, focus traps).

### Phase 4 — structural refactors (medium-large; sequenced so each shrinks the next)

22. **Finding 9:** split build-runner along its test seams (absorbs 15/17's extractions).
23. **Findings 7 + 32 + 6:** give the orchestrator explicit acquire/latch/runPreflight APIs, delete the state mirrors, then extract `PreviewOpenController` and the device-flow module from main.ts — in that order, so the extraction moves calls to real APIs rather than relocating the reach-ins.
24. **Finding 8:** migrate the misplaced IPC channels to routes; delete the dead watch-folder route + wrappers; update §8's count.
25. **Findings 35, 38, 36, 31:** route factory + single `loadLib` + universal `requireAbsolute` + single `__printMdHost__` locator — one coordinated routes-layer pass.
26. **Finding 37:** project-root confinement on the fs routes (defense-in-depth behind Phase 0).
27. **Finding 10:** decompose +page.svelte by feature seam, continuing the rune-class-controller pattern.
28. **Findings 39, 11 (code half), 30:** split contract.ts; delete tombstones and orphaned WebAdapter methods; finish the prefs-store migration.
29. **Findings 24, 26:** typed deep-merge for resolveConfig; convert markdown-it-paged to ESM/TS.
30. **Findings 47, 48:** pin the Docker runtime install; make tag/release recycling refuse stable versions and gate npm publish on the full artifact set.
31. **Finding 49:** backfill tests for chromium.ts, pagedjs.ts, lifecycle.ts, validation-exec.ts — ideally landed alongside the refactors that touch them.

---

## Per-area assessment

| Area | Verdict (reviewer summary) | Findings reported |
|---|---|---|
| CLI build/PDF pipeline & process management (`packages/cli` lib/exec/validation/preview) | §1/§2/§3 respected on the happy path (puppeteer-core genuinely lazy-loaded; no bundlers at runtime), but build-runner.ts is an 1,119-line god-module, process management has real defects (Windows PATH corruption, success-only browser close, uncleared kill timers), and duplication is systemic — MIME tables, static servers, install hints, version reads, spawn wrappers each in 2–4 copies, with comments actively contradicting the code. | 15 |
| Markdown/rendering subsystem & purity contract | The core §6/§8 contracts are genuinely honored: per-render state on env, plugin owns its renderer rules, the render-purity gate is well-designed. The serious problems sit at the seams: author layout warnings computed then discarded everywhere, the preset default silently defeating the style-resolver's fallback chain, manifest handling fragmented across five modules, and load-bearing comments contradicting §8 and the code. | 10 |
| Viewer Electron host layer (`packages/viewer/electron/`) | Real, disciplined extraction effort (orchestrator/scheduler/watcher/controller with injected deps and unit tests), but main.ts remains a 2,010-line god file whose biggest handler bypasses the extracted abstractions, the mirrors show the refactor stopped halfway, and the security posture has a critical gap (no navigation guard → preload bridge reachable by remote content). §8's "narrow bridge" claim has drifted. | 13 (1 further claim refuted) |
| Viewer HTTP API routes & platform-adapter seam | The route-first migration is real and (per verification) intentional, but it left §8's recipe and contract.ts describing an abandoned flow, the WebAdapter full of orphaned implementations, 85+ boilerplate route files with three lib-loading mechanisms, and inconsistent path validation and error envelopes — a net complexity increase against the repo's mandate. | 8 (2 claims refuted) |
| Viewer SPA frontend (state, composition, purity) | The purity story is genuinely good — no direct `fetch('/api')` outside the typed client, no node:*/lib value imports, zero dead components. But +page.svelte is a 3,829-line composition root, the codebase quietly runs a second host seam that contradicts §8's prose, and vestigial layers from retired features (no-op exports, dead editorView state) survive as ceremony. | 10 (1 claim refuted) |
| Build pipeline, CI/release, testing, deps, hygiene | The build/release machinery itself is unusually well-engineered — split render build, two purity gates, drift guards, accurate workflow comments. The two systemic weaknesses are CI gating (viewer tests/lint and CLI typecheck never block PRs) and severe docs-vs-reality drift (Bun.serve, adapter-static, missing ADRs) — dangerous in a repo where AI sessions treat CLAUDE.md as binding. Plus a stale changelog, an unused shipped dep, unpinned Docker deps, and destructive tag recycling. | 14 |

---

## Appendix: claims investigated and rejected

Four reviewer claims were adversarially verified against the code and **did not hold up**. They are excluded from the findings above (residual low-severity fragments were folded into findings 11 and 37 where noted).

1. **"Unauthenticated localhost HTTP server exposes arbitrary file read/write and shell.openExternal" (electron-host, claimed high).** The mechanism is accurately described (127.0.0.1 listener, no token, no hooks.server.ts, unvalidated `openExternal`), but the threat model fails: a same-user local process already has full filesystem and process-launch privileges, so the server grants no escalation; browser drive-by is mitigated by the privileged `app://` scheme, the OS-assigned random port, CORS preflight on JSON POSTs, and SvelteKit's CSRF origin check on form content-types; and the credential claim was overstated — secrets are safeStorage-encrypted and routes return redacted responses. Residual: a narrow defense-in-depth hardening item (bearer token, `openExternal` allowlist) at low severity. The *renderer-context* attack surface on the same routes is retained as finding 37.

2. **"$lib/api.ts is a second, parallel host seam that bypasses the layers §8 mandates" (api-routes, claimed high).** The facts are accurate but the thesis misreads CLAUDE.md: §8's opening transport paragraph explicitly documents the two-path architecture ("the bulk … are ordinary +server.ts HTTP routes the SPA calls with fetch"), api.ts's own header documents the division of responsibility, and renderer purity — the property §8 actually enforces — is preserved and independently gated. What survives is doc drift inside §8's residual prose and dead WebAdapter code, captured as finding 11 at medium.

3. **"The fs surface is reached through two seams — web breaks inconsistently (buffer works via FSA, file tree 503s)" (api-routes, claimed high).** The claimed failure is impossible in current code: web cannot open a folder project at all (every entry point is `isDesktop()`-gated; WebAdapter.openFolder is dormant 0.6.0 scaffolding), the editor buffer is desktop-only by its own documented design, and on desktop both seams converge on the same transport (`ElectronAdapter.readFile` delegates to `api.fs.*`). What survives is a forward-looking note for the PWA milestone: direct `api.fs` call sites must migrate to `getPlatform()` when web folder-open ships — planned-work debt, not a shipping defect.

4. **"The controller pattern injects dozens of accessor thunks instead of sharing reactive state, keeping all real state trapped in +page.svelte" (viewer-frontend, claimed high).** The central claim is contradicted by the code: ZoomViewController, ProjectSessionController, and PageNavController *do* own their state as `$state` rune-class fields, controllers compose by direct sibling reference (exactly what the reviewer prescribed), and much of the injected surface is deliberate DI (fake-timer clocks, DOM measurement, persist sinks). The valid residue — ~6 render-phase fields still component-local with get/set thunks — is explicitly documented in the code as deferred incremental work. The god-file itself remains real (finding 10); the claimed structural cause does not.

---

*Report compiled by the Architecture Critical Review panel lead editor from six reviewer submissions and their adversarial verification notes. Confirmed findings should be treated as actionable as written; unverified findings warrant a quick spot-check of the cited lines before scheduling, but were reported with concrete file:line evidence by reviewers with full code access.*

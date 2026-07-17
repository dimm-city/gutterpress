# Changelog

All notable changes to print-md are documented here.
This project follows [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.8.1] - 2026-07-17

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.8.0...v0.8.1) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.8.1)

### Fixed

- Sync, clone, push, pull, and publish now time out on a stalled network
  connection instead of hanging forever (and no longer wedge later operations
  on the same project).
- Changing two settings in quick succession no longer risks silently reverting
  one of them, and a malformed settings write can no longer corrupt a section.
- Opening an external link now only accepts `http(s)` URLs.

### Changed

- Internal robustness, dead-code removal, and CI hardening from a code-quality
  audit — see `docs/reviews/code-quality-audit-2026-07-16.md`. No changes to
  author-facing behavior beyond the fixes above.

## [0.8.0] - 2026-07-15

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.7.1...v0.8.0) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.8.0)

### Added

- **Writer-focused editing.** Create, rename, copy, and delete files and
  folders from the project tree; author `@marker` syntax with editor
  completions; resize the editor/preview split; and use focus mode for
  distraction-free writing.
- **Guided publishing.** Publish from the toolbar through a wizard with saved
  credential selection and a preflight step that identifies blocking errors
  and warnings before publishing.
- **Theme package import.** Import themes from ZIP packages, folders, or CSS
  files; preview them before applying; and revert to the previously applied
  theme.
- **More visible project controls.** Added a toolbar Save action, a collapsible
  table of contents, version-history workspace restore, and centralized
  Connections settings.
- **Prerelease update opt-in.** Desktop users can enable release-candidate and
  other prerelease update notifications under Settings → App → Updates.
- Build and preview now surface author-facing layout warnings in their logs.

### Changed

- **Sync status overhaul.** One source of truth now drives sync state and
  guidance, removing misleading status and dead-end recovery paths.
- Replaced the settings dialog with a full-window, tabbed settings view.
- Removed the separate startup splash window; startup now stays within the
  main workspace.
- Decomposed and hardened the desktop host and CLI build, preview, and release
  paths.

### Fixed

- Protected the preload bridge from remotely loaded content, preventing
  untrusted pages from reaching desktop capabilities.
- Prevented editor data loss and corrected errors in saving, configuration,
  sync-conflict, export, publishing, theme import, and table-of-contents flows.
- Enforced theme ZIP size limits before decompression.
- `print-md validate --phase` now rejects unknown phase names instead of
  reporting a successful validation.

## [0.8.0-beta.2] - 2026-07-14

### Added

- **Editor layout controls.** The editor/preview split is now a resizable
  gutter with snap points and keyboard resize (#103), plus a distraction-free
  focus mode (#104).
- **Guided publish preflight.** The publish wizard gained a preflight step that
  surfaces blocking errors and warnings before you publish, with an author
  override (#105).
- **Theme package import.** Import a theme from a packaged ZIP, a folder, or a
  single CSS file, preview it live on hover over a canned sample spread, and
  revert to the previously applied theme at any time (#106).

### Testing / infra

- Added an **advisory** preview re-render latency gate
  (`tests/perf/rerender-latency-gate.mjs`) with the `bench/novel-50p` fixture
  (#107). Its `perf-baseline.json` median is a placeholder until captured with
  `npm run rerender-baseline`.

## [0.8.0-beta.1] - 2026-07-13

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.7.1...v0.8.0-beta.1) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.8.0-beta.1)

### Added

- **Writer-focused editing.** Create, rename, copy, and delete files and
  folders from the project tree; author `@marker` syntax with editor
  completions; and manage a project's look and styles through a clearer
  settings flow.
- **Publishing workflow.** Start publishing from the toolbar, complete a
  guided wizard, and select, switch, or add saved credentials for each
  provider. The CLI can now target a specific saved credential when connecting
  or disconnecting a provider with `print-md publish --account` (keep several
  accounts per provider); publish-time credential selection is driven by the
  manifest `publish.<id>.credential` or the stored default.
- **More visible project controls.** Added a toolbar Save action, a
  collapsible table of contents, version-history workspace restore, and
  centralized Connections settings.
- Build and preview now surface author-facing layout warnings in their logs.

### Changed

- **Sync status overhaul.** One source of truth now drives sync state and
  guidance, removing misleading status and dead-end recovery paths.
- The desktop host and CLI build/preview paths were decomposed and hardened,
  with stronger build, preview, and release verification.
- Removed the separate startup splash window; startup now stays within the
  main workspace.

### Fixed

- Protected the preload bridge from remotely loaded content, preventing
  untrusted pages from reaching desktop capabilities.
- Prevented editor data loss and corrected errors in saving, configuration,
  sync-conflict, export, publishing, and table-of-contents flows.
- `print-md validate --phase` now rejects unknown phase names instead of
  reporting a successful validation.

## [0.7.1] - 2026-07-07

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.7.0...v0.7.1) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.7.1)

### Added

- **Publish providers (#35).** Push a finished book to distribution platforms
  from the new `print-md publish` command (headless/CI-safe: `--dry-run`,
  `--json`, env-var credentials) and the desktop app's Project settings →
  Publish section. Five providers: **itch.io** (direct upload via butler,
  auto-downloaded on first publish), **Azure Static Web Apps** (deploys the
  HTML export via the SWA CLI), **Shopify** (creates/updates the product via
  the Admin GraphQL API), and guided flows for **DriveThruRPG** and **Amazon
  KDP** (no upload APIs exist — print-md validates, stages an upload package
  with a listing sheet, and opens the platform's upload page with a
  checklist). Non-secret settings live in the manifest's new `publish:`
  section; API keys are stored in the OS keychain (desktop) or the `0600`
  user-config credential store (CLI) — never in the project folder.

### Changed

- Code-quality remediation across five refactor phases: dedup, structured
  checks, and breaking up several "god files" into composition roots.
- Preview rendering and ZIP backup now use `fflate`.
- Layout scope management refactored to stack-based frame tracking.
- **Repo-root sessions.** A project is its whole repo: added a book switcher,
  removed dead restore-UI code, and hardened recovery.
- Added a welcome landing screen for the startup and empty states.

### Fixed

- `markdown-it-paged`: chapter labels now propagate to every page, col-split
  depth resets per render (was leaking across chapters), and ambiguous marker
  tokens now warn instead of silently misbehaving.
- `release`: version input is normalized before semver validation.

## [0.7.0] - 2026-07-02

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.6.2...v0.7.0) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.7.0)

### Changed

- **Git recovery overhaul.** Interrupted-operation repair, one shared
  classifier, uniform locking, a library preflight check, and a repair CLI
  command.
- Replaced the custom hot-swap web-UI updater with `electron-updater`.
- Release pipeline and auto-update hardening from a deep review pass.
- The release workflow now dispatches `docker.yml` explicitly — a
  `GITHUB_TOKEN`-authored release never triggers it on its own.

## [0.6.2] - 2026-07-01

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.6.1...v0.6.2) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.6.2)

### Fixed

- Recover from an interrupted rebase/cherry-pick, with a clearer
  guidance call-to-action on the fix screen.

## [0.6.1] - 2026-07-01

### Added

- **Windows installer.** Full releases now attach a Windows `.exe` installer in
  addition to the portable zip, so non-technical users can download one file and
  install print-md without manually extracting folders.

### Fixed

- **Safer sync with open editor files.** The editor now checks the live file on
  disk before saving, refuses to overwrite pulled/externally changed content, and
  surfaces the existing Reload / Keep mine choice instead. Background sync now
  tells the UI when pulled files changed locally, so open buffers and problem
  checks refresh even when the shallow folder watcher misses nested file updates.

## [0.6.0] - 2026-06-30

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.5.4...v0.6.0) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.6.0)

### Added

- **PWA scaffolding (#33).** A File System Access `WebAdapter`, a service
  worker, and offline support laid the groundwork for running the editor in a
  browser — desktop-only for now; full PWA support is tracked separately.
- **Mobile-friendly editor (#34).** A single-column, tab-switched layout
  (Markdown / CSS / Preview) usable down to phone widths.
- **Snippets, project templates, a Plugin Manager, and a Theme Manager**
  (#29, #30, #32).
- **CSS-file picker (#66).** Choose which stylesheet to edit, on any screen
  size.
- View the project's git/sync activity log from the status pill.

### Changed

- **Single standard package.** The library and CLI are now one
  `@dimm-city/print-md` package with no custom build step.
- `FolderRef`/`FileRef` replace raw path strings in the viewer's platform
  contract — groundwork the PWA work builds on (#49, #61).
- Migrated 44 IPC handlers to SvelteKit server routes.

### Fixed

- Sync/build-runner deduplication and a racy-index data-safety fix (#49, #50,
  #52).
- Issue #68 follow-ups: type consolidation, accessibility, UX polish, and
  removal of dead surface area.

## [0.5.4] - 2026-06-22

### Added

- **Definition lists.** print-md now parses the standard PHP-Markdown-Extra /
  Pandoc definition-list syntax — a `Term` line, then a `: definition` line —
  emitting plain `<dl><dt><dd>`. Implemented via the canonical `markdown-it-deflist`
  plugin in the core markdown pipeline (definition lists are not part of
  CommonMark/markdown-it core). Purely additive: content without the `: `
  definition-line syntax renders unchanged.

### Fixed

- **Recovery overlay crash.** The recovery overlay took a prop named `state`,
  which shadowed Svelte's `$state` rune and miscompiled state reads into store
  auto-subscriptions — crashing the overlay with `state.subscribe is not a
  function` in production builds. The prop is now `recoveryState`.

## [0.5.3] - 2026-06-19

[Full Changelog](https://github.com/dimm-city/print-md/compare/v0.5.2...v0.5.3) ·
[Release notes](https://github.com/dimm-city/print-md/releases/tag/v0.5.3)

Maintenance release. No pull requests were listed against this tag; see the
full diff above for the exact changes.

## [0.5.2] - 2026-06-16

### Added

- **Automatic recovery from sync problems.** If print-md ever finds your project
  in a confusing version-control state, it now quietly puts things right — saving
  a backup of your work **first** — and shows only a small "Tidying up your sync"
  message while it does. You're asked to decide **only** when a repair could be
  risky (with a plain-language confirmation that notes the backup), and if it
  can't safely continue it stops and shows simple next steps plus where the backup
  was saved. Your files are never deleted and the online copy is never forced.
- **Compare versions in a conflict.** When the same text file changed in two
  places, the "Changes happened in two places" screen now has a **Compare
  versions** view showing *your version* next to *the online version*, so you can
  choose with confidence. "Keep both" stays the recommended, lossless default.
- **A bottom status bar.** Sync status and a saving indicator ("Saving…" /
  "All changes saved") are now always visible at the bottom of the window, with a
  one-click refresh to **sync now** and a **Save now** action — so you can always
  see, and force, where your work stands.

### Changed

- The Edit toggle now sits to the left of the page-navigation buttons, which stay
  centered in the toolbar.
- Sync and save status moved out of the toolbar into the calm, always-readable
  bottom status bar; the sync indicator reads as plain status text rather than a
  button.

### Fixed

- A healthy, in-sync project opened from a **subfolder** could wrongly be treated
  as damaged and trigger a "repair" — which, in some setups, could exhaust memory
  and crash the app. Recovery now correctly recognises the project's repository
  and only runs for genuinely broken projects.
- Recovery backups are now **streamed to disk**, so backing up a large project no
  longer risks running out of memory.
- The **History** tab and the **Problems** list now refresh after saves, syncs,
  snapshots, and restores instead of going stale.
- The Help window now shows the web UI version without expanding the system
  details.

## [0.5.1] - 2026-06-15

### Added

- **Transparent background sync.** When a project is connected to an online
  repository, print-md now keeps it in sync automatically — pulling teammates'
  changes shortly after you open it and periodically while you work, and sending
  yours up — with no buttons to press. The only thing you see is a small status
  ("Saving changes…" / "Everything is in sync"). You're prompted **only** when
  the same file changed in two places, with plain-language choices: **Keep my
  version**, **Use the online version**, or **Keep both** (the safe, lossless
  default). Auto-sync defaults on for connected projects; a Settings toggle can
  pause it.

### Changed

- **A project is its git repo.** Opening a folder — the repo root or any
  subfolder — now syncs the whole repository (plain Git), removing the previous
  per-book scoping that made the two behave differently.
- The separate manual Sync dialog and the History-tab Pull/Push controls were
  removed in favour of the transparent flow above.
- Substantial internal simplification: the sync engine now decides direction
  with a single merge-base check, and ~2,700 lines of dead/over-engineered sync
  and preview code were removed (behaviour unchanged).

### Fixed

- Auto-sync now pulls promptly when you open a project (previously it could wait
  several minutes).
- The deep-history "phantom New changes online" badge is gone.
- The primary accent colour now meets WCAG AA contrast against white text.
- Windows cross-chapter follow-highlight in the preview.

## [0.5.0] - 2026-06-11

### Added

- **Remote Git, for non-technical writers.** Connect a project to GitHub with a
  one-time device-flow sign-in (OAuth App — every repo you can access is
  visible, no per-repo install). Clone a project, and a book that lives inside a
  larger repo uses that repo's history and sync (multi-book picker included).
- **Workspace UI.** A tabbed left-panel sidebar (Table of Contents, Files,
  Media, Projects, History), an editor toolbar with markdown actions + image
  insert, a Media panel to browse/import/inspect project images, and a Problems
  panel that surfaces lint results in the app.

### Changed

- Sync was rebuilt fetch-first with distinct Pull and Push; "check for updates"
  is now refs-only (no history walk), so it stays fast on large repositories.

### Fixed

- Numerous viewer UX and sync-robustness fixes (responsive toolbar, themed
  scrollbars, render-overlay scoping, full-speed initial render, and more).

> **0.3.x–0.4.x:** no release notes are available for this range, on GitHub or
> here. The [0.5.1 release notes](https://github.com/dimm-city/print-md/releases/tag/v0.5.1)
> record that the project's git and release history was reset at that release
> to remove private material that was never intended for public distribution
> — the corresponding tags and GitHub Releases no longer exist. `CLAUDE.md`'s
> discussion of "milestones 0.4.0 and 0.5.0" and the `0.4.0-beta.4`
> renderer-purity crash (see `docs/adr/0004-platform-abstraction.md`) are the
> only surviving record of what shipped in that range.

## [0.2.1] - 2026-06-04

### Added

- **Viewer: web-UI auto-update.** The desktop viewer now updates its SvelteKit
  UI bundle automatically from GitHub Releases (a separate `web-v*` release
  line, independent of the installer `v*` line). Updates are verified with an
  Ed25519-signed manifest and SHA-256 bundle integrity, downloaded and staged
  in the background, applied via an in-app **"Update ready / Apply now"** banner
  (or on next launch), and protected by a health-gate watchdog that rolls back
  a bundle that fails to boot. A manual **"Check for updates"** control is in
  the toolbar. The Electron shell and the library continue to update via a
  normal installer download.
- **Viewer: System info** now reports the Web UI bundle version alongside the
  Electron shell ("Viewer") version — they can differ after a web-UI update.

### Fixed

- **Viewer: System info** now resolves the library version (previously shown as
  `unknown`).
- **Viewer:** the "You're up to date" notification no longer appears twice on a
  manual check, and no longer fires at all on the silent background launch check
  (it only surfaces a banner when an update is actually staged).

## [0.2.0] - 2026-06-04

- Viewer workflow improvements: static-SPA (`adapter-static`) + `app://`
  architecture with IPC instead of HTTP routes, and PDF export via Electron's
  bundled Chromium. See the v0.2.0 release notes for details.

[0.2.1]: https://github.com/dimm-city/print-md/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/dimm-city/print-md/compare/v0.1.13...v0.2.0

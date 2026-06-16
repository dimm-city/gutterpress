# Changelog

All notable changes to print-md are documented here.
This project follows [Semantic Versioning](https://semver.org/).

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

> Entries for 0.3.x–0.4.x were not recorded here; see the
> [GitHub Releases](https://github.com/dimm-city/print-md/releases) for those.

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

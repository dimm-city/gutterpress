# ADR 0003 — Web UI auto-update: static-bundle swap, not whole-app

**Status:** Accepted (2026-06-04)
**Relates to:** ADR 0002 (prefer in-process libraries; viewer ships self-contained)

## Context

The print-md viewer is an Electron desktop app. Non-technical authors need to
receive UI fixes and improvements without having to locate a download page,
re-download a 100 MB installer, and re-run it. At the same time, the viewer's
rendering pipeline depends on a specific `@dimm-city/print-md-lib` version and
the Electron/Node runtime, so a reckless whole-app replacement risks breaking
the installed tool.

The SvelteKit SPA (`build/`) is a **pure static bundle** — HTML, JS, and CSS
with no native code. It is fully separable from the Electron shell that hosts it.

## Decision

Auto-update only the SvelteKit SPA bundle. The Electron shell, Node runtime, and
`@dimm-city/print-md-lib` are not auto-updated; they are delivered only through
the full platform installer (`v*` release tag line). The SPA update channel uses
a separate `web-v*` tag line.

Update application is a **pointer swap + `BrowserWindow` reload**: promote a
staged bundle directory to `current`, call `refreshWebRoot()` (updates the
`app://` protocol handler's root), reload the window. No process restart required
because the shell and lib are not being replaced.

## Rationale

### Why not `electron-updater` (whole-app update)?

`electron-updater` replaces the entire app bundle — Electron binary, asar,
native modules. On macOS this requires a valid Developer ID code-signing
certificate and notarization; on Windows it requires a certificate or users see
a Defender SmartScreen warning. Neither certificate is available without paid
Apple/Microsoft enrollment, and unsigned macOS builds silently silently fail to
auto-update via `electron-updater`'s macOS squirrel mechanism even when the
download succeeds.

The SPA-only swap sidesteps Gatekeeper and SmartScreen entirely: the Electron
binary is not being replaced, so the OS security gate does not re-evaluate it.

### Why not `adapter-node` instead of `adapter-static`?

`adapter-node` would require a running Node HTTP server inside the Electron main
process and would mean distributing executable server-side JS that the auto-updater
swaps in. Replacing executable server code over the network raises the same
security bar as a full-app replacement, except without any of the OS signing
infrastructure that makes whole-app updates trustworthy. The SvelteKit SPA is
pure client HTML/JS; it runs in the renderer process, which is already sandboxed.
Staying on `adapter-static` was also the right call for ADR 0002's elimination of
the in-process HTTP server.

### Why Ed25519 self-signing instead of OS code-signing?

- **Cost and enrollment.** An Apple Developer ID certificate requires a $99/year
  enrollment. A Windows EV certificate requires expensive hardware tokens and
  identity verification. Neither is appropriate for the current project stage.
- **Scope.** OS code-signing is designed to vouch for executables. The update
  payload is a static web bundle, not a native binary. Ed25519 over the manifest
  provides the same tamper-evidence property (a modified manifest or a
  man-in-the-middle bundle swap fails signature verification) without requiring
  platform vendor involvement.
- **Fail-closed verification.** The shell verifies the manifest signature before
  downloading the zip, verifies SHA-256 + exact byte size before extracting, and
  rejects on any failure. The private key never leaves the CI environment (stored
  as a GitHub Actions secret).

### Why reload-not-restart for apply?

The SPA is served from `activeWebRoot`, which is a mutable path pointer in the
`app://` protocol handler. After `refreshWebRoot()` updates the pointer,
`webContents.reload()` causes the renderer to re-fetch `app://local/` from the
new root. The Electron binary, the lib, and all main-process state persist across
the reload unchanged. A full `app.relaunch()` / `app.quit()` would be required
only if the main process itself were being updated, which it is not.

### Lib and shell stay on the manual installer path

The lib ships as a `node_modules` package inside the asar and is loaded with a
plain dynamic `import("@dimm-city/print-md-lib")` (see ADR 0002). A newer SPA
bundle compiled against a different lib version would fail at runtime if the lib
were not also updated. The `DESKTOP_API` integer in `contract.ts` is the
coordination mechanism: when the SPA starts calling a new `ipcMain.handle()` that
does not exist in the current shell, `requiresDesktopApi` in the manifest is
bumped above `DESKTOP_API` in the shell, the shell refuses the update, and the
user is told to update the installer first. This separates UI-only improvements
(the common case) from changes that require a coordinated shell update.

### Version-line rule for web-v* releases

The updater offers a release only when its version is **strictly newer** than
the effective current version — `max(baked baseline, promoted pointer)` — where
the baked baseline is the app package version, which is often rc-suffixed
during a release cycle (e.g. `0.5.0-rc.13`).

Two constraints follow:

1. **A web-v release must sort above the baselines of every shipped shell that
   should receive it.** The rule: use the **next patch/minor above the newest
   shipped shell version** (newest shell `v0.5.0-rc.13` → publish `web-v0.5.1`).
   Per semver precedence a bare release outranks its own rc line
   (`0.5.0 > 0.5.0-rc.13`), so the next patch always clears every rc baseline
   of the previous version. Pinned by
   `packages/viewer/tests/updater/compare-semver.test.ts`.
2. **Web-v versions must never carry a pre-release suffix.** The workflow marks
   any `-`-suffixed version as a GitHub pre-release, and `fetchWebReleases()`
   deliberately excludes drafts and pre-releases (no beta channel) — an
   rc-suffixed web release is invisible to every install.

UI-only changes ship through `release-web-ui.yml` alone (one command:
`gh workflow run release-web-ui.yml -f version=X.Y.Z`); the full installer
pipeline is not involved.

### Testability: feed URL override

`PRINT_MD_UPDATER_FEED_URL` redirects the release-list fetch to a local fixture
server (GitHub `GET /releases` response shape) so the whole
check→download→verify→stage→promote pipeline can be exercised against a
packaged build. Signature verification is never bypassed — fixtures must be
signed with a key whose public half is baked into the build under test.

## Rejected alternatives

| Alternative | Reason for rejection |
|---|---|
| `electron-updater` whole-app | Requires OS code-signing; unsigned macOS builds silently fail the update mechanism; swaps the full 100 MB binary for a UI-only change |
| `adapter-node` + JS server swap | Executable-code swap raises the same security bar as a full-app update with none of the OS tooling; eliminates the architectural gains of ADR 0002 |
| No auto-update | Non-technical authors miss UI fixes; manual download flow is a barrier that the viewer is specifically designed to remove |
| Electron's built-in `autoUpdater` (Squirrel) | macOS-only on Squirrel.Mac; requires signing; unnecessary given the SPA-swap approach |

## Consequences

### Positive

- Non-technical users receive UI improvements automatically with no installer
  interaction.
- The update payload is small (SvelteKit static bundle, typically a few MB)
  rather than the full 100 MB Electron binary.
- Cryptographic integrity (Ed25519 + SHA-256) is stronger than an unsigned
  whole-app download would be.
- The health watchdog ensures a bad bundle cannot permanently brick the app:
  if the renderer fails to call `updater:markReady` within 10 seconds, the
  previous bundle is restored automatically and the failed version is blacklisted.
- The updater is fully inert in development (`app.isPackaged && !VITE_DEV_SERVER_URL`)
  so the dev workflow is unaffected.

### Negative / trade-offs

- Lib and shell improvements still require users to re-download the installer.
  The `DESKTOP_API` gate makes the dependency explicit but does not remove it.
- The public key is baked into the Electron binary. Key rotation requires
  shipping a new installer before new web-v* releases are accepted by the rotated
  shell.
- The downgrade floor (`minimumSeenVersion`) and failed-version set live in
  `userData/web-runtime/state.json`. Corruption of this file (or the pointer
  files) degrades gracefully — all reads are failure-tolerant and fall back to
  the bundled-in-asar baseline — but a user who manually deletes `state.json`
  could theoretically be served a previously-rejected version.

## Implementation files

| File | Role |
|---|---|
| `electron/updater/contract.ts` | `DESKTOP_API` constant, `UpdateManifest` type, `WEB_UI_PUBLIC_KEY` |
| `electron/updater/web-runtime.ts` | `userData` layout, pointer/state read-write, `resolveWebRoot()` |
| `electron/updater/index.ts` | `checkForUpdate`, `downloadAndStage`, `promoteStaged`, `rollback`, `pruneVersions`, `getStatus` |
| `electron/updater/verify.ts` | Ed25519 signature verification, SHA-256 + size bundle integrity check |
| `electron/updater/manifest-validator.ts` | Runtime schema validation for `UpdateManifest` JSON |
| `electron/main.ts` | Lifecycle wiring: `promoteStaged` at launch, background check, watchdog, `updater:*` IPC handlers |
| `scripts/gen-web-ui-signing-key.sh` | One-time keypair generation; prints public key for `contract.ts` |
| `scripts/build-web-ui-manifest.mjs` | CI manifest builder: SHA-256 + size, Ed25519 sign, write `update-manifest.json[.sig]` |
| `.github/workflows/release-web-ui.yml` | CI workflow: build SPA, zip, generate manifest, create GitHub Release on `web-v*` |

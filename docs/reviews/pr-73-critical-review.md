# PR #73 Critical Review — "Refactor viewer updates to npm runtime package"

**Date:** 2026-07-02
**Branch:** `spike/splash-refactor` (commits `9fe7ebf`, `8992d92`, `e2710fa` + merge)
**Reviewers:** architecture review + correctness/security review (independent passes), findings consolidated and verified against the code.

---

## Verdict

**Do not merge in its current shape.** The PR takes a working artifact-distribution
problem (GitHub Release assets) and forces it into a dependency-manager format
(npm) that it then has to fight at every layer — a hand-rolled tar parser, a
full-tarball download on every launch, a package that isn't actually
installable, and a triple-build release job whose sanity checks validate
artifacts that get thrown away and rebuilt before publishing. Nearly every
defect below stems from that one root-cause misfit. On top of it, the PR
bundles an unrelated app-identity rename that would silently wipe every
existing user's settings on upgrade.

Scoping note: the two-tier hot-swap update system itself (zip + Ed25519 manifest
+ current/previous/staged pointers + health gate + rollback) **predates this
PR** — the PR only swaps the delivery channel from GitHub `web-v*` releases to
npm. Both the PR's changes and the underlying design are addressed below.

---

## Critical defects

### 1. The published npm package is broken as a package
`packages/viewer/package.json` is simultaneously the Electron app manifest and
the published `@dimm-city/print-md-ui` manifest.

- `main: "out/main/main.js"` points at a file excluded from `files` →
  `require`/`import` of the published package resolves to nothing.
- `dependencies` still include `"@dimm-city/print-md": "workspace:*"`, which
  `npm publish` does **not** rewrite → `npm install @dimm-city/print-md-ui`
  fails outright for any consumer.
- `files` ships `build/**` **and** `web-ui-bundle.zip` (the same content,
  zipped) → payload doubled in every release.
- CI's "sanity checks" only `test -f` specific paths; nothing ever validates
  installability, so none of this is caught.

The package was never a package — it's a zip smuggled through the registry.

### 2. Every update check downloads the full tarball, even when up to date
`packages/viewer/electron/updater/index.ts`: `checkForUpdate()` downloads and
verifies the whole package tarball (`downloadBuffer`, ~line 412, cap 256 MB)
**before** the "already up to date" comparison (~line 482) — even though the
registry `dist-tags` metadata it already fetched contains the version for free.
Every app launch's background check downloads the entire UI package for the
overwhelmingly common "nothing changed" case.

### 3. The Settings channel picker is a no-op for automatic updates
The startup background check calls `checkAndStage()` with no argument, which
defaults to `'stable'` (`main.ts:3324, 3346`); nothing in the main process
reads the persisted `settings.updates.channel`. Only the manual
"Check for updates" button passes the real channel (`+page.svelte:2433`).
A user who selects beta never receives beta builds automatically. Relatedly,
the `PRINT_MD_UPDATER_CHANNEL` env override is dead code — every production
call path passes an explicit channel.

### 4. App-identity rename silently destroys user data and breaks upgrades
The PR changes `appId` (`city.dimm.print-md-viewer` →
`city.dimm.print-md-desktop-app`), `productName` (→ `Print MD Desktop App`),
and the package `name` — but never pins `app.setPath("userData", …)`. Electron
derives userData from the app name, so on first launch after upgrade all
existing settings, recovery state, logs, and update pointers appear wiped.
Additional fallout:

- The `appId` change breaks NSIS/macOS upgrade identity → users get a second
  parallel install.
- `APP_USER_MODEL_ID` in `main.ts:105` still holds the old id (Windows
  taskbar/notification mismatch).
- Integration tests (`run-ui.mjs`) and README still reference
  `print-md-viewer.exe` / old artifact names.

This branding change is unrelated to the updater refactor and should be split
into its own PR with an explicit userData migration/pinning story.

### 5. `pruneVersions()` can delete a staged-but-unpromoted bundle
The keep-set is built from the `current` and `previous` pointers only, never
`staged.json` (`updater/index.ts:770-804`). Realistic same-launch timing
(promote v2 → health watchdog arms → background check stages v3 → renderer
`markReady` fires → `markHealthy` prunes) deletes `versions/v3` while
`staged.json` still points at it; the next promote silently drops the update.
The PR's own tests encode the buggy keep-set as expected behavior rather than
exercising this hazard — the tests mirror the implementation.

### 6. `checkForUpdate()` has no concurrency guard
`phase` / `lastError` / `availableVersion` / `cachedPackageVersion` are bare
module-level mutables; only `downloadAndStage()` has the `inFlight` guard. A
manual check racing the launch check can clobber status so the UI reports
"up to date" while an update is actually staged (or vice versa).

### 7. Hand-rolled ustar parser
`extractFilesFromNpmTarball()` reads only header bytes 0–100 for names — no
ustar `prefix` field, no PAX extended headers, no GNU long names, and it never
checks `typeflag` (a PAX header block could shadow a wanted filename). It works
today only because the three wanted paths are short, and fails with a generic
"not found" if npm/node-tar emission ever changes. This reintroduces exactly
the fragile format-parsing class that CLAUDE.md §3 prohibits, when `pacote`
(npm's own extractor) or `tar` would do it correctly in one call.

---

## Release-pipeline defects

### 8. Triple build; the published artifact is never the one checked
`prepack` runs the full vite build + zip + sign. The workflow runs it
explicitly, then `npm pack --dry-run` re-triggers it, then `npm publish`
triggers it a **third** time — each regenerating the manifest with a fresh
`releasedAt` timestamp and a fresh signature. The sanity-check steps validate
build #1; the registry receives build #3. The published bundle is also not
byte-identical to the baseline baked into the desktop shells (built separately
in each platform job).

### 9. A bad prerelease suffix poisons the whole release after side effects
The `ui_npm_tag` derivation was added to the shared `version` job and `exit 1`s
for any prerelease kind other than `rc`/`beta` — **after** the version-bump
commit and git tag have already been pushed. Dispatching `1.2.3-alpha.1` bumps
and tags the repo, then kills every downstream job, leaving manual cleanup.
This logic belongs scoped inside `publish-ui-npm` (as a skip, not a failure).

### 10. `publish-ui-npm` runs parallel to the desktop builds, not after them
`needs: [version]` only — if a viewer build fails, the npm version is already
live (npm publishes are effectively irreversible), and the in-app updater talks
to npm directly, so production users can be offered a UI whose matching shell
release never shipped.

### 11. Redundant integrity layer; the whole mechanism is dead in production
The chain is: registry `dist.integrity` (self-referential — hash and tarball
come from the same response over the same TLS connection) → zip sha256 in the
custom manifest → Ed25519 signature. Only the Ed25519 signature adds trust the
registry can't forge; `dist.integrity` verification is code and failure modes
without security value once the signature exists. Also: the signing key is
still not configured (placeholder public key), so the updater fails closed —
**this mechanism has never delivered an update in production.** Deleting or
replacing it costs users nothing today.

### Minor
- No cap on total *decompressed* zip size (compressed-only cap; zip-bomb into
  userData is signing-key-gated but inconsistent with the other caps).
- `state.json` `failedVersions` grows unbounded; nothing prunes old entries.
- CLAUDE.md still describes the viewer as an adapter-static SPA served via
  `app://`, while the code is adapter-node behind a local HTTP server
  (pre-existing drift; this PR deepens the dependency on it).

---

## Recommended target architecture

### Option A (recommended): delete the custom updater; adopt `electron-updater`
The industry-standard path (Slack, Discord, Obsidian, and virtually every
electron-builder app). Signed platform installers already go to GitHub
Releases; `electron-updater` with the GitHub provider gives:

- channel support (`latest`/`beta`/`alpha` channel files — the stable/rc/beta
  requirement, natively),
- differential downloads, staged rollouts,
- signature verification tied to OS code-signing,
- a battle-tested staging/apply/rollback flow,

in ~30 lines of main-process wiring plus a few lines of electron-builder
config.

**Delete:** `updater/index.ts`, `web-runtime.ts`, `verify.ts`,
`manifest-validator.ts`, the Ed25519 signing-key scheme (including the two
never-completed key-management steps), `prepare-ui-runtime-package.mjs`,
`build-web-ui-manifest.mjs`, the `publish-ui-npm` job, the health watchdog,
and the pointer/prune machinery — well over a thousand lines of bespoke
security-sensitive code replaced by a maintained dependency.

**Trade-off:** users download a full app installer per update instead of a
small UI zip. Unless UI release cadence vastly outpaces shell releases
(nothing in the repo suggests it — they share a version number in this very
PR), the trade is decisively worth it.

### Option B (if UI hot-swap must survive): revert to GitHub Releases
The deleted `release-web-ui.yml` flow was strictly better than npm for this:
release assets are plain HTTP downloads of exactly three files, the tiny
manifest can be fetched and version-compared **before** any bundle download,
artifacts are uploaded once (bytes published = bytes checked, no `prepack`
lifecycle traps), and there's no tar parsing and no fake package. If npm
`dist-tags` motivated the channel feature, GitHub prereleases + a channel field
in the manifest achieve the same with less machinery.

Then fix the engine bugs that survive either channel: prune must respect
`staged.json` (#5), `checkForUpdate` needs the in-flight guard (#6), the
startup check must read the persisted channel (#3), and versions must be
compared before downloading anything (#2).

### In either option
- Split the app-identity rename (#4) into its own PR with an explicit userData
  migration.
- Move the `ui_npm_tag` validation out of the side-effecting `version` job
  (or delete it with the job).

### Effort
- **Option A:** ~2–3 days (wire electron-updater, delete the updater subsystem
  and its tests, adjust release workflow). Net-negative diff by a large margin.
- **Option B:** ~1 day revert + 1–2 days engine bug fixes; leaves the project
  owning custom update-security code indefinitely.
- **Fixing the PR in place (keeping npm):** the worst path — 2–3 days of
  patches that still leave a fake package, a bespoke tar parser, and a second
  distribution channel to maintain.

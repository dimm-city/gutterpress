# Public Seams Review — CLI, Viewer, and Distribution (2026-07-26)

## Scope and method

This is a code-only review of print-md's **public seams** — the surfaces a real
end user touches: the CLI commands, the Electron viewer's UI flows, and the
release/install pipeline. Documentation claims (README, guides, CLAUDE.md) were
deliberately ignored; every finding below is grounded in the implemented source,
with file:line evidence. Findings were gathered by parallel code audits of the
four surfaces, then put through an adversarial second pass in which independent
reviewers were tasked with *refuting* each claim against the cited source, and
anything they flagged was re-checked by a third reviewer before the text was
changed. That pass rescoped or re-rated fourteen findings and corrected one
outright factual error; where it settled a question empirically — the pinned
`citty@0.2.2` parser's handling of undeclared flags, the published v0.8.3
release assets — the finding says so rather than hedging.

The review question: *what will actually go wrong for a non-technical author,
per operating system and install scenario, based solely on what the code does?*

## Resolution update (2026-07-26)

All findings have been addressed. The original review below is preserved as the
pre-remediation record, so its file:line references describe the code before the
fixes and may no longer point at the same statements.

| Finding | Status | Resolution |
| --- | --- | --- |
| D1 | **Accepted / mitigated** | Signing remains unaffordable by decision. Releases now publish checksums and put Gatekeeper guidance in the release body; the macOS notifier and package-manager paths reduce the remaining friction. |
| D2 | **Resolved** | Viewer releases explicitly build both Apple Silicon and Intel DMGs. |
| D3 | **Resolved** | macOS performs signing-free, channel-aware GitHub release checks and offers a **Download from GitHub** action without invoking the unsigned installer path. |
| D4 | **Accepted / mitigated** | Windows remains unsigned by decision. The release body explains SmartScreen, checksums are published, and the NSIS installer now keeps a stable basename so its reputation is not reset by each version. |
| D5 | **Resolved** | Release assets are flattened with collision checks, SHA-256 hashed, and published with `SHA256SUMS.txt`; the hashes are also included in release notes. |
| D6 | **Accepted / mitigated** | Both Darwin CLI architectures now run on native CI runners. The supported matrix and the Windows ARM64, Linux ARM64 viewer, and musl gaps are explicit; new targets remain demand-driven as recommended. |
| D7 | **Resolved** | Docker dispatch receives the normalized release version. |
| D8 | **Accepted / documented** | Git URL npm installs are explicitly unsupported; registry installation and standalone binaries are the supported paths. |
| D9 | **Resolved** | The repository now provides a Homebrew tap and Scoop bucket with post-release generation and real install validation. Submission-ready winget metadata is generated; publishing it still requires an external `microsoft/winget-pkgs` PR. |
| C1 | **Resolved** | Every Ghostscript caller uses shared cross-platform resolution with `GHOSTSCRIPT_PATH`, platform command names, and conventional Windows install paths. |
| C2 | **Resolved** | The Linux-only ICC path was removed. A real Ghostscript integration test verifies valid PDF/X metadata and expected RGB-red to CMYK conversion. |
| C3 | **Resolved** | YAML parse failures become filename-, line-, and column-aware `UsageError`s. |
| C4 | **Resolved** | Final builds fail with actionable guidance when no manifest is found; loose-folder live preview remains supported. |
| C5 | **Resolved** | Explicit manifest paths fail consistently in lint, validate, audit, preflight, build, and publish flows. |
| C6 | **Resolved** | Implicit preview only accepts no positional or an existing directory; unknown commands receive spelling guidance. |
| C7 | **Resolved** | Unknown flags and missing option values are rejected across every command, including nested plugin commands, with usage exit code 2. |
| C8 | **Resolved** | Build and preview retain purpose-specific defaults but print the resolved format first. |
| C9 | **Accepted / improved** | The system-browser constraint remains. Errors now point non-technical users to the browser-free desktop app, and Vivaldi/Opera discovery was added. |
| C10 | **Resolved** | `print-md doctor` reports platform, configuration path, external-tool status, paths, and install guidance. |
| C11 | **Accepted / documented** | The existing macOS config path is retained to avoid orphaning credentials and is now shown by `doctor`. |
| C12 | **Resolved** | Port probing uses the requested bind host, validates the full port range, and reports environmental bind exhaustion as a pipeline error. |
| C13 | **Resolved** | A failed automatic PDF open is nonfatal and reports the completed file path. |
| C14 | **Resolved** | PDF/X and annotation-strip intermediates are staged under the OS temporary build root rather than the output directory. |
| V1 | **Resolved** | CLI and viewer installs fetch, verify, and vendor an exact complete npm runtime graph without external tooling or package scripts. Whole-tree receipts, bounded extraction, receipt-bound ESM/CommonJS resolution, atomic mutation, project confinement, native confirmation, and named exports are covered by adversarial tests and standalone-binary smokes. Plugins remain explicitly trusted application code, not a sandbox. |
| V2 | **Resolved** | Failed editor flushes remain dirty, block destructive transitions, create an atomic next-launch marker, and produce bounded in-session warnings. Close and update installation request a direct flush rather than trusting telemetry. |
| V3 | **Resolved** | `.md` associations, macOS `open-file`, Windows/Linux launch arguments, second-instance handling, nearest-project resolution, and queued startup delivery are implemented. |
| V4 | **Resolved** | Linux `basic_text` credential storage triggers a persisted one-time native warning when GitHub is first connected. |
| V5 | **Resolved** | Manifest discovery uses one shared list for `manifest.yaml`, `manifest.yml`, and legacy `print-md.yaml`; malformed-manifest repair copy is distinct from the successful loose-folder setup path, and the unreachable failed-open adoption branch was removed. |

### Verification

- `bun install --frozen-lockfile`
- `bun test` — 3,971 passed, 1 environment-dependent skip, 0 failed
- `bun run typecheck`
- CLI production build and node-free `/render` purity gate
- Viewer Svelte check, lint/token check, production build, strict renderer-purity gate, and Electron main/preload build
- Standalone `bun build --compile` smoke: scaffold project, install dependency-bearing `markdown-it-highlightjs@4.3.0`, load it, and build paginated HTML
- Real Ghostscript 10.06 PDF/X color-conversion integration test
- `actionlint`, package-manager metadata drift tests, and release-asset/checksum tests

Release CI and physical target systems still provide the final native checks for
DMG/NSIS installation, Finder/Explorer/AppImage association behavior, and Linux
keyring backends. Winget availability remains external until its generated
manifest is accepted upstream. Code signing remains the explicit accepted
limitation below.

## Accepted limitation: code signing

> **Decision (2026-07-26): code signing and notarization are not affordable at
> this time and are accepted as a known limitation.** Findings D1, D3, and D4
> below are consequences of this decision. They are documented here for
> completeness, with **no-cost mitigations** recommended in place of signing.
> This section should be revisited when an Apple Developer subscription
> (~$99/yr) and/or a Windows Authenticode certificate become viable.

What the limitation concretely causes today:

- **macOS Gatekeeper** blocks the downloaded DMG and CLI binaries
  ("app is damaged" / "cannot be opened") because nothing is signed or
  notarized. The release workflow explicitly disables identity discovery
  (`CSC_IDENTITY_AUTO_DISCOVERY: false`, `.github/workflows/release.yml:393`)
  and no notarization step exists anywhere in `.github/`.
- **macOS auto-update is disabled entirely** (`packages/viewer/electron/updater.ts:145`)
  because Squirrel.Mac refuses unsigned bundles — a direct, correct consequence.
- **Windows SmartScreen** shows "Windows protected your PC" for the unsigned
  NSIS installer and the unsigned CLI `.exe`.

No-cost mitigations (recommended regardless of when signing happens):

1. **Publish SHA-256 checksums with every release** (see D5). With unsigned
   binaries, a checksum file is the only integrity signal users have for the
   CLI binaries and the DMG.
2. **Put the Gatekeeper workaround in the release body itself** (the
   `gh release create` step can template it): System Settings → Privacy &
   Security → "Open Anyway", or `xattr -d com.apple.quarantine <app>`. Users
   hit the block *at the release page's download*, so that is where the
   instructions must live — not in a doc they haven't found.
3. **Ship a signing-free update notifier on macOS** (see D3) so mac users at
   least learn a new version exists.
4. **Pursue free distribution channels that reduce warning friction over
   time**: winget and Scoop manifests for Windows (winget submission is free
   and installs bypass the browser's SmartScreen-of-download flow), a Homebrew
   tap for the CLI on macOS/Linux (`brew install` strips quarantine on the
   binary it installs).

---

## Severity legend

| Severity | Meaning |
| --- | --- |
| **Critical** | A target-audience user on a supported platform hits a hard failure or dead end |
| **High** | Likely failure or serious confusion in a common scenario |
| **Medium** | Real but narrower impact, or has a workaround a user could plausibly find |
| **Low** | Cosmetic, inconsistency, or affects technical users only |

---

## Part A — Distribution and install (D)

### D1. macOS: unsigned, unnotarized artifacts — **Critical** *(accepted limitation)*

**Evidence:** `.github/workflows/release.yml:393` (`CSC_IDENTITY_AUTO_DISCOVERY:
false`); zero hits for `notarize`/`APPLE_ID`/`CSC_LINK` across `.github/` and
`packages/viewer/electron-builder.yml`; the `build-cli` job
(release.yml:217-278) has no codesign step for the mac CLI binaries either.

**Impact:** the first-run experience on macOS is a Gatekeeper dead end for both
the viewer DMG and the standalone CLI binaries. A non-technical user who
downloads, opens, and drags to Applications gets "damaged / can't be opened"
with no in-product guidance.

**Recommendation:** accepted for now — apply the four no-cost mitigations in
the "Accepted limitation" section above. When funding allows, the fix is an
Apple Developer ID certificate + `notarytool` step in `build-viewer-mac` and
`build-cli`.

### D2. macOS viewer is Apple-Silicon-only; Intel Macs have no viewer — **High** *(not signing-dependent)*

**Evidence:** `packages/viewer/electron-builder.yml:105-108` — the `mac` block
declares `target: [dmg]` with **no `arch` key**, so electron-builder builds the
runner's native arch; `release.yml:365` runs on `macos-latest`, which is
arm64. The CLI matrix *does* ship `macos-x64` (release.yml:225-233), so the
gap is viewer-only.

**Impact:** Intel Mac users have no viewer build at all, and nothing tells them
why the app won't launch (Rosetta cannot run an arm64-only binary).

**Recommendation:** cheap and signing-independent — add explicit arches to the
mac target (`arch: [arm64, x64]`, or a `universal` build). If Intel is
deliberately dropped, state it in the release table instead of failing
silently.

### D3. No update path at all on macOS — **High** *(consequence of D1, mitigable without signing)*

**Evidence:** `packages/viewer/electron/updater.ts:143-148` —
`updaterSupported()` returns `false` unconditionally on `darwin`;
`updater.ts:109-110` shows the user hint ("download the latest release from
GitHub").

**Impact:** every macOS user must notice on their own that a new version
exists, manually re-download, and re-fight Gatekeeper (D1) each time. In
practice mac users will silently stay on old, buggy versions.

**Recommendation:** electron-updater is not the only option. A **check-only
notifier** needs no signing: fetch the GitHub Releases "latest" endpoint
(the app already talks to the GitHub API for sync), compare versions, and show
the existing update UI with a "Download from GitHub" button instead of a
"Install" button. The updater module already has the status plumbing and the
`MAC_UPDATE_HINT` copy; this converts a dead end into a one-click manual
update.

### D4. Windows: unsigned installer and CLI trigger SmartScreen — **Medium** *(accepted limitation)*

**Evidence:** no `CSC_LINK`/`WIN_CSC_LINK`/`signtool` configuration anywhere in
`.github/` or `electron-builder.yml` (grep-confirmed).

**Impact:** "Windows protected your PC" interstitial on first run of the NSIS
installer and the CLI binary. Most non-technical users can click through
("More info" → "Run anyway"), but some will abandon.

**Recommendation:** accepted for now. Mitigations: winget/Scoop manifests
(free, reduces the scare path), and a note in the release body. SmartScreen
reputation also accrues to a stable, frequently-downloaded unsigned binary
over time — renaming artifacts per-release resets that, so keep artifact names
stable.

### D5. No checksums published for the CLI binaries, the DMG, or the Windows zip — **High**

**Evidence:** the `github-release` job (release.yml:504-643) generates no
integrity file of its own — grep of `.github/` for
`sha256|sha512|checksum|shasum|SHASUMS` returns nothing — and publishes
everything with a bare `gh release create … dist/*` (release.yml:619-624). Two
channels are nonetheless covered, by electron-builder rather than by the
workflow: `electron-builder.yml:47-50` declares the `publish: github` provider,
so `latest.yml` / `latest-linux.yml` carry a `sha512` for the NSIS installer and
the AppImage (confirmed on the published v0.8.3 assets), electron-updater
verifies the download against it, and the release job hard-requires and
validates both feeds (release.yml:556-590). The npm package is published with
`--provenance` (release.yml:462, 464). Everything else ships bare: the five
`print-md-cli-*` binaries, the macOS `.dmg` (there is no `latest-mac.yml` — mac
auto-update is disabled, see D1/D3), and the Windows portable `.zip`
(`latest.yml` references only the `.exe`). Neither downloader verifies a hash
either: `packages/cli/scripts/install.sh:166-174` downloads, `chmod +x`s and
`mv`s the binary, and its `verify_install` (install.sh:177) only runs
`--version`; `install.ps1` has no hash check at all.

**Impact:** seven of the nine downloadable artifacts — the entire CLI
distribution surface plus the mac viewer and the Windows portable zip — have no
integrity signal, which combined with D1/D4 (unsigned everything) leaves users
nothing to check. It also blocks D9: brew/winget/Scoop manifests all *require* a
hash for the CLI binaries.

**Recommendation:** one step in `github-release`: `sha256sum dist/* >
SHA256SUMS.txt` and attach it — covering the two already-hashed viewer artifacts
too costs nothing and gives users one uniform file instead of a machine-readable
update feed they have to know to base64-decode. Print the hashes into the
release body, and add verification to `install.sh` / `install.ps1`.

### D6. Platform coverage gaps — **Medium**

**Evidence:** CLI matrix is exactly `bun-linux-x64`, `bun-linux-arm64`,
`bun-darwin-x64`, `bun-darwin-arm64`, `bun-windows-x64`
(release.yml:222-233). Viewer: Linux AppImage x64 only
(electron-builder.yml:63-66, built on `ubuntu-latest`), Windows x64 only
(electron-builder.yml:86-90), mac see D2.

**Impact:**
- No Windows ARM64 CLI or viewer (Surface/ARM laptops run x64 via emulation —
  works, but slowly; worth documenting).
- No Linux ARM64 **viewer** (the CLI has it — asymmetric).
- No musl CLI build — Alpine-based containers/distros can't run the glibc
  bun binaries. The Docker image mitigates for container users.
- Only linux-x64 is smoke-tested in-job (release.yml:252-271; Windows has a
  separate verify job at release.yml:479-497). The darwin binaries are **never
  executed by any workflow** — a broken mac binary would ship undetected.

**Recommendation:** add a `macos-latest` smoke-test job for the darwin
binaries (free, catches real breakage); add missing targets only as demand
appears, but *list* the supported matrix in the release body so the gap is a
statement rather than a surprise.

### D7. Docker dispatch passes the raw version, adding a spurious image tag — **Low**

**Evidence:** `release.yml:634-643` — the dispatch into `docker.yml` passes
`VERSION: ${{ inputs.version }}` (the **raw, unnormalized** input) as that
workflow's `tag` input, while the ref it dispatches at is the normalized
`v<version>` (`--ref "$TAG"`, release.yml:637; tag created at
release.yml:187-189 from the value normalized at release.yml:93-101).

**Impact:** smaller than the mismatch suggests. `docker.yml:50-51` derive
`{{version}}` and `{{major}}.{{minor}}` from the **tag ref**, not from the
input (metadata-action's `type=semver` is a no-op unless `github.ref` is
`refs/tags/*`), so a run at `refs/tags/v1.2.3` still publishes `1.2.3` and
`1.2`, and the action's default `latest=auto` flavor still marks that stable
semver version `latest`. The raw input reaches only `docker.yml:57`
(`type=raw,value=${{ inputs.tag }}`), so dispatching a release as `v1.2.3`
merely *adds* a spurious `v1.2.3` alias next to the correct tags. It also
falsifies the guard at `docker.yml:56` (`github.ref == format('refs/tags/v{0}',
inputs.tag)` compares `refs/tags/v1.2.3` against `refs/tags/vv1.2.3`) — but
that rule is redundant at a tag ref, where `latest=auto` has already set
`latest`, so nothing is lost.

**Recommendation:** pass the normalized version — but note the `version` job
exposes only `tag` and `prerelease` (release.yml:72-74), so
`needs.version.outputs.version` would expand to an empty string. Either add a
`version` output next to release.yml:189 (`echo "version=$VERSION" >>
"$GITHUB_OUTPUT"`), or strip the leading `v` at the call site:
`-f tag="${TAG#v}"`.

### D8. Installing the npm package from git yields a broken CLI — **Low**

**Evidence:** `packages/cli/package.json:53` has `prepublishOnly` (runs only on
registry publish) and no `prepare`/`prepack`; `dist/` is gitignored and
untracked. npm only runs `prepare` for git installs, so
`npm install git+https://…` produces a package with no `dist/cli.js` — the
declared `bin` target (package.json:28-30) doesn't exist.

**Impact:** technical users only; registry installs (`npm i -g
@dimm-city/print-md`) work correctly because `prepublishOnly` builds first.

**Recommendation:** either add a `prepare` script (needs bun on the
installer's machine — may be undesirable) or explicitly treat git installs as
unsupported; the monorepo `workspace:*` layout makes them impractical anyway.

### D9. No native OS package-manager distribution — **Medium**

**Evidence:** no Homebrew formula, Scoop manifest, winget manifest, or
Chocolatey package anywhere in the repo — both a tracked-file search
(`git ls-files | grep -iE "brew|formula|scoop|winget|choco|\.rb$|\.nuspec"`)
and a filesystem `find` for the same patterns return nothing. The channels that
*do* exist are npm (`npm install -g @dimm-city/print-md`,
packages/cli/README.md:23-27, published with `--provenance` at
release.yml:462/464), Docker/GHCR (docs/docker.md:18), the repo's own
`curl | bash` / `irm | iex` installers (packages/cli/scripts/install.sh:7,
install.ps1:7), and direct GitHub Release downloads (README.md:9).

**Impact:** Windows and macOS users get no `winget upgrade` / `brew upgrade`
path and no OS-level provenance. The two shell installers do cover install *and*
in-place upgrade (install.sh:173 `mv -f "$tmp" "$PRINTMD_BIN"`;
install.ps1:172-186 backup → rename-aside → `Move-Item -Force`, which also
handles an in-use `.exe`), with pinning via `PRINTMD_VERSION` (install.sh:10) —
but they fetch an unsigned binary over HTTPS with **no checksum verification**
(grep of both scripts for `sha256|shasum|checksum` returns nothing — see D5),
which is the worst trust path available given D1/D4. Neither README links them
either (README.md:9-15 and packages/cli/README.md:9-21 both advertise a manual
release download), so for a user who isn't on npm or Docker the *documented*
path is still a hand-download.

**Recommendation:** free wins, in order of value: (1) winget manifest —
free submission, native `winget upgrade` support; (2) Homebrew tap
(`dimm-city/homebrew-tap`) — solves macOS quarantine for the CLI as a side
effect; (3) Scoop bucket. All three require D5 (checksums) first — which would
also let the existing `install.sh`/`install.ps1` verify what they download.
Separately, link the installers from both READMEs; they already work and are
covered by `packages/cli/src/installer-asset-names.test.ts`.

---

## Part B — CLI seams (C)

### C1. PDF/X is effectively broken on Windows: Ghostscript is invoked as `gs` — **Critical**

**Evidence:** every Ghostscript call site uses the literal name `gs`:
`packages/cli/src/lib/ghostscript.ts:166` (`run("gs", args)` for the CMYK
conversion), `lib/build-preflight.ts:66` (`isToolAvailable("gs")` gates pdfx
builds), `lib/pdf-parse.ts:77` and `checks/asset/image-tac.ts:27`
(`execCapture("gs", …)`), `lib/diagnostics.ts:73-74` (`bin: "gs"`). The PATH
probe (`lib/tool-probe.ts:28-58`) checks the literal name via `where.exe`.
There is no `gswin64c`/`gswin32c` fallback anywhere (grep-confirmed).

**Impact:** the standard Windows Ghostscript installer provides
`gswin64c.exe`/`gswin32c.exe` — there is no `gs.exe`, and the install doesn't
add itself to PATH by default. So a Windows user who hits the preflight error,
dutifully installs Ghostscript, and retries **fails the exact same preflight
again**. The flagship "print-ready PDF/X" feature cannot be made to work on
Windows without the user hand-crafting a `gs` alias — far beyond the target
audience.

**Recommendation:** resolve Ghostscript the same way Chromium is resolved
(`lib/chromium.ts` is the in-repo pattern to copy): try an env override
(`GHOSTSCRIPT_PATH`), then candidate binary names per platform
(`gs`, `gswin64c`, `gswin32c`), then the conventional install directory
(`C:\Program Files\gs\gs*\bin\gswin64c.exe`). Route all five call sites
through one `resolveGhostscript()` helper.

### C2. Hardcoded Linux-only ICC profile path passed to Ghostscript on every platform — **High**

**Evidence:** `lib/ghostscript.ts:158` —
`-sDefaultRGBProfile=/usr/share/color/icc/ghostscript/srgb.icc` is in the
fixed argument list for the PDF/X CMYK conversion, on all platforms.

**Impact:** that path exists only on Linux distro Ghostscript packages. On
Windows/macOS the flag points at a nonexistent file; depending on gs version
this either errors the conversion or silently falls back to a different RGB
interpretation — meaning **PDF/X color conversion is Linux-shaped at best and
broken at worst everywhere else**. Combined with C1, PDF/X is in practice a
Linux-only feature today.

**Recommendation:** stop referencing a distro path. Either (a) drop the flag
and let gs use its built-in default sRGB (verify output parity on one
fixture), or (b) embed an sRGB ICC profile as an embedded asset (the
`embedded-assets.ts` pattern already exists for exactly this), extract it to
the temp dir, and pass that path with a matching `--permit-file-read`.

### C3. A YAML syntax error in `manifest.yaml` crashes `build`/`preview`/`lint` at startup with a raw stack trace — **High**

**Evidence:** `lib/manifest.ts:54-55` — `parseYaml(raw)` has no try/catch, so a
malformed manifest throws `YAMLParseError`. `commands/build.ts:60-65`,
`commands/preview.ts:102-108`, and `commands/lint.ts:46-52` catch **only**
`UsageError`/`BuildError` and re-throw everything else; no
`uncaughtException`/`unhandledRejection` handler exists anywhere in the CLI
(grep-confirmed); and citty's `runMain` catch-all is
`else console.error(error, "\n"); process.exit(1)` for any non-`CLIError`
(verified against `citty@0.2.x`'s `dist/index.mjs`) — so what reaches the
terminal is the full stack. Meanwhile `validate`/`audit`/`preflight` catch
broadly (`validate.ts:84-87`, `audit.ts:46-49`, `preflight.ts:237-240`) and
print a clean one-line error.

**Impact:** hand-editing YAML is the product's core authoring loop, and YAML
syntax errors (a stray tab, an unquoted colon in a title) are the single most
likely mistake the target audience will make. But the blast radius is **CLI
startup only**, and three limits are worth stating precisely:

- the live-preview edit loop is already tolerant — `preview/file-watcher.ts:471`
  reloads the manifest inside a try whose catch (`:489-490`) logs "Failed to
  regenerate preview" and keeps the server up. Partial mitigation only:
  `utils/logger.ts:63` still `console.error`s the raw error object, and the
  browser silently keeps the last good render with no in-page signal — but
  nothing crashes;
- the desktop viewer never hits this at all —
  `packages/viewer/electron/preview/controller.ts:144-151` wraps
  `startPreviewServer` and rethrows "Preview server failed to start: <msg>",
  which the start screen surfaces as `openError`
  (`project-lifecycle-controller.svelte.ts:426`);
- `preview` short-circuits before the parse when there is no input
  (`preview/lifecycle.ts:142`), so bare `print-md` (`cli.ts:50-51`) never reads
  a manifest — though that mode only serves the placeholder page (the CLI
  preview server is headless, no folder picker: `preview/http-server.ts:333-338`),
  so every real CLI preview does pass a directory.

Not a dead end: `YAMLParseError`'s message carries `at line N, column M` plus a
code frame, so the diagnostic text survives inside the trace. It is still a
stack dump — from `/$bunfs/root/...` in the compiled binary — which is exactly
the output a non-technical author cannot read, and it is gratuitously
inconsistent with the clean one-liner `validate` prints for the very same file.

**Recommendation:** wrap the parse site once, in `loadManifestWithPath`:
catch `YAMLParseError` and rethrow as `UsageError` including the filename and
the parser's line/column (the `yaml` package provides `linePos`). That fixes
all commands at once, removes the build/validate asymmetry for this class, and
also upgrades the file-watcher's logged reload failure to a legible message.

### C4. A missing manifest is never reported: `build` in the wrong folder builds the *wrong* book — or dies with a raw `No markdown files found` — **Medium**

**Evidence:** `lib/manifest.ts:60-66` — when no `manifest.yaml`/`.yml` is
found, the loader returns `{ manifest: {}, manifestDir }` with no output
unless `explicit` was set. `build` then proceeds on preset defaults, whose
`source.files` is `null` (`lib/presets.ts:15`, `:123`), so `renderBook`
(`build-runner.ts:258-261`) hands `files: null` to `renderChapters`, which
falls back to a **non-recursive** scan of the input dir
(`lib/markdown/index.ts:62-67`) and — if that finds nothing — throws a plain
`Error`, `No markdown files found in <dir>` (`markdown/index.ts:70-71`).
`commands/build.ts:60-65` catches only `UsageError`/`BuildError`, so that one
reaches the user through the same unwrapped path as C3. Output paths still
come from the preset (`lib/presets.ts:26-28`, `build-runner.ts:181,465-466`).

**Impact:** the outcome splits on whether the directory happens to hold
top-level `.md` files, and **neither branch ever says a manifest was looked
for and not found**:

- **No `.md` present** — the build fails loudly and names the directory, but
  as a raw, unwrapped `Error` (the C3 class of problem, different trigger).
- **`.md` present** — a book is built from *whatever those files are*, under
  preset defaults: alphabetical order instead of the manifest's
  `source.files`, `"Document"` as the title, and none of the manifest's
  styles or plugins. Because `new` scaffolds chapters at the project root
  (`lib/project-scaffold.ts:245-248`), a manifest that is missing or
  mis-named (`print-md.yaml` — see V5) in the author's *own* project quietly
  yields a mis-ordered, unstyled book rather than an error. A near-empty PDF
  arises only in the narrow case where the wrong directory holds one stray
  `.md` (a README).

The signals that do exist — `Build (pdf): <in> -> <out>`
(`build-runner.ts:600`), `Using all .md files in alphabetical order`
(`build-runner.ts:242`), and the "No `preset` set in manifest.yaml" notice
(`lib/presets.ts:249-256`) — fire identically for a legitimately
manifest-less run, so none of them distinguishes "you are in the wrong
folder" from "this project has no manifest".

**Recommendation:** unchanged — when no manifest is found and no explicit
input was given, `build` should fail with "No manifest.yaml found in <dir> —
run from your project folder or pass the path: print-md build <project-dir>".
The live preview's no-manifest tolerance (lifecycle.ts:139-145) is correct
and should stay — the fix belongs in `resolveBuildContext`
(`build-runner.ts:139-185`), not the loader. It also removes the raw
`No markdown files found` throw from this path.

### C5. A typo'd `--manifest` path is silently ignored by `validate`/`audit`/`preflight`/`lint` — **Medium**

**Evidence:** `build-runner.ts:150-153` passes
`{ explicit: opts.manifestPath !== undefined }` (deliberate fix, ARCH finding
#12), so `build --manifest typo.yaml` errors correctly. But
`lib/validation-exec.ts:146-148` and `lib/lint-runner.ts:20` call the loader
**without** `explicit`, so the same typo silently falls back to the empty
manifest and the commands validate/lint against nothing.

**Impact:** validation reports "clean" against an empty config — a false
all-clear from the very commands whose job is catching problems.

**Recommendation:** replicate the `explicit` argument at both call sites; the
pattern and rationale already exist in `build-runner.ts:145-149`.

### C6. Typo'd subcommands are silently reinterpreted as `preview <dir>` — **Medium**

**Evidence:** `cli.ts:43-52` — any first positional that isn't a known
subcommand causes `rawArgs.unshift("preview")`. `print-md biuld` therefore
errors with "Input directory does not exist: <cwd>/biuld"
(`preview.ts:48-54`) instead of "unknown command 'biuld'".

**Impact:** the error the user sees describes a directory problem, not their
actual mistake; nothing suggests the correct spelling.

**Recommendation:** keep the convenience fallback but gate it: only default to
`preview` when the positional **exists as a directory** (or there are no
positionals). Otherwise print "unknown command 'biuld' — did you mean
'build'?" (a 10-line closest-match over the 9 command names).

### C7. Unknown flag names are silently ignored — **Medium**

**Evidence:** no strict-flag rejection exists anywhere in the CLI source;
commands read only their declared `args.<name>` fields. citty 0.2.2 (pinned at
`bun.lock:717`, zero runtime deps) parses through `node:util`'s `parseArgs`
with `strict: false` (`citty/dist/index.mjs`, `parseRawArgs`), so undeclared
keys pass through unreported — and nothing downstream inspects them: `rawArgs`
reaches `build-runner.ts:433,562` as build-receipt metadata only, never as
validation. The repo already hand-patches a sibling citty gap
(`rejectExtraPositionals`, `lib/cli-args.ts:27-50`, whose doc comment explains
citty leaves extra positionals unreported). The existing `cli-contract.test.ts`
covers bad *values* (`:196-198`, `--format docx`) but never an unknown flag
*name*.

**Impact:** form-dependent, and only one form is genuinely silent.
`print-md build --formt=html` builds the **default PDF** without a word —
compounded by the divergent defaults (C8) — and a value-less typo like
`--verbse` is dropped just as quietly. The space-separated form is *not*
silent: `parseArgs` types the undeclared `--formt` as a boolean, so `html`
falls through to `_` and either becomes the input positional
(`build --formt html` builds `<cwd>/html`) or trips `rejectExtraPositionals`
(`build . --formt html` → exit 2, "unexpected extra argument(s): html",
`build.ts:37`). Either way the user's intent is dropped; only the `=` form
drops it invisibly.

**Recommendation:** extend the existing `rejectExtraPositionals` pattern with a
`rejectUnknownFlags(args, declared)` helper called from the same 9 call
sites, and add the missing contract test.

### C8. `preview` and `build` have different default formats — **Low**

**Evidence:** `preview` defaults to `html` (live server, `preview.ts:58`);
`build` defaults to `pdf` (`build.ts:39`).

**Impact:** mostly reasonable per-command; the real cost is that users moving
between the two commands must remember the asymmetry. The wrong-artifact case
is narrower than it looks: of the C7 typo forms, only the `=` form
(`--formt=html`) survives parsing quietly — the space-separated form
(`--formt html`) is coerced to a boolean by citty and its value falls into
`args._`, where it either trips `rejectExtraPositionals` (`cli-args.ts:39-50`)
or is mistaken for the input directory. And the surviving case is not silent:
`runBuild`'s first statement is
``log.info(`Build (${ctx.format}): ${ctx.inputDir} -> ${ctx.outDir}`)``
(`build-runner.ts:600`, before mkdir/preflight/gates), and the `log` facade is
deliberately not level-gated (`utils/logger.ts:112-132`), so `Build (pdf): …`
always prints first.

**Recommendation:** keep the defaults (they match each command's purpose).
`build` already states the resolved format on its first output line
(`build-runner.ts:600`), and `preview --format pdf|pdfx` inherits that line by
routing through `runBuild`. The only gap left is the live preview, whose
startup line names the input directory but not the format
(`server.ts:74-77`) — a one-word change to `Starting HTML preview server
for: …` makes the resolved format visible on both sides.

### C9. PDF rendering requires a preinstalled Chromium-family browser — **Medium** *(design constraint, well-handled)*

**Evidence:** `puppeteer-core` (no bundled browser, no auto-download anywhere
in the codebase); discovery in `lib/chromium.ts:5-58` (env overrides →
hardcoded per-OS paths for Chrome/Chromium/Edge/Brave → PATH probe); hard
failure with a genuinely good actionable error (`chromium.ts:91-106`) listing
per-OS installs and the `CHROMIUM_PATH` escape hatch. `--format html` degrades
gracefully instead of failing (`build-runner.ts:384-393`).

**Impact:** Firefox-only users and bare machines can't build PDFs from the
CLI. Windows is well-covered in practice (Edge ships with the OS and is
detected); macOS/Linux users without Chrome hit the wall.

**Recommendation:** acceptable as a documented constraint — the viewer (which
uses Electron's own Chromium) is the right answer for non-technical users.
Two cheap improvements: mention "the desktop app needs no browser" inside the
CLI error text itself, and add Vivaldi/Opera to `PATH_CANDIDATES` (currently
only the four families are probed).

### C10. `doctor` command is referenced but does not exist — **Low**

**Evidence:** `lib/diagnostics.ts:3,25` and `lib/version.ts:10` reference
`print-md doctor`; the subcommand map (`cli.ts:10-22`) has no such entry, and
the full diagnostics backend (`getSystemDiagnostics`, probing chromium/gs/qpdf
with install hints) already exists and is used by the viewer's Help panel.

**Impact:** the CLI has no one-shot "is my system ready?" command even though
100% of the logic is already written.

**Recommendation:** add a ~30-line `doctor` command that prints
`getSystemDiagnostics()` results. Given C1/C2/C9 (external-tool fragility is
this tool's biggest real-world failure class), this is the highest
value-per-line change in this report.

### C11. Config dir is `~/.config/print-md` on macOS — **Low**

**Evidence:** `lib/remote-auth/token-store.ts:107-115` — Windows uses
`%APPDATA%`, everything else falls to `XDG_CONFIG_HOME`/`~/.config`; no
`darwin` branch for `~/Library/Application Support`.

**Impact:** cosmetic; many CLIs do the same. Changing it now would orphan
existing credentials.

**Recommendation:** leave as-is; document the location in `doctor` output
(C10).

### C12. Preview port probe checks a different address than it binds — **Low**

**Evidence:** `preview/http-server.ts:184-207` — `findAvailablePort` probes
availability on `127.0.0.1` regardless of `--host`; only the final
`server.listen` (http-server.ts:481) uses the user's host.

**Impact:** with `--host 0.0.0.0`, a port free on loopback but taken on
another interface would pass the probe and then fail the real bind. Rare, but
a correctness gap.

**Recommendation:** pass the resolved host into the probe.

### C13. Missing `xdg-open` crashes `preview --format pdf` — **Low**

**Evidence:** `commands/preview.ts:100` `await`s `openPath(...)` unguarded;
`lib/open-path.ts:24-26` rejects on spawn error (e.g. no `xdg-open` on a
minimal Linux); preview's catch only handles `UsageError`/`BuildError`, so
this propagates raw (same path as C3). `publish.ts:257` already guards the
identical call with `.catch(() => {})`.

**Recommendation:** wrap in a catch that logs "couldn't open the PDF
automatically — it's at <path>". The build succeeded; say so.

### C14. The PDF/X Ghostscript definition file is written into the user's output directory — **Low**

**Evidence:** `lib/ghostscript.ts:128` writes `.pdfx_def_<ts>.ps` into
`dirname(outPdf)` — the user's real output dir (`build-runner.ts:532` passes
`path.resolve(pdfFile)`, resolved from `outDir` at `build-runner.ts:465-466`).
Cleanup is a best-effort `finally` (`ghostscript.ts:167-169`, covered by
`ghostscript.test.ts:22`), so only a hard kill strands it in `dist/`, and no
startup reaper covers this pattern (unlike the preview temp dirs,
`preview/lifecycle.ts:47-68`). Mitigating: it is a dotfile, so a stranded copy
is invisible rather than visibly littering the output dir.

**Recommendation:** stage the `.ps` file in the existing OS-tmpdir stage root
(`build-staging.ts:161-163`), as the stripped PDF already is — `stripAnnotations`
(`ghostscript.ts:13-17`) writes `<pdf>.stripped.pdf` beside its input, but its
only caller (`build-runner.ts:528`) runs in pdfx mode, where `rawPdf` is already
inside the stage root (`build-runner.ts:480-482`) that is removed in a `finally`
(`build-runner.ts:573-574`).

---

## Part C — Viewer seams (V)

### V1. "Add npm plugin" doesn't install anything, and the recovery path contradicts the product's premise — **High**

**Evidence:** the add-npm route (`src/routes/api/plugin/add-npm/+server.ts` →
`packages/cli/src/lib/plugin-manager.ts:253-266`) **only writes a manifest
entry** — auto-install is a deliberate policy (plugins.ts:34-36). The entry
then can't resolve, and the two render paths diverge. The live preview
degrades (`preview/file-watcher.ts:139-143` supplies `onError`) and the
Plugins panel shows "Not installed" with a copyable `npm install <pkg>` and a
guide link (`config-helpers.ts:150-157`, `PluginsSection.svelte:68-77`; the
loader's `cd <dir> && bun add <pkg>` text, plugins.ts:70-76, sits behind "Show
details" at :79-81). **Build and PDF export fail-fast** — no `onError` at
`build-runner.ts:250-253`, by design — so the project stops producing its
deliverable entirely. The diagnostics panel never probes for Node/npm/bun
(`lib/diagnostics.ts:65-93` probes gs/qpdf; chromium at :131).

**Impact:** the packaged viewer's premise is "no Bun/Node required" — and an
always-visible "Add another plugin" field (`PluginsSection.svelte:110-121`)
lets a non-technical author write a manifest entry the app can never satisfy.
Whichever command the panel prints, recovery needs a package manager the
product promised they don't need and almost certainly don't have; the only
other way out is knowing to hand-remove the manifest entry. Until one of those
happens, every PDF export for that project aborts. Only the four bundled
recommended plugins (plugin-manager.ts:85-110 → `BUILTIN_OPTIONAL_PLUGINS`,
renderer.ts:109-114) work out of the box, offline, with no install. The
reproducibility rationale is sound; the seam it's exposed through is wrong for
the audience.

**Recommendation:** implement in-app install **without any external tool**:
fetch the package tarball directly from the npm registry
(`https://registry.npmjs.org/<pkg>/-/<pkg>-<version>.tgz`) with `fetch`,
extract with a pure-JS untar (the repo already uses `fflate` for the butler
download — the identical pattern), and place it under the project's
`plugins/` dir, recording the exact version in the manifest. This keeps
builds reproducible (pinned version, vendored into the project) and stays
inside the "no external binaries" architecture rule. Interim cheaper options:
expand the bundled recommended set; harden the existing pre-add caveat
(`PluginsSection.svelte:120`, "A plugin added by name must already be
installed in your project") into an explicit "requires npm or Bun on your
machine" warning at the point of entry; and add a one-click "remove this
entry" action on the failed row, so a stuck export doesn't require editing
`manifest.yaml` by hand.

### V2. Silent failures on UI-state persistence (not on document saves) — **Low**

**Evidence:** unconditional `.catch(() => {})` on the four host-state writes in
`src/routes/+page.svelte` — 227 (per-project current page), 749
(landing-at-startup pref), 1167 (`setDirtyState`), 1906 (per-project view
state). `api.ts`'s `post()` throws on any non-`ok` response
(`src/lib/api.ts:12-23`), so these swallow real failures. The four
editor-buffer `.catch(() => {})`s at 471, 1249, 1287, 2146 are **inert**:
`doSave()` already try/catches into `setPhase("error")` + `onError`
(`src/lib/editor/buffer-state.svelte.ts:269-273`, wired to `toast?.error` at
`+page.svelte:1155`) and `flush()` only awaits it
(`buffer-state.svelte.ts:278-289`), so it never rejects. The actual close
flush (`+page.svelte:1225`) has no `.catch` at all.

**Impact:** a failed document save is *not* silent — it raises a "Save
failed: …" toast plus an `error` phase, and dirty content is separately
snapshotted for crash recovery (`buffer-state.svelte.ts:205-221`). The
documented quit policy (`electron/main.ts:821-826`) drops only the
version-history entry — "the edits themselves are flushed to disk regardless."
The one defensible work-loss chain is 1167: a silently failed
`setDirtyState(true)` leaves `rendererDirty` false, so the close gate
(`electron/main.ts:829-831`, `const needsFlush = rendererDirty`) never
intercepts the close and the ≤500ms debounced save
(`buffer-state.svelte.ts:198-202`) dies with the window — inside the 1s
recovery-snapshot delay, so nothing is offered on next launch either.

**Recommendation:** narrow the fix to the state writes. Make the close gate
fail safe — retry `setDirtyState` on failure, or default `rendererDirty` to
true in main and let the renderer clear it — so a dropped dirty-flag push
can't skip the flush. For the remaining prefs sites, count failures and show a
single non-blocking toast after N. No change needed to the buffer flush sites
or to the never-block-quit policy.

### V3. No file associations or deep links — **Medium**

**Evidence:** grep of `electron/` for `open-file`, `open-url`,
`setAsDefaultProtocolClient`, `fileAssociations`: zero matches;
`electron-builder.yml` has no `fileAssociations`/`protocols` block. A
`second-instance` handler *does* exist (electron/main.ts:1697-1702) but it
takes no arguments — it only restores/shows/focuses the existing window, and
nothing under `electron/` ever reads `process.argv`. The gap is deliberate and
documented: electron/appimage-integration.ts:181-185 notes the installed
desktop entry carries no `%f`/`%F`/`%u`/`%U` field code, no `MimeType` and no
custom scheme because "the viewer does not process startup argv (its
`second-instance` handler only focuses the existing window), so advertising
file or URL handling here would register associations that silently do
nothing."

**Impact:** double-clicking a project's `manifest.yaml` or a `.md` chapter
does nothing app-related — the app always opens to last-project/landing.
Non-technical users' primary mental model for "open my document" is
double-click.

**Recommendation:** register an association for `manifest.yaml` is
impractical (generic name), but a `fileAssociations` entry for `.md` plus
`open-file` (mac) / `second-instance` argv (win/linux) handling that opens
the *containing project* would match user expectations. Medium effort;
worth a milestone, not a hotfix.

### V4. Weaker token protection on keyring-less Linux — **Low** *(documented in code, invisible to users)*

**Evidence:** `electron/credential-store.ts:11-13,47-49,91-103` — tokens are
encrypted via `safeStorage` (OS keychain/DPAPI/libsecret) with the file at
`0600`; on Linux without a keyring, Electron's `safeStorage` falls back to
basic obfuscation. The code's header documents this; the UI never mentions it.

**Recommendation:** on that specific backend
(`safeStorage.getSelectedStorageBackend() === "basic_text"`), show a one-time
notice when the user first connects GitHub. No behavior change needed.

### V5. Mis-ordered "not a print-md project" branch, duplicated in the UI — **Low**

**Evidence:** `src/lib/errors.ts:23-26` maps errors matching
`/manifest|print-md\.yaml|No such file/i` to "This doesn't look like a
print-md project…", but a missing manifest never throws — the loader returns
the empty manifest (`manifest.ts:60-66`). So the branch never fires for its
intended case, and instead **shadows** the ENOENT branch beneath it
(`errors.ts:27-29`) for any host error carrying Node's raw "no such file or
directory" text. That is reachable today: a manifest whose `source.files`
lists a file that isn't there raises a raw ENOENT at
`lib/markdown/index.ts:79`, surfaced as
`electron/preview/controller.ts:150`'s "Preview server failed to start:
ENOENT: no such file or directory, open '…'" — and the author is told their
project isn't a print-md project. (The common miss falls through correctly:
`preview/lifecycle.ts:130` throws `Input path not found: …`, which matches the
ENOENT branch.) The same regex is duplicated as live UI logic at
`+page.svelte:539-541`, where it gates the "set it up as a book" CTA on a
failed open (`+page.svelte:2648,2667`) — this is not dead code, and any change
must touch both copies. Separately, `print-md.yaml` is a *documented legacy*
manifest name (`remote-auth/github-repos.ts:123-129`) honoured by
`project-scaffold.ts:382` but absent from `MANIFEST_FILENAMES`
(`manifest.ts:15`); that hand-rolled check also omits `manifest.yml`, so a
`.yml`-only project reads as adoptable and `adoptFolder` writes a second,
lookup-winning `manifest.yaml` beside it (`project-scaffold.ts:425`).

**Recommendation:** move the manifest branch below the ENOENT/permission
branches (or narrow it to an explicit "not a print-md project" host code), and
hoist the shared predicate out of `+page.svelte` into `errors.ts` so the CTA
and the copy can't drift apart. Encode the legacy `print-md` stem in the
shared constant alongside `MANIFEST_FILENAMES` and consume it from
`project-scaffold.ts:382` instead of hardcoding two `.yaml`-only names there.

---

## Part D — What is genuinely well-built (keep these)

For balance, the seams also show deliberate, verified care that should be
preserved through any remediation:

- **Exit-code contract defined in one place** (0/1/2/3, `lib/build-error.ts:23-28`)
  and honored at the exit boundary of all nine commands (`cli.ts:10-21`) — the
  discipline is worth keeping, but it is not yet uniform *in-pipeline*: three
  verified deviations, all reaching the user through `print-md build`. CSS
  findings exit **2** from the build lint gate but **1** from standalone
  `print-md lint` (`build-runner.ts:202`, conceded as the gate's "historic exit
  code" at :190-191; only the standalone case is pinned, `cli-contract.test.ts:156`).
  Missing `gs`/`qpdf` exits **2** although `build-error.ts:14-16` files "missing
  tool" under PIPELINE=3 (`build-preflight.ts:83-86`). Missing Chromium throws a
  bare `Error` rather than a `BuildError` (`chromium.ts:95`, via
  `build-preflight.ts:60`), so `build.ts:61-63` cannot map it — the author gets a
  raw stack trace and exit **1**. Reconciling these three is small work and
  restores the property CI scripts are being told to rely on.
- **No-truncated-PDF policy**: pagination stall detection (60s no-progress)
  and a hard failure instead of shipping a partial PDF
  (`lib/pagination.ts:179-306`).
- **Actionable dependency errors**: the missing-browser error with per-OS
  install commands and an env-var escape hatch (`chromium.ts:91-106`);
  preflight blocks pdfx builds *before* rendering (`build-preflight.ts:48-87`).
- **Non-destructive scaffolding**: `new` never overwrites, degrades git-init
  gracefully, and produces a working project with zero external dependencies
  (`project-scaffold.ts:168-256`).
- **Viewer state integrity**: atomic write-then-rename with corrupt-file
  preservation in the settings, prefs, and credential stores
  (`settings-store.ts:110-137`, `prefs-store.ts:110-135`,
  `credential-store.ts:76-103`) — the crash-draft store (`recovery.ts:97-103,
  115-117`) is the exception, still a plain overwrite plus a silent reset on a
  corrupt index (`recovery.ts:83-95`), and it holds the author's unsaved editor
  buffers; save-dialog-authorized PDF write paths preventing arbitrary-file
  overwrite (`export/controller.ts:130-149`); OS-keychain token encryption
  (V4 covers the basic-obfuscation fallback on keyring-less Linux).
- **Temp hygiene**: PID-marker orphan reaping and timeout-guarded shutdown so
  a wedged chokidar close can't leak temp dirs (`preview/lifecycle.ts:28-68,
  180-235`).
- **Pure-JS git** (isomorphic-git + device-flow OAuth) with no system git/gh
  dependency anywhere — verified, not just claimed.

---

## Prioritized remediation summary

| # | Finding | Severity | Effort | Notes |
| --- | --- | --- | --- | --- |
| 1 | C1 — `gs` name on Windows | Critical | Small | Copy the chromium.ts discovery pattern |
| 2 | D5 — publish checksums | High | Trivial | One workflow step; prerequisite for D9 |
| 3 | C3 — YAML error stack trace | High | Small | One try/catch in the loader |
| 4 | C2 — hardcoded ICC path | High | Small | Embed profile or drop the flag |
| 5 | D2 — Intel mac viewer | High | Small | Explicit `arch` in electron-builder |
| 6 | D3 — mac update notifier | High | Medium | Check-only, no signing needed |
| 7 | V1 — plugin install seam | High | Medium | Registry-tarball fetch, pure JS |
| 8 | C5 — `explicit` inconsistency | Medium | Trivial | Two call sites |
| 9 | C4 — missing manifest never reported | Medium | Small | Fail with guidance in `resolveBuildContext` |
| 10 | C6/C7 — typo handling | Medium | Small | Guarded fallback + unknown-flag reject |
| 11 | D9 — winget/brew/scoop | Medium | Medium | Depends on #2 |
| 12 | C10 — add `doctor` | Low | Small | Backend already exists; high leverage |
| 13 | D7 — Docker spurious `v` tag | Low | Trivial | Normalize the dispatched tag input |
| 14 | V2 — silent UI-state writes | Low | Small | Fail-safe dirty flag; toast after N |
| 15 | D1/D4 — code signing | — | — | **Accepted limitation**; revisit when funded |

Everything not listed (C8, C11–C14, V3–V5, D6, D8) is tracked above with a
recommendation but can ride along with adjacent work.

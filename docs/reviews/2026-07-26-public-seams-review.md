# Public Seams Review — CLI, Viewer, and Distribution (2026-07-26)

## Scope and method

This is a code-only review of print-md's **public seams** — the surfaces a real
end user touches: the CLI commands, the Electron viewer's UI flows, and the
release/install pipeline. Documentation claims (README, guides, CLAUDE.md) were
deliberately ignored; every finding below is grounded in the implemented source,
with file:line evidence. Findings were gathered by parallel code audits of the
four surfaces and then individually re-verified against the source. Items that
could not be verified end-to-end (e.g. behaviors that depend on the `citty`
argument parser's runtime internals) are explicitly marked **inferred**.

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
   binaries, a checksum file is the only integrity signal users have.
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

### D5. No checksums published for any artifact — **High**

**Evidence:** grep of `.github/` for `sha256|checksum|shasum|SHASUMS` returns
nothing; the `github-release` job (release.yml:504-627) attaches binaries with
no integrity file.

**Impact:** combined with D1/D4 (unsigned everything), users and downstream
packagers (brew/winget both *require* hashes) have zero way to verify a
download. This is the cheapest meaningful trust improvement available.

**Recommendation:** one step in `github-release`: `sha256sum dist/* >
SHA256SUMS.txt` and attach it. Print the hashes into the release body too.

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

### D7. Docker image tag can drift from every other artifact's version — **Medium**

**Evidence:** `release.yml:636-643` — the dispatch into `docker.yml` passes
`VERSION: ${{ inputs.version }}` (the **raw, unnormalized** input), while the
tag/package.json/npm all use the normalized version (leading `v` and
`print-md ` prefixes stripped, release.yml:93-101).

**Impact:** dispatching a release as `v1.2.3` (a form the workflow explicitly
accepts and normalizes everywhere else) pushes a GHCR image tagged literally
`v1.2.3`, diverging from the `1.2.3` npm/CLI/release version.

**Recommendation:** one-line fix — pass `needs.version.outputs.version` (the
normalized value) instead of `inputs.version`.

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

### D9. No package-manager distribution — **Medium**

**Evidence:** exhaustive search — no Homebrew formula, Scoop manifest, winget
manifest, install.sh, or Chocolatey package anywhere in the repo.

**Impact:** every install is a manual browser download of an unsigned binary —
the worst possible trust path given D1/D4, and there is no update story for
the CLI at all (the viewer at least has electron-updater on Windows/Linux).

**Recommendation:** free wins, in order of value: (1) winget manifest —
free submission, native `winget upgrade` support; (2) Homebrew tap
(`dimm-city/homebrew-tap`) — solves macOS quarantine for the CLI as a side
effect; (3) Scoop bucket. All three require D5 (checksums) first.

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

### C3. A YAML syntax error in `manifest.yaml` crashes `build`/`preview`/`lint` with a raw stack trace — **Critical**

**Evidence:** `lib/manifest.ts:54-55` — `parseYaml(raw)` has no try/catch, so a
malformed manifest throws `YAMLParseError`. `commands/build.ts:60-65`,
`commands/preview.ts:102-108`, and `commands/lint.ts:46-52` catch **only**
`UsageError`/`BuildError` and re-throw everything else; no
`uncaughtException`/`unhandledRejection` handler exists anywhere in the CLI
(grep-confirmed). Meanwhile `validate`/`audit`/`preflight` catch broadly
(`validate.ts:84-87`, `audit.ts:46-49`, `preflight.ts:237-240`) and print a
clean one-line error. *(Exact terminal rendering depends on citty's `runMain`
wrapper — inferred, not executed — but there is no in-repo handler either
way.)*

**Impact:** hand-editing YAML **is the product's core authoring loop**, and
YAML syntax errors (a stray tab, an unquoted colon in a title) are the single
most likely mistake the target audience will make. The three commands they run
most are the three that handle it worst.

**Recommendation:** wrap the parse site once, in `loadManifestWithPath`:
catch `YAMLParseError` and rethrow as `UsageError` including the filename and
the parser's line/column (the `yaml` package provides `linePos`). That fixes
all commands at once and removes the build/validate asymmetry for this class.

### C4. Missing manifest is silent: `build` in the wrong folder quietly builds an empty book — **High**

**Evidence:** `lib/manifest.ts:60-66` — when no `manifest.yaml`/`.yml` is
found, the loader returns `{ manifest: {}, manifestDir }` with no output
unless `explicit` was set. `build` then proceeds with preset defaults and
writes `dist/book.pdf` (`lib/presets.ts:26-28`, `build-runner.ts:181,465-466`).

**Impact:** a user who runs `print-md build` in the wrong directory gets a
successful-looking run and a near-empty PDF, with no indication that their
actual project was never read. For a non-technical user this reads as "the
tool ate my book."

**Recommendation:** when no manifest is found and no explicit input was given,
`build` should fail with "No manifest.yaml found in <dir> — run from your
project folder or pass the path: print-md build <project-dir>". The live
preview's no-manifest tolerance (lifecycle.ts:139-145) is correct and should
stay — the fix belongs in `resolveBuildContext`, not the loader.

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

### C7. Unknown flag names are (very likely) silently ignored — **Medium** *(inferred)*

**Evidence:** no strict-flag rejection exists anywhere in the CLI source;
commands read only their declared `args.<name>` fields. citty's mri-based
parser does not reject unknown keys, and the repo already hand-patches a
sibling citty gap (`rejectExtraPositionals`, `lib/cli-args.ts:27-50`, whose
doc comment explains citty leaves extra positionals unreported). The existing
`cli-contract.test.ts` covers bad *values* but never an unknown flag *name*.

**Impact:** `--formt html` silently builds the **default PDF** — compounded by
the divergent defaults (C8). The user's intent is dropped without a word.

**Recommendation:** extend the existing `rejectExtraPositionals` pattern with a
`rejectUnknownFlags(args, declared)` helper called from the same 9 call
sites, and add the missing contract test.

### C8. `preview` and `build` have different default formats — **Low**

**Evidence:** `preview` defaults to `html` (live server); `build` defaults to
`pdf` (`build.ts:39`).

**Impact:** mostly reasonable per-command, but it turns flag typos (C7) into
wrong-artifact surprises, and users moving between the two commands must
remember the asymmetry.

**Recommendation:** keep the defaults (they match each command's purpose) but
make each command's first output line state the resolved format — one log line
turns a silent surprise into a visible choice.

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

### C14. PDF/X intermediate files are written into the user's output directory — **Low**

**Evidence:** `lib/ghostscript.ts:128` writes `.pdfx_def_<ts>.ps` next to the
output PDF; `ghostscript.ts:13-17` writes `<pdf>.stripped.pdf` beside the
target before renaming. Cleanup is best-effort `finally`; a crash mid-window
strands them in `dist/`, and no startup reaper covers this pattern (unlike the
preview temp dirs, `preview/lifecycle.ts:47-68`).

**Recommendation:** stage both in the existing OS-tmpdir stage root
(`build-staging.ts:161-163`) instead of the output dir.

---

## Part C — Viewer seams (V)

### V1. "Add npm plugin" doesn't install anything, and the recovery path contradicts the product's premise — **High**

**Evidence:** the add-npm route (`src/routes/api/plugin/add-npm/+server.ts` →
`packages/cli/src/lib/plugin-manager.ts:253-266`) **only writes a manifest
entry**. Resolution then fails in
`packages/cli/src/lib/markdown/plugins.ts:70-76` with instructions to run
`cd <project> && bun add <package>` — auto-install is a deliberate policy
(plugins.ts:34-36). The diagnostics panel doesn't even probe for Node/npm/bun
presence (`lib/diagnostics.ts` checks only chromium/gs/qpdf).

**Impact:** the packaged viewer's premise is "no Bun/Node required" — and its
own plugin UI ends with "open a terminal, cd, and run bun," a toolchain the
user was promised they don't need and almost certainly doesn't have. Only the
four bundled recommended plugins (plugin-manager.ts:85-110) work out of the
box. The reproducibility rationale is sound; the seam it's exposed through is
wrong for the audience.

**Recommendation:** implement in-app install **without any external tool**:
fetch the package tarball directly from the npm registry
(`https://registry.npmjs.org/<pkg>/-/<pkg>-<version>.tgz`) with `fetch`,
extract with a pure-JS untar (the repo already uses `fflate` for the butler
download — the identical pattern), and place it under the project's
`plugins/` dir, recording the exact version in the manifest. This keeps
builds reproducible (pinned version, vendored into the project) and stays
inside the "no external binaries" architecture rule. Interim cheaper option:
expand the bundled recommended set and label npm plugins "requires a developer
toolchain" *before* the user adds one, not after.

### V2. Silent state-save failures and the quit-time flush can drop work with no signal — **Medium**

**Evidence:** repeated `.catch(() => {})` on persistence calls in
`src/routes/+page.svelte` (e.g. lines 227, 749, 1167, 1906 — per-project
state, landing prefs, dirty-state) and on editor-buffer flushes at project
switch/close (lines 471, 1249, 1287, 2146). The close-gate's documented
policy (electron/main.ts:818-824) deliberately drops the final snapshot
rather than blocking quit.

**Impact:** a failed write at exactly the wrong moment loses the last edit
with zero user-facing indication. "Never block quit" is a defensible policy;
"never *mention* it" is not, for an audience that can't diagnose loss.

**Recommendation:** keep the non-blocking policy, add the signal: persist a
"last flush failed" marker (the prefs store's atomic-write machinery already
exists) and surface a one-line notice on next launch ("Your last edit on
<date> may not have been saved"). For the in-session `.catch(() => {})`
sites, count failures and show a single non-blocking toast after N.

### V3. No file associations or deep links — **Medium**

**Evidence:** grep of `electron/` for `open-file`, `setAsDefaultProtocolClient`,
`fileAssociations`, second-instance argv handling: zero matches;
`electron-builder.yml` has no `fileAssociations`/`protocols` block.

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

### V5. Dead/misleading error branch for "missing manifest" — **Low**

**Evidence:** `src/lib/errors.ts:23-34` maps errors matching
`/manifest|print-md\.yaml|No such file/i` to "This doesn't look like a
print-md project…", but the host never throws for a missing manifest (it
returns the empty manifest, manifest.ts:60-66) — the branch is likely
unreachable for its intended case. Also, `project-scaffold.ts:382` treats a
third filename (`print-md.yaml`) as "already a project" that the manifest
loader (`manifest.ts:15`) never actually loads.

**Recommendation:** cleanup pass — reconcile the recognized-filename list and
delete or re-point the dead copy. (If C4's recommendation lands, the branch
becomes reachable and correct.)

---

## Part D — What is genuinely well-built (keep these)

For balance, the seams also show deliberate, verified care that should be
preserved through any remediation:

- **Uniform exit-code contract** (0/1/2/3, `lib/build-error.ts:23-31`) applied
  across all nine commands.
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
  preservation for all stores (`prefs-store.ts`, `settings-store.ts`);
  save-dialog-authorized PDF write paths preventing arbitrary-file overwrite
  (`export/controller.ts:130-149`); OS-keychain token encryption.
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
| 2 | C3 — YAML error stack trace | Critical | Small | One try/catch in the loader |
| 3 | D5 — publish checksums | High | Trivial | One workflow step; prerequisite for D9 |
| 4 | C2 — hardcoded ICC path | High | Small | Embed profile or drop the flag |
| 5 | C4 — silent empty-manifest build | High | Small | Fail with guidance in `resolveBuildContext` |
| 6 | D2 — Intel mac viewer | High | Small | Explicit `arch` in electron-builder |
| 7 | D3 — mac update notifier | High | Medium | Check-only, no signing needed |
| 8 | V1 — plugin install seam | High | Medium | Registry-tarball fetch, pure JS |
| 9 | C5 — `explicit` inconsistency | Medium | Trivial | Two call sites |
| 10 | D7 — Docker tag drift | Medium | Trivial | Use normalized version output |
| 11 | C10 — add `doctor` | Low | Small | Backend already exists; high leverage |
| 12 | C6/C7 — typo handling | Medium | Small | Guarded fallback + unknown-flag reject |
| 13 | D9 — winget/brew/scoop | Medium | Medium | Depends on #3 |
| 14 | V2 — silent save failures | Medium | Small | Marker + next-launch notice |
| 15 | D1/D4 — code signing | — | — | **Accepted limitation**; revisit when funded |

Everything not listed (C8, C11–C14, V3–V5, D6, D8) is tracked above with a
recommendation but can ride along with adjacent work.

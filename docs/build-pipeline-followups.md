# Build / Package / Deploy — follow-up backlog

Tracked items from the 2026-05-30 build-pipeline audit that were intentionally
**not** done in that pass (either because they need a live CI run to validate,
change release policy, or are larger features). Grouped by priority. Items that
were fixed in that pass are not listed here — see the `build:` and `fix(assets):`
commits and `fix(field-guide):` in dc-op-manual.

## High value

### -1. The lib ships no `.d.ts`, so consumers' typecheck can't see its types
`@dimm-city/print-md-lib` builds with `bun build` (JS only) and its package
`exports` has `bun` (src) + `default` (dist/index.js) conditions but no `types`.
Under tsc, the cli/viewer resolve the lib to `dist/index.js` (no declarations),
so every `import type { … } from "@dimm-city/print-md-lib"` errors with "has no
exported member" (~9 errors in `packages/cli/src/commands/*`). The artifacts
build fine (Bun transpiles, ignoring types) and the lib's own index.ts already
`export type`s these, so this is purely a consumer-typecheck gap. **Fix:** emit
declarations in the lib build (`tsc --emitDeclarationOnly --declaration` into
`dist/`) and add a `types` export condition, OR wire up TS project references.
Needs the lib's own pre-existing type error (file-utils `Dirent`) addressed
first for clean `.d.ts`. (Resolving via `customConditions: ["bun"]` is NOT the
fix — it makes the cli recompile lib internals.)

### 0. Standalone binary now runs the full pipeline (RESOLVED — stylelint removed)
stylelint couldn't run inside a `bun build --compile` binary (it loads its ~200
rule modules via a computed-path dynamic `import()` that no bundler can embed,
plus runtime `package.json`/css-tree data reads). Rather than keep a brittle
binary-vs-npm split, **stylelint was removed entirely**. CSS print-safety checks
(remote-url, risky-prop, pagedjs-crash-selector) now run on **postcss**
(`packages/lib/src/lib/printsafe.ts`), which bundles cleanly. The binary, npm
package, and Docker image now run identical lint, and `compile-plugin.ts` is
gone (no source rewrites needed). The general `stylelint-config-standard`
ruleset (block-no-empty, color-no-invalid-hex, etc.) is no longer run — print-md
lints for print-safety only; authors who want full CSS linting run stylelint
themselves.

### 0b. `cross-refs.ts` PDF check never works (`qpdf --list-all-objects`)
The cross-reference check invokes `qpdf --list-all-objects`, which isn't a valid
qpdf option on qpdf 10 or 11 — it always lands in the catch and emits the
info-level "Could not inspect PDF for cross-references." Harmless (info, never
blocks), but the check is dead. **Fix:** use a real qpdf invocation (e.g.
`qpdf --json=1 --json-key=objects` and count `/Subtype /Link`, like the PDF/X
checks now do) or remove the check.

### 1. Release tag/release delete-and-recreate rewrites published history
`release.yml` force-deletes the remote tag (version job) and deletes the
existing GitHub release (github-release job) on re-runs. Repointing a published
tag breaks anything pinned to the old SHA and the source-archive downloads.
**Fix:** fail fast if the tag already exists, or gate recreation behind an
explicit `force` boolean input. Decision needed: re-release policy.

### 2. Supply-chain: no checksums or signatures for the CLI binaries
The release uploads `dist/*` with no `SHA256SUMS`, and `install.sh`/`install.ps1`
download + `chmod +x`/`Move-Item` with zero integrity verification (a curl|bash
root-of-trust gap).
**Fix:** have the release job emit `SHA256SUMS` (and optionally a cosign/minisign
signature) and upload it; have both installers fetch it, verify the hash
(`sha256sum` / `Get-FileHash`) before installing, and abort on mismatch.

### 3. CI quality gates are non-blocking
`ci.yml` carries `continue-on-error: true` on ESLint, Prettier, and the CLI
typecheck, so the pipeline reports green while broken. The CLI typecheck has
known pre-existing errors (see project memory), so enforcement must come *after*
those are fixed.
**Fix:** fix the pre-existing `tsc` errors in the CLI package, then remove
`continue-on-error` from the typecheck (and lint/format) steps so regressions
fail PRs. Consider splitting a required "core" check from advisory lint.

## Medium value

### 4. `publish-npm` rebuilds the lib dist unnecessarily
The npm publish runs `bun run build` in `packages/lib`, but `build:npm` (via the
CLI's `prepublishOnly`) bundles the lib **source** into `dist/cli.js`; the
standalone lib `dist/` is not needed for the publish.
**Fix:** drop the "Build lib dist" step from the `publish-npm` job.

### 5. Playwright installed via a scratch package + npm-warning regex filter
`windows-electron-test.yml` creates a throwaway `package.json`, runs
`npm install playwright --no-save --no-package-lock --ignore-scripts`, filters
stderr with `Where-Object { $_ -notmatch "^npm warn" }`, and copies the test
`.mjs` next to `node_modules` so ESM resolves — all to dodge a `workspace:*`
conflict.
**Fix:** add Playwright as a proper viewer devDependency and run the existing
test runner instead of hand-resolving ESM. (Note: the build preamble of this
workflow was already deduped into `.github/actions/build-viewer-windows-zip`.)

### 6. Examples bootstrap downloads the whole repo tarball, unverified
Both installers pull `/tarball|/zipball` of the entire repo just to extract
`examples/`, every install, with no integrity check, and guess GitHub's
`<owner>-<repo>-<sha>` archive directory name.
**Fix:** ship `examples/` as a dedicated, checksummed release asset
(`print-md-examples.tar.gz`) produced by the release job and fetch that instead.

### 7. `install.sh` carries two JSON parsers for the GitHub API
`resolve_asset_url` has a python3 path **and** a brittle brace-matching `grep`
fallback for the same data.
**Fix:** pick one (prefer `jq` if acceptable as an optional dep; otherwise keep
python3 and delete the regex fallback).

## Low value / nice-to-have

### 8. PR test gate is weaker than the release gate
`ci.yml` runs only `bun --filter @dimm-city/print-md test` (CLI only) while
`release.yml` runs `bun --filter '*' test` (all packages). Align the PR gate to
all packages (the test job already sets up Chrome).

### 9. `skip_npm_publish` defaults to `true`
The default release path silently never publishes to npm. Revisit the default
once the npm Trusted Publisher is configured (see the pure-OIDC publish step).

### 10. `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true` escape hatch
Set in several workflows to force actions onto a newer Node runtime. Remove once
the underlying actions ship native support; at minimum document why it's needed.

### 11. No Windows ARM64 native CLI binary
`install.ps1` ships the x64 exe to ARM64 Windows (x64 emulation). Acceptable, but
add a native `bun-windows-arm64` target to the release matrix if/when Bun
supports it, and document the emulation fallback for users.

### 12. `deploy-dc-design-guide-azure.yml` runs the CLI from source
Deploys via `bun packages/cli/src/cli.ts build …` rather than the shipped binary
or published package, so the deployed output can diverge from what users get.
Consider using the published artifact.

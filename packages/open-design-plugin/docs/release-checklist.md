# Gutterpress Publishing Plugin Release Checklist

Use this checklist for each plugin release. The installable root is `plugin/`;
tests and fixtures must not enter the archive.

## Version 0.2.0 status

- Tested Open Design release: `0.16.1`
- Current upstream reference: `a7e205939d441d29d64e616d6f5ec89c53bb711a`
- Supported distribution: trusted local install
- Marketplace status: not published
- Gutterpress release floor: unreleased branch source; 0.8.3 is unsupported
- Existing-project UI status: host snapshot transport bug; use `od plugin run`
- CLI run context: no Browser-tab attachment or interactive form collection
- Engine floor: declared as `>=0.16.1`, not enforced by Open Design 0.16.1
- Restricted remote status: blocked by Open Design 0.16.1 `pipeline:*` grant gap

## Source checks

- [x] `open-design.json`, `SKILL.md`, README, changelog, references, and evals
  agree on behavior and version.
- [x] `SKILL.md` contains every rule required for a safe run and does not require
  companion files to be addressable from staged skill text.
- [x] The package contains no secret, symlink, generated output, fixture, or
  repository-relative link that breaks after installation.
- [x] The changelog records every user-visible contract change.
- [x] `git diff --check` passes.

## Gutterpress checks

From `packages/open-design-plugin/`:

```bash
bun test
```

From `packages/cli/`:

```bash
bun test src/lib/theme-manager.test.ts \
  src/lib/asset-inline.test.ts \
  src/lib/pagination.test.ts \
  src/lib/markdown/plugins.test.ts \
  src/preview/file-watcher.test.ts \
  src/preview/http-server.test.ts \
  src/preview/lifecycle.test.ts
bun run typecheck
bun run build
```

- [x] Static package contract passes.
- [x] Explicit, implicit, themed, and multi-book fixtures pass.
- [x] Preview recovery and dependency-watch tests pass.
- [x] CLI typecheck and build pass, including render-purity validation.

## Open Design checks

From `packages/open-design-plugin/`, with the current Open Design checkout at
`$OPEN_DESIGN_ROOT`:

```bash
node "$OPEN_DESIGN_ROOT/apps/daemon/bin/od.mjs" \
  plugin validate "$PWD/plugin" --no-daemon --json
node "$OPEN_DESIGN_ROOT/apps/daemon/bin/od.mjs" \
  plugin pack "$PWD/plugin" \
  --out /tmp/gutterpress-publishing-0.2.0.tgz --json
```

Using an isolated Open Design data directory, then run:

```bash
od plugin install "$PWD/plugin"
od plugin info gutterpress-publishing --json
od plugin apply gutterpress-publishing --json
od plugin doctor gutterpress-publishing --json
```

- [x] Validation reports no diagnostics.
- [x] Pack reports only package-root files, no symlinks, and less than 50 MiB.
- [x] Install reports `trust=trusted` and version `0.2.0`.
- [x] Apply succeeds with no inputs and returns the inspect/edit/verify pipeline.
- [x] Doctor has no release-blocking issue.
- [x] The tested digest, byte count, and file count are recorded below.

## Behavioral checks

- [ ] A clear single-book request proceeds without asking the user to repeat
  values that can be safely inferred.
- [ ] An ambiguous multi-book request emits one `gutterpress-brief` question form
  and writes nothing before the response.
- [ ] `theme` scope does not change prose or layout markers.
- [ ] `book-only` scope does not modify shared foundations.
- [ ] Implicit manuscript discovery never receives a new root control document.
- [ ] No run changes `book.html`, `dist/**`, `.od-skills/**`, `.git/**`, or
  `plugins/npm/**`.
- [ ] Every watched source change is judged only after complete pagination.
- [ ] The final response names every changed source file and its ownership.

## Publication checks

- [ ] A canonical public repository or stable monorepo subpath exists at a tag.
- [ ] The required Gutterpress preview changes have a tagged release and the exact
  supported version floor is recorded.
- [ ] The README uses only install commands that actually resolve.
- [ ] Open Design's existing-project snapshot transport is fixed, or CLI-only
  support is explicitly accepted for the release.
- [ ] Restricted pipeline trust is fixed, or the listing is official/trusted.
- [ ] Marketplace submission/review is complete.
- [ ] `od marketplace refresh official` followed by
  `od plugin install gutterpress-publishing` succeeds.

Do not mark or describe the plugin as published before every publication check
passes.

## Validation record

Fill this after the final package bytes are fixed:

```text
Date: 2026-07-28
Gutterpress commit: 70d560145cec21274f7486eb180cf512e21ea776 + release-candidate working tree
Open Design version/commit: 0.16.1 / 4bf9b72404fa1c23c0e20439e13f2a1de9097585
Manifest digest: b044a733fb711b9083616a4d9669209cefaaeb3d34287316e9208eb1b54ea973
Packed archive bytes: 22334
Packed file count: 11
Focused tests: plugin 7 pass; pagination 3 pass; final watcher suite 43 pass
Full tests/build: CLI 2114 pass, 1 skip; typecheck, build, render purity, and diff check pass
Isolated host run: install/info/apply/doctor pass; imported-project fake-agent run succeeded
Known limitations: doctor emits the non-blocking local-skill ref warning; Open Design
  snapshot transport and restricted pipeline grants remain host blockers; Gutterpress
  0.8.3 is unsupported; schema URL and marketplace publication remain external work.
```

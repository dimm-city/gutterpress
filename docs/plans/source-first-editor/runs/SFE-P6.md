# SFE-P6 — Composition roots, public exports, architecture records

## Objective

The plan's P6: make the two composition roots compose instead of own
(`+page.svelte`, `electron/main.ts`), add the justified subpath exports, and
land the architecture records — under the P3e ruling's discipline: extract
only where responsibility and owner are clear, no ceremony, no
one-class-per-file, no DI framework, no generic controllers.

## Sub-runs

- **P6a (Lane A)** — `+page.svelte` composes features. The plan names the
  feature boundaries (project, document/editor, preview, build/export,
  media/assets, publishing, remote/sync, settings/update,
  diagnostics/problems). Much already lives in `src/lib/routes/*-controller`
  modules and capability modules; the work is moving the REMAINING owned
  workflows out to their obvious owners and leaving the root instantiating
  services, coordinating top-level selection, and rendering shells.
  Cross-feature coordination stays explicit in the root — no event bus.
  Source-mutation policy stays in document/editor; build policy in build;
  sync policy in remote/sync.
- **P6b (Lane B)** — `main.ts` keeps lifecycle, windows, OS integration,
  security policy, and service composition. The ~120 `secureHandle`
  registrations move into explicit per-context registration modules
  (`electron/api/*` already hold the handlers — the REGISTRATION blocks
  join them or a thin per-context `register*` function). Flush-before-close,
  second-instance, file-launch, update and security behavior preserved and
  their tests kept meaningful.
- **P6c (Lane C, after A+B)** — public exports and records:
  - `gutterpress/plugins` subpath export (D11-named, with a REAL consumer:
    the desktop's `electron/api/editor-projection` local-file plugin loader
    duplicates `loadPlugins` because the export was missing — SFE-P3e's
    recorded follow-up. Add the export with its dist entrypoint, swap the
    desktop's duplicate for the real loader, delete the duplicate.) Other
    D11 subpaths ONLY where a current consumer justifies them — enumerate
    and justify or decline each in the run report.
  - Package export tests (the export map resolves under Node and Bun;
    `gutterpress/render` stays node-free).
  - `docs/ARCHITECTURE.md` final pass; the six plan-named ADRs added or
    resolved; CODEOWNERS or documented ownership for the four boundaries;
    long historical comments moved to ADRs where they have one, kept as
    concise invariants where they are load-bearing.

## Behavior identity

P6a/P6b are refactors: every suite green, zero behavior change, and the two
roots' line counts recorded before/after in the ledger (Checkpoint D). A
move that would change behavior is reported, not absorbed.

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test && bun run test:browser`
- `cd packages/vscode-extension && bun run test`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build && bun run electron:build`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

<!-- Appended by the review stage. -->

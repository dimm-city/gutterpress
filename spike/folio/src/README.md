# Engine source promoted

The engine source that used to live here (`shared/`, `compiler/`, `viewer/`,
`bundles.ts`, `cli.ts`) was promoted 2026-08-06 out of this spike into
`packages/cli/src/engine/` as **the Gutterpress engine** — the ratified
naming decision retires "Folio" as a standalone name; it is now core to
Gutterpress rendering, not a separate package. See
[`../MIGRATION.md`](../MIGRATION.md) "Step 3 — integration spike results"
for what changed and why.

- Node-side (`shared/`, `compiler/`): `packages/cli/src/engine/{shared,compiler}`
- Browser-side (`viewer/`, the compiler agent): `packages/cli/src/engine/viewer`
  and `packages/cli/src/engine/compiler/agent.ts`, prebuilt to
  `packages/cli/src/assets/engine/{folio.js,folio-agent.js}` by
  `packages/cli/scripts/build-engine-bundles.mjs` and embedded via
  `with { type: "file" }` (root `CLAUDE.md` §4).
- The standalone dev CLI (`cli.ts`) moved to `packages/cli/src/engine/dev-cli.ts`.
- `spikes/`, `fixtures/` (this repo's verification harness) now import the
  engine from its new location — see `spikes/bundles.ts` for the spikes' own
  on-demand bundle rebuild.

**Known dangling reference, left as a TODO, not fixed by this promotion**:
`compare/run.ts` and `compare/diff-report.ts` still statically import from
this now-empty `src/` (`../src/bundles.ts`, `../src/shared/*.ts`,
`../src/compiler/build.ts`). `compare/**` is out of this promotion's scope
(a concurrent task owns it) — those imports need retargeting to
`packages/cli/src/engine/...`, the same way `spikes/*.ts` and
`fixtures/migration/runner.ts` were updated.

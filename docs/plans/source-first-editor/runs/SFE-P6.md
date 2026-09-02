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

Three batches over `b7242a71..HEAD` (P6a `fa8ea498`, P6b, P6c `52d099b3`),
two rounds. The reviewer independently re-derived the run's central identity
claim before judging anything else: the 120-channel IPC surface is
byte-identical before and after (full-tree channel extraction at `b7242a71`
vs HEAD, diff clean), all 26 `register*Handlers` are actually composed in
`main.ts`, and both roots shrank as claimed.

Round 1: **needs-repair, 7 CONFIRMED** — (1) a live CI break: the new
`package-exports.test.ts` hard-throws without a built `dist/`, and CI's
`test` job never built one; (2) an architecture regression: P6b gave
`electron/api/updater.ts` a top-level value import of `../updater` (which
imports `electron`), breaking the hooks-only registrar pattern —
`updater-ipc.test.ts` failed standalone and was green in-suite only through
cross-file `mock.module` leakage; (3) the `.finally` epoch guard in
`RichDocHostController` was mutation-provably untested (reviewer removed the
guard; 12/12 stayed green) while the ledger claimed the replacement covered
the same races; (4) `preload-surface.test.ts` counted registrars that were
never invoked toward the 120; (5) `package-exports.test.ts` was a
self-referential oracle — deleting a subpath deleted its own coverage,
contradicting its header; (6) ADR 0013 described seven hunks / one seam
against PATCHES.md's ten hunks / two patches, omitting Patch 2's core
render-loop change; (7) the ledger's stale-ADR decline was proven on a
subset presented as repo-wide, and this run created a new file citing the
nonexistent ADR 0006. Plus 26 advisories (recorded in the workflow journal;
notable ones disposed below).

Repair round 1 (`de4445d2`): all seven fixed — CI gains a
`bun run build:library` step before the cli test filter; `applyNow` joins
`UpdaterHooks` so `api/updater.ts` imports no Electron (isolate run
8 pass / 0 fail, whole `tests/platform` clean under `--isolate`); a new
epoch-guard race case (reviewer re-mutated the guard: that test and only
that test fails); `preload-surface.test.ts` asserts every exported
`register*Handlers` is called in `main.ts` (mutation-proven, >20 liveness
floor); the export test pins `SUBPATHS` to the literal set
`{'.', './api', './render', './plugins'}` × `['default','types']`
(sabotage-proven: deleting `./plugins` from package.json fails exactly one
assertion; 18 pass); ADR 0013 rewritten to the ten-hunk / two-patch reality
with the removal trigger restated as two independent conditions; the
stale-ADR decline re-proven repo-wide (106 files / 193 occurrences, every
number independently reproduced) with per-area dispositions, and the
dangling ADR 0006 citation replaced with the issue number plus a footnote to
ADR 0009's predecessor note.

Round 2: **approve**, 0 confirmed, 2 advisories — both record-accuracy:
the ledger's P6c verification table kept the pre-repair 17-pass count
(annotated in place at close-out, historical counts preserved), and the
repair report attached the full-suite counts (163 files / 5915 pass) to the
`--isolate tests/platform` command, whose true counts are 109 files /
1495 pass / 1 skip / 0 fail — the underlying green claim held under the
reviewer's re-run. Regression checks at approve: root typecheck clean,
desktop 5915 pass / 1 skip / 0 fail, `tests/platform` clean under
`--isolate`, package-exports 18 pass.

Advisory dispositions (integrator): the missing `check:package-exports`
script named by the plan's P7 gate is carried into the SFE-P7 spec as
explicit work (the plan names it; today the coverage lives in
`bun run test`'s integration file); the capability-module-count staleness,
registrar-enumeration omissions, and rename fossils are recorded here as
non-blocking record debt; the keystroke-drop window during deferred publish
is already tracked under the D13 follow-ups. None block P6's
behavior-identity claim, which the reviewer verified independently of the
records.

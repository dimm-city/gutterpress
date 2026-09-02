# SFE-P7 — Decision-record close-out and final acceptance sweep

## Objective

The plan's P7: prove the agreed scope is complete and leave an auditable
release-ready state. This run produces RECORDS and EVIDENCE, not features:
zero-remnant verification, the deletion ledger's final measured
before/after, resolved proposal records and cross-referenced ADRs, the
changelog and release notes, the architecture doc, the real-book and
packaged-product sweeps, and the report-only final acceptance sweep over
all 24 criteria.

The SFE-P3e product-owner ruling stays binding: no new machinery. Where
the plan names a gate script that does not exist
(`check:package-exports`, `check:no-prosemirror`, `check:no-preview-editing`,
`check:no-desktop-pwa`, `check:no-desktop-http`), the disposition is a
**recorded name→command mapping** with evidence that the existing command
covers the named property — NOT five new alias scripts. Today's coverage:
`check:architecture` rule 1 is the prosemirror ban, rule 2 is the desktop
route ratchet at baseline 0 (no desktop HTTP), and
`packages/cli/tests/integration/package-exports.test.ts` (18 cases, pinned
surface) is the package-exports gate; no-preview-editing and
no-desktop-pwa are absence properties proven by the P4/P5a deletion-ledger
greps, re-run and re-recorded by Lane A below. The sweep reviewer verifies
every mapping's coverage claim; if one is genuinely uncovered, that is a
finding, not a reason to add scripts unilaterally.

## Honest state carried into this run (do not launder)

- **AC-24 is Measured — NOT met** (D13: 250 KiB p95 <100ms budget; real
  p95 ~551–632ms; root cause in the vendored fork; three ordered
  follow-ups recorded in the SFE-P3f close-out). The acceptance sweep
  records FAIL with that evidence — not "deferred", not NA.
- **AC-16's packaged-asar smoke half is open.** Lane C makes the real
  attempt this run; if this sandbox cannot drive a packaged Electron app,
  the record shows the exact commands attempted and the exact failure.
- **A11y gaps** from the P3d sweep (no ARIA landmark on the rich surface;
  no `<main>`/skip-link) are open items, recorded as such.
- **Real-VS-Code activation** deviation: `@vscode/test-electron` is
  network-blocked in this sandbox; extension evidence is the harness suite.
- Record debt named in Checkpoint D advisory 4 (stale capability counts,
  registrar enumeration omissions, rename fossils, ADR 0015/0016 "all
  moved" phrasing) — Lane A fixes items that are one-line record
  corrections in files it owns; anything wider is recorded as an open
  advisory, not silently absorbed.

## Lane ownership

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A — remnants, ledger, ADRs | `docs/plans/source-first-editor/deletion-ledger.md` (final section + one-line record corrections), `docs/adr/**`, `docs/plans/source-first-editor/runs/SFE-P7.md` (its lane report section only), proposal/plan records under `docs/plans/**` EXCEPT acceptance.md | `docs/plans/source-first-editor/acceptance.md`, `CHANGELOG.md`, `docs/releases/**`, `docs/architecture/**`, any production or test file | Zero-remnant proof set; nine-metric measured before/after; proposal records resolved ACCEPTED/RESOLVED/SUPERSEDED; ADR cross-references; final commit SHAs |
| B — release records | `CHANGELOG.md`, `docs/releases/0.11.0.md`, `docs/architecture/source-first-editor.md`, `docs/plans/source-first-editor/acceptance.md` (matrix implementation-location/evidence columns ONLY — not the final sweep section) | `deletion-ledger.md`, `docs/adr/**`, any production or test file | Changelog + release notes grounded in git history; the architecture doc; acceptance matrix rows carry implementation locations |
| C — sweeps | `docs/plans/source-first-editor/p7-sweeps.md` (new evidence doc) | Everything else — this lane is evidence-only; a defect found is REPORTED, not fixed | Real-book sweep, packaged-product sweep incl. the packaged-asar smoke attempt, release checks (`dist:linux` attempt, `npm pack --dry-run`), plan-gate name→command mapping table with each command actually run |

Lane details:

- **Lane A.** Zero-remnant verification is repo-wide (the P6 lesson: a
  subset presented as repo-wide is a confirmed finding) — for each deleted
  surface (preview mutation protocol v≤8 message names, `InlineEditController`,
  `CommitEngine`, `WebAdapter`/PWA (service worker, manifest, IndexedDB
  persistence), `getPlatform`/`ElectronAdapter`/`HostServices`,
  `src/routes/api`/`+server.ts`/`src/lib/api.ts`, `sveltekit-host`, bearer
  token, loopback proxy) run the greps repo-wide, paste command + output,
  and classify every hit (the accepted residual classes from the P4 D15
  ruling: absence-asserting tests and version-history comments). Ledger
  metrics: production LOC, test LOC, module/file count, dependency count,
  platform method count, desktop HTTP route count, IPC handler count,
  preview protocol message count, architecture-check count — before from
  `baseline.md`/P0a at the recorded baseline SHA, after at HEAD, each with
  the exact derivation command, both sides derived the SAME way. Final
  commit SHAs: the full run list from the program base to HEAD.
- **Lane B.** CHANGELOG and release notes describe user-visible and
  contract-level changes derived from the actual run history (the run
  specs' Run result sections + acceptance entries), written for
  Gutterpress users (authors and desktop users), not for reviewers of this
  program. `docs/architecture/source-first-editor.md` is the plan-named
  final output: the source-first architecture as it now IS (document
  session, sparse projection, plugin origin/trust, rich-mode desktop
  wiring, VS Code extension, read-only preview), pointing at ADRs 0011–0016
  — descriptive, not historical narrative.
- **Lane C.** Every command actually run, with exit code and counts; a
  sweep that cannot run in this sandbox records the attempt verbatim.
  Real-book: the parity gate (empty allowlist) plus builds of the user
  guide, the with-design-guide example, and the validation example.
  Packaged: `electron:build` then `dist:linux` attempt; on success, drive
  the packaged app far enough to prove the asar-served renderer loads a
  project (the AC-16 open half); on sandbox failure, record exactly where
  it stopped. `npm pack --dry-run` for packages/cli, verifying the file
  list matches the pinned export surface. Win/mac dist are CI-runner work:
  record as such, per the plan ("record which runner produced each
  result").

## Review dimensions

- Re-derive every number in every record this run writes — ledger metrics,
  changelog claims, sweep counts — from git and from re-run commands, not
  from the lane reports. This program's reviews have repeatedly caught
  fabricated quotes, stale SHAs, and subset-as-whole claims; P7's entire
  value is that its records survive that scrutiny.
- Verify each zero-remnant grep is actually repo-wide, its residual
  classifications match the D15 ruling, and no deleted-surface name is
  missing from the sweep set.
- Verify the plan-gate name→command mappings: does the named command
  actually prove the named property, and did it run in this tree?
- Verify CHANGELOG/release notes claim nothing the diff does not support,
  and omit nothing contract-level (export surface, plugin API stance,
  preview read-only, VS Code extension).
- Verify Lane C's sweep evidence is from commands actually run — "do not
  summarize a partially run gate as green" is a plan requirement.

## Acceptance sweep (after review approve)

A separate report-only stage: ONE reviewer lane (Opus) walks all 24
criteria in `acceptance.md` and writes the final sweep section — per
criterion: implementation location, test/fixture evidence, search evidence
where absence matters, gate evidence, security evidence, performance
evidence, and final status PASS / FAIL / NOT APPLICABLE with rationale.
"A criterion without evidence is not complete." AC-24 is FAIL with the
measured numbers; any criterion whose evidence cannot be produced in this
sandbox states what ran instead and what remains for CI. Write ownership:
`docs/plans/source-first-editor/acceptance.md` (final sweep section) only.

## Gate

The full program gate, one last time, at the final SHA:

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test && bun run test:browser`
- `cd packages/vscode-extension && bun run test`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build && bun run electron:build`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

(Release checks — `dist:linux` attempt, `npm pack --dry-run` — run inside
Lane C with their results recorded in `p7-sweeps.md`, not repeated here.)

## Review log

<!-- Appended by the review stage. -->

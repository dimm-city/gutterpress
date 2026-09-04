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
  registrar enumeration omissions, rename fossils, ADR 0016/0017 "all
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
  wiring, VS Code extension, read-only preview), pointing at ADRs 0012–0017
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

## Gate results

PASS — all 16 commands exit 0 at `dfe75b91` (the final verified SHA;
close-out documentation commits follow it, touching no code): install
(frozen, 806 packages); typecheck (4 workspaces); cli build (render-pure)
+ 1931 pass / 60 skip / 0 fail (skips are the expected no-Chromium/no-qpdf
sandbox set); editor 3038 unit + 121 browser (9 suites); vscode-extension
228; desktop 5915 pass / 1 skip / 0 fail + check (693 files, 0 errors) +
lint + build (adapter-static, purity 144 files) + electron:build
(`node --check` clean); architecture 4/4; generated-files (1,271 tracked);
vendored (24 unpatched byte-identical + 2 patched, 26 hashes / 33 files);
knip clean.

CI at the same SHA (`dfe75b91`, run 33583966490): **all four jobs green**,
with the Test job's "Preview/print parity gate" step completing SUCCESS
(14s) on a runner with real Chrome and Ghostscript/qpdf — the parity gate
is green AT the final SHA, closing the sweep's one "remains for CI" item
on AC-21 and the F-1 bottom-line caveat.

## Run result

The program's close-out is auditable end to end: repo-wide zero-remnant
proofs for every deleted surface with per-hit classification; the
nine-metric measured before/after, every number carrying its derivation
command (routes 104→0, IPC 12→120, protocol messages 5→0, locator members
31→0, architecture checks 0→4+3, with production/test LOC and
module/dependency counts split baseline-scope vs whole-workspace and the
vendored fork a stated exclusion); a verified 21-run SHA chain; release
records (CHANGELOG 0.11.0, `docs/releases/0.11.0.md`,
`docs/architecture/source-first-editor.md`) whose every claim survived an
adversarial re-derivation; the packaged-asar smoke closed with a real
electron-builder build and headless launch; and the 24-criterion
acceptance sweep at 23 PASS / 1 FAIL (AC-24, carried openly) / 0 NA. The
review cost three rounds precisely because record accuracy IS this run's
deliverable — including findings against the integrator's own fixes.
Commits: `ea2610b3` (lanes + integrator fixes), `86e97f61`/`131a65e5`
(repairs), `e10b7059` (review log), `dfe75b91` (sweep + F-1 fix).

## Review log

Two batches over `2ba5ca0a..HEAD` (lanes + integrator fixes, `ea2610b3`),
three rounds. The reviewer re-ran every load-bearing grep, git range, and
file read itself.

Round 1: **needs-repair, 11 CONFIRMED, 11 advisories.** The dominant
failure mode: records disagreeing with the tree they shipped with, inside
one commit — (1) ledger §5 said the four stale-comment defects were "not
fixed" while `ea2610b3` fixed all four; (2–3) two of the integrator's own
fixes introduced fresh instances of the defect class they fixed —
`render.ts`'s new header cited two type-only importers as browser *value*
importers and missed the real one (`+page.svelte`), and `assemble.ts`
swapped a nonexistent `WebAdapter` consumer for a nonexistent desktop-SPA
consumer (`assembleBookHtml` has zero browser call sites); (4) the
`platform.ts` fix left five `Web:`/`0.6.0` residues in the file it edited —
root cause: the sweep matched the identifier `WebAdapter`, not the concept,
which is also why (8) a dozen more same-class files were missed, three in
the published package; (5) CHANGELOG + release notes claimed
`gutterpress/render` unchanged when it gained the program's central new
projection surface; (6) release notes and architecture doc said the parity
gate "proves" agreement while this run's own sweep records it BLOCKED with
no green run in the program's evidence; (7) the p7-sweeps §4.3/§4.4 grep
breakdowns did not reproduce and §4.3's pattern missed 3 of 5 deleted
protocol messages; (9) ledger §2.5 scored the vendored fork as "no fork
needed, 0 LOC" against ADR 0014 and its own §2.8; (10) the architecture
doc mis-dated the `check-parity.mjs` deletion; (11) the release notes'
P5a "~−3,100" contradicted the ledger's audited −2,546.

Repair round 1 (`86e97f61`): all 11 addressed — consumer lists re-derived
from actual imports, capability framing ("CAN run in a browser host; no
browser caller today"), the `"web"` discriminant arm deleted, ledger §5
given an explicit disposition naming `ea2610b3`, the three laundered
release claims corrected against the program's own evidence, §4.3/§4.4
re-run with reproducible per-file counts under the real three-class D15
ruling, the fork honestly recorded as a stated LOC exclusion (17 tracked
files), and the same-class sweep extended through 13 more files.

Round 2: **needs-repair, 1 CONFIRMED** — the extended sweep still fixed
instances rather than performing the enumeration §5.5 itself prescribes:
three present-tense "SvelteKit server routes" comments survived in the
published package (`manifest-config.ts`, `manifest-doc.ts`, `index.ts`)
plus `create-host-bridge.ts`. Repair round 2 (`131a65e5`): the four fixed,
and the full enumeration actually run — every surviving hit read in
context and classified (dated version-history prose, accurate SPA
framework naming, or the CLI preview server's own still-live `/api/status`).

Round 3: **approve, 0 confirmed, 2 advisories** (one loose-but-sanctioned
wording; enumeration scope excluded docs/ and tools/, spot-checked clean).
The reviewer verified round 2's fixes in the tree, re-ran both enumeration
commands at HEAD, and re-checked repo typecheck (4 workspaces) and
`check:architecture` (4 rules) green.

After the approve, the report-only acceptance sweep (its own stage) walked
all 24 criteria: **23 PASS (7 with explicit scope), 1 FAIL (AC-24), 0 NA**
— the full per-criterion record is acceptance.md's "Final acceptance sweep
— SFE-P7" section. The sweep also caught F-1, a live CI break the round-2
repair itself introduced: the literal specifier text in a rewritten header
comment tripped the runtime-deps scanner. Fixed at `dfe75b91` (comment
reworded; test re-run locally, 1 pass).

Advisory dispositions (integrator): "CHANGELOG dates a 0.11.0 release with
no version bump anywhere in the tree" — correct and intended: the version
bump and publish are stakeholder release actions, listed as such in the
wrap-up, not this program's to take. "PlatformAdapter is dead exported
surface" — recorded as a follow-up candidate (removing a public export is
a contract change outside this program's scope). The p7-sweeps §4.3
total's self-referential growth (242→246 as the ledger discusses the
identifiers) is the sanctioned class its §4.4 note describes. Remaining
record-nit advisories are recorded in the workflow journal.

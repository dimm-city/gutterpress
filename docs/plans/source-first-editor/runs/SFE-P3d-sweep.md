# SFE-P3d-sweep — Interaction, accessibility, performance; Checkpoint B

## Objective

The half of the plan's P3d that SFE-P3d-parity deferred: prove the product
bar "through real interaction, not only parser and model tests" — the
twenty required scenarios, the accessibility review, and the D13 performance
budgets — and assemble **Checkpoint B** (the report the plan requires before
the deletion phases).

## Governing posture — audit first (product-owner ruling, SFE-P3e)

Most of the twenty scenarios already have evidence from P1b/P2a/P2b/P2c/
P3ab/P3d-parity/P3e/P3c. Re-proving green scenarios is machinery. Every lane
therefore starts with an **audit**: map each owned scenario to the existing
test that already proves it (file + test title, verified by reading the test,
not its name), and build ONLY for the genuine gaps. The audit table is a
deliverable — it becomes Checkpoint B's parity-evidence appendix.

## The twenty scenarios (plan P3d, verbatim), with owners

| # | Scenario | Owner |
|---|---|---|
| 1 | type ordinary text | A |
| 2 | format selection | A |
| 3 | insert and modify image | A |
| 4 | create/edit table | A |
| 5 | use slash menu (or the product's actual insertion affordance — audit what exists; if no slash menu was ever built, say so rather than inventing one this run) | A |
| 6 | move block by keyboard and pointer | A |
| 7 | activate/deactivate plugin region | A |
| 8 | edit near generated content | A |
| 9 | paste rich/plain text | A |
| 10 | IME composition | A |
| 11 | screen-reader landmarks and labels | C |
| 12 | external file change while active | A |
| 13 | stale source edit rejection | A |
| 14 | source/rich mode switch | C |
| 15 | file switch | C |
| 16 | undo/redo within current mode | A |
| 17 | oversized file source fallback | A |
| 18 | untrusted VS Code workspace fallback | A |
| 19 | dispose/remount without leaked listeners | A |
| 20 | 25 KiB / 100 KiB / 250 KiB / 1 MiB performance runs | B |

## Binding decisions

- **D13** — on this environment's runner: repeated ordinary typing in a
  250 KiB document must hold p95 edit-to-paint under 100 ms after warm-up.
  Record real numbers for all four sizes; a budget miss is reported as a
  finding with the measurement, never tuned away by weakening the measure.
  This sandbox is not the project's CI reference runner — record absolute
  numbers AND the environment caveat; the budget verdict here is
  provisional evidence, not the final CI-runner word.
- **AP-21/G-12** — a measurement harness must prove it measures (a
  deliberately slowed control must blow the budget); an a11y assertion must
  prove it can fail.
- **P3e ruling** — no new machinery where an existing harness serves. The
  editor browser harness, the desktop unit patterns, and the existing
  `tests/integration/*.pw.mjs` Electron driver are the sanctioned vehicles.
- **Honesty about the sandbox** — the packaged-Electron scenarios run only
  if the existing driver actually launches here. A lane that cannot launch
  it records the exact command and failure and proves the scenario at the
  highest level it CAN reach, stating the gap plainly.

## Lane ownership (A, B, C in parallel — disjoint)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/editor/tests/**`, `packages/vscode-extension/tests/**`, `docs/plans/source-first-editor/p3d-sweep-audit.md` (§A) | production source anywhere, `packages/desktop/**`, other lanes' files | Scenario audit §A + gap closures for scenarios 1–10, 12, 13, 16–19 at the editor/extension level |
| B | `packages/editor/tests/perf/**`, `docs/plans/source-first-editor/p3d-sweep-audit.md` (§B) | production source, other lanes' files | The four size runs + the 250 KiB p95 budget, with a slowed control |
| C | `packages/desktop/tests/**`, `docs/plans/source-first-editor/p3d-sweep-audit.md` (§C) | production source, `packages/editor/**`, `packages/vscode-extension/**` | A11y audit + gaps (11), desktop-level scenarios (14, 15), and the packaged-driver probe |
| Integrator | `bun.lock`, wiring, commits, Checkpoint B | — | Verification, commits, the Checkpoint B report |
| D | `packages/editor/src/vscode-adapter/**`, `packages/editor/src/web/**`, `packages/editor/tests/**` (perf + regression), `docs/plans/source-first-editor/p3d-sweep-audit.md` (§D) | `packages/cli/**`, `packages/desktop/**`, `packages/vscode-extension/**`, `packages/editor/src/core/**`, `src/gutterpress/**` | D13 budget root cause: find why edit-to-paint scales linearly with document size, fix it at the root, re-measure |

**Lane D was added after lanes A–C reported** (spec amended before it runs).
Cause: Lane B's measurement is a real product finding — the 250 KiB p95 is
5.5–6.3× over D13's budget, and edit-to-paint is near-linear in document size
(~2.1 ms/KiB across 25 KiB→1 MiB), the signature of a whole-document cost on
every keystroke. The fork's own parser supports incremental
`parse(text, previous, edit)`, so the linearity most plausibly lives in OUR
adapter/mount glue (e.g. the host-echo path replacing the entire model text on
every accepted edit). Per the product-owner ruling this is fixed at the root,
not recorded and walked past; per D13, never by weakening validation or
safety.

All three lanes append to ONE audit document, each in its own labeled
section — no shared lines.

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/editor && bun run test && bun run test:browser && bun run test:perf`
- `cd packages/vscode-extension && bun run test && bun run test:browser`
- `cd packages/desktop && bun run test && bun run check && bun run lint`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Checkpoint B

<!-- Assembled by the integrator at close-out. -->

## Review log

<!-- Appended by the review stage. -->

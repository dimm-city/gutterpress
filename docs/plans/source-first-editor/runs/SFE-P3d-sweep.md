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

## Review log

Combined review of SFE-P3d-sweep lanes A–D and SFE-P3f (`bc98a23f..f3e6f2e4`),
four batches, three rounds. Round 1: **9 CONFIRMED** — the highest-stakes one
being that **fork Patch 2 was fast but wrong**: it cached a block's
visual-line map without keying on `absoluteStart`, so after any edit,
pointer→offset and caret math were wrong for every block downstream — and no
test in the tree could detect the class (the 118 green browser tests never
re-query pointer math on a reused block after an edit). Also confirmed:
PATCHES.md's correctness proof was false as written; the upstream draft was
"ready to file" on the same false argument; the audit's headline 45–50%
improvement was measured on the incorrect implementation; the perf control
and echo-guard liveness checks were vacuous; a mis-nested audit section; and
an over-claiming test title.

Repair round 1 fixed the patch soundly (`absoluteStart` equality joins the
reuse guard; fallback to full remeasure), added the missing defect-class
test (fails against the pre-fix bytes, verified live), corrected every
governance document, made the control differential, and **withdrew the
performance win**: with the correct guard, typing early in a document
invalidates every downstream block's cache, so the re-measured 250 KiB p95
(551.8–577.0 ms over three invocations) is statistically the unpatched
baseline. The patch's mechanism is real for genuine end-of-document typing
(4 `Range` calls/keystroke, verified) — the benchmark's own navigation
defect (`drive.ts`'s click+End lands at ~937 of 256,018 characters) means
every recorded run measures near-start typing, which is the honest
worst case for the corrected patch.

Round 2 confirmed one residual (PATCHES.md's new fallback-over-shift section
stated the opposite of what was measured; fixed in `d1b6e573`); round 3:
**approve**, 0 confirmed, 1 advisory (a pre-existing prototype claim
elsewhere in PATCHES.md, recorded).

After the gate exposed a drift false-negative in the sequential differential
control (a contention-inflated baseline compressed the measured delta to
63.3 ms of an injected 150 ms), the control was made interleaved — the
condition alternates per keystroke so load drift cancels — and now measures
the injected 150 ms as 151.1/123.6/144.2 ms across three runs (`873e9d94`).

## Gate

**PASS on 18 of 19 commands; the 19th is red by design.** install; typecheck
(4 workspaces); cli build + 1913:60; editor 3038 unit + 121 browser (9
suites) + purity; vscode-extension 228 + 35 browser + build; desktop 6045:1 +
check (896 files) + lint + build (render purity); vendored (Patch 2 hashes);
architecture (route ratchet 104 == 104); generated-files; knip — all exit 0.
`test:perf` exits 1 on exactly the two 250 KiB D13 budget assertions
(fresh confirmation run: p95 545.5 ms vs 100 ms), with the interleaved
control and both mechanism guards green. That red is the recorded state of
AC-24, not a defect in the gate.

## Checkpoint B — the plan's pre-deletion report

**Editor/fork decision.** D5's compatibility gate ran all eight cases
against the published `@vscode/markdown-editor` 0.0.2-84 in real Chromium;
case 4 (a generic custom-block render hook) is structurally absent, so the
package is vendored as a byte-pinned fork with exactly two patches, each
documented hunk-by-hunk in PATCHES.md and re-hashed in checksums.json:
`renderCustomBlock` (Hunks 1–7) and identity-cached measurement (Patch 2,
corrected in review). Two upstream issue drafts stand ready; filing them is
the fork's removal trigger.

**Desktop behavior.** Rich mode runs the shared mount over
`DesktopDocumentHost`; the projection is built host-side, plugin-aware and
trusted, over validated IPC (SFE-P3e); the parity matrix maps all 13
preview-mutation actions to tested replacements with zero waivers; 28 real
chapters round-trip byte-identically; preview navigation is proven separable
from the mutation surface P4 deletes.

**VS Code behavior.** The same mount runs as a custom text editor:
`TextDocument`/`WorkspaceEdit`/native undo, stamped one-in-flight
reconciliation passing the shared contract suite under latency and
rejection, workspace-trust-gated plugins with path containment, CSP'd
webview proven in real Chromium. Recorded deviation: real-VS-Code activation
via `@vscode/test-electron` is scaffolded but network-blocked in this
environment.

**Parity evidence.** The five-condition parity gate: 1–4 green on derived,
sabotage-proven evidence; condition 5's designated blocker (plugins in the
rich editor) closed by SFE-P3e. The twenty P3d scenarios are audited in
`p3d-sweep-audit.md` with per-scenario citations; five gaps were closed and
three product facts pinned as-is (paste is plain-text-only; no pointer-drag
block movement exists; no slash menu exists outside the desktop toolbar).

**Security review.** Plugin execution host-only (bundle-scan proven, P2c);
CSP with per-render nonce, fixed base, dist-scoped roots, both-side message
validation, sanitized wire errors, and workspace-root path containment with
an escape-refusal fixture (P3c); renderer-boundary IPC validation (P3e);
no secrets or absolute paths in projections, diagnostics, or messages.

**Accessibility review.** Focus reachability, keyboard escape hatch, and
arrow-caret behavior proven against the real fork (P1b); desktop landmarks
asserted in the package's established convention with a can-fail control.
**Open items for the product owner:** the rich-editing surface has no ARIA
landmark role anywhere in the stack, and the shell has no `<main>` landmark
and no skip-link. Recorded, not fixed — production changes beyond the
sweep's scope.

**Performance results.** 25 KiB is within the 100 ms p95 budget; 100 KiB,
250 KiB (p95 ~545–632 ms) and 1 MiB (p95 ~2.3 s) are not. The measured cost
is inside the vendored fork and scales with document size; the sound Patch 2
helps end-of-document typing only. Named follow-ups, in order: fix the
benchmark's navigation defect; implement the delta-translation variant
(option b) so mid-document typing also reuses cached maps; then re-profile
the residual (the EditContext input-path suspect is located, not proven).
All numbers carry the caveat that this sandbox is not the CI reference
runner; the assertion stays red until the numbers are real.

**Approval to enter deletion phases.** Conditions the plan names for P4 are
met: the parity gate is green and its designated blocker closed. The one red
item, the D13 budget, does not interact with what P4 deletes (preview
mutation), and deleting preview editing neither worsens nor masks it.
Proceeding to P4 under the product owner's standing directive to complete
the remaining phases, with this checkpoint recorded for their review — the
perf follow-ups remain open work, not waived work.

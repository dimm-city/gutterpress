# SFE-P2c — Project plugins, transform origin, and trusted rendering

## Objective

Support representative project-plugin regions safely: plugins execute
**host-side only**, their output reaches the projection through the existing
trusted pipeline, a minimal evidence-based origin mechanism maps
consumed-and-generated regions to authored source, and everything it cannot
prove **refuses by rule name** rather than guessing.

## Allowed behavior changes

- `createEditorProjection` gains plugin-awareness: `plugin-region` blocks
  (the kind reserved in P2b) become real, and origin diagnostics gain
  rule-named refusal reasons.
- New origin module in `packages/cli` (browser-safe, inside the render graph).
- `packages/editor/src/gutterpress` gains inactive/active plugin-region views.
- No change to the plugin loader, its security model, or rendered book output.

## Behavior that must remain unchanged

- `packages/cli/src/lib/markdown/plugins.ts` — the loader, its vendored-tree
  verification, and its fail-fast/degrade-and-report modes are untouched.
- Rendered book/preview/PDF output byte-identical.
- Every existing suite, the fork patch surface, P2b's block/generated-view
  behavior for non-plugin documents.

## Binding decisions

- **D6/G-05** — origin comes from parser/plugin *events* and exact object or
  range evidence. **Never** from rendered DOM, text equality, tag matching,
  token gaps, visual position, or approximate line counts. Ambiguity → typed
  refusal naming the rule → source-mode fallback.
- **D12** — project plugin code executes in the **host**, never in the editor
  webview. Plugin-produced HTML is inert in the editor (P2b's inert-text
  posture continues; no hand-rolled sanitizer). No secrets in projections.
- **§5 (CLAUDE.md)** — plugins stay plain markdown-it plugins. **No
  Gutterpress-specific plugin API**, no host-injected `ctx`, no required base
  class, no plugin-side opt-in the editor depends on. Origin must work for
  plugins that know nothing about the editor.
- **AP-05/AP-06** — do not reconstruct source from generated output; do not
  treat transformed token attributes as authored attributes.
- **AP-07** — support source-backed regions *generically*; fail closed only
  where origin or edit behavior is genuinely ambiguous. Refusing every unknown
  plugin token (PR 158's first attempt) is a FAILURE, not a safe default.
- **D13** — the P2b caps apply unchanged to plugin payloads.

## Origin mechanism — the binding constraint

The only sanctioned evidence is a **before/after token-stream comparison
across the plugin core-rule boundary**, using token object identity:

1. Snapshot the block-level token array immediately **before** plugin core
   rules run and immediately **after** (a core rule pair registered around
   them — reuse the existing `source_range` registration pattern; that rule
   already establishes where in the chain evidence is stamped).
2. Tokens present in both snapshots **by object identity** keep their own
   existing evidence (this is the P2b path, unchanged).
3. A **contiguous run of removed tokens replaced by a contiguous run of added
   tokens at the same position** — a single clean splice — yields origin =
   the union of the removed run's ranges, **only if** every removed token in
   that run carried complete range evidence.
4. **Everything else refuses**, with the offending rule's registered name in
   the diagnostic: interleaved edits, multiple overlapping splices, partial
   evidence in the removed run, tokens moved rather than replaced, copies
   (one source region producing several output regions), or consume-all with
   no carrier left.

Rule 3 is derived from a known transformation boundary plus object identity —
it is not presentation inference. Rule 4 is the fail-closed default. If a
lane finds rule 3 cannot be made sound, it **narrows to refuse-always and
reports** rather than widening the heuristic.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Host-side plugin loading | Projection accepts an `md` instance with project plugins already applied via the existing `applyPlugins`; plugin code never crosses into the editor package or a webview bundle (import-graph proof) | A |
| Plugin CSS | `collectPluginCss` output reaches the editor's presentation input through the host, not by the editor loading plugins itself | A |
| Survivor tokens | Tokens untouched by plugins project exactly as in P2b (regression: the P2b suite passes unchanged with plugins loaded) | A |
| Clean-splice origin | A consume-and-replace plugin rule (one contiguous run in, one out, full evidence) yields a `plugin-region` block whose range is the authored source it consumed — asserted byte-exact | B |
| Refusal matrix | Each rule-4 shape (interleave, multi-splice, partial evidence, move, copy, consume-all) produces a typed refusal naming the rule; NO block, document stays editable | B |
| Ported PR 158 fixtures | The adversarial shapes recorded in `pr158-lessons.md` §12.2 that apply to this mechanism are reproduced as fixtures with their expected outcomes | B |
| Inactive plugin view | A `plugin-region` renders the plugin's own HTML inertly (P2b's posture), carrying safe view attributes; script payloads never execute (browser-asserted) | C |
| Active plugin view | Caret entry reveals the region's exact authored source; edits are byte-exact within its range; leaving restores the inactive view with zero drift | C |
| Unsupported interior | A refused region shows the inactive rendering where safe plus an explicit "edit in source" affordance; never a guessed writable range | C |
| Untrusted context | With trust withheld, plugins are not loaded and regions degrade to plain source — no partial execution | A/C |

## Lane ownership (Lane A FIRST; then B and C in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/cli/src/lib/markdown/editor-projection.ts`, its tests, `packages/cli/src/render.ts` | plugins.ts, markers.js, source-range.ts, renderer.ts, assemble.ts, packages/editor | Plugin-aware projection input + trust gate + survivor regression |
| B | `packages/cli/src/lib/markdown/plugin-origin.ts` (+ tests), `editor-projection.ts` origin integration | Lane A's non-origin logic, plugins.ts, packages/editor | Origin mechanism + refusal matrix + ported fixtures |
| C | `packages/editor/src/gutterpress/**`, `packages/editor/tests/gutterpress/**`, `packages/editor/package.json` | packages/cli, fork, core/, web/standard | Two-state plugin views + browser proofs |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

## Security review (required by the plan for this run)

The review stage must explicitly cover: the plugin execution boundary (host
only — prove by import graph and bundle scan), CSP/inertness of
plugin-produced HTML, base-URI behavior, raw-HTML handling, and secret
isolation in projections and diagnostics.

## Test plan

- A realistic plugin fixture shaped like a **real registered markdown-it
  rule** (not a toy): consume a marker paragraph, emit replacement tokens.
  `packages/open-design-plugin` is the in-repo reference for realistic shape.
- Liveness first everywhere: a fixture must prove its transform actually ran
  before any behavioral assertion (AP-21; PR 158's vacuous-pass lesson).
- Browser proofs reuse the P2b/P1b2 harness patterns.

## Review dimensions

- Can origin ever be assigned from anything but object identity + recorded
  ranges? Construct an attack.
- Does any refusal path silently produce a writable range?
- Does plugin code reach the editor bundle by any import path?
- Are the refusal fixtures genuinely distinct shapes, or the same shape six
  times?
- Does a plugin that knows nothing about Gutterpress still work (no plugin-side
  opt-in required)?

## Gate

- `bun install --frozen-lockfile`
- `cd packages/cli && bun run build && bun run test`
- `bun run typecheck`
- `cd packages/editor && bun run test && bun run test:browser && bun run check:browser-purity`
- `cd packages/desktop && bun run test && bun run check`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

- **Rounds 1-3** (adversarial + mandated security review of `d0de018d..a9fb0090`,
  two batches): 6+ CONFIRMED findings — an undetected copy shape, discarded
  rule-named reasons, unguarded plugin-region ranges, base-pipeline rules
  polluting the origin bracket (plus a latent snapshot-vs-caller-array bug it
  exposed), a missing source affordance for refused regions with a fabricated
  justifying quotation, and an inactive view showing authored source instead of
  the plugin's own rendered HTML. Rounds 2-3 closed bidirectional containment
  and residual shapes. Fixed in `24306d9c`, `e7b08cc6`, `a9fb0090`. Verdict:
  **approve**, 0 confirmed remaining, 2 advisories (both fail-closed direction).
- **Security review** (plan-mandated for this run): plugin execution proven
  host-only by import-graph and built-bundle scan; plugin HTML inert under a
  script-payload assertion; trust gate fail-closed by default; no secrets or
  absolute paths in projections, diagnostics, or chips.
- **Gate**: PASS — all 13 commands exit 0 (cli 1913/0; editor 3038/0 unit +
  99/0 across 8 browser suites; desktop 2260/0; all fitness checks green).

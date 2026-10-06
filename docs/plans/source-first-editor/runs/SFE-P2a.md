# SFE-P2a — Standard Markdown rich editor

## Objective

Deliver a complete source-first rich editor for STANDARD Markdown before any
Gutterpress dialect work: the P1a mount shell's public API backed by the real
adapter/fork surface, plus a shared formatting-command layer where every
command emits an explicit D3 source edit — proven by byte-identity and
edit-locality corpora.

## Allowed behavior changes

- `packages/editor/src/web/mount.ts` internals are replaced by the
  adapter-backed surface (public `mountEditor`/`EditorMount` API unchanged;
  the P1a textarea shell retires). Existing `tests/web` mount tests keep
  passing — they may be RE-BASED onto the richer surface ONLY where an
  assertion is textarea-specific (each such change individually justified in
  the diff; behavioral assertions stay).
- New `packages/editor/src/web/standard/**` (command implementations) and
  `packages/editor/src/core/commands.ts` growth STRICTLY bounded by the
  command list below.
- Desktop toolbar adapter may map its existing actions to the shared
  commands (behavior identical).

## Behavior that must remain unchanged

- D3 contract, adapter semantics, fork patch surface (no
  `packages/vscode-markdown-editor` edits).
- All P1b/P1b2 browser suites unmodified and green.
- No Gutterpress projections yet (P2b) — standard Markdown only.

## Binding decisions

- **D2** — no ordinary edit serializes a semantic tree; every command emits an
  explicit source edit computed from the CURRENT snapshot + selection.
  A command needing multiple changes returns ONE replacement spanning the
  smallest safe common range (D3).
- **Lessons §8.7** — commands are pure source transformations; desktop
  toolbar, rich web UI, and VS Code consume the same vocabulary.
- **G-09** — one implementation per authoring concept.
- **AP-19/AP-21** — interaction proof in real Chromium with liveness
  assertions; no vacuous passes.

## Command list (the union's full extent this run — nothing more)

`toggle-bold`, `toggle-italic`, `toggle-strike`, `toggle-inline-code`,
`set-heading {level 1-6 | none}`, `toggle-blockquote`,
`toggle-list {bullet|ordered|task}`, `insert-link {href, text?}`,
`insert-image {src, alt?}`, `toggle-code-block {lang?}`,
`insert-horizontal-rule`, `insert-table {rows, cols}` — mapped 1:1 from the
existing desktop toolbar actions plus the P1c union; NO layout/marker/plugin
commands (P2b+).

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Adapter-backed mount | `mountEditor` mounts the fork editor (CSS injected, host-wired); dispose/remount clean; P1a public API intact | A |
| Command emission | Every command above computes ONE minimal SourceEdit from snapshot+selection and applies via the host; rejection surfaces diagnostics | A/B |
| Toggle semantics | toggle-on wraps/prefixes exactly; toggle-off removes exactly (byte-exact both ways, incl. partial-selection and caret-only cases; document the chosen caret-only behavior per command) | B |
| Capability queries | `commandState(snapshot, selection)` reports active/applicable per command (for toolbars); pure function, no DOM | B |
| Byte-identity corpus | No-edit open/close byte-identical across the corpus (extends P1b cases; adds CommonMark oddities: setext headings, lazy continuation, hard breaks, entity refs, autolinks, nested lists 4-space vs 2-space, tabs) | C |
| Edit locality corpus | Every command on every corpus document changes ONLY the range its returned edit declares (diff assertion against independent splice) | C |
| Randomized ranges | Seeded randomized selection placement per command x corpus; invariants: apply succeeds or rejects cleanly, result parses, no drift outside range | C |
| Desktop toolbar mapping | Existing toolbar actions route through the shared commands (type-level + unit proof; UI wiring unchanged) | B |

## Lane ownership (Lane A FIRST; then B and C in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/editor/src/web/**` (mount.ts + new standard/ scaffolding), `packages/editor/tests/web/**`, `packages/editor/package.json` (scripts only) | core/ (except nothing), adapter src, fork, other packages | Adapter-backed mount + re-based mount tests + browser smoke |
| B | `packages/editor/src/web/standard/**` (commands impl), `packages/editor/src/core/commands.ts`, `packages/editor/tests/standard/**`, `packages/desktop/src/lib/editor/toolbar-actions.ts` (mapping only) | mount.ts, adapter, fork, tests/web | Command implementations + capability queries + toolbar mapping |
| C | `packages/editor/tests/corpus/**` | src/**, other lanes' tests | Byte-identity + locality + randomized corpora (unit-level via MemoryDocumentHost + the pure command functions; browser only where selection semantics demand it) |
| Integrator | `bun.lock`, wiring, milestone commits | — | Install, verification, commits |

## Test plan

- Pure command functions unit-tested exhaustively (no browser needed for the
  transform math — selection in, edit out).
- Browser suites for the mount swap + a representative command subset driven
  by real keyboard/toolbar-call paths.
- Corpus tests via MemoryDocumentHost (fast, no browser).

## Review dimensions

- Can any command produce an edit wider than its minimal range, or serialize
  document state it didn't read from the snapshot?
- Are toggle-off paths byte-exact inverses on the corpus (no normalization)?
- Did the mount swap preserve every P1a behavioral guarantee (diagnostics,
  dispose, remount, external replacement)?
- Are re-based tests genuinely equivalent or quietly weakened?
- Is the command union still minimal (no speculative members)?

## Gate

> Use `cd <pkg> && bun run <script>` — never `bun --cwd`.

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/editor && bun run test`
- `cd packages/editor && bun run test:browser`
- `cd packages/desktop && bun run test && bun run check && bun run lint`
- `cd packages/cli && bun run test`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

- **Rounds 1-3** (adversarial review of `d6c3a2b5..fbc2862a`, two batches): 8+
  CONFIRMED findings across three repair rounds — three genuine data-loss bugs
  (destructive unfencing, setext absorbing thematic breaks, italic destroying
  bold), a non-inverse ordered-list toggle, a non-identical toolbar mapping with
  false header claims, a tautological locality oracle, dead refusal branches,
  and a false supersession claim. All fixed with sabotage-verified regressions
  (`d0edefc3`, `828c9fde`, `fbc2862a`). Verdict: **approve**, 0 confirmed
  remaining. The run hit the 3-round bound exactly — within policy.
- **Gate**: PASS — all 12 commands exit 0 (editor 3003/0 + 65/0 browser;
  desktop 2260/0; cli 1810/0; all fitness checks green).

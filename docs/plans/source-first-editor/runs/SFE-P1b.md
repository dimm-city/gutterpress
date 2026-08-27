# SFE-P1b — `@vscode/markdown-editor` compatibility and fork gate

## Objective

Prove the exact-pinned `@vscode/markdown-editor@0.0.2-84` can serve as the rich
editor core behind ONE adapter — or produce the evidence that mandates the
permitted minimal generic fork. Every D5 mandatory case gets a real, exercised
result; the adoption decision is recorded with that evidence.

## Allowed behavior changes

- `packages/editor` gains the pinned runtime dependency (already committed,
  `171c961f`), the sole adapter under `src/vscode-adapter/`, and a browser test
  harness (`test:browser`).
- No other package changes; no production consumer yet.

## Behavior that must remain unchanged

- `packages/editor/src/core/**` — the D3 contract is frozen; the adapter
  conforms TO it, never the reverse.
- The P1a mount shell's public API (`mountEditor`/`EditorMount`) — P1b may
  replace `mount.ts` internals with the adapter-backed surface, but the public
  shape and its 26 tests keep passing unmodified (tests may be EXTENDED, never
  weakened).
- All existing gates.

## Binding decisions

- **D5** — direct package use is final ONLY if all 8 mandatory cases pass:
  (1) exact source edits; (2) external authoritative replacement;
  (3) host-delegated undo/redo; (4) custom inactive Gutterpress block rendering;
  (5) active/source-aware rendering for a projected block; (6) selection mapping
  through projected content; (7) custom CSS and isolated document mounting;
  (8) clipboard, IME, accessibility, and disposal behavior.
  Only a missing generic custom-block/view hook justifies a fork
  (`packages/vscode-markdown-editor`, internal, MIT notices, upstream diff,
  generic seams only, no Gutterpress syntax). Failure of unrelated optional
  styling does NOT justify a fork. Fork-with-Gutterpress-syntax or broad
  rewrites → STOP and re-plan.
- **D2/G-01** — exact source authority: the package's own model claims this
  ("keeps Markdown source as the canonical document"); the spike must VERIFY it
  (no-edit byte identity, edit locality) rather than trust it.
- **D1** — no compatibility with PR 158 anything.
- **I-01** — "Package declarations alone are insufficient; exercise the exact
  pinned runtime."

## Recorded facts (verified by the integrator against the installed 0.0.2-84)

- Deps are micromark-family + `@vscode/{codicons,diff,observables}` + katex —
  **no ProseMirror/Tiptap/Milkdown**; architecture Rule 1 green with the
  lockfile entries present.
- API surface (from `dist/index.d.ts`, 3496 lines):
  `EditorModel` (`sourceText: ISettableObservable<StringValue>`,
  `readonlyMode`, `selection`, `applyEdit(edit: StringEdit, selection?)`,
  source-edit listeners), `EditorView(model, options?: EditorViewOptions)`
  (owns `element`, overlay container, coordinate space),
  `StringEdit.{replace,insert,delete,single}` over `OffsetRange`,
  `EditorViewOptions extends BlockViewOptions` with
  `renderCustomCodeBlock?: (language, content) => HTMLElement | undefined` and
  `onEmbeddedCodeEditorEdit`, an `onEdit?: (edit: StringEdit) => void` seam,
  `UnhandledBlockAstNode` (lossless unknown-block source), full cursor/edit
  command exports, `./web-editors` subpath with sandboxed-iframe embedded
  code-block editor providers (nonce + theme aware), CSS exports
  (`./editor.css`, `./themes/*.css`).
- Purity/architecture rules match exactly `vscode`/`vscode/...` — the
  `@vscode/` npm scope does not trip them (verified live).
- Browser runtime available: Chromium at `PLAYWRIGHT_BROWSERS_PATH`
  (`/opt/pw-browsers`), `playwright-core` ^1.60.0 is a root devDependency.
  Never run `playwright install`.

## Behavior table (the D5 mandatory cases, plus locality proofs)

| # | Case | Required result | Owner |
|---|---|---|---|
| 1 | Exact source edits | Typing/commands produce `StringEdit`s the adapter converts to D3 `SourceEdit`s against the host; accepted host edits round-trip back; byte-exact locality (only `[from,to)` changes) | A |
| 1b | No-edit byte identity | Mount + unmount with zero user edits leaves host source byte-identical (G-01) | A |
| 2 | External authoritative replacement | Host `replaceExternal` → adapter updates `sourceText` without echoing an edit back; version increments exactly once; view re-renders | A |
| 3 | Host-delegated undo/redo | The adapter can route undo through the host (or prove the package's history can be disabled/bypassed so the host owns it); no second persistent history (D7) | A |
| 4 | Custom inactive Gutterpress block rendering | A synthetic projected block (e.g. a paragraph line `@page splash`) can render custom inactive HTML via a GENERIC hook; record exactly which hook, or its absence | C |
| 5 | Active/source-aware rendering | Activating that block exposes source-aware editing of its exact range; leaving it restores inactive rendering; no byte drift | C |
| 6 | Selection mapping through projected content | Selections crossing the projected block map to correct source offsets; caret enter/exit is coherent | C |
| 7 | Custom CSS + isolated mounting | Editor mounts in an isolated container/iframe with our CSS injected alongside `editor.css`; no style leakage into the host page assertion | B |
| 8 | Clipboard, IME, a11y, disposal | Paste plain/rich text; composition events don't corrupt source; focus/keyboard nav; dispose leaks no listeners/observers (remount clean) | B |

## Lane ownership (Lane A runs FIRST, sequentially; B and C then run in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/editor/src/vscode-adapter/**`, `packages/editor/tests/vscode-adapter/**`, `packages/editor/src/web.tsconfig.json` (include list), `packages/editor/package.json` (scripts + test harness devDeps only), `packages/editor/tests/browser-harness/**` | `src/core/**`, existing tests, other packages, root files | The sole adapter + browser harness + cases 1/1b/2/3 proven |
| B | `packages/editor/tests/vscode-adapter/input-a11y/**` | adapter source, other lanes' tests, other packages | Case 7/8 spike results (real browser) |
| C | `packages/editor/tests/vscode-adapter/custom-view/**`, `docs/plans/source-first-editor/runs/SFE-P1b-decision.md` | adapter source (may add a TEST-ONLY provider file under its own dir), other packages | Cases 4/5/6 spike results + the adoption decision record |
| Integrator | `bun.lock`, milestone commits, final decision ratification | — | Install, wiring, commits |

## Harness requirements

- Browser tests run in REAL Chromium via `playwright-core` (launch with
  `executablePath` resolved from `/opt/pw-browsers` if default resolution
  fails). Bundle the page under test with `bun build` (test-only; the no-bundler
  rule governs `packages/cli` runtime, not test harnesses). Serve via
  `node:http` on an OS-assigned port or load a data:/file: URL of a
  self-contained bundle.
- Every browser test asserts liveness (the editor actually mounted, the target
  block exists) before behavior (AP-21). A test that cannot run (missing
  browser) FAILS with the environment error — no silent skip (AP-20).
- `test:browser` becomes a package script; the ordinary `test` script keeps
  excluding browser tests so `bun run test` stays fast and hermetic.

## Decision gate protocol (Lane C records, integrator ratifies)

`SFE-P1b-decision.md` must contain: per-case PASS/FAIL with the exercised
evidence (test file + assertion), the exact hook used for cases 4–6 or proof of
its absence (API search + attempted implementations), and the verdict:
**DIRECT** (all 8 pass) / **FORK** (only generic-hook gap) / **STOP** (anything
else). A FORK verdict does NOT begin the fork in this run — it stops for
re-plan of the fork run, per the plan's bounded-run rule.

## Test plan

- Adapter unit tests (bun:test, DOM stub where possible) for edit conversion
  (StringEdit↔SourceEdit offsets, multi-replacement StringEdits → smallest
  safe common range per D3), rejection propagation, external replacement
  no-echo, disposal.
- Browser integration tests for the behavior table's real-input cases.
- No weakening of P1a tests; the P1a mount tests keep passing.

## Review dimensions

- Does any path let the package's model mutate source outside an explicit
  host-accepted edit (hidden normalization on mount — check case 1b hard)?
- Is the adapter the ONLY file importing package internals (D5)?
- Are cases marked PASS actually exercised in a real browser, not inferred
  from types (I-01)?
- Does the harness fail closed when Chromium is unavailable?
- Is the decision record's evidence traceable to committed tests?

## Gate

> Use `cd <pkg> && bun run <script>` — never `bun --cwd`.

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/editor && bun run typecheck`
- `cd packages/editor && bun run test`
- `cd packages/editor && bun run test:browser`
- `cd packages/editor && bun run check:browser-purity`
- `bun run check:architecture`
- `bun run knip`

## Review log

- **Round 1** (adversarial review of `a8a93c0c..5cc16061^`, four batches): 6 CONFIRMED
  findings — knip gate failure on .btest.ts files; a stale-snapshot rejection-revert
  replay plus an over-broad echo guard in the adapter (both real G-11/D2 bugs, fixed
  with new race tests); missing CI invocation for test:browser (AP-20); an incomplete
  hook catalog in the decision record (renderMath found — the fork seam was upgraded
  to the segments-capable shape as a result); a tautological clipboard assertion; and
  a partially tautological drag proof with a doc/behavior mismatch. Fixed in
  `5cc16061`. Verdict: **approve**, 0 confirmed remaining, 2 advisories.
- **Gate**: PASS — all 11 commands exit 0 (editor 126/0 unit + 39/0 real-Chromium
  browser; desktop 2132/0; cli 1810/0; all fitness checks green).
- **Decision**: FORK, ratified — see `SFE-P1b-decision.md`; executed as SFE-P1b2.

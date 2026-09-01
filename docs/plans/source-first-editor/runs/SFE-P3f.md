# SFE-P3f — Fork measurement patch (the D13 fix)

## Decision record — why the fork is patched

SFE-P3d-sweep Lane D proved, by differential measurement, that the D13
250 KiB p95 budget miss (554–632 ms vs 100 ms) is **inherent to the vendored
fork**: `EditorView._renderAutorun → _publishMeasurements` unconditionally
remeasures every block's DOM geometry (`getBoundingClientRect`,
`getComputedStyle`, `Range.getClientRects` per block and per wrapped visual
line) for the WHOLE mounted document on every render — every keystroke —
with no public escape hatch. The fork mounted directly, with zero Gutterpress
code in the loop, reproduces the full cost; our glue measures under 1 ms.

D5's fork governance permits a minimal patch, documented hunk-by-hunk in
`PATCHES.md`, byte-pinned by `checksums.json`, verified by
`scripts/verify-vendored.mjs`, load-tested, and kept upstreamable (the same
process that shipped `renderCustomBlock`, Hunks 1–7). This run authorizes
exactly one such patch. Its removal trigger is the same as the existing
patch's: upstream adopting an equivalent fix.

## Objective

Reduce per-keystroke measurement cost from O(document) toward
O(changed/visible), WITHOUT changing any observable editing behavior: caret
math, pointer→offset mapping, selection rects, segment tiling, custom-block
rendering and every existing browser proof must remain byte-for-byte and
pixel-honest. Then re-measure D13.

## Binding constraints

- **Correctness outranks the budget.** `_publishMeasurements` feeds
  `VisualLineMap.offsetAtPoint`, pointer selection, and the segment tiling
  the custom-block seam depends on. A patch that makes typing fast but caret
  math stale is a catastrophic regression; every caret/drag/selection browser
  proof in `packages/editor` and `packages/vscode-extension` is the safety
  net and must pass unmodified.
- **Smallest sound scope.** Candidate strategies, in preference order:
  (1) skip remeasuring blocks whose view nodes were reused by identity and
  whose geometry inputs cannot have changed (measure only dirty blocks and
  those after a height-changed block if positions shift); (2) viewport-scoped
  measurement with lazy fill on scroll/query. Pick the SMALLEST that
  empirically lands the budget; do not build both.
- **Stale-geometry honesty:** if the patch defers any measurement, every
  consumer that could read a deferred value must either trigger measurement
  on demand or provably never be reached for an unmeasured block — traced,
  not assumed.
- **Governance:** new hunk(s) appended to `PATCHES.md` in the established
  format (before/after excerpts, why, upstream shape); `checksums.json`
  patched hashes updated; `bun run check:vendored` green; the upstream-issue
  draft gains a companion section (or a second draft) offering the fix
  upstream.
- **Honest outcome:** if the patch cannot reach the budget without risking
  correctness, report the achieved numbers and stop — the budget stays red
  and Checkpoint B carries the truth.

## Gate

- `bun run typecheck`
- `cd packages/editor && bun run test && bun run test:browser && bun run test:perf`
- `cd packages/vscode-extension && bun run test && bun run test:browser`
- `cd packages/desktop && bun run test`
- `bun run check:vendored && bun run check:architecture && bun run knip`

## Review log

<!-- Appended by the review stage. -->

# SFE-P2b — Sparse Gutterpress projection

## Objective

Add Gutterpress syntax awareness to the editor without a second Markdown model:
`createEditorProjection()` on the browser-safe render boundary produces exact
source-range projections for core layout markers, attributes, raw HTML, and
generated views from the REAL markdown-it pipeline; `packages/editor` consumes
them through the fork's `renderCustomBlock` seam; D13 caps and D14 diagnostics
fail closed.

## Allowed behavior changes

- New browser-safe projection module in `packages/cli` exported via
  `gutterpress/render` (or a narrowly exported Node-free sibling).
- New `packages/editor/src/gutterpress/**` consumer layer + `./gutterpress`
  subpath.
- Zero change to rendered book output, the marker contract, or any existing
  pipeline behavior (the projection is derived, discardable, read-only over
  the token stream).

## Behavior that must remain unchanged

- All render/preview/PDF output byte-identical (the projection builder only
  READS the token stream; `assembleBookHtml`/`createMarkdownRenderer`
  behavior untouched).
- The fork patch surface; the standard-command layer; every existing suite.

## Binding decisions

- **D6** (verbatim constraints) — projection schema version 1; kinds:
  `chapter`, `page`, `spread`, `section`, `page-break`, `column-break`,
  `plugin-region`, `raw-html`. Every authored projected block has a valid
  source range; every generated view has an anchor and NO writable range.
  Ranges come from the configured pipeline's token maps and marker metadata
  (the `source_range` core rule) — NEVER inferred from DOM, tag gaps, text
  equality, or reverse conversion. Ambiguity → typed diagnostic +
  source-mode fallback. Projection output is derived and rebuildable.
- **D13** — caps: 10,000 projected blocks; 1 MiB per inactive HTML payload;
  8 MiB aggregate generated/plugin HTML; fail closed to source mode or safe
  placeholder; no unbounded recursion.
- **D14** — `EDITOR_UNSUPPORTED_PROJECTION`, `EDITOR_PROJECTION_LIMIT`
  (+ existing categories); messages state the safe next action.
- **G-04** — authored source / source-derived view metadata / generated view /
  editor chrome are distinct types; runtime checks make generated→source
  conversion impossible.
- **G-05** — source origin never inferred from presentation.
- **G-11** — projection results carry `sourceVersion`; consumers reject stale.
- **P2c boundary** — `plugin-region` mapping for real project plugins is P2c;
  this run implements the KIND and the fail-closed path for unknown/ambiguous
  regions only.

## Recorded facts (verified by the integrator)

- `packages/cli/src/lib/markdown/source-range.ts` — pure (node-free) core rule
  annotating open block tokens + self-closing blocks (`fence`, `hr`,
  `html_block`, `layout_page_break`, `layout_column_break`) with
  `data-source-range="<start>:<end>"`: markdown-it `token.map` semantics,
  0-based half-open LINE indices; marker lines threaded via `token.meta.line`
  by `markers.js` (ADR 0009: `token.map` deliberately not set on layout
  wrappers).
- The projection contract needs UTF-16 CHARACTER offsets (D1/D3): the builder
  converts line ranges to char offsets against the exact source via a
  line-start offset table — deterministic, no inference.
- `gutterpress/render` exports `createMarkdownRenderer`, `assembleBookHtml`,
  `MARKER_CSS`; browser purity enforced by `scripts/check-render-pure.mjs`.
- The fork consumer seam: `renderCustomBlock(node, sourceText) →
  CustomBlockRendering{dom, segments?}` (P1b2), with the md-block class
  host-applied and the provider guidance documented in the decision record.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Marker projection | `@chapter`/`@page`/`@spread`/`@section` lines + `@page-break`/`@column-break` (the real marker family from markers.js — enumerate from its parser, not hardcoded guesses) project to blocks with exact char ranges matching the source bytes of the marker's own line(s) | A |
| Attribute fidelity | Marker attributes (compact + braces spellings) surface as viewAttributes verbatim from source metadata — never from transformed tokens (AP-06) | A |
| Raw HTML | `html_block` tokens project as `raw-html` with exact ranges; inline HTML pairs recorded per the support matrix (source-only edit mode) | A |
| Generated views | `markers.js`-generated structures with no authored range (e.g. `.chapter-opener` injection, `data-chapter-label` furniture) become GeneratedView{anchor, html} — anchored to the generating marker's range end; NO writable range (type-level + runtime) | A |
| Range validity invariants | Every block: 0 <= from < to <= source.length; blocks non-overlapping OR strictly nested (define + assert the invariant the marker DOM actually produces); every range's source slice re-parses to the same block kind (self-check, cheap) | A |
| Consumer mapping | `packages/editor/src/gutterpress`: projection → renderCustomBlock provider (inactive chips for markers w/ viewAttributes; raw-html safe rendering per trust flag; generated views rendered read-only OUT of the editable flow — decide the mechanism honestly against the fork's seam and record it) | B |
| Two-state | Marker blocks: inactive chip → active exact-source editing via the proven showMarkup transition; leaving restores; zero drift (extends the P1b2 suite patterns) | B |
| Stale rejection | A projection with sourceVersion != current snapshot version is refused by the consumer (G-11) | B |
| Caps | 10,001 blocks → EDITOR_PROJECTION_LIMIT + source-mode fallback; >1 MiB inactive payload → placeholder + diagnostic; >8 MiB aggregate → fail closed; each cap sabotage-tested at the boundary (N and N+1) | C |
| Ambiguity | A token with no source-range evidence (construct one via a synthetic plugin that strips maps — the AP-05 shape) → typed refusal naming the reason, block projected as source-only, document still editable | C |
| Malformed markers | Fixture matrix from markers.test.ts's edge cases (invalid marker lines, orphan continuations) → projection degrades per-block, never throws, never guesses | C |

## Lane ownership (Lane A FIRST; then B and C in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/cli/src/lib/markdown/editor-projection.ts` (+ `.test.ts`), `packages/cli/src/render.ts` (export lines) | markers.js, source-range.ts, renderer.ts, assemble.ts, other packages | Browser-safe projection builder + exact-range tests + render purity intact |
| B | `packages/editor/src/gutterpress/**`, `packages/editor/tests/gutterpress/**`, `packages/editor/package.json` (subpath + test:browser chain) | core/, web/standard, adapter, fork, cli internals | Consumer layer + two-state browser proofs |
| C | `packages/cli/tests` or `packages/cli/src/lib/markdown/editor-projection-limits.test.ts` (limits/ambiguity tests co-located per cli convention — verify), `packages/editor/tests/gutterpress/limits.btest.ts` | production code of either package | Caps + diagnostics + malformed/ambiguous fixture matrix |
| Integrator | `bun.lock`, wiring, milestone commits | — | Install, verification, commits |

## Security and trust

- Raw HTML never executes in the editor: inactive raw-html rendering is
  sanitized or inert per the P1b2 CSP posture (Lane B documents the mechanism
  and proves script inertness in the browser suite).
- The projection carries no absolute paths or secrets.

## Test plan

- Lane A: exact-range unit tests against real pipeline output for every
  marker-family member; attribute spellings; the range-validity invariants;
  purity (`check-render-pure.mjs` still green — the builder ships in the
  render graph).
- Lane B: browser suites reusing the P1b2 harness/probe patterns.
- Lane C: cap boundaries (N/N+1), ambiguity refusals, malformed matrix — all
  with AP-21 liveness.

## Review dimensions

- Can generated HTML acquire a writable range through ANY path (type system +
  runtime + tests)?
- Is any range derived from anything except token maps/marker metadata?
- Does the projection duplicate standard-Markdown structure it doesn't need
  (D6 sparseness)?
- Does the builder stay Node-free in the compiled render graph?
- Are the cap tests at exact boundaries, and does fallback keep source
  editable?

## Gate

> Use `cd <pkg> && bun run <script>` — never `bun --cwd`.

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/cli && bun run test`
- `cd packages/cli && bun run build` (render purity gate runs inside)
- `cd packages/editor && bun run test`
- `cd packages/editor && bun run test:browser`
- `cd packages/desktop && bun run test && bun run check`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

<!-- Appended by the review stage. -->

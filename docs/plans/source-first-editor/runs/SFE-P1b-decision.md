# SFE-P1b — adoption decision record

> Written by Lane C per `docs/plans/source-first-editor/runs/SFE-P1b.md`'s
> "Decision gate protocol". Recorded by Lane C; ratification is the
> integrator's per the plan's Lane rules ("Only the integrator resolves
> conflicts or broadens write ownership... final decision ratification").

## Verdict

**FORK.**

All 8 of D5's mandatory cases were exercised against the real, pinned
`@vscode/markdown-editor@0.0.2-84` runtime (I-01). Cases 1, 1b, 2, 3, 6, 7,
and 8 PASS. Case 4 FAILS for the run spec's specified probes (a
paragraph-shaped Gutterpress marker line, and a fenced-code-free
"plugin-region-like" paragraph): **the package exposes no generic hook that
lets a host render custom inactive HTML for a block it treats as an ordinary
paragraph or as `UnhandledBlockAstNode`.** Case 5 is consequently FAIL for
the same probes — there is no projected block to activate. This is
exhaustively confirmed both by a full API-surface catalog (`dist/index.d.ts`,
3496 lines) and by real-Chromium spikes instrumenting the ONE hook the
package does expose (`BlockViewOptions.renderCustomCodeBlock`) and proving it
is never invoked for either probe shape.

The missing seam is narrow, precisely nameable, and has a direct precedent
already shipping in the package for a different block kind (see "Fork
proposal" below) — this is exactly the condition D5 sets for **FORK**, not
**STOP**: "If and only if a generic custom-block/view hook is absent, create
`packages/vscode-markdown-editor`... Failure of unrelated optional styling
does not justify a fork" (this is not "unrelated optional styling" — it is
the mandatory case 4 hook itself) "... Fork-with-Gutterpress-syntax or broad
rewrites → STOP" (the proposed seam is generic and carries zero Gutterpress
syntax; it mirrors an existing package pattern almost exactly, so it is not a
broad rewrite).

Per the run spec: **"A FORK verdict does NOT begin the fork in this run — it
stops for re-plan of the fork run, per the plan's bounded-run rule."** No
fork package is created by this run.

## Integrator ratification

**RATIFIED: FORK** (2026-08-27, integrator). The verdict matches D5's fork
condition precisely: the only blocker is the absent generic custom-block/view
hook; the proposed seam is generic, mirrors the package's own
`renderCustomCodeBlock` precedent, and carries zero Gutterpress syntax. The
fork is executed as its own bounded run (SFE-P1b2) per the bounded-run rule;
it must record the upstream version + source provenance, retain MIT notices,
ship an upstream-diff document and contract tests (including the
caret-entry-at-block-start and pointer-drag-precision constraints recorded
above), and repeat the exact D5 suite.

## Per-case results

| # | Case | Result | Evidence |
|---|---|---|---|
| 1 | Exact source edits | **PASS** | `packages/editor/tests/vscode-adapter/browser.cases.btest.ts`, `describe("case 1 — exact source edits")` (2 tests: end-of-document typing, multi-block edit locality) |
| 1b | No-edit byte identity (G-01) | **PASS** | same file, `describe("case 1b — no-edit byte identity (G-01)")` (6-entry non-normalized-Markdown corpus, `applyEditCallCount() === 0` asserted hard) |
| 2 | External authoritative replacement | **PASS** | same file, `describe("case 2 — external authoritative replacement")` |
| 3 | Host-delegated undo/redo (D7) | **PASS** | same file, `describe("case 3 — host-delegated undo/redo (D7)")` |
| 4 | Custom inactive Gutterpress block rendering | **FAIL** | see "Case 4" below — `packages/editor/tests/vscode-adapter/custom-view/probe.btest.ts`, `describe("case 4 — absence proof: no generic hook fires for a paragraph-shaped Gutterpress marker")` and `describe("case 4 — overlay workaround: additive only, cannot participate in text flow")` |
| 5 | Active/source-aware rendering for a projected block | **FAIL** (for the specified probe; see caveat) | see "Case 5" below — same file, `describe("case 5 — the ONE working two-state transition...")` |
| 6 | Selection mapping through projected content | **PASS** (scoped; see caveat) | see "Case 6" below — same file, both `describe("case 6 — ...")` blocks |
| 7 | Custom CSS + isolated mounting | **PASS** | `packages/editor/tests/vscode-adapter/input-a11y/input-a11y.btest.ts`, `describe("case 7 — custom CSS + isolated mounting")` (3 tests: 7a custom stylesheet reaches computed styles, 7b no leakage onto a page element outside the container, 7c two independent instances don't cross-contaminate) |
| 8 | Clipboard, IME, a11y, disposal | **PASS** | same file, `describe("case 8 — clipboard")`, `describe("case 8 — IME / composition")`, `describe("case 8 — accessibility")`, `describe("case 8 — disposal")` (9 tests total) |

Cases 1/1b/2/3 (Lane A) and 7/8 (Lane B) were re-run by Lane C as part of
this record's own verification pass, not merely read from source — see
"Commands run" below. Lane B's suite **is present in the tree, passes at
runtime (14/14), and — as of the final verification pass recorded below —
`cd packages/editor && bun run typecheck` passes cleanly end-to-end across
all three lanes' files with no exclusions needed** (an earlier pass in this
same run observed transient `tsc` errors confined to Lane B's file, which
resolved between verification passes as Lane B's own work continued
concurrently — see "Commands run" for both observations).

## Case 4 — custom inactive Gutterpress block rendering

**Question:** can a paragraph line like `@page splash`, or a
fenced-code-free "plugin-region-like" paragraph like `::: sidebar`, render
custom inactive HTML via a GENERIC hook?

**Answer: no.** Catalogued every candidate seam in `dist/index.d.ts`
(3496 lines) and confirmed each against the shipped `dist/index.js`
implementation (the package ships no `.ts` source under `src/`, only CSS —
confirmed via `package.json`'s `files` list and a live directory listing;
all behavioral citations below are against the bundled, sourcemapped
`dist/index.js`):

> **Correction (SFE-P1b repair, round 1):** the original text of item 1
> below claimed `renderCustomCodeBlock` was "the ONLY hook the package
> exposes for custom INACTIVE block rendering." That is false. A second one
> exists — `BlockViewOptions.renderMath` (`dist/index.d.ts:250`) — and is
> catalogued as item 1b, added below without renumbering the rest of this
> list. It does not change the FORK verdict (below) because it is keyed to
> the `mathBlock`/inline-math AST kinds, not generic — but its
> `MathRendering.segments` mechanism is exactly the missing piece the
> "Fork proposal" section's original signature left out, and that section
> has been revised accordingly. See "Commands run" for how this correction
> was verified.

1. **`BlockViewOptions.renderCustomCodeBlock`** (`dist/index.d.ts:218`) —
   `(language: string, content: string) => HTMLElement | undefined`. One of
   TWO hooks the package exposes for custom INACTIVE block rendering (see
   1b) — the only one keyed to fenced code blocks specifically.
   Invocation is gated in `dist/index.js:4290`:
   `!l && !e.showMarkup && i.language && i.closeFence &&
   t?.renderCustomCodeBlock` — `i` is the AST node being viewed; `i.language`
   and `i.closeFence` are properties that exist ONLY on `CodeBlockAstNode`
   (`dist/index.d.ts:273-341`). This hook is **structurally unreachable**
   for a `ParagraphAstNode` or `UnhandledBlockAstNode` — the view-node
   factory's `switch (n.kind)` (`dist/index.js:3795-3810`) never even calls
   the function that reads this option for those two kinds (see below).
   Confirmed empirically: `probe.btest.ts`'s `describe("case 4 —
   absence proof...")` test instruments this exact hook and mounts a
   document containing ONLY the two paragraph-shaped probes — the hook's
   call array is empty (`expect(await codeBlockHookCalls()).toEqual([])`)
   while the SAME instrumented hook, mounted against a real
   ` ```gutterpress-region ` fence in the companion "known-hook baseline"
   test, is called exactly once.
1b. **`BlockViewOptions.renderMath`** (`dist/index.d.ts:250`) — `(request:
   MathRenderRequest) => MathRendering | undefined`, where `MathRendering`
   (`dist/index.d.ts:2378-2383`) is `{ dom: HTMLElement; segments: readonly
   MathSourceSegment[] }` and `MathSourceSegment`
   (`dist/index.d.ts:2404-2411`) is `{ dom: Node; start: number; length:
   number }`. The SECOND inactive-form render hook the package exposes —
   missed by this record's original pass, which searched for a hook
   returning a bare `HTMLElement` and did not separately catalog the
   math-node surface. Its own doc comment
   (`dist/index.d.ts:238-245`) is explicit about what `segments` buys the
   caller: "let parts of the rendered math (e.g. individual identifier
   glyphs) map back to source ranges so the caret can land inside them."
   Confirmed live in `dist/index.js` (not just typed): both math view
   classes (block math at `dist/index.js:4474`, inline math at
   `dist/index.js:4580`) call `t?.renderMath?.(...)` and, when it returns a
   result, pass `c.segments`/`r.segments` straight into a shared helper,
   `Zs(node, segments, nodeLength)` (`dist/index.js:4438-4446`): it filters
   segments to valid, in-range spans, sorts them by `start`, and builds an
   ordered list of view leaves that TILE the node's full length — a
   zero-length text-node leaf for each gap the renderer did not map, and a
   real leaf wrapping the renderer's own `dom` for each reported segment.
   This is precisely the per-character source-mapping data structure a
   caret/selection/hit-test needs, and it is generic (`Zs` is not
   math-specific code — it is reused verbatim for both math view kinds).
   **Why this does not change the FORK verdict:** `renderMath` is invoked
   only from the two hardcoded math view classes
   (`dist/index.js:4474`/`4580`), gated on the AST already having been
   recognized as `mathBlock`/inline-math by the parser — there is no path
   that reaches it for a `ParagraphAstNode` or `UnhandledBlockAstNode`, so
   it is exactly as unreachable for this run's probes as item 1's hook, for
   the same structural reason. It remains true that no GENERIC hook exists
   today. **Why it matters anyway:** the `Zs()` tiling helper it feeds is
   itself generic, already proven, and already shipping for two block
   kinds — see "Fork proposal" below, revised to model the seam's return
   shape on `MathRendering`/`MathSourceSegment` rather than a bare
   `HTMLElement`, specifically so the fork's patch can reuse `Zs()` for the
   `"paragraph"`/`"unhandledBlock"` arms instead of leaving case 5's
   caret-entry-at-start and case 6's drag-imprecision findings as
   permanent, pinned limitations.
2. **Paragraph rendering has no options-based customization point at all.**
   `dist/index.js:3795-3796`: `case "paragraph": return new fe(n, "p",
   "md-block md-paragraph", e, we(t));` — the view class `fe`
   (`dist/index.js:4098-4105`) takes a fixed tag (`"p"`) and a fixed class
   string (`"md-block md-paragraph"`) as construction-time literals; the
   `options` parameter it does receive (`t`, i.e. `e` from the switch) is
   passed through ONLY to convert the paragraph's INLINE children (links,
   emphasis, etc. — via `we(t)`/`de(i)`), never to select or override the
   paragraph's OWN element or class. There is no `renderCustomParagraph`,
   no per-kind override, nothing.
3. **`UnhandledBlockAstNode` has exactly two hardcoded views, chosen by
   content shape, never by an option.** `dist/index.js:3805-3808`:
   `case "unhandledBlock": { const s = n.ast.htmlComment; return s ? new
   Ln(n, s, e, N(t, Ln)) : new Sn(n, e, N(t, Sn)); }`. `Ln`
   (`dist/index.js:4193-4203`) is an HTML-comment-specific view
   (`md-html-comment*` classes); `Sn` (`dist/index.js:4170-4192`), used for
   every OTHER unhandled construct, unconditionally builds `<div
   class="md-block md-unhandled-block"><pre class="md-code-block
   md-unhandled-scroll"><code>…verbatim source…</code></pre></div>` — the
   options parameter it receives is threaded ONLY into a recursive `Y(l, t,
   d)` call for its own children (markers/glue), never read to pick a
   different top-level element. Confirmed empirically against a `<div>plain
   html block</div>` fixture (deliberately not a comment, so it exercises
   `Sn` and not `Ln`): `kind === "unhandledBlock"`, class exactly
   `md-block md-unhandled-block`, and the same instrumented
   `renderCustomCodeBlock` was never called.
4. **The parser is not configurable.** `EditorModel` owns a `private
   readonly _parser` (`dist/index.d.ts:1057`) of type `MarkdownParser`
   (`dist/index.d.ts:2335-2337`), whose only public method is `parse(text,
   previous?, edit?)` — no constructor parameter, no extension list, no
   micromark-extension injection point anywhere in the public surface.
   `EditorModel`'s own public constructor takes zero arguments (also relied
   on by Lane A's adapter — see `src/vscode-adapter/adapter.ts`'s own
   comment on this). A paragraph-shaped marker line therefore has no way to
   be recognized as anything OTHER than `ParagraphAstNode` before it ever
   reaches view construction — confirmed at the PARSE level too:
   `dist/index.js:924-925`, `case "paragraph": return
   this._parseParagraph();` is reached for any line micromark tokenizes as
   its `paragraph` construct, which both `@page splash` and `::: sidebar`
   are (neither collides with any of the other explicitly-recognized token
   types the parser's block switch handles: `yaml`, `atxHeading`,
   `codeFenced`, `codeIndented`, `mathFlow`, `thematicBreak`, `blockQuote`,
   `listUnordered`/`listOrdered`, `table` — `dist/index.js:918-943`).
5. **The `./web-editors` embedded-editor providers are language-keyed, not
   generic.** `CodeBlockEditorSelector` (`dist/web-editors.d.ts:17-21`) is
   `{ language: string } | { languagePrefix: string }`, and
   `selectCodeBlockEditorProvider` (`dist/web-editors.d.ts:164`) matches
   against a `language` string — this is the SAME code-block-only seam as
   (1), reached through a different construction path
   (`VirtualizedIframeEmbeddedEditorFactory`), not an independent generic
   hook.
6. **The overlay/contribution system
   (`overlayContainer`/`rangeRects`/`forcedMarkerVisibleBlocks`) is additive,
   not substitutive — proven, not just read from docs.**
   `EditorView.overlayContainer` (`dist/index.d.ts:1306`) and `rangeRects()`
   (`dist/index.d.ts:1313`) exist specifically for contributions like the
   package's own `CommentModeController`, whose doc comment
   (`dist/index.d.ts:427-432`) states outright: "a compact 'add a comment'
   affordance layered on top of the editor *without modifying it*." This
   was verified empirically, not just cited: `probe.btest.ts`'s
   `describe("case 4 — overlay workaround...")` test mounts a real overlay
   chip positioned via `rangeRects()` over the `@page splash` block's exact
   range, and confirms the block's OWN DOM (kind, class, literal source
   text) is byte-identical before and after — the overlay cannot replace,
   hide, or participate in the block's text-flow position; it can only sit
   visually on top of it. `forcedMarkerVisibleBlocks`
   (`dist/index.d.ts:1234`) is unioned into the "show raw markers" set
   (confirmed live at `dist/index.js:6260`,
   `o.size === 0 ? i : new Set([...i, ...o])`) — it toggles WHICH state
   (marker-hidden vs. marker-visible) an already-recognized block renders
   in; it cannot make an ordinary paragraph render as anything other than a
   paragraph.

**The one viable workaround, and why it does not satisfy case 4 as
specified:** wrapping a Gutterpress region in a fenced code block with a
distinguishing info string (e.g. ` ```gutterpress-region `) makes
`renderCustomCodeBlock` reachable (see the "known-hook baseline" test,
which proves this concretely). But this requires the AUTHOR to write a
fence — CLAUDE.md's marker family (`@page`/`@chapter`/`@section`/etc.) is
explicitly a **paragraph-line** authoring surface, and the block-container
syntax (`:::name ... :::`) was deliberately **removed** from Gutterpress
core (see CLAUDE.md §5, "removed 2026-05-17... Do NOT reintroduce
`markdown-it-container` to core"). Projecting Gutterpress markers through a
fence the author never writes would require a **display-only rewrite** from
the author's real paragraph-shaped source to a synthetic fenced-code
representation purely to reach this hook — exactly the kind of
transform-origin/display-mapping machinery D6 and G-05 warn against
("Source origin is never inferred from presentation... Do not derive
writable ranges from... approximate line counts" and similar). This
implication is recorded, not resolved: **whether a fence-shaped mapping is
an acceptable interim design is a product decision this run does not make.**

## Case 5 — active/source-aware rendering for a projected block

**Question:** does activating the projected block expose source-aware
editing of its exact range, and does leaving it restore inactive rendering
with no byte drift?

**Answer: FAIL for the specified probe, because case 4 already failed for
that probe** — there is no custom-inactive-rendered "projected block" state
for `@page splash` to activate away from; a plain paragraph is always
already in its one and only (fully source-aware, fully editable) rendering.
Testing "activation" against it would exercise nothing beyond the base
editor's ordinary paragraph editing, already covered by cases 1/1b.

**However, the underlying two-state mechanics were tested for real, on the
one block kind where a custom-inactive state DOES exist** (the
`renderCustomCodeBlock`-painted ` ```gutterpress-region ` fence), because
D5's instruction is explicit that a fork's minimal seam should be evaluated
against real behavior, and because this is the closest real analog to what
a future generic hook would need to support. `probe.btest.ts`'s
`describe("case 5 — the ONE working two-state transition...")` test proves,
with real keyboard input driving the real `EditorController`:

- **Inactive → active swap is real and gated correctly.** Entering the
  block via `ArrowDown` (from the preceding block, real controller
  navigation) makes the custom chip disappear and the block's own DOM show
  the actual fenced-code source (fence markers, `gutterpress-region`
  language token, and body lines all present as real text) — confirmed via
  `dist/index.js:4290`'s `!e.showMarkup` gate: `renderCustomCodeBlock` and
  `embeddedCodeEditorFactory` apply ONLY while `showMarkup` is false;
  `showMarkup` true (block active) falls straight through to the package's
  ordinary `i.openFence` fenced-code rendering path
  (`dist/index.js:4315-4330`), which is real per-character DOM.
- **Editing while active submits a byte-exact host edit at the precise
  interior offset**, computed independently via `String.indexOf` (not
  inferred from navigation), and the resulting host text equals
  `original.slice(0, offset) + "X" + original.slice(offset)` exactly, with
  the host version incrementing by exactly 1 — D2/D3's "an accepted
  rich-editor edit changes only its explicit source range" holds for this
  path.
- **Deactivating restores the custom chip with zero further byte drift** —
  `hostText()` and `hostVersion()` after moving the caret back out are
  identical to their values immediately after the edit; leaving the block
  is not itself a source-mutating event.
- **One material, adversarially-discovered constraint, recorded honestly
  rather than smoothed over:** the FIRST position the controller lands the
  caret at, when entering a `renderCustomCodeBlock`-painted block from
  outside, is exactly the block's `absoluteStart` — i.e. immediately
  BEFORE the opening fence's backticks. An earlier version of this same
  test typed there directly; the inserted character corrupted the fence
  line (` X```gutterpress-region `no longer parses as a valid fence open),
  and the block reparsed as an ordinary paragraph on the next render. This
  is not a bug in the test alone — it is real evidence that **a custom
  chip's painted content carries none of the model's per-character layout
  data**, so entry lands at the one position the model can always compute
  (the block boundary) rather than anywhere meaningfully inside the custom
  painted text. A generic `renderCustomBlock` hook (see "Fork proposal")
  inherits this exact same characteristic and must be designed with it in
  mind — which is precisely why this finding belongs in the fork's contract
  tests, not just this record.

Given this, case 5 is reported **FAIL** for the run's literal probe (nothing
to activate), with the caveat that the mechanism a fork would rely on is
independently proven correct — on byte-locality, on state-gating, and on
zero-drift deactivation — for the one block kind that already has it.

## Case 6 — selection mapping through projected content

**Question:** do selections crossing the projected block map to correct
source offsets, with coherent caret enter/exit?

**Answer: PASS, scoped to the one real custom-rendering hook — fully proven
for the two keyboard legs, and (correction, SFE-P1b repair round 1)
scoped-not-yet-proven for the pointer-drag leg's offset PRECISION, since the
drag leg's own assertion cannot distinguish a correct offset pair from an
arbitrary in-range one (see item 3 below). Also scoped to the
` ```gutterpress-region ` fence probe only, per the caveat already recorded
at the end of this section — none of the three legs was additionally
exercised against the `@page splash` paragraph probe, so P1b2's re-run
against that probe is a FIRST proof, not a regression check.**
`probe.btest.ts` exercises this from three angles, per the run spec's "drive
a selection from before the probe block to after it (`page.keyboard`
shift+arrows and pointer drag)":

1. **Exact full-document keyboard selection** (`Control+Home` then
   `Shift+Control+End`) across the ` ```gutterpress-region ` block (custom,
   inactive, painted as a one-line chip bearing NO resemblance to its real
   4-line source): the resulting selection is EXACTLY `{anchor: 0, active:
   CODE_BLOCK_PROBE_TEXT.length}`, and the model-read "copy" slice
   (`sourceText.slice(start, endExclusive)` — the package's own
   `EditorController` doc, `dist/index.d.ts:951-967`, confirms copy/cut
   read the MODEL's selection, not the browser's native DOM selection,
   which is exactly what this reads) equals the full source byte-for-byte.
   The same exact-full-document assertion is repeated against the plain
   paragraph probes as a baseline.
2. **`Shift+ArrowDown` crossing**, stepped one keystroke at a time from the
   end of the preceding block: the anchor never moves, the active offset
   only ever advances (never regresses or goes `undefined`) across up to 12
   real keystrokes, and it demonstrably reaches past the projected block's
   exact `[absoluteStart, absoluteStart + length)` range. The resulting
   slice contains the fenced block's real fence markers and both body
   lines — the selection crossed the custom-painted block without skipping
   or truncating its source.
3. **Pointer drag** from inside the lead block toward the trail block: this
   is where the one real constraint showed up. The synthetic drag's
   final `endExclusive`, in this sandboxed run, landed INSIDE the
   projected block's own source range rather than past it into the trail
   block — i.e. dragging a mouse over a `renderCustomCodeBlock`-painted
   block does not reliably reach as far as the equivalent keyboard
   navigation does, for the same underlying reason recorded in case 5: the
   custom HTML carries no per-character layout data for the drag to
   hit-test against once the pointer is over it.
   **Correction (SFE-P1b repair, round 1):** the original text of this
   item claimed the resulting mapping was proven "an EXACT
   character-for-character match against the real source (not merely
   'contains' — full equality)" and that "the mapping that DID result was
   exact and uncorrupted every time this was run." Both statements
   overclaimed what the test evidence supports. The document under test is
   never edited by this test, so `slice` and
   `CODE_BLOCK_PROBE_TEXT.slice(start, endExclusive)` read the SAME static
   text — the equality assertion is true for ANY `(start, endExclusive)`
   pair the drag could have reported, including one bearing no relation to
   where the pointer actually landed; it cannot distinguish a correct
   mapping from an arbitrary in-range one. What lines 445-463 of
   `probe.btest.ts` actually establish, and what remains true and
   meaningful: **the drag's selection genuinely reached INTO the projected
   block** (`endExclusive > codeBlock.absoluteStart`, `start <=
   codeBlock.absoluteStart`), and **the source was not mutated or
   corrupted** (the resulting slice is well-formed and still contains the
   real fence marker, not a truncated or garbled read). Per this run's
   adversarial instruction ("a hook that technically renders HTML but
   breaks selection mapping... does NOT make a case PASS") those two facts
   are sufficient for a scoped PASS on reachability/non-corruption; they do
   NOT establish offset PRECISION, which is left an open question — this
   is recorded as a fork-scope consideration for P1b2 to close (either by
   proving precision via an independent point→offset computation, e.g. the
   package's own `VisualLineMap.offsetAtPoint`, or by explicitly continuing
   to scope it out with a stated reason), not a disqualifier for this run's
   FORK verdict.

## Fork proposal

**Revised (SFE-P1b repair, round 1).** The original proposal below returned
a bare `HTMLElement`, deferring the caret-entry/drag-precision constraint as
permanent and out of scope. That was written before this record's own
catalog (item 1b above) was corrected to include `renderMath` — the
package's OTHER inactive-render hook, whose `MathRendering`/
`MathSourceSegment` return shape is precisely a source-segment-mapping
contract, feeding a generic tiling helper (`Zs()`, `dist/index.js:4438-4446`)
already shipping for both math view kinds. The seam below is now modeled on
that shape so the fork can reuse the same helper for the `"paragraph"`/
`"unhandledBlock"` arms, rather than inheriting a limitation the package's
own code already shows how to avoid:

```ts
// BlockViewOptions, parallel to the existing renderCustomCodeBlock AND
// renderMath — same shape as MathRendering/MathSourceSegment
// (dist/index.d.ts:2378-2411), generalized past the math-node kind:
readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;

interface CustomBlockRendering {
  readonly dom: HTMLElement;
  /** Source-mapped spans within `dom` (need not tile the whole node) —
   * same contract as MathSourceSegment; the fork's patched paragraph/
   * unhandledBlock view classes pass this straight into the existing
   * Zs() tiling helper, exactly as the math views already do. */
  readonly segments?: readonly SourceSegment[];
}

interface SourceSegment {
  readonly dom: Node;
  readonly start: number;
  readonly length: number;
}
```

- Gated identically to `renderCustomCodeBlock`/`renderMath` today: only
  consulted while `!e.showMarkup` (block inactive); returning `undefined`
  falls back to the block's existing hardcoded view, byte-for-byte
  compatible with today's behavior for every existing caller.
- Applied at minimum to the `"paragraph"` and `"unhandledBlock"` arms of the
  view-node factory switch (`dist/index.js`'s `Y` function,
  `dist/index.js:3795-3810`), i.e. exactly the two arms this run's spikes
  proved have no such seam today.
- **No separate active-state hook is needed for these two kinds.** Unlike
  `CodeBlockAstNode` (which needed `embeddedCodeEditorFactory` for an
  INTERACTIVE inactive form), `ParagraphAstNode` and `UnhandledBlockAstNode`
  already have a working, fully source-aware ACTIVE rendering today (that is
  what case 4's absence-proof test observed directly) — once `showMarkup`
  flips true, the package's existing per-kind active view already shows
  real, editable source text. A parallel `renderCustomBlock` hook only needs
  to cover the INACTIVE side; the two-state transition itself (case 5's
  proven mechanics) comes for free from the existing `showMarkup` gate.
- Carries zero Gutterpress-specific vocabulary — `node`/`sourceText`/
  `CustomBlockRendering`/`SourceSegment` are generic, package-shaped types
  (the last two are a direct rename of `MathRendering`/`MathSourceSegment`
  to a non-math-specific name), matching D5's "generic seams only" and
  "avoid unrelated formatting or refactoring of upstream code."
- **`segments` is OPTIONAL, not mandatory, in the returned shape** — a
  caller (Gutterpress's own adapter/projection layer included) that has no
  per-character mapping to offer may omit it and fall back to exactly the
  bare-`HTMLElement` behavior the original proposal described: caret entry
  from outside lands at the block's start offset, and drag precision once
  inside is reduced (case 5/6's findings, still valid and still worth an
  explicit contract test as a fallback-mode pin). What changed is that this
  is now a CHOICE the caller makes per block, evidenced by a pattern the
  package already ships, not an inherent limitation of the seam itself.
- **Not resolved by this repair pass, and explicitly left for SFE-P1b2 to
  decide with evidence, not by default:** whether Lane B of the fork run
  actually wires `segments` through for Gutterpress's own custom blocks (it
  requires the projection layer to report per-character source-mapped DOM
  nodes for whatever it paints, which no run before P2b's projection work
  has designed yet) or defers that wiring while still shipping the
  `segments`-shaped seam so a later run can add it without another fork
  patch. Either choice is legitimate; recording the limitation as
  structurally inherent to the seam — as the original proposal did — is
  not, now that `renderMath` proves otherwise.

## Caveats and out-of-scope findings

- **Transient, since resolved:** an earlier verification pass in this same
  run observed `tsc --noEmit -p src/web.tsconfig.json` failing inside
  `tests/vscode-adapter/input-a11y/support/entry.ts` (a `Window.__gp` type
  declared with a different shape than Lane A's own declaration for the
  same global, plus several driver-method arity mismatches) — this file is
  outside Lane C's write ownership
  (`packages/editor/tests/vscode-adapter/input-a11y/**` is explicitly
  MUST-NOT-WRITE for this lane) and was never modified by Lane C. At the
  time, the tests still **ran and passed** (`bun test` transpiles without
  full type checking, so runtime evidence was unaffected), but the run
  spec's gate command did not exit 0 end-to-end. By this record's final
  verification pass (see "Commands run"), Lane B's concurrent work had
  resolved this and `bun run typecheck` passes cleanly with zero errors
  across all three lanes' files, with no filtering needed. Left in this
  record as a coordination note, not a currently-open issue.
- The direct construction of `EditorModel`/`EditorView`/`EditorController`
  in `packages/editor/tests/vscode-adapter/custom-view/support/entry.ts`
  imports `@vscode/markdown-editor` directly, unlike Lane A's own test
  entry. This is deliberate and confined to this run's own investigation
  code (see that file's header comment for the full justification): D5's
  "no application code outside `src/vscode-adapter/` may import package
  internals" governs the ADOPTED adapter's production import boundary; this
  lane's whole job is to determine whether that boundary is sufficient, and
  the current adapter's public surface (`VscodeEditorAdapter`) does not
  expose `overlayContainer`, `rangeRects`, `forcedMarkerVisibleBlocks`, or
  `EditorModel.selection` — all required to honestly investigate cases 4-6.
  No production code path relies on this file.

## Commands run

All from `packages/editor/` unless noted; all exit codes recorded as
observed by Lane C.

| Command | Exit | Notes |
|---|---|---|
| `bun build tests/vscode-adapter/custom-view/support/entry.ts --target=browser --format=esm --outdir=/tmp/gpc-build-check` | 0 | Bundles cleanly (130 modules) — sanity check before wiring the real harness. |
| `bun run typecheck` (early pass, mid-run) | 1 | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/web.tsconfig.json`. All errors at that point were confined to `tests/vscode-adapter/input-a11y/**` (Lane B, concurrently in progress, out of Lane C's write ownership); zero errors in any file Lane C touched. |
| `bun run typecheck` (final pass) | **0** | Re-run after Lane B's concurrent work continued — zero errors anywhere in the package, no filtering needed. |
| `bun test ./tests/vscode-adapter/custom-view/probe.btest.ts` | 0 | 10 pass / 0 fail / 87 `expect()` calls. Re-run 4 times total across this session for flake-checking (real-browser keyboard/pointer timing) — 10/10 green every run. |
| `bun run test` | 0 | Full non-browser suite (`bun test`, which excludes `*.btest.ts`): 126 pass / 0 fail across 11 files — confirms this lane introduced no regression to the existing core/web/vscode-adapter unit suites. |
| `bun run test:browser` | 0 | Lane A's own script (`bun test ./tests/vscode-adapter/browser.cases.btest.ts`): 13 pass / 0 fail — re-verified independently by Lane C as the source for cases 1/1b/2/3's PASS rows above. |
| `bun test ./tests/vscode-adapter/input-a11y/input-a11y.btest.ts` | 0 | Lane B's file, run directly (not via a package script, since no script wires it yet): 14 pass / 0 fail — source for cases 7/8's PASS rows above. Read-only: no file in this directory was modified. |

**SFE-P1b repair, round 1 — correction verification (Case 4 catalog /
`renderMath`):** re-grepped the exact installed
`@vscode/markdown-editor@0.0.2-84` runtime directly (not re-derived from
this record's own prior text): `grep -n "renderMath\|MathRendering\|MathSourceSegment" dist/index.d.ts`
confirms `renderMath` at line 250, `MathRendering` at 2378-2383,
`MathSourceSegment` at 2404-2411, exactly as cited above; `grep -n "renderMath\|\.segments\b" dist/index.js`
confirms both math view classes (block math ~line 4474, inline math ~line
4580) call `t?.renderMath?.(...)` and pass the result's `.segments` into a
shared helper `Zs()` defined at `dist/index.js:4438-4446`, which filters,
sorts, and tiles the segments across the node's full length with synthetic
zero-length gap leaves — read in full and summarized accurately in item 1b
above. `grep -rn "renderMath\|MathRender\|segments"` against both
`SFE-P1b-decision.md` (pre-correction) and `SFE-P1b2.md` returned zero
matches, confirming the omission this finding reported.

Per this run's own instructions, targeted verification is scoped to the
files this lane touched (`packages/editor/tests/vscode-adapter/custom-view/**`
plus this record) — the full run-spec gate (`bun install
--frozen-lockfile`, root `bun run typecheck`, `bun run
check:architecture`, `bun run knip`, `check:browser-purity`) is the
integrator's responsibility once all three lanes have landed.

## SFE-P1b2 fork-suite results

> Written by SFE-P1b2 Lane B per
> `docs/plans/source-first-editor/runs/SFE-P1b2.md`. Lane A vendored
> `packages/vscode-markdown-editor` (the internal fork committed and
> installed as `@dimm-city/vscode-markdown-editor`) and patched in the
> `renderCustomBlock` seam this section's evidence exercises — see
> `packages/vscode-markdown-editor/PATCHES.md` for the exact hunks. This
> section repeats the D5 suite (above) against that patched runtime and
> records cases 4, 5, and 6 for the probes this record's original run
> (SFE-P1b) found FAILing or scoped.

### Cases 4 and 5 — now PASS against the fork

Both probes named in the original FAIL rows above (the `@page splash`
paragraph marker and a standalone `<div>plain html block</div>`
unhandled-block probe) now get real custom inactive rendering, and case 5's
full two-state mechanics (activate → byte-exact edit → deactivate with zero
drift) are proven directly on the paragraph probe, not merely by analogy to
the fenced-code hook as the original record's case 5 section had to settle
for.

Evidence: `packages/editor/tests/vscode-adapter/custom-view/fork-hook.btest.ts`
(new file, SFE-P1b2 Lane B; wired into `packages/editor/package.json`'s
`test:browser` script as a fourth `&& bun test <file>` segment):

| # | Case | Result | `describe` block |
|---|---|---|---|
| 4 | Positive: paragraph probe gets the chip; heading/list/codeBlock in the same document keep their own default rendering | **PASS** | `"case 4 — renderCustomBlock fires for the paragraph probe, and NOT for a heading/list/codeBlock in the same document"` |
| 4 | Positive: standalone unhandled-block probe gets the chip | **PASS** | `"case 4 — renderCustomBlock fires for the <div> unhandled-block probe"` |
| 4 | Hook called with exact node kind + exact `sourceText` slice (cross-checked against an independently-sliced `[absoluteStart, absoluteStart+length)` read of the static fixture) | **PASS** | `"case 4 — the hook is called with the exact node kind and the exact sourceText slice"` |
| 4 | Negative: never consulted for the block's OWN active render (other inactive blocks may legitimately be re-consulted on the same re-render — checked honestly, not assumed) | **PASS** | `"case 4 — never consulted for the ACTIVE render of the block itself"` |
| 4 | Fallback: `undefined` → byte-identical DOM to a no-hook control mount (`outerHTML` equality) | **PASS** | `"case 4 — fallback: returning undefined falls through to the exact default view"` |
| 5 | Bare-dom fallback (no `segments`): entry lands at `absoluteStart`; typing PREPENDS onto the marker line, byte-exact, version+1; leaving restores the chip with zero further drift | **PASS** | `"case 5 — bare-dom fallback (no segments): entry lands at absoluteStart; typing PREPENDS onto the marker line, safely (unlike the fence-corruption hazard)"` |
| 5 | Segmented chip: entry lands INSIDE at the exact expected offset (not merely "in range"); interior edit is byte-exact at that offset; leaving restores the chip with zero further drift | **PASS** | `"case 5 — segmented chip: entry lands INSIDE at the exact expected offset; interior edit is byte-exact; leaving restores the chip with zero drift"` |

A real, empirical, non-obvious finding surfaced while building this suite,
worth recording alongside the pass results: **a `renderCustomBlock`
provider must add `"md-block"` to its own returned `dom` itself.** Unlike
the pre-existing `renderCustomCodeBlock` path (whose own hardcoded view
class adds `"md-block"`/`"md-code-block"` to the element it's handed —
`dist/index.js:4325`/`4334`), the fork's new `"paragraph"`/`"unhandledBlock"`
arms mount the returned `dom` completely unmodified via the shared `T` base
view-node class, which adds no class at all. Confirmed by grepping the
whole patched `dist/index.js`: `"md-block"` is added at exactly those two
pre-existing call sites and nowhere else — every other hardcoded block view
supplies its own `"md-block …"` string at construction time. Without it,
`.md-document > .md-block` DOM queries silently skip the block, AND —
more materially — the measured layout that keyboard/pointer navigation
depends on treats the block as absent (observed live: a chip missing this
class was skipped entirely by `ArrowDown`, landing straight on the next
block instead of entering the chip at all). This is recorded in
`support/entry.ts`'s provider as a load-bearing comment, not just here,
since any future production `renderCustomBlock` provider (Gutterpress's own
projection layer included, in a later run) will need to do the same thing.

### Segments decision — option (a): real per-character `segments` ARE wired

Per the run specification's "Constraint decision required" section, this
run made an explicit, evidenced choice rather than defaulting to the
bare-`dom` pin: **`support/entry.ts`'s test-only provider wires real,
per-character `segments` for the `@page splash` paragraph probe** (its
`"segmented-text"` mode — one real DOM `Text` node per character, each
reported as its own length-1 `SourceSegment`, contiguously tiling the whole
node span with no gaps for `Zs()` to backfill). This was attempted, proven
to work, and is now covered by passing contract tests — not deferred.

Evidence, `fork-hook.btest.ts`, `describe("segments decision — caret-entry
and drag precision now match the keyboard baseline (option (a): segments
ARE wired)")`:

- **Caret-entry precision.** Four independent fresh-mount clicks at four
  distinct character positions inside the segmented chip (`"@page splash"`,
  characters 0, 1, 6, 11) each land the caret at a distinct, EXACTLY
  predicted offset (`absoluteStart + charIndex + 1`, reproducibly stable
  across repeated runs — verified live, not asserted from the patch alone).
  This is the material contrast with the bare-dom fallback (case 5 above):
  entry no longer collapses to `absoluteStart` for every click — it lands
  wherever the pointer actually was, character-accurate.
- **Cross-checked by a second, independent mechanism.** Every expected
  offset above is also verified against `EditorView.measuredLayout
  .visualLineMap.get().offsetAtPoint(...)` (exposed by this run's new
  `offsetAtClientPoint` driver method) at the exact same client-space
  point — a wholly separate code path from the selection the click itself
  produced, and it agrees exactly, every time.
- **Drag precision now matches the keyboard baseline.** A real pointer
  drag from character index 1 to character index 10 inside the segmented
  chip selects EXACTLY `[absoluteStart+2, absoluteStart+11)` — not merely
  "reached into the block" (the qualifier the original fenced-code drag
  test needed), but the PRECISE expected range, independently predicted via
  `String.indexOf` against the static fixture and independently
  cross-checked via `offsetAtClientPoint` at both drag endpoints. This is
  the "drag precision matches the keyboard-navigation baseline" proof the
  run specification's segments-decision option (a) requires.
- **Interior edits are byte-exact at the clicked offset**, not a prepend
  (case 5's segmented-chip test above): typing after clicking mid-`"splash"`
  produces `"@page sXplash"`, an interior insertion — materially different
  from, and strictly better than, the bare-dom fallback's forced prepend.

The bare-dom (no-`segments`) mode is not abandoned — it is deliberately
KEPT and exercised as its own explicit, still-legitimate mode (case 4's
`"label"`/`"plain-text"` probes and case 5's first test above), reachable
via `CustomBlockMountOptions.mode`, per the seam's own contract
(`segments` is optional). Its constraints (entry at `absoluteStart`,
typing prepends) are pinned as explicit, passing assertions in case 5's
bare-dom test, not left as an unstated default.

### Case 6 (re-run) — first proof on the paragraph probe, with the hook active

The original case 6 section above scoped its result to the
` ```gutterpress-region ` fenced-code probe only, noting explicitly: "none
of the three legs was additionally exercised against the `@page splash`
paragraph probe, so P1b2's re-run against that probe is a FIRST proof, not
a regression check." That re-run is now done, in
`fork-hook.btest.ts`, with the fork's `renderCustomBlock` hook ACTIVE
(segmented mode, so the block is genuinely custom-painted, not merely
inactive-by-default):

| Leg | Result | `describe` block |
|---|---|---|
| Full-document keyboard selection (`Ctrl+Home` / `Shift+Ctrl+End`) across the custom-rendered probe; copy-slice equality against the model | **PASS** | `"case 6 (re-run, first proof) — full-document keyboard selection across the active paragraph probe"` |
| `Shift+ArrowDown` crossing, stepped one keystroke at a time, anchor stable / active monotonic, reaching past the probe's exact range | **PASS** | `"case 6 (re-run, first proof) — Shift+ArrowDown crossing the active paragraph probe"` |
| Pointer-drag precision | **PASS, and now EXACT (not merely "reached into")** — see the segments-decision drag result above, which is this leg's paragraph-probe proof | — |

All three legs are green on the paragraph probe. Unlike the original
case 6 (fenced-code probe, no `segments` available for that hook), the
drag leg here achieves EXACT offset precision because `segments` are wired
for this probe — closing the "drag precision" gap that record's case 6
section left open, for this probe.

### The inherited advisory — inert pointer-drag assertion, resolved

`probe.btest.ts`'s `"case 6 — selection mapping across the fenced-code
projected block"` describe block's pointer-drag test ended with a
tautological assertion (`SFE-P1b` repair round 1 had already flagged it as
proving nothing: `slice` and a fresh slice of the same static,
never-mutated `CODE_BLOCK_PROBE_TEXT` read the identical text regardless of
what offsets the drag actually reported). This run's instructions offered
two legitimate resolutions: make it invertible via an independent
point→offset computation "if the fork's segments make that possible", or
delete it.

**Resolution: neither literally — invertible, but not via `segments`.**
`segments` genuinely is NOT possible for that specific test's target block:
it targets `renderCustomCodeBlock`
(`(language: string, content: string) => HTMLElement | undefined`), the
PRE-EXISTING, unpatched hook — structurally incapable of carrying
`SourceSegment`s (only the NEW `renderCustomBlock` seam this run added
supports `segments`, and only for the `"paragraph"`/`"unhandledBlock"`
arms, never `codeBlock`). But an independent point→offset computation does
NOT require `segments` to exist for the target block: `VisualLineMap
.offsetAtPoint` is a general geometry query over the package's own measured
layout, unrelated to whether any per-character source mapping was ever
supplied. The tautological line was replaced with:

```ts
const independentEndOffset = await offsetAtClientPoint(dragEndX, dragEndY);
expect(independentEndOffset).toBe(sel!.endExclusive);
```

computed from the exact real client-space coordinates the drag's mouse
ended at — a value derived from NEITHER `sel` nor `slice`, so it cannot be
tautological the way the deleted line was. Verified live, reproducibly
(3 consecutive full-file runs, `probe.btest.ts`, 10/10 pass each time):
this independent query returns EXACTLY `sel!.endExclusive` for this exact
drag, in this exact sandbox — genuine, non-vacuous evidence that the
reported selection offset really is where the package's own rendered
geometry says that pixel maps to. The two weaker, still-valid assertions
this test already made (`endExclusive > codeBlock.absoluteStart`: the drag
genuinely reached into the block; the slice still contains the fence
marker: no corruption) are unchanged. `offsetAtClientPoint` was added to
`support/entry.ts`'s driver by this run specifically to make this fix
possible, and is reused (via `segmentCharacterCenter`-driven clicks) as the
primary precision-proof mechanism throughout the segments-decision section
above.

### Updated verdict

**The D5 suite is now fully green against the fork.** Every one of D5's 8
mandatory compatibility cases passes against the patched, vendored
`@dimm-city/vscode-markdown-editor` runtime: cases 1/1b/2/3/6/7/8 as
already recorded above (re-run unmodified against the fork by SFE-P1b2's
Lane A per the run spec's "No-hook compatibility" requirement), and cases
4 and 5 — previously FAIL for the run's specified probes — now PASS, with
the segments decision resolved as option (a) (real per-character segments
wired, proven, not deferred) and case 6 given its first proof on the
paragraph probe. `SFE-P1b.md`'s "FORK" verdict (ratified by the integrator,
above) is fully discharged: the fork exists, is minimal (PATCHES.md: seven
hunks total — four behavioral, in `dist/index.js`, plus three
type-only/documentation hunks in `dist/index.d.ts` — no reformatting of
upstream code, zero Gutterpress vocabulary), and the seam it adds closes
every gap the original D5 exploration found.

**Commands run** (all from `packages/editor/`, all exit codes as observed
by SFE-P1b2 Lane B):

| Command | Exit | Notes |
|---|---|---|
| `bun run typecheck` | 0 | `tsc --noEmit -p tsconfig.json && tsc --noEmit -p src/web.tsconfig.json` — zero errors across every file this lane touched. |
| `bun run test` | 0 | 126 pass / 0 fail across 11 files (non-browser suite; unaffected by this lane's changes). |
| `bun test ./tests/vscode-adapter/custom-view/probe.btest.ts` | 0 | 10 pass / 0 fail / 88 `expect()` calls (up from 87 — the resolved pointer-drag assertion). Re-run 3 times for flake-checking: 10/10 green every run. |
| `bun test ./tests/vscode-adapter/custom-view/fork-hook.btest.ts` | 0 | 12 pass / 0 fail / 126 `expect()` calls. Re-run 3 times for flake-checking: 12/12 green every run. |
| `bun run test:browser` | 0 | All four suites in sequence (`browser.cases.btest.ts` 15/15, `input-a11y.btest.ts` 14/14, `probe.btest.ts` 10/10, `fork-hook.btest.ts` 12/12) — 51/51 total. Re-run twice: stable both times. |

Per this run's write-ownership boundary, this lane's targeted verification
is scoped to `packages/editor` (`typecheck`, `test`, `test:browser`); the
full run-spec gate (`bun install --frozen-lockfile`,
`node packages/vscode-markdown-editor/scripts/verify-vendored.mjs`,
`bun run check:architecture`, `bun run knip`, root-level
`check:browser-purity`) is the integrator's responsibility once all lanes
have landed.

# SFE-P1b2 — Minimal internal fork: `renderCustomBlock` seam

## Objective

Execute the ratified FORK verdict from `SFE-P1b-decision.md`: vendor the exact
published `@vscode/markdown-editor@0.0.2-84` artifact as an internal package,
apply the smallest possible patch adding the ONE missing generic seam
(`BlockViewOptions.renderCustomBlock`), repeat the exact D5 suite against the
forked runtime, and turn cases 4 and 5 green.

## Allowed behavior changes

- New internal workspace package `packages/vscode-markdown-editor`
  (`@dimm-city/vscode-markdown-editor`, private, never published).
- `packages/editor` switches its dependency and the adapter's import specifier
  from the registry package to the fork.
- The registry dependency `@vscode/markdown-editor` is REMOVED from
  `packages/editor` in the same run (no dual dependency).

## Behavior that must remain unchanged

- Every existing test in every package. The pre-fork D5 suites (cases
  1/1b/2/3/6/7/8) must pass UNMODIFIED against the fork — byte-for-byte
  behavioral compatibility when `renderCustomBlock` is not supplied.
- The D3 contract and adapter public API.

## Binding decisions

- **D5 (fork contract)** — the fork must: record upstream package version and
  source commit; retain MIT notices; contain only generic extension seams, not
  Gutterpress-specific syntax; include an upstream-diff document and contract
  tests; remain internal; avoid unrelated formatting or refactoring of
  upstream code.
- **Provenance constraint (recorded, session-specific)** — the upstream source
  repo (`microsoft/vscode-packages`, dir
  `vscode-team-tools/packages/markdown-editor`, gitHead
  `b5fd5cda44376c118dd383f8c03ac4f6a06c648e`) is not reachable from this
  execution session (cross-owner repo attach unsupported), and the npm tarball
  ships only bundled `dist/` (no TS source). The fork therefore vendors the
  PUBLISHED ARTIFACT and patches `dist/index.js` + `dist/index.d.ts`
  surgically. This is recorded as a deviation with a follow-up: regenerate the
  fork from upstream source (or upstream the seam as a PR) when the source
  repo is accessible. An upstream feature request for `renderCustomBlock` is
  the preferred end-state; the fork is designed for deletion (CLAUDE.md's
  design-for-deletion rule).
- **The seam (from the decision record's proposal, revised per the
  record's SFE-P1b repair round-1 correction — this is NOT the bare-
  `HTMLElement` shape an earlier draft of the record proposed):**

  ```ts
  // BlockViewOptions, parallel to the existing renderCustomCodeBlock AND
  // renderMath — CustomBlockRendering/SourceSegment are a direct rename of
  // the package's own MathRendering/MathSourceSegment (dist/index.d.ts:
  // 2378-2411) to a non-math-specific name, not a new shape:
  readonly renderCustomBlock?: (node: BlockAstNode, sourceText: string) => CustomBlockRendering | undefined;

  interface CustomBlockRendering {
    readonly dom: HTMLElement;
    /** Optional — omit for the bare-HTMLElement fallback behavior described
     * below. When present, threaded into the same Zs() tiling helper the
     * package's own math views already use (dist/index.js:4438-4446). */
    readonly segments?: readonly SourceSegment[];
  }

  interface SourceSegment {
    readonly dom: Node;
    readonly start: number;
    readonly length: number;
  }
  ```

  - Consulted ONLY while the block is inactive (the existing `!showMarkup`
    gate), for the `"paragraph"` and `"unhandledBlock"` view-factory arms.
  - Returning `undefined` falls through to the existing hardcoded view —
    behavior byte-identical to upstream for every existing caller.
  - Reuses the same wrapper machinery the existing `renderCustomCodeBlock`
    path uses for the plain-`dom`, no-`segments` case (no new view-node
    class unless structurally unavoidable — study how the code-block
    custom path wraps its `HTMLElement` result and mirror it); reuses
    `Zs()` directly (unmodified) for the `segments`-present case, exactly
    as the existing math views call it.

## Recorded facts

- Patch sites located by SFE-P1b Lane C with live citations: view-factory
  switch at `dist/index.js:3795-3810` (paragraph arm constructs `fe(n, "p",
  "md-block md-paragraph", e, we(t))`; unhandledBlock arm chooses `Ln`
  (html-comment) or `Sn`), custom-code-block gate at `dist/index.js:4290`
  (`!l && !e.showMarkup && i.language && i.closeFence &&
  t?.renderCustomCodeBlock`), segment-tiling helper `Zs()` at
  `dist/index.js:4438-4446` (called by both math view classes,
  `dist/index.js:4474`/`4580`, with `renderMath`'s returned `segments`).
- License: MIT (declared in the package manifest; no LICENSE file in the
  tarball — the NOTICE records the declaration and upstream copyright).
- **Constraint decision required, not a foregone pin (SFE-P1b repair,
  round 1):** the decision record's original text treated caret-entry-at-
  start and reduced drag precision as inherent to any custom-painted block
  and instructed the contract tests to pin them as permanent limitations.
  That is no longer accurate — `renderMath`'s `segments` mechanism is a
  proven, already-shipping way to avoid both, and the seam above carries
  it. Lane B must make an explicit, evidenced choice per probe rather than
  defaulting to the pin:
    - If Lane B wires real per-character `segments` for the `@page splash`
      paragraph probe and the `<div>` unhandled-block probe (requires the
      test-only provider to report source-mapped DOM nodes for its own
      painted content — no production projection code is required to do
      this yet), write contract tests proving caret entry lands INSIDE the
      custom content at the correct offset and drag precision matches the
      keyboard-navigation baseline, and record cases 5/6 as fully resolved
      for the fork, not merely scoped.
    - If Lane B defers `segments` wiring for this run (e.g. because the
      projection layer's own per-character source-mapping isn't designed
      until P2b), it must say so explicitly in the decision-record update,
      with the reason, and pin the bare-`dom`-only fallback behavior
      (caret-entry-at-start, reduced drag precision) as a DEFERRED
      limitation of the *current wiring*, not an inherent property of the
      seam — and note it as a candidate to revisit once P2b's projection
      work exists.
  Either outcome is legitimate; recording the fallback behavior as
  structurally unavoidable, without stating which choice was made and why,
  is not.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Fork package loads | `@dimm-city/vscode-markdown-editor` resolves; unpatched surfaces byte-identical (checksum manifest of vendored files vs the published tarball, with the patched files listed as the ONLY diffs) | A |
| No-hook compatibility | Full pre-fork D5 suites (1/1b/2/3/6/7/8) pass against the fork with zero test edits | A |
| Case 4 green | `renderCustomBlock` fires for the `@page splash` paragraph probe and the `<div>` unhandled probe when inactive; custom HTML rendered; NOT consulted when active (`showMarkup`) | B |
| Case 5 green | Caret entry activates the block (custom chip → real source), interior edits are byte-exact at the correct offsets, deactivation restores the chip with zero drift | B |
| Fallback | Hook returning `undefined` → upstream default view (DOM equality with unforked baseline) | B |
| Selection through custom block | Case-6 suite re-run with the hook active on the paragraph probe: keyboard crossing + full-document selection map exactly | B |
| Segments decision | Explicit, evidenced choice recorded (decision-record update): either real `segments` wired for both probes with caret-entry/drag-precision tests proving they now succeed, or an explicit deferral naming the reason — never an unstated pin (see "Recorded facts" above) | B |
| Constraint pins (fallback mode only) | IF `segments` is deferred for a probe: caret-entry-at-start and drag-precision constraints for that probe's bare-`dom` fallback asserted as explicit expectations (so an upstream or later-run change that fixes them trips a pin and gets noticed) | B |

## Lane ownership (Lane A FIRST, sequential; then Lane B)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/vscode-markdown-editor/**`, `packages/editor/package.json` (dep swap), `packages/editor/src/vscode-adapter/**` (import specifier only), `knip.jsonc` (fork workspace entry if needed) | test files, other packages, tools | Vendored fork + patch + `PATCHES.md` + `NOTICE` + checksum manifest + dep swap |
| B | `packages/editor/tests/vscode-adapter/custom-view/**` (new fork-hook btest files), `docs/plans/source-first-editor/runs/SFE-P1b-decision.md` (append fork-suite results) | fork internals, adapter, other packages | Cases 4/5 green + fallback + constraint pins + decision-record update |
| Integrator | `bun.lock`, milestone commits | — | Install, verification, commits |

## Security and trust

- The vendored artifact's unpatched files must be PROVEN identical to the
  published tarball (sha256 manifest generated at vendor time; a verify script
  re-checks it so a silent local edit of vendored code cannot hide).
- No new network access at build or runtime; the fork is plain files.

## Test plan

- Lane A: a `verify-vendored.mjs` script (checksums; patched files listed
  explicitly) + the full existing suite re-run.
- Lane B: fork-hook contract btests per the behavior table; every test with
  liveness assertions; sabotage note (disable the patch → case 4 tests fail).

## Review dimensions

- Is the patch the smallest possible (only the two arms + the type + the
  option threading — no reformatting, no unrelated edits)?
- Is unpatched-file identity proven by checksums, not asserted?
- Do the pre-fork suites really run unmodified against the fork?
- Could the hook fire for an ACTIVE block or a non-paragraph/unhandled kind?
- Does the fork carry any Gutterpress vocabulary (it must not)?

## Gate

> Use `cd <pkg> && bun run <script>` — never `bun --cwd`.

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/editor && bun run test`
- `cd packages/editor && bun run test:browser`
- `node packages/vscode-markdown-editor/scripts/verify-vendored.mjs`
- `cd packages/editor && bun run check:browser-purity`
- `bun run check:architecture`
- `bun run knip`

## Review log

<!-- Appended by the review stage. -->

# ADR 0013 — One shared, framework-free editor package for desktop and VS Code

Date: 2026-09-01 · Status: accepted · Implemented by: SFE-P1a, P1b, P1b2, P3a, P3c, P3f

> **Supersedes, in part:** the (missing) platform-abstraction ADR that
> `CLAUDE.md` and several desktop source comments still cite as "ADR 0004" —
> that record does not exist in this repository (see ADR 0009's "Note on
> predecessors" and the deletion ledger's SFE-P5a entry). Where those
> comments describe the desktop/VS Code host-portability boundary, this ADR
> and ADR 0016 are the current record.

## Context

Gutterpress needed the same rich-editing experience in two very different
hosts: the Electron desktop app (Svelte, full Node access, IPC) and a VS
Code extension (a `TextDocument`/`WorkspaceEdit`-owning extension host plus
a webview with no Node or filesystem access at all). Building or
maintaining two independent rich editors was rejected outright by the plan
(non-goal: "no arbitrary extension API... no second rich-text engine";
D4: "the same web editor mount is used by desktop and VS Code").

The plan named `@vscode/markdown-editor@0.0.2-84` (exact-pinned, no caret or
tilde range) as the initial dependency candidate and set a deterministic
gate (D5) rather than a judgment call: adopt the package directly through
one adapter file if eight mandatory compatibility cases pass; fork only the
minimal missing generic seam if a real gap is found; stop and re-plan if the
gap requires Gutterpress-specific syntax or broad rewrites.

## Decision

**`packages/editor` (`@dimm-city/gutterpress-editor`, Experimental in
0.11.0) is the one framework-free, browser-safe editor package.** It
imports `@vscode/markdown-editor` (via the fork below) and
`gutterpress/render` (ADR 0011's projection), and nothing else host-shaped —
no Svelte, Electron, `vscode`, or `node:fs` imports (plan D4). Desktop wraps
it in a thin Svelte shell; the VS Code extension wraps it in a webview
bootstrap. Both hosts mount the exact same package.

**The compatibility gate ran for real, against the real pinned runtime, and
found a genuine gap.** All eight of D5's mandatory cases were exercised with
live browser input (`packages/editor/tests/vscode-adapter/**`). Seven passed
outright against the unforked package: exact source edits, no-edit byte
identity, external authoritative replacement, host-delegated undo/redo,
selection mapping (scoped), custom CSS/isolated mounting, and
clipboard/IME/accessibility/disposal. Case 4 — custom inactive rendering for
a Gutterpress-shaped block (a paragraph-line marker like `@page splash`, or
an unhandled-block region) — failed: the package exposes exactly two
inactive-render hooks, both keyed to a specific AST node kind
(`renderCustomCodeBlock` for fenced code, `renderMath` for math nodes), and
neither fires for a plain paragraph or unhandled block
(`docs/plans/source-first-editor/runs/SFE-P1b-decision.md`, catalogued
against the shipped `dist/index.js`, not assumed from typings).

**The verdict was FORK, per D5's own condition** ("if and only if a generic
custom-block/view hook is absent... failure of unrelated optional styling
does not justify a fork"): the missing seam was narrow, precisely named, and
had a direct precedent already shipping in the package (`renderMath`'s
segment-mapping return shape). `packages/vscode-markdown-editor`
(`@dimm-city/vscode-markdown-editor@0.0.2-84.gp.1`) is the resulting minimal
internal fork. It carries **two** patches, applied on top of the unmodified,
published `0.0.2-84` artifact and fully itemized in
`packages/vscode-markdown-editor/PATCHES.md`:

- **Patch 1 — `renderCustomBlock`** (Hunks 1-7): adds one new option,
  `renderCustomBlock`, gated identically to the two existing hooks
  (`!showMarkup` only) and reachable for the `"paragraph"` and
  `"unhandledBlock"` AST arms specifically — the two arms P1b proved have no
  seam today. No other view KIND is touched by this patch (a paragraph's own
  `ViewData` gains one already-computed field it previously discarded before
  view-construction — Hunks 1-2 — but no other block type's view or the
  render loop itself is touched). Its return shape
  (`CustomBlockRendering { dom, segments? }`) is a direct, non-math-specific
  rename of the package's own `MathRendering`/`MathSourceSegment`, reusing
  the package's existing `Zs()` per-character tiling helper rather than
  inventing a parallel mechanism. Four hunks are behavioral in
  `dist/index.js`, three are type-only in `dist/index.d.ts`.
- **Patch 2 — `measurement`** (Hunks 8-10, SFE-P3f — the D13 250 KiB p95
  budget fix): three behavioral hunks, all in `dist/index.js`, none in
  `dist/index.d.ts`. Unlike Patch 1, this patch DOES touch the package's
  core render loop: `gpTranslateVisualLineMap` is a new helper (Hunk 8),
  `_publishMeasurements` — the sole producer of every consumer's measured
  layout, per `PATCHES.md`'s own consumer map — gains an `incremental`
  parameter (Hunk 9), and its `_renderAutorun` call site is updated to pass
  it (Hunk 10). The patch translates a cached, correct `visualLineMap`
  instead of re-walking the DOM for a block whose rendered subtree is
  provably unchanged; every block still gets a complete measurement
  published at the same point in the render cycle as before — see
  `PATCHES.md`'s "Patch 2" section for the full consumer-safety argument and
  the `absoluteStart`-keyed cache-reuse guard (`gpReusable`) that makes the
  translation exact rather than approximate.

Ten hunks total against upstream, across the two files the fork touches
(`dist/index.js`, `dist/index.d.ts`) — not seven against one story. Both
patches keep MIT notices, upstream version, and source recorded, and add no
unrelated reformatting of upstream code — matching D5's fork requirements.
"No Gutterpress vocabulary" describes the package's PUBLIC surface (option
names, return shapes: `renderCustomBlock`, `CustomBlockRendering`) — the
patch SITES themselves are deliberately marked with `/* gp-fork:
renderCustomBlock */` / `/* gp-fork: measurement */` comments and, in Patch
2, `gp`-prefixed internal identifiers (`gpTranslateVisualLineMap`,
`gpReusable`) precisely so a patch site is unambiguous to find and diff
against upstream; these are patch-site markers, not authoring vocabulary
leaking into the package's behavior or API.

Re-running the full D5 suite against the Patch-1-patched runtime (SFE-P1b2)
turned cases 4 and 5 from FAIL to PASS, with `segments` genuinely wired (not
deferred) for character-accurate caret entry and pointer-drag precision
matching the keyboard baseline. Patch 2 (SFE-P3f) was added later, against a
different D-decision (D13's performance budget), and is verified by its own
differential proof (`docs/plans/source-first-editor/p3d-sweep-audit.md`,
"Lane D") rather than the D5 suite.

**No application code outside `packages/editor/src/vscode-adapter/` imports
package internals** (D5), of either the upstream package or the fork — the
fork is consumed exactly like any other pinned dependency, through the one
adapter.

## Consequences

- One editor implementation, two thin host wrappers — a defect fixed in
  `packages/editor` (a selection bug, a projection-consumer bug) is fixed
  for both desktop and VS Code simultaneously, by construction.
- The fork is bounded and auditable: `PATCHES.md` is the complete diff
  against a named upstream version, so upstream shipping either of two
  independent things natively is a small, provable deletion of the matching
  patch — Patch 1 (`renderCustomBlock`) needs an equivalent generic
  custom-block hook, Patch 2 (`measurement`) needs `_publishMeasurements`
  to skip unchanged blocks on its own — and unforking the package entirely
  requires BOTH, not one (the same "thin over capable, design for deletion"
  discipline root `CLAUDE.md` applies to rendering-engine shims applies here
  to this fork).
- The fork remains an internal package, not a public Gutterpress API
  (D5) — `gutterpress`'s own public exports (ADR 0011, and this run's
  subpath work) never re-export it.
- Case 6's original pointer-drag assertion against the unforked package was
  found tautological during review (it could not distinguish a correct
  offset from an arbitrary in-range one) and was replaced with an
  independent point→offset check via the package's own measured-layout
  query — recorded here because it is exactly the kind of gate-calibration
  finding `pr158-lessons.md` AP-22 warns is easy to miss.

## Alternatives rejected

- **Two independent rich editors (one Svelte-native, one VS Code-native)** —
  rejected by plan non-goal; doubles the authoring-command surface
  (`pr158-lessons.md` AP-18, "build similar authoring logic twice") for no
  product benefit.
- **A broad or immediate fork, skipping the direct-adoption gate** —
  rejected by D5's own sequencing; the gate proved seven of eight cases
  needed no fork at all, and the one gap found is narrow specifically
  because the direct-adoption attempt ran first and located it precisely.
- **Solving case 4 by wrapping Gutterpress markers in a fenced code block**
  (making the pre-existing `renderCustomCodeBlock` hook reachable without
  any fork) — investigated and rejected: it would require authors to write
  a fence Gutterpress's own marker syntax deliberately never uses (root
  `CLAUDE.md` §5: block-container syntax was removed from core), turning a
  display need into a source-shape requirement — exactly the
  transform-origin/display-mapping hazard ADR 0011 and G-05 warn against.

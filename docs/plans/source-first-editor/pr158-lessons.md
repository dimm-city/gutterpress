# Gutterpress PR 158 Experiment Review — Lessons, Anti-Patterns, and Implementation Guardrails

> **Status:** Companion implementation guide for `gutterpress-source-first-paginated-rich-editor-enterprise-refactor-plan.md`.
>
> **Purpose:** Preserve the useful engineering knowledge produced by PR 158 without carrying its rejected ProseMirror architecture into the new source-first editor. This document tells implementers what the experiment proved, which work should be reused or re-created, which patterns must not return, and which uncertainties require measured spikes rather than assumptions.
>
> **Authority:** The current orchestrated implementation plan and its binding decisions take precedence over this guide. PR 158 is evidence and history, not the implementation baseline.

---

## 1. Executive verdict

PR 158 was a valuable engineering experiment and an unsuitable integration base.

It proved several hard product and engineering facts:

1. A Gutterpress rich editor must be **continuously paginated and styled with the actual resolved Gutterpress presentation stack**. A generic rich Markdown surface is not sufficient.
2. Exact author source, generated pipeline output, plugin presentation, editor chrome, and page furniture are different kinds of data and must never be conflated.
3. Plugin-heavy books invalidate simplistic assumptions about Markdown tokens, source maps, HTML wrappers, and one-node-per-region rendering.
4. Unit and round-trip tests can all pass while the editor is unusable, visually wrong, or unable to open.
5. Pagination and styling must be measured in the packaged product against real books; screenshots alone and source-level reasoning are not enough.
6. The editor must own a stable semantic DOM. Pagination may measure and decorate that DOM, but it must not clone, fragment, reparent, or replace editor-owned content nodes.
7. The rich editor must expose the authoring operations that matter in a print product—especially images, layout markers, plugin regions, page/spread controls, and block manipulation—inside the active editing surface.
8. Fail-closed source safety is non-negotiable. When source origin is ambiguous, the correct result is a named diagnostic and source-mode fallback, not a guessed edit.

PR 158 also demonstrated why its core approach should not be retained:

- ProseMirror became a second document model.
- A whole-document Markdown serializer became part of normal typing.
- Canonical normalization and fixpoint gates were added to manage source churn created by that decision.
- A large amount of parser, schema, serializer, mark-order, HTML-pairing, and provenance machinery existed primarily to recover source that should never have stopped being authoritative.
- ProseMirror-specific DOM differences required CSS rewriting and cascade-neutralization work that the new editor may not need.

The new effort must therefore follow this rule:

> **Reuse the evidence, fixtures, measurements, security findings, pagination lessons, and authoring vocabulary from PR 158. Do not reuse its ProseMirror document model, serializer, normalization lifecycle, or implementation-specific repairs unless the new architecture independently reproduces the same failure.**

---

## 2. Relationship to the current implementation plan

The current plan already makes the following binding decisions:

- Exact Markdown source is the only authoritative document.
- No ProseMirror, Tiptap, or Milkdown runtime is introduced.
- `@vscode/markdown-editor` is evaluated behind a narrow adapter and minimally forked only if mandatory extension seams are missing.
- Desktop and the future VS Code extension use the same framework-free rich-editor mount.
- The rich editor is continuously paginated and Gutterpress-styled.
- Pagination must not mutate editor-owned semantic content DOM.
- A sparse Gutterpress projection carries only Gutterpress-specific source ranges and view metadata.
- Generated views have anchors but no writable source ranges.
- The separate preview remains a read-only independent rendering, export, and parity surface.
- PR 158 is closed as superseded and retained as an archive; no broad rebase or merge is performed.

This guide adds practical guardrails to those decisions. Every phase specification should cite the relevant lesson IDs from this document and state how the run proves it did not reintroduce the corresponding failure.

---

## 3. Evidence reviewed and limits of the review

### 3.1 Primary evidence

This review used:

- [PR 158 — editor: rich editing surface — deferred to 0.11](https://github.com/dimm-city/gutterpress/pull/158)
- The 72-commit PR branch history through head `5a5e54e86dfd073cc08789fb52cf0bb5b19f8b1f`
- [`docs/rich-editor-lessons-learned.md`](https://github.com/dimm-city/gutterpress/blob/5a5e54e86dfd073cc08789fb52cf0bb5b19f8b1f/docs/rich-editor-lessons-learned.md)
- [`docs/editor-core-rule-provenance-plan.md`](https://github.com/dimm-city/gutterpress/blob/5a5e54e86dfd073cc08789fb52cf0bb5b19f8b1f/docs/editor-core-rule-provenance-plan.md)
- [`docs/galley-postmortem.md`](https://github.com/dimm-city/gutterpress/blob/5a5e54e86dfd073cc08789fb52cf0bb5b19f8b1f/docs/galley-postmortem.md), preserved on the PR 158 branch because the earlier galley experiment directly informed the rich-editor design
- Representative parser, schema, serializer, renderer, component, interaction, parity, and real-book test changes from the branch
- Commit messages that recorded reproduced defects, independent review findings, rejected findings, deferred product decisions, and measured acceptance results

### 3.2 Review-discussion limitation

GitHub reports no persisted review threads, submitted reviews, or issue comments on PR 158. Some commits refer to Codex, Copilot, or independent reviews; the review findings that can be verified are those recorded and reproduced in the branch commits. This guide does not invent missing review discussion.

### 3.3 Current-code limitation

PR 158 was built before the current `0.10.2` line advanced. File paths and implementations on the PR branch are not assumed to match current `main`. Any code proposed for reuse must first be compared with the post-`0.10.2` baseline. The default action is to port a test or invariant manually, not to cherry-pick a branch commit.

### 3.4 Classification vocabulary

Each lesson is classified as one of:

- **ADOPT:** Carry the principle directly into the new architecture.
- **ADAPT:** Preserve the requirement or test, but implement it differently on the source-first foundation.
- **DO NOT PORT:** The code or pattern existed because of the rejected architecture and should not be carried forward.
- **INVESTIGATE:** The branch exposed a real uncertainty that still requires a measured spike or acceptance gate.

---

## 4. What the experiment actually established

### 4.1 The product bar is authoring quality, not parser correctness

At handoff, the branch could report strong round-trip and visual results on selected books while still failing the intended product requirement: plugin-built regions that made up much of a real chapter were visible but not typable, and basic authoring affordances lagged behind source mode.

**Durable conclusion:** A rich editor is complete only when a non-technical author can perform the common book-authoring tasks without switching to source or preview for routine work.

Required evidence must include real interaction with:

- text entry and selection;
- formatting;
- links;
- image insertion and image-property changes;
- lists and tables;
- layout marker insertion and manipulation;
- plugin-region activation and fallback;
- block movement;
- undo/redo;
- paste and clipboard behavior;
- page/spread controls, zoom, and navigation;
- keyboard-only and accessibility paths.

**Classification:** ADOPT.

### 4.2 Pagination and Gutterpress styling are part of the editor, not decoration

The branch repeatedly found that a structurally editable document was not a Gutterpress editor until it applied the actual resolved engine, book, theme, and plugin styling and reproduced the book’s pages. Missing engine styles caused a brick-wall book to appear on white paper. Missing marker attributes, wrapper ancestry, generated labels, named-page breaks, and tight-list semantics produced major differences even though text and source were intact.

**Durable conclusion:** The shared rich editor must consume one resolved presentation context from the same configuration and render pipeline used by preview and print. It must not maintain an approximate or separately ordered CSS stack.

**Classification:** ADOPT.

### 4.3 Exact source safety and visual fidelity are separate properties

The branch found failures in both directions:

- Source could be stable while authored data had already been lost on the first parse/serialize pass.
- Source and round-trip tests could be perfect while the rendered hierarchy was visibly wrong.
- Visual output could look right while plugin-generated markup risked being materialized into source.

**Durable conclusion:** The acceptance model needs independent gates for:

1. exact source preservation and edit locality;
2. semantic rendered meaning;
3. styled DOM and hierarchy;
4. pagination and page furniture;
5. interactive authoring behavior;
6. security and trust boundaries.

No single gate substitutes for the others.

**Classification:** ADOPT.

### 4.4 Real project plugins are not edge cases

The first generic plugin approach refused every unknown plugin token. That made entire plugin books fall back to source mode, even though project plugins are a core Gutterpress extension surface. Later, support for only ordinary Markdown-it block rules still missed core-ruler transforms that consumed authored marker paragraphs and synthesized replacement tokens.

**Durable conclusion:** Plugin-aware editing is a first-class acceptance area. The design must distinguish:

- tokens with direct authored source ranges;
- plugin output that decorates source-derived nodes;
- plugin output generated from a recoverable authored region;
- generated display content with no writable source;
- ambiguous transforms that must fail closed.

**Classification:** ADOPT.

### 4.5 The final quality gains came from better instruments

The major improvements followed new measurement tools:

- CI parity execution checks found a gate that existed but did not run.
- Packaged-app smoke found an editor that never opened.
- Real-book round-trip measurement exposed silent core-rule data loss.
- Editor-versus-preview run comparison found CSS and DOM hierarchy divergence.
- Interaction testing found missing image authoring and vacuous region checks.
- Revision-diff tooling separated “viewer changed” from “viewer agrees with print.”
- Cross-browser smoke exposed fragmentation behavior that neither parent branch showed alone.

**Durable conclusion:** Before adding a workaround, first build or select the instrument that can distinguish the suspected defect from a control. Every new gate must be demonstrated to fail with the defect present.

**Classification:** ADOPT.

---

## 5. Chronology of the experiment and the lesson from each stage

### Stage A — Earlier galley experiment: paginator and editor fought over one DOM

The earlier galley implementation, preserved in the PR 158 branch postmortem, mounted an editor and a DOM-rewriting fragmenter over the same subtree. The fragmenter reparented nodes, inserted layout artifacts, and changed structures the editor considered authoritative. The editor’s observer then reverted or misinterpreted those changes. Avoiding that conflict required detaching observers around layout work, which became a permanent caller obligation.

**Lesson:** The editor owns the semantic content DOM. Pagination can use CSS, measurement, overlays, page sheets, and out-of-band furniture, but cannot rewrite the editor’s semantic nodes.

**Current-plan consequence:** P2d must prove pagination does not clone, fragment, reparent, or replace editor-owned content.

### Stage B — Initial PR 158 architecture: rich editing worked by converting through ProseMirror

The branch built a custom ProseMirror schema, Markdown-it token adoption, a serializer, commands, history, rich views, and an iframe presentation shell. This provided a substantial working surface but made the ProseMirror document the active editing representation and regenerated Markdown after changes.

**Lesson:** A second semantic document and serializer create broad source-fidelity work that is not necessary when exact Markdown remains authoritative.

**Current-plan consequence:** Keep the presentation-shell findings; discard the ProseMirror model and serializer.

### Stage C — Verification gap: the editor could not open

A packaged-app run found a startup `ReferenceError` caused by Svelte scope and temporal-dead-zone mistakes. Earlier TypeScript checks did not include `.svelte` files. The same pass found stale or nonexistent theme tokens and another initialization-order defect.

**Lesson:** “Typecheck passed” is meaningless unless every source language and generated integration path is included. A packaged-product open/type/save/switch smoke is mandatory.

**Current-plan consequence:** One aggregate verification command must include Svelte checks, TypeScript, lint, token checks, tests, build, packaging, and packaged-app smoke.

### Stage D — Canonicalization compensation: normalization became a product feature

Because the ProseMirror serializer normalized source, the branch added a project-wide normalize-on-adoption workflow so authors would not discover surprise rewrites one chapter at a time. That workflow then required planning, confirmation, path scoping, representability checks, change detection, project state, and race handling.

**Lesson:** A bulk normalization feature was compensating for the editor architecture. Exact-source editing removes this entire category from the normal workflow.

**Current-plan consequence:** Do not add normalizing source as a prerequisite for rich editing. Any future explicit formatter must be a separate, opt-in command with a reviewed plan/apply boundary.

### Stage E — Plugin support: source maps and token types were less reliable than assumed

A realistic plugin fixture revealed that ordinary block-rule provenance was insufficient. Core rules could consume marker paragraphs, move or replace tokens, synthesize non-HTML tokens, produce close tokens without maps, or consume all content without leaving a token carrier. A five-agent adversarial pass invalidated the first provenance design before implementation.

**Lesson:** Source attribution must be derived from known parser/plugin events and exact object/range evidence. Gaps, rendered equality, tag matching alone, and assumed close-token maps are not source origin.

**Current-plan consequence:** Implement only the minimum transform-origin mechanism needed for sparse projection. Ambiguity becomes a typed refusal. Do not port the full ProseMirror-era recovery mechanism unless the source-first projection independently requires each part.

### Stage F — Real-book visual comparison: source safety did not imply styled hierarchy

The branch’s real-book parity harness found wrapper nesting, named-page breaks, marker attributes, authored braces, tight lists, inline HTML pairs, generated labels, and cross-region ancestry defects that byte gates could not see.

**Lesson:** Rich-editor parity needs structural and computed-style measurement, not just rendered text or source equality.

**Current-plan consequence:** P2d and P3d must compare page count, break placement, hierarchy-sensitive styles, backgrounds, furniture, and representative text runs.

### Stage G — Interaction testing: green parse/serialize gates hid missing product capability

The branch added a real-pointer interaction gate only after humans discovered that images could not be selected or adjusted in rich mode and that plugin regions appeared as raw source. The first region check passed vacuously on a chapter with no matching regions.

**Lesson:** Product workflows require interaction tests with liveness assertions and defect reintroduction. An empty result set is not a pass.

**Current-plan consequence:** Every interaction gate must prove the expected target exists before evaluating behavior.

### Stage H — Deferral: visual progress did not clear the primary-authoring bar

The branch was deferred after it reached strong fidelity measurements but still left most plugin-created interiors read-only and omitted some page furniture. This was the correct decision: fidelity was necessary but not sufficient.

**Lesson:** Do not ship a half-state that merely trades one failure for another. An inactive plugin view that looks correct and an active view that is editable but unstyled is not a completed feature.

**Current-plan consequence:** Plugin region activation requires a two-state design before broad rollout.

---

## 6. Non-negotiable implementation guardrails

### G-01 — Exact source is the only writable authority

- The rich editor emits explicit source edits.
- No ordinary edit serializes a semantic document back into Markdown.
- Opening and closing without an explicit edit changes zero bytes.
- External changes update the authoritative snapshot, then derived views.
- Generated display output has no writable range.

**PR 158 failure this prevents:** serializer normalization, mark-order drift, token-attribute leakage, and the need for normalize-on-adoption.

### G-02 — The editor owns semantic content DOM

- Pagination may measure content and create page layers outside it.
- Page backgrounds, page gaps, margin furniture, selection chrome, and generated furniture must not become editable document nodes.
- No paginator may reparent, clone, fragment, replace, or inject content children into the editor-owned subtree.
- Any temporary browser measurement node is outside the semantic root and excluded from selection and source mapping.

**PR 158/galley failure this prevents:** observer fights, mutation bracketing, stale editor state, and a permanent layout-caller protocol.

### G-03 — One resolved presentation context

The rich editor must receive the same resolved inputs used by the rendering pipeline:

- engine/native CSS;
- theme and book CSS;
- project-plugin CSS;
- fonts and assets;
- page geometry;
- named pages and forced breaks;
- columns and spreads;
- page backgrounds;
- margin-box furniture;
- generated structures needed for presentation.

Do not read `manifest.styles` directly or reproduce style ordering in the editor package.

### G-04 — Authored, generated, and view-only values are distinct types

- **Authored source:** exact writable bytes with a source range.
- **Source-derived view metadata:** safe attributes/classes used to reproduce styling; never serialized by the editor.
- **Generated view:** pipeline output with an anchor but no source range.
- **Editor chrome:** selection handles, drag affordances, toolbars, page sheets, diagnostics; never document content.

The type system and runtime checks must make it impossible to accidentally convert a generated view into a source edit.

### G-05 — Source origin is never inferred from presentation

Do not derive writable ranges from:

- rendered DOM ancestry;
- text equality;
- matching tag names;
- missing-token gaps;
- visual position;
- plugin-generated HTML;
- approximate line counts.

Use parser ranges, marker metadata, exact source metadata, or a proven transform-origin record. Otherwise fail closed.

### G-06 — Plugin ambiguity is a named refusal

A refusal must identify:

- the plugin or rule when known;
- the source region or nearest anchor;
- why origin or editability is ambiguous;
- the safe action available to the author, normally “Edit in source mode.”

Do not silently degrade a writable-looking region into guessed behavior.

### G-07 — Inactive and active plugin views are separate projections of the same source

- Inactive state may show the plugin’s own rendered output.
- Active state must expose source-aware editable content while preserving the safe visual wrapper and page context.
- The transition is derived from selection/activation, not stored as a second document state.
- Unsupported interiors remain rendered/read-only with an explicit source action.
- Entering active mode must not leave the paginated flow or discard styling.

### G-08 — Page fidelity is measured, not asserted

The following are separately measured:

- editor versus read-only preview;
- preview versus PDF/print;
- current revision versus baseline revision;
- Chromium versus supported secondary browser engines where applicable.

A single “parity” number cannot answer all four questions.

### G-09 — One implementation per authoring concept

Image properties, link properties, Gutterpress attribute vocabulary, layout commands, block movement, and diagnostics must be shared between surfaces or delegated to one source command implementation. The desktop and VS Code hosts should not each invent their own semantics.

### G-10 — The active surface owns the authoring workflow

When rich mode is active:

- image and link properties are reachable there;
- page/spread and zoom controls operate on it;
- keyboard and pointer actions target it;
- the UI does not display a second equivalent paginated pane at a size that makes both unusable;
- controls that apply only to the read-only preview are hidden or disabled.

### G-11 — Async results are scoped by document, project, and presentation revision

Every async CSS, plugin, projection, asset, and layout result must carry enough identity to reject stale responses. A result for project A may never update project B because a component was cached or a promise resolved late.

### G-12 — A gate must prove it ran and prove it can fail

Every required gate needs:

- a fixture liveness assertion;
- nonempty expected targets;
- an invocation path in CI or the documented release workflow;
- a deliberate sabotage or defect-reintroduction demonstration;
- actionable forensic output;
- unique fixture identifiers and staging paths.

---

## 7. Anti-pattern catalog and required replacement

### AP-01 — A semantic rich-text document becomes the effective source of truth

**Observed:** ProseMirror owned the edited document and Markdown was regenerated from it.

**Why it failed:** Every syntax detail not fully represented in the schema or serializer became a source-fidelity problem: entities, bullets, attributes, raw HTML, continuation markers, reference definitions, typographer output, links, table cells, plugin wrappers, and mark ordering.

**Replacement:** Exact source snapshot plus explicit source edits. Derived editor models may be rebuilt at any time and are never serialized wholesale.

**Disposition:** DO NOT PORT.

### AP-02 — Handwritten DOM-to-Markdown or model-to-Markdown reconstruction

**Observed:** The earlier galley attempt had a large handwritten DOM serializer; PR 158 used a ProseMirror serializer with extensive custom rules.

**Why it failed:** Presentation DOM and semantic document models do not retain every authored spelling. Reverse conversion creates normalization, ambiguous source ownership, and broad edit diffs.

**Replacement:** Edit source directly. Use explicit source commands for structure changes.

**Disposition:** DO NOT PORT.

### AP-03 — Normalize the whole project to make the editor safe

**Observed:** The branch added a normalize-on-adoption prompt because canonical serializer output would otherwise surprise authors one file at a time.

**Why it failed:** It turned an editor implementation detail into a destructive project migration with planning, confirmation, project state, security scoping, TOCTOU handling, and unsupported-file behavior.

**Replacement:** No normalization prerequisite. A future formatter, if desired, is a separate explicit tool.

**Disposition:** DO NOT PORT.

### AP-04 — Treat fixpoint stability as proof of losslessness

**Observed:** Content could be deleted on the first pass and remain perfectly stable on the second. Reference definitions were a concrete case because Markdown-it consumed them without producing tokens.

**Replacement:** For normal rich editing, demand zero-byte no-op and explicit edit locality. For transformations, combine exact-source comparison, semantic-render comparison, and representative fixtures.

**Disposition:** ADOPT the lesson; discard the fixpoint-as-primary design.

### AP-05 — Infer authored source from token gaps or generated HTML

**Observed:** Core-rule transforms consumed source and produced map-less replacements. Earlier heuristics treated map-less HTML as generated and safe to drop, deleting the only authored carrier.

**Replacement:** Proven transform origin or refusal. In the new architecture, origin maps presentation back to source; it does not reconstruct source bytes.

**Disposition:** ADAPT.

### AP-06 — Trust transformed token attributes as authored attributes

**Observed:** A plugin decorated heading tokens, and the editor wrote those decorations back as author source.

**Replacement:** Authored attributes come from exact source metadata. Transformed attributes may be view-only if needed for presentation.

**Disposition:** ADOPT.

### AP-07 — Unknown plugin syntax silently falls through

**Observed:** An overly permissive path could open a file richly and mis-serialize it; the opposite extreme refused every project-plugin token and made plugin books unusable.

**Replacement:** Support source-backed projected regions generically; fail closed only when origin or edit behavior is ambiguous, with a named reason.

**Disposition:** ADOPT.

### AP-08 — Paginator rewrites editor-owned DOM

**Observed:** The galley fragmenter reparented and decorated the same DOM ProseMirror observed.

**Replacement:** CSS and measurement over stable semantic DOM; out-of-band sheets and furniture; no semantic-node mutation.

**Disposition:** DO NOT PORT.

### AP-09 — Editor keeps a second approximation of Gutterpress pagination

**Observed:** Named-page emulation reproduced margins but initially omitted the page break implied by a page-name transition. Editor page count still diverged after style parity improved.

**Replacement:** One shared page-rule vocabulary and explicit parity tools. Any unavoidable browser/editor difference is documented with a measured tolerance and an owner.

**Disposition:** ADOPT.

### AP-10 — Editor reads raw manifest styles instead of resolved configuration

**Observed:** Engine-native CSS reached print and preview but not the editor, producing white paper instead of the book’s page background.

**Replacement:** Host produces `EditorPresentationContext` from the authoritative resolved configuration path.

**Disposition:** ADOPT.

### AP-11 — Model wrappers are assumed to be presentation-neutral

**Observed:** Extra paragraph wrappers in tight lists changed inherited and direct CSS. Raw HTML open/close atoms placed wrapped text as siblings instead of descendants.

**Replacement:** Prefer a rendered hierarchy that matches the pipeline. When the editor engine necessarily introduces wrappers, make them demonstrably cascade-transparent and test affected selectors. Do not copy PR 158’s ProseMirror-specific CSS variants unless the VS Code editor produces the same structure.

**Disposition:** ADAPT; investigate against the selected editor DOM.

### AP-12 — Preserve only a hand-selected subset of view attributes

**Observed:** Carrying only `class` dropped IDs and `data-*` attributes books styled against.

**Replacement:** Define a safe, general view-attribute policy. Remove source-coordinate and dangerous attributes explicitly; preserve the remaining presentation-relevant attributes through a generic path.

**Disposition:** ADOPT.

### AP-13 — Render generated content as authored raw HTML

**Observed:** Generated chapter openers and plugin labels needed to be visible but had to serialize to nothing.

**Replacement:** `GeneratedView` with an anchor, safe rendered representation, read-only behavior, and no writable range.

**Disposition:** ADOPT.

### AP-14 — Pair wrappers across opaque regions by tag name alone

**Observed:** Nearest-unclosed matching paired an opener with a later unrelated closer across a region that contained the true closer, producing visually wrong nesting while byte gates stayed green.

**Replacement:** Treat opaque or ambiguous regions as pairing barriers. Prefer explicit origin/ancestry records. Any heuristic pairing fails soft to a read-only or source representation.

**Disposition:** ADAPT.

### AP-15 — Unlock content before solving its active presentation

**Observed:** Most opaque interiors appeared safely parseable, but opening them as ordinary content would discard the plugin’s card presentation.

**Replacement:** Implement and test the two-state view first. Do not ship “editable but looks wrong” as a replacement for “looks right but read-only.”

**Disposition:** ADOPT.

### AP-16 — Duplicate paginated editor and preview side by side

**Observed:** The rich editor and preview showed the same pages at half width, reducing body text to roughly unreadable size.

**Replacement:** Rich mode owns the authoring workspace. The independent preview remains available as a verification/export surface, not a mandatory simultaneous duplicate.

**Disposition:** ADOPT.

### AP-17 — Authoring controls exist only in another surface

**Observed:** Image layout properties were available only from preview, so rich-mode authors had to leave the active surface for core layout work.

**Replacement:** Shared authoring commands and dialogs are reachable from the active editor. Preview-only commands are read-only inspection actions.

**Disposition:** ADOPT.

### AP-18 — Build similar authoring logic twice

**Observed:** Image-property parsing/application lived in preview code until it was extracted for rich mode.

**Replacement:** One source-command or vocabulary implementation, with thin host/surface adapters.

**Disposition:** ADOPT.

### AP-19 — Parser and serializer tests stand in for product interaction

**Observed:** Thousands of passing tests did not prove the editor opened, accepted input, selected an image, displayed the page background, or exposed plugin content correctly.

**Replacement:** Packaged interaction tests using real pointer and keyboard input, plus accessibility and IME coverage.

**Disposition:** ADOPT.

### AP-20 — Gate exists but is not invoked

**Observed:** A parity script was present but not wired into workflows. Missing fixtures were skipped while the gate reported success.

**Replacement:** CI/release workflow invocation tests, fail-closed fixture discovery, and explicit result counts.

**Disposition:** ADOPT.

### AP-21 — Empty result sets count as success

**Observed:** The first plugin-region interaction check reported success on a chapter with no relevant regions.

**Replacement:** Liveness assertions precede behavioral assertions. Zero targets is a fixture error or explicit not-applicable result, never a silent pass.

**Disposition:** ADOPT.

### AP-22 — Measurement tool is trusted before calibration

**Observed:** A parity tool mismatched repeated text and compared gaps across column boundaries, making roughly a third of reported differences false.

**Replacement:** Adversarial spot-checks, occurrence-aware matching, layout-context-aware metrics, raw evidence dumps, and sabotage fixtures.

**Disposition:** ADOPT.

### AP-23 — One parity tool answers multiple different questions

**Observed:** Preview/PDF parity could not determine whether the viewer changed between revisions; revision changes could move preview and print together or preserve an existing mismatch.

**Replacement:** Separate tools for current-surface parity, print parity, revision diff, and cross-browser diff.

**Disposition:** ADOPT.

### AP-24 — Weak fixture assertions verify text presence but not syntax meaning

**Observed:** A fixture heading was corrupted with an empty bold pair; assertions only checked that the words appeared, so the missing heading semantics went unnoticed.

**Replacement:** Parse fixtures and assert structural intent. Validate fixtures independently before using them as a gate.

**Disposition:** ADOPT.

### AP-25 — Tests mutate committed fixtures without restoration

**Observed:** An interaction exercise left source damage in two fixture copies.

**Replacement:** Tests use disposable copies, temp worktrees, or restore assertions. Committed fixtures are immutable inputs.

**Disposition:** ADOPT.

### AP-26 — Hand-rolled project file enumeration

**Observed:** A normalization route scanned top-level `.md` files and missed nested manifest sources.

**Replacement:** Reuse the authoritative project-source resolver used by build and lint.

**Disposition:** ADOPT.

### AP-27 — “Apply” recomputes instead of applying the reviewed plan

**Observed:** A file could change after the user reviewed a normalization plan; apply then rewrote unreviewed content.

**Replacement:** Plans bind to exact versions or before-bytes. Stale inputs are skipped or rejected and must be reviewed again.

**Disposition:** ADOPT for any explicit bulk operation; normal source edits already use version checks.

### AP-28 — Async project data is not invalidated on context switch

**Observed:** Cached rich-editor CSS could remain from the previous project, and normalize prompts were scoped to a session instead of a project.

**Replacement:** Project/document/presentation revision identity on every async result; centralized project-open reset path.

**Disposition:** ADOPT.

### AP-29 — Cache identity uses basename, byte count, or other weak surrogates

**Observed:** Same-named, same-length component files could collide in an SSR harness cache.

**Replacement:** Use canonical full identity plus relevant content/version hash. State exactly what invalidates the cache.

**Disposition:** ADOPT.

### AP-30 — Process-global state leaks across tests or projects

**Observed:** Host-service registration in a `globalThis` slot leaked between tests.

**Replacement:** Explicit lifecycle, scoped dependency injection at real boundaries, and cleanup assertions. Avoid mutable globals.

**Disposition:** ADOPT.

### AP-31 — Compatibility is asserted without corpus evidence

**Observed:** A review raised `.col-split` backward compatibility, but measured repository usage did not support the premise.

**Replacement:** Search actual books, fixtures, docs, and public contracts. Reject or accept compatibility findings with evidence.

**Disposition:** ADOPT.

### AP-32 — Obsolete workaround survives after its cause is removed

**Observed:** A wrapper path remained after Paged.js was removed even though native column breaks now reproduced the behavior. The custom path also bypassed generic attribute rendering.

**Replacement:** Periodically re-measure historical workarounds. Prefer platform-native and generic library paths when they satisfy current behavior.

**Disposition:** ADOPT.

### AP-33 — Unavailable-browser failures provide only a page-count number

**Observed:** A Firefox-only fragmentation difference could not be reproduced locally.

**Replacement:** CI failures capture per-strip or per-page content, geometry, CSS variables, browser/version, and screenshots sufficient to locate the divergence.

**Disposition:** ADOPT.

### AP-34 — Branch combines product experiment and unrelated release work

**Observed:** PR 158 grew to 72 commits and 159 changed files, including independent viewer, sync, CLI, workflow, and packaging changes.

**Replacement:** One live feature branch, bounded runs, independent fixes split into their own PRs, and explicit archival of superseded experiments.

**Disposition:** ADOPT.

---

## 8. Preferred implementation patterns for the new editor

### 8.1 Source-edit core

The minimum shared contract remains:

```ts
interface DocumentSnapshot {
  readonly text: string;
  readonly version: number;
}

interface SourceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly expectedVersion: number;
}
```

Properties:

- Offsets are UTF-16 code-unit offsets, matching JavaScript and VS Code.
- A stale edit changes nothing and receives the current snapshot.
- A command returns the smallest safe source replacement range.
- The host owns persistence and undo/redo integration.
- The editor never writes the filesystem.

This design eliminates the PR 158 requirement to compare a serialized semantic document with disk before applying source offsets.

### 8.2 Sparse Gutterpress projection

The projection should contain only information the base Markdown editor cannot derive:

```ts
interface ProjectedBlock {
  readonly id: string;
  readonly kind:
    | "chapter"
    | "page"
    | "spread"
    | "section"
    | "page-break"
    | "column-break"
    | "plugin-region"
    | "raw-html";
  readonly from: number;
  readonly to: number;
  readonly editMode: "structured" | "source" | "readonly";
  readonly inactiveHtml?: string;
  readonly viewAttributes?: Readonly<Record<string, string>>;
  readonly refusalReason?: string;
}

interface GeneratedView {
  readonly id: string;
  readonly anchor: number;
  readonly html: string;
}
```

Do not recreate PR 158’s full ProseMirror schema as a generic AST under another name.

### 8.3 Stable semantic DOM plus out-of-band page presentation

Recommended conceptual layers:

```text
host document / iframe / webview
  └── editor scale and viewport layer
       ├── page-sheet layer              # paper, backgrounds, furniture
       ├── semantic editor flow          # editor-owned content DOM
       ├── generated-view layer          # pipeline output, non-writable
       └── interaction chrome layer      # caret helpers, handles, toolbars
```

Rules:

- The semantic flow is the only contenteditable/editor-owned subtree.
- Page sheets and furniture use measured page slots and remain outside source selection.
- Scaling is visual and does not alter print-size layout calculations.
- Repagination is coalesced and cancelable by presentation revision.
- The coordinate mapper accounts for scale, page gaps, columns, spreads, and scroll position.
- An active plugin block remains inside this page flow.

### 8.4 Resolved presentation context

The host should deliver an immutable presentation snapshot:

```ts
interface EditorPresentationContext {
  readonly revision: number;
  readonly documentId: string;
  readonly projectId: string;
  readonly cssText: string;
  readonly assetBase: string;
  readonly fonts: readonly FontDescriptor[];
  readonly pageModel: ResolvedPageModel;
  readonly furniture: readonly PageFurnitureDefinition[];
  readonly trusted: boolean;
}
```

The exact type is finalized in the implementation phase, but the ownership is fixed: configuration resolution remains in the Gutterpress host/render layer, not in the shared editor UI.

### 8.5 Two-state plugin region

```text
INACTIVE
  source range remains authoritative
  plugin-rendered safe HTML is visible
  no writable generated nodes

ACTIVE
  safe plugin wrapper/classes remain
  source-aware editor view replaces or overlays the interior
  accepted edits target exact source range
  page layout repaginates

UNSUPPORTED
  inactive rendering remains visible where safe
  explicit “Edit source” action
  named diagnostic
```

Selection or active-block state drives the transition. Do not store an independently editable copy of the plugin HTML.

### 8.6 Transform origin as projection metadata, not source reconstruction

The PR 158 provenance work should be narrowed in the new design.

Use origin records to answer:

- Which exact authored range produced this plugin view?
- Is the entire range attributable to one stable source region?
- Can its interior be edited safely as source-aware Markdown?
- What generated display fragments belong at its boundaries?

Do not use origin records to regenerate the author’s source; the original source is already present.

### 8.7 Shared authoring commands

Commands should be pure source transformations where practical:

```ts
type EditorCommand =
  | { kind: "toggle-bold" }
  | { kind: "set-heading"; level: 1 | 2 | 3 | 4 | 5 | 6 }
  | { kind: "insert-image"; value: ImageValue }
  | { kind: "update-image"; value: ImageValue }
  | { kind: "insert-layout"; layout: LayoutKind }
  | { kind: "move-block"; direction: "up" | "down" };
```

The desktop toolbar, rich web UI, source editor, and VS Code commands consume the same vocabulary. Surface-specific code decides only presentation and command routing.

### 8.8 Security isolation

Retain the strongest PR 158 findings:

- Author and plugin HTML executes no script in the editing document.
- The host installs its own `<base>` or equivalent asset resolver before author content can affect base resolution.
- Raw HTML and plugin HTML are sanitized according to workspace/project trust.
- VS Code untrusted workspaces use standard Markdown editing and safe placeholders/source fallback; project plugin code does not execute.
- The webview has no direct filesystem or Node access.
- Generated IDs are not duplicated when view fragments are repeated for presentation.

---

## 9. Pagination and Gutterpress styling guidance

### 9.1 Required fidelity dimensions

A paginated rich editor must be checked for:

1. page width and height;
2. content-box width and height;
3. page margins;
4. one-page and spread layout;
5. column count, gaps, and forced column breaks;
6. named pages and transitions between page names;
7. explicit page and spread breaks;
8. page backgrounds and canvas backgrounds;
9. margin-box content and page furniture;
10. fonts and font loading;
11. image sizing, bleed, pinning, shape wrapping, and fragmentation;
12. generated labels and decorative structures;
13. safe book/plugin attributes and wrapper ancestry;
14. active-edit-state layout;
15. page count and content distribution;
16. zoom and coordinate mapping;
17. cross-browser fragmentation behavior.

### 9.2 Do not define parity as pixel identity everywhere

The correct acceptance model should distinguish:

- **Structural parity:** same meaningful hierarchy, wrappers, source-derived attributes, generated view placement, and break boundaries.
- **Style parity:** representative computed styles and cascade outcomes match.
- **Pagination parity:** accepted page count, break placement, and content distribution match.
- **Furniture parity:** page backgrounds and margin content match.
- **Interaction parity:** editing does not escape the paginated flow or corrupt coordinate mapping.

Where exact parity is not technically possible, the plan owner must approve a narrowly measured tolerance. A vague “close enough” or a permanent allowlist without root cause is not acceptable.

### 9.3 Page sheets and furniture

PR 158’s page-sheet approach is useful as a concept:

- page paper can be drawn as real out-of-band elements;
- backgrounds can be captured and applied without making them editor content;
- scale can be visual while layout stays at print size;
- page slots can be created from measured flow extent.

But the branch did not finish margin-box content. The new design must treat page furniture as part of the initial page-presentation contract, not a cosmetic follow-up.

### 9.4 Named pages and forced breaks

The branch showed that applying a named-page margin is insufficient. Page-name transitions may force page breaks and split runs. The shared page model must represent both geometry and transition behavior.

Tests must include:

- consecutive blocks with the same page name;
- a change from default to named page;
- a change between two named pages;
- named pages nested under layout markers;
- a named page adjacent to explicit page/spread breaks;
- active editing at the transition boundary.

### 9.5 Cascade transparency

The editor engine may introduce DOM that print does not. Before adding CSS rewrites like PR 158’s tight-list selector variants:

1. inspect the actual `@vscode/markdown-editor` DOM;
2. compare it with Gutterpress render DOM;
3. determine whether the difference affects author selectors;
4. prefer changing the editor view hierarchy or a generic editor hook;
5. use CSS transformation only when the DOM cannot be aligned and the transformation can be proven semantics-preserving.

Any CSS transformation must preserve:

- at-rule context such as `@layer`, `@supports`, and media conditions;
- selector specificity;
- source order;
- grouping behavior;
- unknown rules unchanged;
- byte identity when no transformation applies.

### 9.6 Cross-browser instrumentation

For each supported browser engine, failure output should include:

- browser and engine version;
- viewport and device scale;
- page and strip count;
- per-page/strip text summary;
- measured geometry;
- relevant CSS custom properties;
- forced-break and named-page markers;
- screenshots;
- source/presentation revision.

This allows remote CI failures to be diagnosed without the same browser installed locally.

---

## 10. Plugin and raw-HTML guidance

### 10.1 Support matrix

| Shape | Source origin | Inactive view | Active behavior | Failure policy |
|---|---|---|---|---|
| Standard Markdown block | Base parser range | Base rich view | Structured rich editing | Base editor diagnostic |
| Gutterpress layout marker | Exact marker range | Styled layout boundary | Structured/source-aware command | Source fallback on invalid marker |
| Plugin block with exact range | Proven range | Plugin-rendered safe HTML/wrapper | Two-state source-aware interior | Refuse if active mapping is unsafe |
| Plugin generated label | Anchor only | Generated view | Read-only | Never writable |
| Raw HTML with exact source | Exact range | Trusted/sanitized representation | Source-aware or source-only | Source fallback if unsafe |
| Ambiguous transform | Unknown/overlapping | Safe placeholder or trusted rendered view | Source mode only | Named refusal |

### 10.2 Do not add a Gutterpress-only plugin API merely for the editor

PR 158 deliberately kept plugins as ordinary Markdown-it plugins and observed their registered rules. The new implementation should retain that constraint unless an independently approved plugin API redesign is undertaken.

The editor may define an internal projection result, but existing plugins should not be forced to implement a second rendering or editor lifecycle.

### 10.3 Opaque output still needs correct ancestry

The branch found that plugin output could open wrappers in one region and close them in a later region. Rendering each region independently caused browser auto-closing and incorrect CSS ancestry.

The new projection must investigate whether the render pipeline can expose stable ancestry/origin information directly. Replaying an HTML tag stack is a fallback presentation technique, not proof of editable source ownership.

### 10.4 Survivor content between regions

PR 158 left an open problem: ordinary authored paragraphs between plugin regions could need the ancestry established by earlier generated wrappers. This remains a required investigation.

Do not solve it by guessing tag ownership from surrounding strings. Candidate solutions must be measured against real plugin books and must preserve:

- source ranges;
- wrapper ancestry;
- selection and active-state transitions;
- pagination;
- generated/author separation;
- IDs and attributes;
- source-edit locality.

### 10.5 Raw HTML

Raw HTML is common enough in the corpus that blanket refusal is not acceptable. But the editor must distinguish:

- standalone raw blocks;
- inline raw HTML;
- paired wrappers around Markdown;
- script/style/base-bearing markup;
- trusted versus untrusted project contexts.

Paired wrappers must preserve descendant hierarchy in the inactive view. Active editing may expose source rather than pretending every arbitrary HTML structure has a safe rich form.

---

## 11. Verification strategy derived from the experiment

### 11.1 Gate families

#### A. Source-integrity gates

Prove:

- no-op open/close is byte-identical;
- each edit changes only its explicit range;
- stale/invalid edits change nothing;
- generated views cannot produce edits;
- unknown attributes survive unrelated edits;
- project switches do not cross-contaminate source.

#### B. Projection gates

Prove:

- every writable projection has a valid exact range;
- generated projections have no writable range;
- ambiguous plugin transforms produce diagnostics;
- projection revision matches source/presentation revision;
- range overlap and containment invariants hold.

#### C. Semantic-render gates

Compare meaningful rendered structure while ignoring only proven irrelevant differences such as attribute order. Do not ignore attribute values, hierarchy, or generated content placement.

#### D. Styled parity gates

Measure:

- text-run sequence;
- DOM ancestry class or projected role;
- representative computed styles;
- vertical spacing within the same layout context;
- backgrounds and page chrome;
- active versus inactive region presentation.

Repeated text must be paired by occurrence and context, not first match.

#### E. Pagination gates

Measure:

- page count;
- page dimensions;
- content distribution per page;
- named/forced break positions;
- column/spread behavior;
- page furniture;
- revision differences.

#### F. Interaction gates

Use real pointer and keyboard input in the packaged desktop application and VS Code extension host. Include liveness checks for every target.

#### G. Accessibility and input-method gates

Cover:

- keyboard-only operation;
- visible focus;
- screen-reader semantics;
- IME composition;
- dead keys;
- clipboard and drag/drop;
- high zoom and OS scaling;
- reduced-motion behavior where applicable.

#### H. Cross-browser gates

At minimum, run the supported Chromium/Electron path and the browser engine required by the project’s compatibility policy. Report actionable per-page forensics.

### 11.2 Sabotage requirement

Before a new gate counts as acceptance evidence, the author must demonstrate it fails when the protected behavior is deliberately broken. Examples:

- remove engine CSS;
- remove a forced page break;
- drop a source-derived class;
- give a generated view a writable range;
- disable plugin HTML rendering;
- point the interaction test at a chapter with no relevant target;
- return a stale presentation result;
- duplicate a fixture basename;
- skip the fixture file.

The sabotage may be performed locally and documented; it does not need to remain committed.

### 11.3 Fixture integrity

- Committed fixtures are read-only inputs.
- Interactive tests run on disposable copies.
- A fixture linter parses each file and asserts its intended semantic shapes.
- Duplicate fixture names receive unique IDs based on full relative path.
- Real-book fixtures are version-pinned or checked out at a recorded commit.
- A gate fails when a required real book or baseline is unavailable; it does not skip silently.

### 11.4 Packaged product first

Development-server success is insufficient. Acceptance includes:

- packaged Electron application;
- production bundle/tree-shaking behavior;
- actual CSP and base URI;
- real font and asset loading;
- actual project switching;
- actual desktop persistence;
- VS Code extension host plus production webview bundle.

---

## 12. Reuse and porting matrix

### 12.1 Use as durable reference

| PR 158 artifact | Use |
|---|---|
| `docs/rich-editor-lessons-learned.md` | Historical failure record and measured product gaps |
| `docs/galley-postmortem.md` | DOM-ownership and pagination anti-pattern record |
| `docs/editor-core-rule-provenance-plan.md` | Adversarial transform-shape catalog and fail-closed origin rules |
| PR body and handoff measurements | Baseline evidence, not current acceptance numbers |
| Advanced plugin-book fixture concepts | Re-create against current plugin APIs and source-first projection |
| Packaged parity/interaction tool concepts | Reimplement without ProseMirror assumptions |
| Viewer revision-diff concept | Preserve as a distinct release instrument |
| Iframe CSS-isolation, CSP, base-URI findings | Apply to desktop host and adapt to VS Code webview |
| Page-sheet, scale, backdrop, and page-background concepts | Reimplement in the shared paginated presentation layer |
| Shared image-property vocabulary lesson | Reuse the current post-`0.10.2` implementation or extract it once |

### 12.2 Manually port tests or fixtures after comparing current main

- consume-and-replace core-rule plugin cases;
- copied/moved/morphed token cases;
- generated chapter opener;
- generated plugin label;
- plugin wrapper open/close across regions;
- opaque barrier/cross-pair regression;
- raw HTML wrapper around Markdown;
- inline HTML pair;
- quoted multi-word marker label;
- `@continue` section chain;
- bullet-character distinction;
- image attributes with unknown tokens;
- named page transitions;
- tight-list style case;
- empty-token-stream poison case;
- liveness/vacuous-pass cases;
- repeated-text parity case;
- cross-column gap case;
- stale project CSS response;
- fixture corruption detection.

Port the behavior and expected result, not the ProseMirror node shape.

### 12.3 Do not port

- `prosemirror-*` dependencies;
- Tiptap or Milkdown dependencies;
- ProseMirror schema and node/mark declarations;
- ProseMirror Markdown parser adapter;
- ProseMirror Markdown serializer;
- whole-document serialization on every edit;
- canonical normalization requirement;
- normalize-on-adoption route/dialog/state;
- rich-document-versus-disk equality gate for applying source offsets;
- ProseMirror history as a second persistence history;
- ProseMirror-specific drag/drop implementation;
- ProseMirror-specific mark-order fixes;
- ProseMirror-specific tight-list CSS variants unless independently reproduced;
- ProseMirror-specific nested raw-HTML mark handler;
- full core-rule provenance implementation wholesale;
- renderer/client code that depends on PR 158’s branch-era APIs;
- unrelated sync, viewer, CLI, build, or workflow commits without a fresh comparison to current `main`.

### 12.4 No direct cherry-picks by default

The branch predates extensive `0.10.2` work and mixes independent changes. The default workflow is:

1. identify a behavior or test worth retaining;
2. inspect the current post-`0.10.2` implementation;
3. write a current-baseline characterization or failing test;
4. implement the smallest source-first solution;
5. cite the PR 158 evidence in the run specification or ADR.

A direct cherry-pick requires an explicit run specification proving the commit is isolated, still applicable, and free of rejected architecture dependencies.

---

## 13. Required investigations before implementation choices become permanent

### I-01 — `@vscode/markdown-editor` extension seam and fork decision

**Question:** Can the exact pinned package support custom projected blocks, inactive/active views, isolated document mounting, host history, paginated layout roots, and coordinate mapping without a fork?

**Required experiment:** Build the P1b compatibility matrix with one standard document, one Gutterpress layout wrapper, one generated view, and one plugin region inside a multi-column page.

**Exit condition:** Every mandatory case passes, or the missing generic seams are named with a minimal fork patch and contract tests.

**Do not guess:** Package declarations alone are insufficient; exercise the exact pinned runtime.

### I-02 — Stable pagination with editor cursor geometry

**Question:** Does CSS/page-slot pagination preserve click-to-offset, vertical cursor movement, selection rectangles, IME composition bounds, and drag/drop across page gaps and scaled spreads?

**Required experiment:** A real browser harness that types and selects across page and column boundaries at multiple zoom levels.

**Exit condition:** Coordinate errors remain within an approved pixel/offset tolerance and no semantic DOM mutation is required.

### I-03 — Margin-box furniture in the editor

**Question:** How will running heads, page numbers, chapter chips, and other margin content be produced without placing them in the editable tree?

**Required experiment:** Shared furniture model rendered into page-sheet layers for representative `@page` rules.

**Exit condition:** Furniture parity on the user guide and a plugin-heavy book, including page-number changes after edits.

### I-04 — Plugin transform origin on the source-first path

**Question:** What minimum instrumentation is needed to map consumed-and-generated plugin regions to exact source ranges?

**Required experiment:** Re-create the real consume/replace, copy, move, orphan, lazy-continuation, and cross-hunk cases from the PR 158 fixture.

**Exit condition:** Recoverable cases map exactly; ambiguous cases refuse by rule name; no source reconstruction is performed.

### I-05 — Cross-region ancestry and survivor content

**Question:** How can ordinary source blocks inherit the plugin wrapper ancestry that print establishes across transform regions?

**Required experiment:** Measure candidate projection/ancestry models against the real field guide, including `.dc-path-shell` and skill-card sequences.

**Exit condition:** Correct hierarchy and styles without guessed writable ownership or duplicate IDs.

### I-06 — Two-state plugin-region interaction

**Question:** Can inactive plugin HTML and active source-aware editing switch without layout jumps, source duplication, or lost selection?

**Required experiment:** Activate, edit, undo, leave, and reactivate regions before/after page boundaries and inside columns.

**Exit condition:** Exact edit locality, preserved safe wrapper styling, stable page context, and explicit fallback for unsupported cases.

### I-07 — Generated-view anchoring

**Question:** How do generated labels and decorations track source edits and layout movement while remaining non-writable?

**Required experiment:** Insert/delete before anchors, move surrounding blocks, and reparse plugin output.

**Exit condition:** Generated views remain correctly positioned, cannot receive source edits, and do not capture inappropriate selection.

### I-08 — Raw HTML trust and presentation

**Question:** Which HTML can be rendered in trusted and untrusted contexts, and which forms receive a rich active view versus source-only editing?

**Required experiment:** Block/inline/pair cases including scripts, styles, base tags, event handlers, external URLs, duplicate IDs, and nested formatting.

**Exit condition:** Security review approves CSP/sanitization/base behavior; unsafe forms fall back without losing source.

### I-09 — Typographer and linkify display behavior

**Question:** Can the rich view show typographic substitutions and linkification while preserving straight quotes, dashes, and bare URLs in source and source-offset mapping?

**Required experiment:** Compare displayed and source forms through edits around substituted spans.

**Exit condition:** No source rewrite, stable selection mapping, and documented visual/source distinction.

### I-10 — Large-document performance

**Question:** What are the parse, projection, layout, repagination, and interaction costs for long chapters and book-length files?

**Required experiment:** Fixed benchmarks at several document sizes with plugin-heavy, table-heavy, image-heavy, and multi-column content.

**Exit condition:** Meets the plan’s latency/memory limits or triggers an approved incremental/reconciliation optimization.

### I-11 — Cross-browser fragmentation

**Question:** Which browser engines are supported for desktop, webview, preview, and CI, and how do fragmentation differences affect the editor?

**Required experiment:** Cross-engine page/strip measurement with merge-base and feature-branch comparisons.

**Exit condition:** Supported-engine policy, measured tolerances, and forensic CI output are documented.

### I-12 — VS Code trust and plugin loading

**Question:** Which project plugins and assets may be resolved in trusted and untrusted workspaces, and where does plugin code execute?

**Required experiment:** Trusted/untrusted extension host tests and webview message-boundary tests.

**Exit condition:** No project code executes in the webview; untrusted workspaces retain safe standard Markdown editing and source fallback.

---

## 14. How these lessons map to the implementation plan

### P0 — Baseline and guardrails

Add or verify:

- immutable fixture policy;
- full-source-language verification (`svelte-check`, TypeScript, lint, token checks);
- gate invocation/liveness tests;
- generated-file and duplicate-fixture checks;
- architecture rules that prohibit ProseMirror and semantic-DOM pagination mutation;
- source evidence links to this guide.

### P1 — Shared editor foundation

Apply:

- G-01 source authority;
- G-02 DOM ownership;
- I-01 package/fork spike;
- I-02 cursor geometry spike;
- packaged open/type/replace/undo smoke;
- strong version and cache identity.

### P2a/P2b — Base editor and sparse projection

Apply:

- authored/generated/view-only type separation;
- exact source ranges;
- marker attributes from source;
- generated views with anchors only;
- raw HTML fallback rules;
- no full replacement AST.

### P2c — Plugins

Apply:

- real-shaped plugin fixtures;
- transform-origin refusal rules;
- source-origin liveness tests;
- no plugin API redesign;
- two-state region contract;
- I-04, I-05, I-06, I-07, and I-08.

### P2d — Shared pagination and styling

Apply:

- one resolved presentation context;
- stable semantic DOM;
- page sheets/furniture outside content;
- named-page transition tests;
- cascade-transparency analysis;
- four distinct parity/revision/cross-browser tool purposes;
- I-02, I-03, I-09, I-10, and I-11.

### P3 — Product integrations

Apply:

- rich mode owns the main authoring workspace;
- active-surface controls;
- one implementation per image/link/layout concept;
- project/presentation revision invalidation;
- packaged interaction and accessibility gates;
- VS Code trust boundary.

### P4 — Preview-edit deletion

Confirm that all preview-only mutation capabilities have equivalents in rich/source modes before deletion. Retain preview navigation and verification; remove duplicate authoring semantics.

### P5/P6 — Architecture simplification

Use PR 158 process lessons:

- reuse authoritative resolvers instead of hand-rolled enumeration;
- eliminate global state and weak cache keys;
- make transport and project state explicit;
- split unrelated product/release changes into bounded runs;
- preserve historical postmortems under `docs/`, clearly marked as historical.

### P7 — Final acceptance

The acceptance sweep must include:

- source-integrity evidence;
- real-book plugin evidence;
- paginated rich-editor versus preview evidence;
- preview versus PDF evidence;
- revision-diff evidence;
- packaged desktop interaction;
- VS Code extension interaction;
- accessibility and IME;
- cross-browser forensics;
- proof that the relevant gates were sabotage-tested;
- proof that rejected PR 158 architecture did not return.

---

## 15. Reviewer checklists

### 15.1 Source-safety review

- [ ] Does every accepted mutation resolve to an explicit source edit?
- [ ] Can any generated HTML, page furniture, or editor chrome acquire a writable range?
- [ ] Is source origin derived from parser/plugin evidence rather than presentation?
- [ ] Do stale versions change nothing?
- [ ] Does no-op open/close change zero bytes?
- [ ] Are unknown source attributes preserved by unrelated edits?
- [ ] Is any serializer being used in the ordinary edit path?
- [ ] Is normalization being introduced to compensate for the editor?

### 15.2 Pagination review

- [ ] Does the paginator leave editor-owned semantic nodes untouched?
- [ ] Are page sheets and furniture outside the editable tree?
- [ ] Are named-page transitions and forced breaks represented?
- [ ] Does active editing stay paginated?
- [ ] Are columns, spreads, zoom, and page gaps included in coordinate mapping?
- [ ] Is repagination coalesced and revision-scoped?
- [ ] Does the gate compare page content distribution, not only count?
- [ ] Does failure output identify the page/strip and relevant geometry?

### 15.3 Styling review

- [ ] Does styling come from resolved project configuration?
- [ ] Are engine-native sheets included?
- [ ] Are fonts and assets resolved by the host?
- [ ] Are safe IDs/classes/data attributes preserved generically?
- [ ] Does any editor wrapper change the author cascade?
- [ ] If CSS is transformed, are at-rule context, specificity, and source order preserved?
- [ ] Are author/plugin styles isolated from the application shell?

### 15.4 Plugin review

- [ ] Is the fixture shaped like a real registered plugin rule?
- [ ] Does a liveness assertion prove the transform ran?
- [ ] Are copy, move, consume-all, cross-hunk, and lazy-continuation cases covered where relevant?
- [ ] Are ambiguous origins refused with a rule name?
- [ ] Is plugin-rendered HTML view-only?
- [ ] Does active state preserve safe wrapper styling?
- [ ] Is cross-region ancestry measured on a real plugin book?
- [ ] Does untrusted mode avoid executing project plugin code?

### 15.5 Interaction review

- [ ] Can the author perform the workflow in the active surface?
- [ ] Does the test use real pointer/keyboard input?
- [ ] Does it assert the target exists before interacting?
- [ ] Has the gate been shown to fail with the defect reintroduced?
- [ ] Does source mode remain available and preserve the same document?
- [ ] Are controls disabled or hidden when they target an inactive surface?
- [ ] Does the packaged application—not only the dev server—pass?

### 15.6 Test-tool review

- [ ] What exact question does this tool answer?
- [ ] What similar question does it not answer?
- [ ] Are repeated content and multiple columns handled correctly?
- [ ] Are fixture IDs unique by full path?
- [ ] Does missing input fail instead of skip?
- [ ] Is an empty target set an error?
- [ ] Is raw evidence available for spot-checking?
- [ ] Does the output contain enough information for a remote-browser failure?

### 15.7 Process review

- [ ] Is the change bounded to one coherent run?
- [ ] Are unrelated release fixes split out?
- [ ] Was each review finding reproduced before repair?
- [ ] Are rejected findings documented with evidence?
- [ ] Are product tradeoffs escalated instead of silently chosen in code?
- [ ] Are historical docs clearly marked as historical or superseded?
- [ ] Is only one live implementation branch active for the effort?

---

## 16. Required ADRs and durable records

The new effort should create or update records for:

1. **Source-first editor authority:** exact Markdown, source edits, host persistence, no whole-document serializer.
2. **Paginated rich-editor DOM ownership:** stable semantic DOM, out-of-band page sheets and furniture, no fragmenter mutation.
3. **Gutterpress projection and generated-view taxonomy:** authored range, source-derived view metadata, generated anchor, refusal.
4. **Plugin transform-origin policy:** evidence sources, ambiguity, diagnostics, trust boundary.
5. **Resolved presentation context:** one style/page vocabulary shared by preview, print, desktop rich editor, and VS Code.
6. **`@vscode/markdown-editor` adoption/fork decision:** compatibility results, exact version, upstream seam, maintenance policy.
7. **Desktop/VS Code host boundaries:** authoritative document owner, undo/redo, CSP, assets, workspace trust.
8. **Parity-tool taxonomy:** editor-preview, preview-print, revision-diff, cross-browser.
9. **PR 158 supersession record:** what was retained, what was rejected, and where this guide lives.

Long historical rationale belongs in these records and this guide. Production comments should retain only the local invariant and a link.

---

## 17. Final team rules distilled from PR 158

1. **Do not make rendered or semantic editor state more authoritative than source.**
2. **Do not let pagination rewrite the editor’s content DOM.**
3. **Do not duplicate Gutterpress configuration, style ordering, or plugin semantics.**
4. **Do not infer writable source from rendered output.**
5. **Do not call a gate green when it did not run, skipped its fixture, or matched zero targets.**
6. **Do not treat fixpoint, byte equality, semantic equality, style parity, pagination parity, and interaction quality as interchangeable.**
7. **Do not ship inactive fidelity without active usability, or active usability without inactive fidelity.**
8. **Do not make authors switch surfaces for routine work the active editor should own.**
9. **Do not trust measurement tooling until it has been calibrated against known defects and controls.**
10. **Do not cherry-pick PR 158 wholesale. Re-create the proven behavior on the current source-first foundation.**
11. **Do preserve its real-book fixtures, adversarial cases, security lessons, page-presentation findings, and measurement discipline.**
12. **When uncertain, build the smallest experiment that can disprove the design before expanding production code.**

---

## 18. Evidence index

The following commits are especially useful starting points for implementers:

| Evidence | What it demonstrates |
|---|---|
| [`bf1b78e`](https://github.com/dimm-city/gutterpress/commit/bf1b78e) | A parity gate can exist, skip missing fixtures, and never run in CI |
| [`61717ff`](https://github.com/dimm-city/gutterpress/commit/61717ff) | Measure and delete obsolete layout workarounds; generic renderer paths preserve attributes better |
| [`e061b54`](https://github.com/dimm-city/gutterpress/commit/e061b54) | Packaged app found an editor that never opened; verify every source language and theme token |
| [`56e7531`](https://github.com/dimm-city/gutterpress/commit/56e7531) | Independent review findings: one safety predicate, authoritative resolver, TOCTOU-safe plan/apply, stale async rejection |
| [`5c2c95f`](https://github.com/dimm-city/gutterpress/commit/5c2c95f) | Realistic plugin fixture, authored versus transformed attributes, semantic comparator |
| [`a08376f`](https://github.com/dimm-city/gutterpress/commit/a08376f) | HTML hierarchy, named pages, marker attributes, tight-list visual differences |
| [`fcb5462`](https://github.com/dimm-city/gutterpress/commit/fcb5462) | Stop and record confirmed silent data loss before proceeding |
| [`6400fb1`](https://github.com/dimm-city/gutterpress/commit/6400fb1) | Adversarial design review invalidated an unsatisfiable provenance plan before implementation |
| [`6d06f37`](https://github.com/dimm-city/gutterpress/commit/6d06f37) | Fail-closed provenance and the complexity required by source reconstruction |
| [`4f7128b`](https://github.com/dimm-city/gutterpress/commit/4f7128b) | True consume/replace fixture shapes and liveness tests |
| [`5be0b56`](https://github.com/dimm-city/gutterpress/commit/5be0b56) | Byte gates missed visually wrong wrapper cross-pairing; opaque regions are barriers |
| [`00c459b`](https://github.com/dimm-city/gutterpress/commit/00c459b) | Real-app parity found authored braces, chained wrappers, and generated-label gaps |
| [`4aaf67d`](https://github.com/dimm-city/gutterpress/commit/4aaf67d) | Tool calibration, cascade transparency, and explicit remaining differences |
| [`9cca179`](https://github.com/dimm-city/gutterpress/commit/9cca179) | Corrupted fixture passed weak text-presence assertions |
| [`3c571a1`](https://github.com/dimm-city/gutterpress/commit/3c571a1) | Opaque plugin regions must show plugin output and may require cross-region ancestry |
| [`48c608d`](https://github.com/dimm-city/gutterpress/commit/48c608d) | Rich editor must use resolved engine styles, not direct manifest styles |
| [`f1b5538`](https://github.com/dimm-city/gutterpress/commit/f1b5538) | Active editor must expose image layout controls; share one authoring vocabulary |
| [`763eb14`](https://github.com/dimm-city/gutterpress/commit/763eb14) | Interaction gate, sabotage proof, and vacuous-pass correction |
| [`1d553b3`](https://github.com/dimm-city/gutterpress/commit/1d553b3) | Revision diff answers a different question than preview/print parity |
| [`5a5e54e`](https://github.com/dimm-city/gutterpress/commit/5a5e54e) | Cross-browser failures need self-contained forensic output |

Some short hashes in the table are labels; follow the linked full commit for the authoritative identifier.

---

## 19. Completion condition for using this guide

Before the new implementation is considered ready to merge, the final acceptance reviewer must confirm:

- every **ADOPT** lesson is represented by a binding decision, test, architecture rule, or deletion proof;
- every **ADAPT** lesson has a source-first implementation and does not copy a ProseMirror-specific workaround without reproduction;
- every **DO NOT PORT** item is absent from production dependencies and source;
- every release-blocking **INVESTIGATE** item has a recorded experiment and disposition;
- the evidence links and historical branch remain accessible;
- the implementation-plan acceptance matrix cites the applicable lesson and gate evidence.

A criterion without evidence is incomplete.

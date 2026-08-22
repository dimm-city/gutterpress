# Stale comment inventory — both repos

**Date:** 2026-08-11
**Scope:** `print-md/` (CLI src, desktop src + electron, docs, examples, scripts, tests) and `dc-op-manual/` (CSS, project plugin, docs, field-guide markdown).
**Method:** three parallel sweeps, then a lead verification pass. Agent coverage varied widely, so the **greppable counts below are my own exhaustive sweep**, not a sample.

Deliberately historical material is EXCLUDED throughout and must not be "cleaned": `docs/engine-history/`, `docs/audits/`, `docs/migrations/`, `docs/native-engine-parity-evidence-archive.md`, `docs/native-engine-acceptance-gate.md`, `CHANGELOG.md`, `.archive/`.

> **This exclusion was violated two days later.** Commit `5e3b209` ("clean up", 2026-08-13) deleted all three files in `docs/migrations/` plus `docs/native-engine-acceptance-gate.md` and `docs/native-engine-parity-evidence-archive.md` — five of the seven paths named above. The migration guides were restored on 2026-08-21, because six live pointers (the CHANGELOG, the user guide, the shipped `manifest.schema.json`, and three source comments including a `warnOnce()` string printed to users) still cited them. The two `native-engine-*` files remain deleted; `packages/cli/src/engine/viewer/fragment.ts` and `packages/cli/src/preview/nav-native.test.ts` still cite the acceptance gate. **Deleting a file that live code points at is not cleanup.** Check inbound references before removing anything under `docs/`.

---

## The rule this inventory applies

A comment that **explains why code looks the way it does** is valuable even when it names a removed engine — that is institutional memory, and deleting it invites someone to "simplify" a workaround whose reason is no longer written down. Mark those KEEP-AS-HISTORY.

A comment that **asserts something currently true which is not** is stale. Where it would actively mislead someone into writing worse code, it is flagged **WRONG** — those are the priority.

---

## Scale (my own counts, not the agents')

### print-md — "Paged.js" mentions per file, excluding historical

| File | Hits |
|---|---:|
| `docs/native-only-migration-plan.md` | 31 |
| `docs/native-engine-dx-recommendations.md` | 16 |
| `docs/native-engine-styling-guide.md` | 15 |
| `docs/reviews/inline-editing-analysis-2026-08-04.md` | 14 |
| `docs/inline-editing-plan.md` | 13 |
| `docs/ARCHITECTURE.md` | 11 |
| `docs/pwa-webadapter-plan.md` | 10 |
| `packages/cli/src/lib/markdown/markdown-it-paged.js` | 8 — **see correction, mostly legitimate** |
| `CLAUDE.md` | 7 |
| `packages/cli/src/lib/engine.ts` | 6 |
| `packages/desktop/electron/main.ts`, `…/markdown-it-paged.test.ts`, `…/assemble.ts`, `docs/ux-design-contract.md`, `docs/adr/0009-…` | 5 each |
| `…/manifest.types.ts`, `…/embedded-assets.test.ts`, `…/build-runner.ts` | 4 each |

The two migration/plan docs at the top are *about* the migration and are arguably self-historical — decide their status deliberately rather than sweeping them.

### dc-op-manual — 493 total mentions

| File | Hits |
|---|---:|
| `dc-design-guide/docs/css-architecture.md` | **45** |
| `dc-design-guide/css/dc-components.css` | 23 |
| `dc-design-guide/css/native-furniture.css` | 12 |
| `dc-design-guide/css/page-templates.css` | 11 |
| `dc-design-guide/css/fg-overrides.css` | 7 |
| `dc-design-guide/css/page-rules.css` | 6 |
| `dc-design-guide/css/dg-overrides.css` | 6 |
| `dc-design-guide/03-palette.md` | 5 |
| `dc-design-guide/css/dc-core.css`, `README.md`, `05-page-templates.md` | 4 each |
| `dc-design-guide/docs/constitution.md` | 3 |
| `dc-design-guide/plugins/dimm-city-plugin.js` | 2 |

### Removed image classes still named as current

Files containing `.center` / `.float-left` / `.float-right` / `.full-width` / `.full-bleed` outside the excluded set:

`packages/cli/tests/field-guide-input/*.md` (**8 sites** — chapter-01 ×1, chapter-02 ×6, chapter-04 ×1), `examples/with-design-guide/design-guide/{00-toc,04-page-templates,05-layout}.md`, `examples/gutterpress-user-guide/03-visual-elements.md` (migration prose — correct), `docs/contextual-cascade-principle.md`, `docs/native-engine-styling-guide.md`, plus the desktop editor's deliberate legacy-recognition list (`image-classes.ts`, `toolbar-actions.ts` and their tests — **correct, keep**).

---

## Priority 1 — WRONG: comments that would make someone write worse code

| file:line | Text | Why WRONG | Action |
|---|---|---|---|
| `dc-op-manual/dc-design-guide/docs/css-architecture.md:33` | "`counter-set` — Paged.js polyfill does not implement it. Use `counter-reset` only." | **Verified false**: a fixture with `counter-set: sec 41` renders `[sec=41]`. | DELETE the row |
| `…/css-architecture.md:34` | "`text-wrap: balance/pretty` — CSS4 properties, Paged.js ignores them" | **Verified false**: both accepted and applied. | DELETE the row |
| `…/css-architecture.md:30` | "`filter:` on layout boxes → use tiled PNG on `.pagedjs_sheet` for texture effects" | Names a selector that can never match. Following this advice produces nothing. | REWORD → `@page { background }` |
| `…/css-architecture.md:372-373` | "**Critical**: use `counter-reset` only. `counter-set` is not implemented by the Paged.js polyfill" | Same false claim, restated as a rule. | DELETE |
| `…/css-architecture.md:268-284` | "Paged.js caveat — `content: none` in named `@page` rules is silently dropped" + `.pagedjs_*` override code | The bug and the override are both gone; the workaround it prescribes is dead code. | DELETE |
| `…/css-architecture.md:13` | "engine via Paged.js, and every rule must survive that pipeline unchanged" | The framing sentence of an 800-line governing document, describing a removed pipeline. | REWORD |
| `…/css-architecture.md:24-36` | whole section "What Paged.js silently ignores" | Four of its rows are now false or dead. | Reframe as history, or delete |
| `dc-op-manual/dc-design-guide/03-palette.md:90-98` | code example applying a background to `.pagedjs_sheet` | A worked example a reader will copy, that cannot work. | REWORD → `@page { background }` |
| `dc-op-manual/dc-design-guide/README.md:4-5` | "renders to a print-quality PDF on US Letter paper via Paged.js" | First lines of the project README; also "US Letter" is wrong — the book is 8.625×11.25in. | REWORD |
| `print-md/docs/ARCHITECTURE.md:103` | `├── pagedjs.ts   # Paged.js HTML patching` | **Verified**: the file does not exist. A file-tree diagram listing a deleted file. | DELETE the line |
| `print-md/docs/ARCHITECTURE.md:18, 143, 125` | "uses Chromium + Paged.js for PDF generation and Paged.js for live preview" | The top-level architecture doc describes the wrong engine. | REWORD |
| `print-md/docs/native-engine-styling-guide.md:26-28` | "A full-bleed texture needs two layers: `html { background }` … plus `@page` margin boxes (all 16…)" | **Now false for the PDF path** — `@page { background }` paints the whole sheet and the viewer honours it. This is the guide's own §1. | REWORD |

## Priority 2 — stale pointers created by this session's own refactors

| file:line | Text | Action |
|---|---|---|
| `packages/desktop/src/lib/editor/image-classes.ts:6-8` | "The vocabulary itself is core's: `PAGED_CSS` in `packages/cli/src/lib/markdown/markdown-it-paged.js` ships the rules" | The `gp-*` rules moved to `GUTTERPRESS_CSS` in `gutterpress-css.ts`. **Broken by my own change** — REWORD |
| `dc-op-manual` CSS × several | Comment blocks describing rules deleted this session (`@page chapter-end`, `@page clean`, `.page.full-bleed`, `.pmd-suppress-footer`, both `overflow-x: clip` guards, `img.bottom`, old §12) | Audit findings A17–A19 cover these; DELETE the orphaned blocks |

## Priority 3 — REWORD: names a deleted engine while describing current behaviour

| file:line | Text | Action |
|---|---|---|
| `packages/desktop/electron/main.ts:670-671, 686-690, 831-834` | "paged.js's requestAnimationFrame loop", "collapses the first paged.js render to ~1 page/sec" | The throttling problem is real and current; only the engine name is wrong. REWORD to "the renderer's" |
| `packages/desktop/src/lib/components/PreviewFrame.svelte:89-96` | "NEVER hide this iframe while paged.js is laying out" | Same — real constraint, wrong name. REWORD |
| `packages/desktop/src/lib/editor/toolbar-actions.ts:416-419` | "`.col-split` is required — Paged.js strips `break-after: column`" | REWORD, **and check whether `.col-split` is still needed at all** — if native honours `break-after: column`, this is a dead feature, not just a dead comment |
| `dc-op-manual/dc-design-guide/css/page-rules.css:10` | "Paged.js counter workarounds" | REWORD → "counter resets" |
| `packages/cli/tests/field-guide-input/*.md` (8 sites) | `.float-left` / `.float-right` on images | Test-input fixtures now render as plain inline images. Migrate to `.gp-left`/`.gp-right` — or state in a header comment that these fixtures deliberately exercise the un-migrated form |

## Priority 4 — KEEP-AS-HISTORY

`dc-op-manual/dc-design-guide/css/page-templates.css:44-46, 62-63, 121, 141`; `dc-core.css:138-143`; and the measured column-fill notes — these explain *why* a rule exists and what was measured. Keep. Consider a `HISTORICAL:` prefix convention so a future sweep does not re-flag them.

---

## CORRECTION — `markdown-it-paged.js` is not stale here

One sweep recommended rewording five Paged.js references in `packages/cli/src/lib/markdown/markdown-it-paged.js` (lines 283, 290, 446, 651, 759, incl. "Minimal Paged.js-friendly CSS").

**Reject.** That file is the inlined copy of the **standalone, independently published `markdown-it-paged` package**, whose own `package.json` description reads:

> "Markdown-it extension providing @spread/@page/@section/@break markers for print-friendly DOM wrappers **(Paged.js compatible)**."

Paged.js compatibility is that plugin's advertised scope. Gutterpress dropping Paged.js does not remove it from the plugin's world — and per `CLAUDE.md` §6 we must keep Gutterpress concerns *out* of that file, which cuts both ways. Rewording its comments to describe only the native engine would be making the same category error the `gp-*` move just corrected.

**One genuine question inside that file**, which is a *code* question rather than a comment question: `.col-split` emits explicit `<div class="col">` wrappers because Paged.js stripped `break-after: column`. If native honours the property, Gutterpress may no longer need the wrapper path. Worth measuring — it is not a comment fix.

---

## Recommended handling

1. Fix the **Priority 1 WRONG** items first, and treat `css-architecture.md` as a rewrite rather than a patch — 45 mentions in one governing document is not a sweep job.
2. Fix the Priority 2 pointer I broke.
3. Priority 3 is mechanical; do it in one pass per repo.
4. Leave Priority 4 alone, and adopt a `HISTORICAL:` marker so the next sweep can tell the difference without re-deriving it.
5. Decide deliberately what `docs/native-only-migration-plan.md` (31 mentions) and the inline-editing planning docs are: if they are records of a completed migration, move them under `docs/engine-history/` and they stop being noise forever.

## Coverage note

The three sweeps found 6, 10 and ~48 items respectively. The first materially under-reported: it found 1 of 8 removed-class uses in test fixtures and surfaced 2 of the 13 doc files that mention Paged.js. Greppable categories in this document are therefore my own exhaustive counts. The judgement calls (KEEP-AS-HISTORY vs REWORD) come from the sweeps and were spot-checked, not re-derived line by line — treat the per-line verdicts in Priority 3 and 4 as advisory rather than final.

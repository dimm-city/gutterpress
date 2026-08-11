# 0.10.0 alignment audit — dc-design-guide, field-guide, and the shipped examples

**Date:** 2026-08-11
**Scope:** `dc-op-manual/dc-design-guide/` (CSS, docs, project plugin), `dc-op-manual/field-guide/` (authoring), and `print-md/examples/` + `print-md/docs/fixtures/`.
**Method:** six parallel audit teams, each with a non-overlapping domain, followed by a verification pass on every HIGH finding. Findings that did not survive verification are recorded below as **CORRECTED** rather than deleted, because the reasoning behind an overstated finding is itself useful.

Goal: make dc-op-manual a project that demonstrates best practice — professional output, easy authoring, maintainable layout — with legacy implementations replaced by standards-aligned ones.

---

## TL;DR

The book is in better shape than its size suggests: **zero `!important`**, **zero vendor prefixes**, only 3 uses of superseded `page-break-*`, and 158 of 171 component classes are live. The problems are not sprawl — they are **stale scaffolding from the Paged.js era that no longer describes reality**, and a **project plugin that has grown past what it needs to do**.

**Two CRITICAL engine bugs came out of this, and they outrank everything else.** `var()` inside `@page` fails silently, two different ways: in `size:` it yields **Letter instead of the book's trim**, and in `margin:` it **disables the shrink-to-fit guard**. Both reproduced. The field guide is running with the guard off right now. See §6b.

The six *book* changes that matter most, in order:

1. **The design guide does not render like the field guide.** It loads `css/index.css`, which imports 7 stylesheets but **not** `native-furniture.css` — so the book that documents the design system, with live specimens in it, is missing the brick wall, the folio stickers, the image-bottom flow, the multicol fixes and the break glue. The reference is not showing the product.
2. **`@page { background }` collapses the brick wall from 15 rules to 1** — and dissolves two more sections of workaround with it.
3. **The book's own governing docs teach removed constraints.** 1,390 lines of `constitution.md` + `css-architecture.md` still describe a Paged.js pipeline, including advice that is now demonstrably false.
4. **`native-furniture.css` should stop existing** — and finding 1 is *why it is harmful*, not merely redundant: it is a layer whose only mechanism is "load last and undo", which manufactures cascade fights structurally and splits the two books' rendering.
5. **The project plugin should shrink by roughly half.** Eight macros are `<div class=X>` wrappers that core's `@section .x` already does, better.
6. **58 lines of hand-written `<div>` stat blocks** in the field guide are a markdown table.

---

## 1. The single highest-value change: one `@page` rule replaces the brick wall

**Verified by fixture, in the PDF — not just the viewer.** `@page { background: <color> url(...) }` paints the **entire sheet, margins included**, with `background-size` and `background-blend-mode` honoured.

Today the book paints its brick wall in two layers because the root background only covers the content box:

```css
/* native-furniture.css §1 + §2 — 15 rules */
html { background-color: var(--bg); background-image: url("../img/brick-bg-01.png");
       background-size: 1.5in auto; background-blend-mode: multiply; }
@page {
  @top-left-corner { content: ""; background: var(--bg) url("../img/brick-bg-01.png"); … }
  /* × 13 more margin boxes */
}
```

becomes:

```css
@page { background: var(--bg) url("../img/brick-bg-01.png") repeat 0 0 / 1.5in auto;
        background-blend-mode: multiply; }
```

This cascades further than the line count suggests:

- **§3 (folio stickers)** currently keeps each chip box full-height with a trailing brick background layer, purely so the margin band stays continuous. With the page background underneath, the chip can be `width/height: fit-content` and the band is continuous anyway — the trailing layer and the `--*-blend` multiply lists go.
- **§4 (chip suppression)** currently refills suppressed boxes with brick. With a page background, a bare `content: none` suffices — roughly 8 lines become 4.

**Caveat, measured:** gradient-only `@page` backgrounds paint **nothing** in Chromium print, while solid colours and `url()` images paint the full sheet. Pre-rasterise gradients. This is not in the styling guide and should be added.

**Prerequisite — already shipped:** the viewer models `@page` paint declarations as of `72e02d4`, so this no longer causes a preview↔print divergence.

---

## 2. The book's governing documents are stale, and actively misleading

This is the finding with the longest tail, because these documents steer every future change.

| File | Lines | Problem |
|---|---|---|
| `dc-design-guide/docs/css-architecture.md` | 800 | Opens with "engine via Paged.js, and every rule must survive that pipeline unchanged". Contains a table of "what Paged.js silently ignores" whose advice is now wrong. |
| `dc-design-guide/docs/constitution.md` | 590 | "Pages inherit chapter numbering via Paged.js cascade"; file-ownership table lists "Paged.js counter fixes". |
| 6 design-guide chapters | — | 23 Paged.js mentions in author-facing prose. |

Two claims from that table, **verified false** by fixture on the current engine:

| Doc claim | Reality (measured) |
|---|---|
| "`counter-set` — Paged.js polyfill does not implement it. Use `counter-reset` only." | `counter-set: sec 41` renders `[sec=41]`. Works. |
| "`text-wrap: balance/pretty` — CSS4 properties, Paged.js ignores them." | Accepted and applied. |
| "`filter:` on layout boxes → use tiled PNG on `.pagedjs_sheet`" | `.pagedjs_sheet` cannot match anything; the advice names a dead selector. |

**Recommendation:** rewrite both governing docs against the native engine before doing any further CSS work in this book. Leaving them is worse than leaving stale CSS — stale CSS is inert, stale doctrine reproduces itself.

---

## 3. `native-furniture.css` should be dissolved

The file exists to hold "rules that differ between engines". There is one engine now, so every rule in it is simply *the book's CSS*, and its load-last position wins every cascade fight — which is how §12 outlived its cause and became a bug (already fixed).

Per-section disposition, from the audit (VERIFIED = checked against a built fixture):

| § | What it does | Status | Disposition |
|---|---|---|---|
| 1–2 | Brick wall, two layers | **VERIFIED-GONE** as a requirement | Collapse to one `@page` rule → `page-rules.css` |
| 3 | Sticker gradient stacks | **VERIFIED-REAL** (`box-shadow`/`rotate()` genuinely dropped in margin boxes) | Keep; simplify per §1 above |
| 4 | Chip suppression refill | **VERIFIED-GONE** | Simplify to `content: none` |
| 5 | Front-matter margins/masthead | Justified (gradient `@page` bg paints nothing, so a partial band still needs margin boxes) | Move → `page-templates.css` |
| 6, 7 | Credits plate, image-bottom flow | No engine defect named | Move → `fg-overrides.css` |
| 7 | `break-inside: avoid` on image wrappers | **VERIFIED-REAL** (core ships only `break-before` glue) | Keep; move → book layer |
| 9 | Tall-placard `max-height` cap | **VERIFIED-REAL** (1179px art sliced across 5 pages; core only warns) | Keep |
| 9 | the `- 4px` fudge in that cap | **VERIFIED-GONE** (core's `vertical-align: bottom` collapsed the line box) | Delete the fudge |
| 10 | `column-fill: auto`, `.section` break override | **VERIFIED-REAL**, measured at 302pp vs 299pp | Keep — see correction below |
| 13 | Callout/card break glue | **VERIFIED-REAL** (core's glue is `:where()` and doesn't know these classes) | Keep; move → `dc-components.css` |

What survives is a handful of genuine Chromium gaps, each a one-line rule that should carry a comment naming its removal trigger — which is what "design for deletion" asks for. No separate engine layer is needed to hold them.

### CORRECTED finding

> *Audit claimed:* §10 papers over a `break-inside: avoid` that `dc-components.css` still sets; fix at source by removing it.

**Wrong.** `dc-components.css`'s `.section { break-inside: avoid }` is deliberate and documented: *"Sections are atomic units — they MUST NOT span pages… The resulting dead zone is intentional design behavior, not a layout failure."* §10's override is a correctly scoped exception for the multicol case, not a paper-over. Removing the source rule would change the book's page model. The audit read the override without reading the rule's rationale.

---

## 3b. The layer contract: eight files are two axes pretending to be one

Seven stylesheets split by **concern**; `native-furniture.css` splits by **engine**. To do its job the engine file must violate all seven contracts at once — it holds `:root` tokens, `@page` rules, `.page.*` templates, `.section` rules and bare-element rules simultaneously. That crossing is the structural cause of the highest-severity findings below, and it is why the two books render differently.

**HIGH — verified:**

| # | Evidence | Finding |
|---|---|---|
| L1 | `dc-design-guide/manifest.yaml` loads `css/index.css`; `index.css` has 7 `@import`s and **0** references to `native-furniture.css` | The design guide renders without the native layer entirely. Its specimens do not show the real book. |
| L2 | `fg-overrides.css:111-120` vs `native-furniture.css:278-286` | `.fg-art-founders-house` is `position:absolute; bottom:-2.5in; width:100%` in one file and `position:static; width:calc(100% + 1.69in); margin:0 -0.845in` in the other. **Layer 2 exists solely to undo layer 1.** |
| L3 | `page-templates.css:363-380` vs `native-furniture.css:243-250` | Masthead out-dent restated **identically** in both; only `margin-top` differs. Four dead declarations. |
| L4 | `page-templates.css:407-426`, `dg-overrides.css:205-212`, `:362-379` | TOC rows styled in **three** places, two at identical specificity (0,3,2) — the winner is decided by manifest order alone. |
| L5 | `fg-overrides.css:543-547` vs `dc-core.css:208-209` | `dc-core` exposes `--dc-table-header-bg/-color` *specifically* so this file can override via token; it sets raw `background`/`color` instead, bypassing its own contract. `.dc-table` is defined nowhere. |
| L6 | `fg-overrides.css:328-342, 361-366, 371-380, 479-484, 529-533` | Five rules set raw `background`/`border`/`padding`/`color` on components, violating this file's own stated CORE CONSTRAINT (`:25-32`) and its own restatement at `:399-401` ("We never set raw values here"). |

**MED, abbreviated:** the "column ownership rule" (`page-templates.css:28-29`) splits 8 components across two files and leaks anyway (`column-span:all` at 5 sites in `dc-components.css`); ~90 lines of chapter/page scaffolding sit inside `dc-components.css` (`:3874-3960`) against its own contract; `.fg-art-handle`, `.fg-art-vibe`, `.fg-art-wall-feature` are each defined **twice within `fg-overrides.css`**, ~400 lines apart; `dc-tokens.css`'s header claims to own resets it does not contain; `dg-overrides.css` (another book's overrides) is loaded by the field guide and leaks unscoped rules into it.

### Proposed target: five files

1. `dc-tokens.css` — `:root` + `@font-face` (already clean; only the header lies)
2. `dc-core.css` — element baseline, absorbing the bare-element/utility strays from `dc-components.css`
3. `dc-components.css` — components **including their own columns** (delete the column-ownership rule; it buys nothing and costs eight split components)
4. `page.css` — merge `page-rules` + `page-templates` + the page-shaped half of `native-furniture`. Every named page currently lives in two or three files; one file per page ends L3, L4 and the orphaned-comment findings.
5. `fg-overrides.css` — book context overrides only

`dg-overrides.css` should not be part of the shared stack at all — it belongs in the design-guide project beside its own markdown. The field guide would then load four shared files plus its own.

### CORRECTED — my own earlier call

When I removed §12's abspos overrides, I left `.fg-art-founders-house` alone, reasoning that its `bottom: -2.5in` was "a deliberate design bleed `.gp-pin` cannot express". **That was wrong**: L2 shows native-furniture overrides it to `position: static`, so the bleed never applies. The abspos block is dead code and the pair should be collapsed to one rule.

---

## 4. The project plugin should shrink by about half

`dimm-city-plugin.js` is 1,914 lines. Roughly 700 lines carry behaviour core cannot express; the rest is re-implementation.

**Delete — zero uses:** `@glossary`, `@roll-table`, `@options-table`, `@end-skills`, `buildDistanceTags`.

**Delete — core `@section .class` does this already, better:** `@sidebar`, `@sidebar-box`, `@definition`, `@lede`, `@toc`, `@specialty-intro`, `@specialty-art`, `@tape`. Eight macros, **89 uses**, all emitting nothing but `<div class=X>…</div>`. Three of them (`@toc`, `@lede`, `@glossary`) parse author attributes and then **silently discard them**, so `@lede .foo` is a no-op today — core's marker handles attributes correctly.

**Delete — aliases of other macros in the same file:** `@dm-note` → `@callout variant=dm` (byte-identical output; its own header says "sugar for"); `@gear` → `@card .dc-gear` (its own comment says so).

**Delete — dead code (HIGH).** The `@continue` skill-continuation branch is unreachable, and I confirmed the mechanism statically: core's `markdown-it-paged` claims `continue` as a marker kind (`markdown-it-paged.js:96`) and consumes it into layout tokens (`:553`), and `renderer.ts` registers core **before** user plugins. The project plugin matches markers on `paragraph_open`, so by the time it walks the token stream `@continue` is no longer a paragraph. All 17 uses fall through; the `{name} ▸` continuation tab never renders. The field guide's *working* mechanism is the separate `@skill {.continued}` class (4 uses).
*(A runtime repro was attempted and was inconclusive — `@skill` did not fire in a bare fixture — so this rests on the code path, which is decisive on its own.)*

**Fix — HIGH, correctness/robustness:**
- `attrs['class']` and `attrs['variant']` are interpolated **unescaped** into `class="…"` (lines 1226–1230, 1168), unlike the `buildAttrs` helper used elsewhere. `@block .a" onx="` injects attributes.
- `name="…"` is emitted on a `<div>` — not a valid attribute. Use `id=` or `data-name=`.

**Fix — MED:** `parseAttrs` (411–486) is an inlined copy of core's `parseMarkerLine` per CLAUDE.md §5 — the right approach — but it has **drifted**: no positional-name slot, no `isBareToken`, no ambiguous-bare-token warning. The same author syntax behaves differently depending on which parser sees it.

**Keep:** `@skill`, `@learning-path`, `@card`, `@block`, `@procedure`, `@outcome`, the GFM alert transform, and the inline AP/roll-die parsing. These are genuine markdown→structure macros with no core equivalent.

---

## 5. Authoring surface

34 distinct markers are in use; core provides 7, the plugin the other 27. Usage is extremely skewed: `@skill` 170, `@section` 95, `@page` 52 — then a long tail of macros used once or twice.

| Finding | Evidence | Recommendation |
|---|---|---|
| **58 lines of raw `<div>` stat blocks** | `chapter-04.md:326-519`, four ~15-line nested trees | It is a 2-column key/value table plus prose lines. Markdown already expresses that; `.dc-npc-stat` CSS exists (`dc-components.css:3655`). Removes all meaningful raw HTML from the book. |
| Chapter number retyped on every page | `.chapter-01` ×11, `.chapter-03` ×17, `.chapter-04` ×11 | Derive from the enclosing `@chapter`; ~50 redundant tokens |
| `.allow-split` retyped 39× on `@skill` + 4× on `@section` | | Make it the specialty default |
| **`@continue` means two different things** | core section-continue vs the (dead) skill form | Rename one |
| Two idioms for DM notes | `@dm-note` (9) vs `> [!DM]` blockquote (91 alerts total) | Pick the blockquote; it is standard GFM |
| Two idioms for outcome tables | `@outcome` (7) vs auto-classified `Roll`/`Outcome` GFM table | Pick the table |
| `@procedure` auto-closes at EOF with only a warning | plugin header | Fail loudly |
| `@card`/`@end-card` needs a blank line after a blockquote | documented **only** in plugin source (1261–1263) | Fix the parser or document it |
| 2 stray `<br>` tags | `chapter-02 1 Augmerc.md:102`, `chapter-02 3 Streetwarden.md:580` | Already against the user guide's own rule |

### Loose end from recent work

`field-guide/chapter-01.md:103` still carries `{.bottom .fg-art-handle}`. The `img.bottom` rule was removed in the image-bottom consolidation, so `.bottom` now styles nothing. This is a straggler created by that change, not pre-existing drift.

---

## 6. Shipped examples and fixtures

**Clean:** no live use of the five removed image classes (`.center`/`.float-left`/`.float-right`/`.full-width`/`.full-bleed`) anywhere in examples or fixtures — the only mentions are correctly-framed migration prose. No hand-rolled equivalents of `gp-*` primitives.

| Finding | Location | Action |
|---|---|---|
| Dead `engine: paged` fixture, **tracked in git** | `docs/fixtures/css-authoring-spike/book/manifest-paged.yaml` + `styles/style-paged.css` | Delete — `engine: paged` is now a no-op that warns |
| Dead `.pagedjs_sheet` background rules | `examples/gutterpress-user-guide/styles/guide.css:200`, `examples/with-design-guide/design-guide/styles/guide.css:240` | Selector can never match; replace with `@page { background }` |
| ~6 comments/prose naming Paged.js as a live option | both `guide.css` files; `04-page-templates.md:145,182`; `06-markdown-reference.md:123` | Reword; drop the dead pagedjs.org link |

Load-bearing parity fixtures (per `native-parity-gate.ts`): `examples/with-design-guide/{book-01,book-02,design-guide}`, `docs/fixtures/css-authoring-spike/book`, `docs/fixtures/gp-image-positioning/book`. These must stay buildable and parity-clean; their prose bar is lower than the user-facing examples.

### CORRECTED finding

> *Audit claimed:* `examples/with-design-guide/design-guide/.reviews/` (24 MB of QA screenshots) is shipped by accident — HIGH severity repo bloat.

**Wrong.** It is gitignored (`.gitignore:56`) and `git ls-files` returns zero entries. It is local scratch and is not shipped. Nothing to do.

---

## 6b. Two CRITICAL engine bugs — `var()` in `@page` fails silently

These are **Gutterpress bugs, not book bugs**, and both fail silently. I reproduced each myself.

### B1 — `var()` in `@page { size }` silently yields Letter

```css
:root { --pw: 8.625in; --ph: 11.25in; }
@page { size: var(--pw) var(--ph); }   /* → 612 × 792 pt (Letter)  ✗ */
@page { size: 8.625in 11.25in; }       /* → 621 × 810 pt           ✓ */
```

Measured, same fixture, one line changed. A book that tokenises its trim size gets **Letter with no warning** — a wrong-trim PDF is unusable to a printer. Root cause is in `engine/shared/gcpm-extract.ts` (~448-469, 525): `toPt` is lexical and the size parser falls back to `letter` silently.

**This makes the book's literal `size: 8.625in 11.25in` (`page-rules.css:86`) load-bearing.** Anyone "tidying" it to use the `--page-width`/`--page-height` tokens that sit right beside it in `dc-tokens.css:237-238` would silently reformat a 300-page book. Until the engine is fixed, that literal needs a comment saying so.

### B2 — `var()` in `@page { margin }` silently disables the shrink-to-fit guard

```css
@page { size: 6in 4in; margin: 0.75in; }        .wide { width: 5.5in }  → HARD ERROR ✓
:root { --m: 0.75in }
@page { size: 6in 4in; margin: var(--m); }      .wide { width: 5.5in }  → builds clean ✗
```

Identical geometry; only the margin's spelling differs. With `var()`, the compiler's width check — the one that hard-errors on content wider than the page content box — does not fire.

**The field guide is in exactly this state**: `page-rules.css:98,106,164,165,171,172` all use `var(--binding-margin, …)` / `var(--page-margin)`, so its named pages have been building with the guard effectively off.

#### CORRECTED — weakens evidence I gave earlier

When I removed the two `overflow-x: clip` shrink guards, part of my justification was that a full 300pp build reported **zero** shrink-to-fit offenders. Given B2, that signal was weaker than I represented — the check was disabled on the very pages it needed to cover.

The conclusion still holds, but on the *other* evidence: text occupies x 51.7..557.5pt in both builds, identical to a tenth of a point, which rules out a document scale directly. That measurement is what the decision should rest on, not the offender count.

---

## 7. Standards conformance — what's already right, and what to modernise

**Already standards-based, and worth protecting:** the GCPM layer is genuinely idiomatic — `string-set: guideSection attr(data-ch)` + `content: string(guideSection, first)`, `target-counter(attr(href), page)`, `counter(page)`, named pages via the `page` property. Nothing hand-rolled. All six `float`s are legitimate text-wrap floats that grid/flex cannot replace, already paired with `shape-outside` and `display: flow-root`.

| Finding | Replacement | Verified | Lines |
|---|---|---|---|
| `width: calc(100% + 1.25in)` + twin negative margins + `box-sizing` (4 decls, 5 sites) | `margin-inline: calc(-1 * var(--outer-margin))` | **Yes** — byte-identical raster | ~18 |
| `--outer-margin` declared with **zero** `var()` references; `0.625in` ×16, content-box arithmetic restated in 3 files | mint `--content-width`/`--content-height` as `calc()` off the page tokens | **Yes** — token chain and literal land identically | −20 magic numbers |
| 5 comments forbidding `:is()`/`:has()` as "Paged.js crashes" | Paged.js is gone — collapse the selector lists | **Yes** — `:is()`, `:has()` all build and apply | ~25 unblocked |
| 3 hand-typed `rgba()` copies of base tokens, **all three already drifted** | `color-mix(in srgb, var(--base) N%, transparent)` | **Yes** | fixes 3 live bugs |
| 57 physical properties vs 6 logical | `margin-inline`, `inset`, `border-block` | partial | ~20 |
| `page-break-*` alongside `break-*` (3 sites) | delete the legacy alias | **Yes** | 3 |
| `deprecated.css` (137 lines), unreferenced | dead file | Yes | 137 |

**Do not convert:** the hexes at `dc-tokens.css:122,128,132,140,149` carry measured WCAG ratios in their comments — `color-mix` won't reproduce them. `@page :left/:right` binding margins must stay **physical**; mirroring is the whole point.

---

## 7b. Cross-cutting: a limitation in the new containment lint

`printsafe/page-containment` (added `635076f`) flags stacking contexts and clipping ancestors on `.page`/`.spread`. But `dc-components.css`'s `.section` sets **`isolation: isolate`**, which is a stacking context that would trap a `.gp-behind` image inside any section — and the lint cannot see it, because `.section` is a book class, not one of core's wrappers.

Core cannot know a book's wrapper names. Options: let a book declare its own wrapper selectors for the check, or move the check to build time where the real ancestor chain is known (the engine already has an `engine.abspos.leak` diagnostic operating on the live DOM — the natural home).

---

## Recommended sequence

**−1. Fix the two `var()`-in-`@page` engine bugs (B1, B2) before touching the book's CSS.** They are the only findings here that can silently produce a wrong artefact, and B2 means the book's own safety net is currently off. Everything else in this audit is refactoring; this is correctness. Until B1 ships, add a comment to `page-rules.css:86` explaining why `size:` must stay literal.

0. **Make the design guide load what the field guide loads** (finding L1). Until this is true, every visual judgement made against the design guide is being made against a different stylesheet than the product. One line, and it likely surfaces further divergence — do it first and look at the result.
1. Rewrite `css-architecture.md` and `constitution.md` against the native engine *(nothing else should be built on stale doctrine)*
2. Collapse the brick wall to one `@page { background }` rule; simplify §3/§4 *(biggest CSS win, verified)*
3. Dissolve `native-furniture.css` into the ordinary layers, collapsing the undo-pairs (L2, L3) as you go
4. Plugin: delete the 5 zero-use macros, the 8 `<div>` wrappers, the 2 aliases, and the dead `@continue` branch; fix the 2 escaping/validity bugs
5. Replace the hand-written stat blocks with markdown tables
6. Examples: delete the dead paged fixture, fix the 2 dead `.pagedjs_sheet` rules, sweep the prose
7. Authoring ergonomics: chapter-class derivation, `.allow-split` default, pick one idiom per duplicated pair

Steps 1–3 are the ones that change how the project *feels* to work in. Steps 4–7 are mechanical once those land.

---

## Verification notes

Every HIGH finding above was re-checked. Two did not survive (both recorded as CORRECTED). Independent baselines gathered during verification, which the teams did not report and which are worth knowing:

- **0** `!important` across ~7,700 lines of book CSS
- **0** vendor prefixes
- **3** uses of superseded `page-break-*` (`page-templates.css` ×2, `dc-components.css` ×1)
- **158 of 171** classes declared in `dc-components.css` are referenced; the 13 unreferenced are documented author-facing span utilities (`{.fg1}`, `{.accent-*}`) in a library whose stated contract is reuse across projects — **not** dead code, and not to be deleted

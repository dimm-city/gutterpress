# 0.10.0 alignment audit — dc-design-guide, field-guide, and the shipped examples

**Date:** 2026-08-11
**Scope:** `dc-op-manual/dc-design-guide/` (CSS, docs, project plugin), `dc-op-manual/field-guide/` (authoring), and `print-md/examples/` + `print-md/docs/fixtures/`.
**Method:** six parallel audit teams, each with a non-overlapping domain, followed by a verification pass on every HIGH finding. Findings that did not survive verification are recorded below as **CORRECTED** rather than deleted, because the reasoning behind an overstated finding is itself useful.

Goal: make dc-op-manual a project that demonstrates best practice — professional output, easy authoring, maintainable layout — with legacy implementations replaced by standards-aligned ones.

---

## TL;DR

The book is in better shape than its size suggests: **zero `!important`**, **zero vendor prefixes**, only 3 uses of superseded `page-break-*`, and 158 of 171 component classes are live. The problems are not sprawl — they are **stale scaffolding from the Paged.js era that no longer describes reality**, and a **project plugin that has grown past what it needs to do**.

**Two CRITICAL engine bugs came out of this, and they outrank everything else.** `var()` inside `@page` fails silently in the declarations **our compiler parses itself**: in `size:` it yields **Letter instead of the book's trim**, and in `margin:` it **disables the shrink-to-fit guard**. Both reproduced. The field guide is running with the guard off right now. (`var()` in `@page { background }` — which Chromium parses — works fine; see §1.) See §6b.

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

**`var()` in the replacement rule — checked, and it works.** The solution review flagged that the one-liner above uses `var(--bg)` inside `@page`, in a document that also reports `var()` failing silently in `@page` (§6b) — and that my verification fixture had used a literal hex, so the combination was unproven. Re-tested directly: `@page { background: var(--bg) }` and `@page { background: #2d6cdf }` produce **identical output** (corner pixel `(46,107,222)` both).

That contradiction resolves into a sharper rule than either document had, and it explains B1/B2's mechanism:

> **`var()` works in `@page` declarations Chromium consumes directly** (`background`). **It fails in the ones our compiler parses itself** (`size`, `margin`) — because `gcpm-extract.ts` does lexical `toPt` conversion with a silent fallback, and never resolves custom properties.

So the fix for B1/B2 is not "ban `var()` in `@page`" but "make the compiler's own `@page` parsing resolve custom properties, or refuse loudly when it cannot". Anything Chromium parses is already fine.

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

---

# Appendices — complete team findings

The body above is the synthesis. These appendices preserve each team's full
findings table verbatim, so nothing is lost to summarisation. Severities are
the reporting team's; my verification verdicts are in the body and in
Appendix G.

## Appendix A — CSS layer contract (full table)

Paths relative to `dc-op-manual/dc-design-guide/css/`.

| # | file:line | Finding | Sev |
|---|---|---|---|
| A1 | `index.css:1-29` vs `field-guide/manifest.yaml:12-22` | `index.css` declares a "7-file stack" and omits `native-furniture.css` entirely. Only the field guide loads it (via `engineStyles.native`). The design guide — the document that *documents* this system — builds with no brick wall, no folio stickers, no `.image-bottom`, no multicol-fragmentation fixes. Its live specimens no longer show the real book. | HIGH |
| A2 | `fg-overrides.css:111-120` vs `native-furniture.css:278-286` | `.fg-art-founders-house` set `position:absolute; bottom:-2.5in; width:100%; margin:0` in one layer, then `position:static; display:block; width:calc(100% + 1.69in); margin:0 -0.845in; max-width:unset` in another. Layer 2 exists solely to undo layer 1. | HIGH |
| A3 | `page-templates.css:363-380` vs `native-furniture.css:243-250` | Frontmatter masthead: `margin-left:-0.625in`, `margin-right:-0.625in`, `width:calc(100% + 1.25in)`, `box-sizing:border-box` restated **identically** in both files; only `margin-top` differs (`-0.5in` → `0`). Four dead declarations. | HIGH |
| A4 | `page-templates.css:407-426` vs `dg-overrides.css:205-212` (+ `:362-379`) | `.page.page-toc .dc-toc ol > li` and its `::before` styled in two files at **identical specificity (0,3,2)** — the winner is decided purely by manifest order. With `dg-overrides.css:362-379` the TOC row is authored in three places. | HIGH |
| A5 | `fg-overrides.css:543-547` vs `dc-core.css:208-209` | `dc-core` exposes `--dc-table-header-bg`/`--dc-table-header-color` *specifically* so per-chapter overrides can pick a header colour; `fg-overrides` sets raw `background`/`color` instead, bypassing its own token. The comment at `:536` claims the default is `--hud-blue-dim`; it is `--ink-dark`. `.dc-table` (`:543`) is defined nowhere in the stack. | HIGH |
| A6 | `fg-overrides.css:328-342, 361-366, 371-380, 479-484, 529-533` | Five rules set raw `background`/`border`/`padding`/`color`/`box-shadow` on components — violating this file's own CORE CONSTRAINT (`:25-32`) and its own restatement at `:399-401` ("We never set raw values here"). | HIGH |
| A7 | `page-templates.css:28-29` | The "COLUMN OWNERSHIP RULE" splits **8 components across two files**: `.dc-card-grid` (`page-templates:223` + `dc-components:3725`), `.section.dc-rules-definition` (`:245` + `:4028`), `.two-column-list` (`:253`), `.dc-skill-card.two-col` (`:276` + `:1257`), `.section.col-split` (`:198`), `.toc`/`.guide-toc` (`:284,289` + `dg-overrides:224-325`), `.colophon-grid` (`:465`). It leaks anyway: `dc-components:2914` holds `column-rule`, and `column-span:all` appears at `dc-components:1257, 3279, 3320, 4062, 4067`. | MED |
| A8 | `dc-components.css:3874-3960` | ~90 lines of chapter/page scaffolding (`.chapter-opener`, `.chapter[data-chapter-label] > .page[data-page="intro"] > .section …`) inside a file whose contract forbids page/chapter context. A comment at `:3865-3868` explains why the *tokens* aren't here — immediately before the rules that are. | MED |
| A9 | `dc-components.css:2939-3369, 3375-3390, 972-978, 2727-2729, 3343-3346` | `.section` chassis (~430 lines), `.fg1`–`.fg4`/`.accent-*`/`.font-*` utilities, `hr`, and bare-element rules live in a file whose AGENT RULE (`:53`) admits only `.dc-*`/`.pmd-*`. `:3373` records that the utilities were moved here *to escape a violation in `dc-tokens.css`* — one violation resolved by creating another. | MED |
| A10 | `fg-overrides.css:246-250`+`:635-638`; `:252-262`+`:639-645`; `:231-237`+`:646-649` | `.fg-art-handle`, `.fg-art-vibe`, `.fg-art-wall-feature` each defined **twice in the same file**, ~400 lines apart; the second block adds the `width` the first deliberately omitted. | MED |
| A11 | `native-furniture.css:90-117` | A second `:root {}` block (`--sticker-h`, `--sticker-shadow`, `--folio-sticker`, `--chapter-sticker`, `--folio-blend`, `--chapter-blend`) outside `dc-tokens.css` — the only other `:root` in the stack. | MED |
| A12 | `dc-components.css:3096` vs `:3292` | `.section.two-column, .section.three-column { border-top: 3px solid … }` declared, then `border-top: 0` on the same selector 200 lines later. Line 3096 is dead. | MED |
| A13 | `dc-components.css:2187-2228` vs `:2236-2270` | `.dc-gear-entry` and `.section.dc-gear-list > .dc-card` near-byte-identical (same margin/padding/background/border-left, same `h3` rule, same contrast comment duplicated at `:2203` and `:2247`). The comment at `:2230` concedes it. | MED |
| A14 | `dc-tokens.css:5-24` | Contract claims it OWNS `* { print-color-adjust }`, the `html`/`body` baseline, and the `h1–h6/p/a/table` resets. It contains none of these — the file is `@font-face` + one `:root`. `dc-core.css:5-27` claims and implements the same list; `dc-core.css:30-32` holds the `print-color-adjust` rule. | MED |
| A15 | `dg-overrides.css:14-20` | Header documents a **5-file** order, omits `dc-core` and `fg-overrides`, and calls this file `guide.css`. Two more stale `guide.css` references at `dc-tokens.css:19` and `page-rules.css:18`. | MED |
| A16 | `dg-overrides.css:205-217, 224-325, 327-397, 406-408` | Rules **not** scoped to `.guide` in a file the field guide also loads, contradicting its own SCOPING clause (`:28-32`) — which was written after exactly this leak restyled field-guide `<hr>`s. `.toc`, `.page.page-toc*`, `.page.credits strong`, `.page:is(…) p` all reach field-guide pages. | MED |
| A17 | `page-templates.css:115-145` vs `:591-594` | `.dc-art-top`/`.dc-art-bottom` still defined; the comment 450 lines below says they "went with it… never matched anything". Confirmed: zero markdown usage in either book (docs prose only). | LOW |
| A18 | `page-templates.css:14`, `page-rules.css:242` | `.pmd-suppress-footer` documented as owned and "wired" — it has **no definition** anywhere, and the `@page clean` it wired to was already deleted. `.pmd-col-span` (`:110`) has no markdown consumer. | LOW |
| A19 | `page-rules.css:183-188`, `:242-244`; `page-templates.css:36-40, 147-149` | Orphaned comment blocks describing rules that no longer exist (`@page chapter-end`, `@page clean`, Paged.js sheet background, full-bleed template). | LOW |
| A20 | `dc-core.css:70-80`+`:266-272`; `:83-91`+`:281-283` | Headings styled in two separate blocks 200 lines apart in the same file; `break-after: avoid` declared twice, `h1` twice. | LOW |
| A21 | `dc-components.css:1248-1250, 2682-2684, 2918-2920` | Empty rulesets left in place after their bodies were exiled. | LOW |
| A22 | all 10 files | **Zero `!important`.** Cascade fights are fought with selector qualification instead (`dc-components.css:3996-4003` documents one explicitly; `:2253` is a 5-level chain). | — (positive) |

## Appendix B — native-furniture.css, per section (full table)

Fixtures f1–f8 under `scratchpad/nf-audit/`, built on the current tree.

| § | line | What it does | Defect still real? | Replacement | Rec |
|---|---|---|---|---|---|
| 1 | 30–36 | `html` background paints content box | **VERIFIED-GONE** as a requirement (f2/f3) | fold into one `@page` rule | SIMPLIFY |
| 2 | 41–56 | 14 margin boxes hand-fed the brick | **VERIFIED-GONE** (f3: `@page` bg + `background-size` + `background-blend-mode` honoured, seamless) | same `@page { background }` | DELETE |
| 3 | 90–117 | Sticker gradient-layer stacks | gradients in margin boxes **VERIFIED-REAL/working** (f4) | keep the technique | KEEP |
| 3 | 89 note | `box-shadow`/`rotate()` dropped in margin boxes | **VERIFIED-REAL** (f4: `box-shadow: 6px 6px 0 #c00` and `rotate(-8deg)` both ignored; `border` paints) | none — genuine Chromium gap | KEEP |
| 3 | 102, 111, 115–116 | Trailing brick layer + `--*-blend` multiply tails; box kept full-height | **VERIFIED-GONE** (f8: fit-content chip over `@page` bg, no gap) | drop trailing layer + blend lists; add `height: fit-content` | SIMPLIFY |
| 4 | 190–197 | Suppression refills empty brick | **VERIFIED-GONE** (f8 p3: bare `content: none` leaves band continuous) | `@page chapter-start { @bottom-left { content: none } }` | SIMPLIFY to ~4 lines |
| 5 | 218–250 | front-matter margins 0, ink-dark top band, masthead out-dent | UNVERIFIED but justified: gradient-only `@page` backgrounds paint **nothing** (f1) while solid ones do (f2), so a partial top band still needs margin boxes | none | KEEP, MOVE → `page-templates.css` |
| 6 | 261–286 | Credits founders plate, flex column | UNVERIFIED — ordinary book layout, no engine defect named | — | MOVE → `fg-overrides.css` |
| 7 | 308–320 | `.image-bottom` block flow | UNVERIFIED, plausibly real | — | MOVE → book layer |
| 7 | 323–326 | `break-inside: avoid` on `p.dc-img-wrapper`, `figure` | **VERIFIED-REAL** — core ships only `break-before` first-child glue | none | KEEP, MOVE → book layer |
| 7 | 329–331 | `.full-page { overflow: clip }` | UNVERIFIED — needs measurement; also risks trapping `.gp-behind` | — | FLAG |
| 9 | 339–342 | Tall-placard `max-height` cap | **VERIFIED-REAL** (f5: 1179px art sliced across 5 pages; core only warns) | none | KEEP |
| 9 | 340 | the `- 4px` fudge | **VERIFIED-GONE** (f7: exact `calc(4in - 0.5in - 0.5in)` = 1 page; core's `vertical-align: bottom` collapsed the line box) | drop `- 4px` | SIMPLIFY |
| 9 | 357–376 | `@page gp-full-bleed { margin: 0 }` + chrome off | **VERIFIED-REAL** — core bleeds horizontally only, by design | none | KEEP |
| 10 | 387–390 | `.section { break-inside: auto }` in multicol | **VERIFIED-REAL** by the book's 302pp-vs-299pp measurement | see correction in body §3 | KEEP (scoped exception) |
| 10 | 398–401 | `column-fill: auto` | **VERIFIED-REAL**, explicitly measured; core warns but won't default | none | KEEP |
| 10 | 420–422 | `.dc-citizen-walkthrough` back to `balance` | real, but a book-content exception | — | MOVE → book layer |
| 13 | 453–456, 466–468, 483–488 | Callout/alert/card-tab break glue | **VERIFIED-REAL** (core's glue is `:where()` and doesn't know these classes) | none | KEEP, MOVE → `dc-components.css` |

**Two findings worth filing upstream regardless:** gradient-only `@page` backgrounds paint nothing while solid/`url()` ones paint the full sheet (f1 vs f2/f3) — a Chromium inconsistency the styling guide does not mention; and the guide's §1 claim that "a full-bleed texture needs two layers" is now **wrong for the PDF path**.

## Appendix C — project plugin (`dimm-city-plugin.js`, 1,914 lines)

### C.1 Macro inventory

Counts = line-start occurrences across `field-guide/*.md` (14 files) + `dc-design-guide/*.md` (19 files).

| Macro | Emits (line) | Uses | Verdict |
|---|---|---:|---|
| `@skill` + h4/h5/bq/ol/table transform | `.dc-skill-card > .dc-card-tab + .dc-card-body > .dc-card-inner` (1757–1767) | 193 | Keep — real macro |
| `@specialty` | `div.dc-specialty` (1448) | 49 | Keep (wrapper only) |
| `@learning-path` | `.dc-learning-path.dc-path-block > .dc-path-shell`, h3→`h2.dc-spray`, ul→`.dc-stickers` (1477, 1566, 181) | 41 | Keep — real transform |
| `@lede` | `div.dc-intro`, **attrs parsed then discarded** (1415) | 32 | DELETE → `@section .dc-intro` |
| `@definition` | `div.dc-prose-panel.dc-definition-block` (1118) | 26 | DELETE → `@section` |
| `@specialty-card` | `div.dc-specialty-card[data-position=even/odd]` (1302) | 24 | SHRINK — only `data-position` is non-trivial; `:nth-child(even)` does it in CSS |
| `@gear` | `div.dc-card.dc-gear` (1387) | 23 | DELETE → `@card .dc-gear` (its own doc says it is that, 1382) |
| `@card` | `.dc-card > .dc-card-heading/.dc-card-pull/.dc-card-body` (1270, 1624–1654) | 19 | Keep |
| `@continue` (skill form) | continuation card w/ `{name} ▸` tab (1525–1537) | 17 | **DEAD CODE** — see C2 |
| `@callout` | `div.dc-alert.dc-<variant>` + label span (1170) | 16 | Merge with `> [!TYPE]` |
| `@block` | `div.dc-block.dc-panel\|slate\|shard\|codex` + `.dc-block-title` (1231) | 16 | Keep |
| `@specialty-intro` | `div.dc-specialty-intro` (1322) | 11 | DELETE → `@section` |
| `@procedure` | `ol.dc-steps > li > span.dc-step-no` (599–609) | 9 | Keep (padded numbering) |
| `@dm-note` | `div.dc-alert.dc-dm-note` (1196) | 9 | DELETE → `@callout variant=dm` (header says "sugar for") |
| `@outcome` | `.dc-outcomes > .dc-outcome-row` (998–1017 / 1041–1059) | 7 | Keep, dedupe |
| `@sidebar` | `div.dc-sidebar` (921) | 5 | DELETE → `@section .dc-sidebar` |
| `@sidebar-box` | `div.dc-prose-panel.dc-sidebar-box` (1089) | 3 | DELETE → `@section` |
| `@toc` | `div.dc-toc`, attrs discarded (1363) | 2 | DELETE → `@section .dc-toc` |
| `@tape` | `div.dc-tape` (1404) | 2 | DELETE |
| `@specialty-art` | `div.dc-specialty-art` (1343) | 2 | DELETE → `@page full` / `@section` |
| `@glossary` | `div.dc-terms` (1431) | **0** | DELETE |
| `@roll-table` / `@options-table` / `@end-skills` | nothing (942–948, 1502) | **0** | DELETE |
| `> [!NOTE…]` alerts (617–722) | `div.dc-alert.dc-*` | 91 | Keep — best-earning feature |
| `buildDistanceTags` (308–329) | `.dc-distance-tags` | 1 table | DELETE |
| `parseAbilityFromListItem` (372) | `.dc-ability > .dc-ap` | 251 | Keep |
| `processRollDie` (200) | `span.dc-roll-the-die` | ~56 | Keep |

### C.2 Findings

| Line | Finding | Sev |
|---|---|---|
| 1512 | `@continue`'s skill-continuation branch is **unreachable**. Core's `layout_marker` block rule (`markdown-it-paged.js:96, 251`) claims `@continue` before `paragraph`, and core is `md.use`d at `renderer.ts:163` before user plugins (198). `isMarker` only matches `paragraph_open`. The plugin's own comment at 1716–1720 states this — then 1512 depends on the opposite. All 17 uses fall through to 1721's `closeAll()`; the `{name} ▸` tab never renders | HIGH |
| 1757, 1525 | Emits `name="…"` on a `<div>` — not a valid HTML attribute on div | HIGH |
| 1226–1230, 1168 | `attrs['class']` and `attrs['variant']` interpolated **unescaped** into `class="…"`, unlike `buildAttrs` (587). `@block .a" onx="` injects attributes | HIGH |
| 921/1089/1118/1322/1343/1363/1415/1431 | Eight macros are pure `<div class=X>…</div>` — 89 uses total. Core `@section .x`/`@end-section` already does exactly this, with better nesting and `break-inside` from `PAGED_CSS` | HIGH |
| 1363, 1415, 1431 | `@toc`/`@lede`/`@glossary` call `parseMarker` then **silently discard** `attrs` — `@lede .foo` is a no-op | MED |
| 1188–1211 | `@dm-note` byte-identical to `@callout variant=dm` (1159); `@gear` (1387) is `@card .dc-gear` | MED |
| 269–306 / 998–1017 / 1041–1059 | Outcomes HTML built **three times** in three near-identical blocks (~90 duplicated lines) | MED |
| 411–486 | `parseAttrs` is an inlined copy of `parseMarkerLine` (`markdown-it-paged.js:59–180`) per CLAUDE.md §5 — correct approach, but **drifted**: no positional-name slot, no `isBareToken`, no `__ambiguousBareToken` warning, and it adds a brace-block pre-pass core lacks | MED |
| ~40 sites (923, 1092, …) | Every handler hard-codes `i += 2`, assuming `paragraph_open/inline/paragraph_close`. A marker inside a list item or blockquote silently eats the wrong tokens | MED |
| 755–1880 | One 1,125-line function, 25 boolean flags (760–801), `closeAll` (805–888) a 25-branch if-chain. Markers with 1–5 uses are ~55% of the dispatch | MED |
| 1225–1231, 1156–1164 | Variant→class maps hard-code presentation the CSS layer already owns | LOW |
| 1700 | `p.dc-img-wrapper` exists to dodge Paged.js dropping `p:has(img)` — dead reason; core `PAGED_CSS` already selects `p > img:only-child` | LOW |
| 99–102 | `esc()` does not escape `'` | LOW |
| 1447 | `specClass` recomputes class merging that `buildAttrs` does on the next line | LOW |
| 1887–1896 | **Positive:** unclosed `@procedure` warns via `state.env.layoutWarnings`; state is function-local (757–801) so there is **no cross-file leakage** and chapter order is safe (except `data-path-ref`, which restarts per file) | — |

## Appendix D — authoring surface (field guide)

### D.1 Markers in use (34 distinct)

`@skill` 170 · `@section`/`@end-section` 95/95 · `@page` 52 · `@learning-path`/`@end` 33/32 · `@specialty`/`@end` 19/18 · `@definition`/`@end` 15/15 · `@continue` 15 · `@chapter` 14 · `@card`/`@end` 11/11 · `@specialty-card`/`@end` 10/10 · `@gear`/`@end` 10/10 · `@specialty-intro`/`@end` 9/8 · `@callout`/`@end` 6/6 · `@lede`/`@end` 3/3 · `@outcome`/`@end` 2/2 · `@dm-note`/`@end` 2/2 · `@block`/`@end` 2/2 · `@toc`/`@end` 1/1 · `@procedure`/`@end` 1/1

Zero occurrences in the book: `@sidebar`, `@sidebar-box`, `@specialty-art`, `@glossary`, `@tape`, `@end-skill`.

### D.2 Classes

On markers: `.chapter-01/02/03/04/05` (54 combined — every page repeats its own chapter number), `.allow-split` (9), `.two-column` (8), `.dc-citizen-walkthrough` (8), `.cosmology` (4), `.page-chapter-start`/`.chapter-start` (3 each), `.citizen-file` (3).

In `{.attr}` blocks: `.allow-split` (39), `.fg-art-inline` (14, real styling at `fg-overrides.css:170-186`), `.gp-pin`/`.gp-bottom` (4/4 — the new correct pattern), `.continued` (4, `@skill {.continued}` — a *different* mechanism from core `@continue`, same word), `.dc-chevron` (3).

### D.3 Fragile idioms

- `@continue` means two different things depending on context (core section-continue vs the plugin's skill form).
- `@procedure` auto-closes at EOF with only a warning — a forgotten `@end-procedure` silently absorbs the rest of the document.
- `@card`/`@end-card` requires a blank line before `@end-card` if the last content is a blockquote, or markdown-it's lazy continuation swallows the marker — documented **only** in plugin source (1261–1263).
- Two competing DM-note idioms (`@dm-note` vs `> [!DM]`) and two competing outcome idioms (`@outcome` vs auto-classified `Roll`/`Outcome` GFM table).
- `@page` bare-word-vs-class ambiguity — a core trap the user guide itself calls out (`02-writing-content.md:213`).

### D.4 Raw HTML

`chapter-04.md:326-519` — four repeated ~15-line nested `<div>` trees (58 divs) for NPC stat blocks. Plus `chapter-00.md` (1) and `chapter-01.md` (3). Two stray `<br>` tags at `chapter-02 1 Augmerc.md:102` and `chapter-02 3 Streetwarden.md:580`, against the user guide's own rule (`02-writing-content.md:306`).

## Appendix E — examples and fixtures

| file:line | Category | Sev | Replacement |
|---|---|---|---|
| `docs/fixtures/css-authoring-spike/book/manifest-paged.yaml` + `styles/style-paged.css` | Dead `engine: paged` demo, **tracked in git** | HIGH | Delete both — the gate only builds `manifest.yaml` |
| `examples/gutterpress-user-guide/styles/guide.css:200-202` | `.pagedjs_sheet` background — selector can never match | MED | `@page { background: var(--color-paper) }` |
| `examples/with-design-guide/design-guide/styles/guide.css:238-241` | same | MED | same |
| `examples/with-design-guide/design-guide/04-page-templates.md:145` | Dead pagedjs.org doc link | MED | Point at the GCPM spec / Gutterpress margin-box docs |
| `…/guide.css:103`, `…/guide.css:218`, `04-page-templates.md:182`, `06-markdown-reference.md:123`, `…/guide.css:364` | Prose/comments naming Paged.js as a live option | LOW | Reword |

**Clean:** zero live uses of the five removed image classes anywhere in examples or fixtures — only correctly-framed migration prose. Zero hand-rolled `gp-*` equivalents.

**Load-bearing parity fixtures** (per `native-parity-gate.ts`): `examples/with-design-guide/{book-01,book-02,design-guide}`, `docs/fixtures/css-authoring-spike/book`, `docs/fixtures/gp-image-positioning/book`. Must stay buildable and parity-clean; prose bar lower than user-facing examples.

## Appendix F — standards conformance (full table)

| # | file:line | Current | Replacement | Verified | Sev | Lines |
|---|---|---|---|---|---|---|
| F1 | `page-rules.css:98,99,106,107,164,165,171,172,251,252,265,266` | `var()` inside `@page { margin }` | literals, or fix engine `parseMargin` | **YES** — fixture `I` (var margins) built clean; `I2` (literal, identical box) errored `730px > 708px` | **Critical** | 0 (safety) |
| F2 | `dc-tokens.css:237-238` vs `page-rules.css:86` | tokens beside a literal `size:` that can drift | **do NOT tokenize `size`**; document why | **YES** — fixture `H`: `size: var(…)` silently produced 612×792 Letter. Root cause `gcpm-extract.ts:448-469, 525` | **Critical** | 0 (trap) |
| F3 | `page-templates.css:117-120,137-140,366-369`; `native-furniture.css:246-249,281-282` | `width: calc(100% + 1.25in)` + twin negative margins + `box-sizing` | `margin-inline: calc(-1 * var(--outer-margin))` | **YES** — fixtures `C`/`D` byte-identical raster | High | ~18 |
| F4 | `dc-tokens.css:233` dead; `0.625in`×16, `7.25in`×3, `7.375in`, `10in`×4 | `--outer-margin` declared with **zero** `var()` refs; derived values restated in 3 files | mint `--content-width`/`--content-height` as `calc()` | **YES** — fixture `E`: token chain and literal land at identical y=49.3068 | High | −20 magic numbers |
| F5 | `dc-components.css:3234-3236, 3297-3298, 3341-3342, 74-79, 3287-3288` | 5 comments forbidding `:is()`/`:has()` as "Paged.js crashes" | collapse the selector lists | **YES** — fixture `J`: `:is()` nested + `:has()` + `break-before: avoid` all applied | Med-High | ~25 unblocked |
| F6 | 57 physical vs 6 logical decls (`dc-components.css` ~19 pairs; `2388-2391`, `3036-3038`, `2845-2846`) | `margin-left`+`margin-right`, `top/left/right/bottom` | `margin-inline`, `inset`, `border-block` | partial | Med | ~20 |
| F7 | `dc-tokens.css:507, 524, 545` | hand-typed `rgba()` copies — **all 3 already drifted** | `color-mix(in srgb, var(--base) N%, transparent)` | **YES** — fixture `G` matched seamlessly | Med | fixes 3 bugs |
| F8 | `page-templates.css:102,107`; `dc-components.css:1269` | `page-break-*` alongside `break-*` | delete the alias | **YES** — fixture `E` | Low | 3 |
| F9 | `dc-components.css:4016-4021`, `dc-tokens.css:413-414` | `width`+`height` pairs (compact variant drifted 0.88→0.90) | `aspect-ratio` | No | Low-Med | ~4 |
| F10 | `deprecated.css` (137 lines) | not referenced by `index.css` | dead file | **YES** | Low | 137 |

**Do not convert:** `dc-tokens.css:122, 128, 132, 140, 149` carry measured WCAG ratios in their comments — `color-mix` will not reproduce them. `@page :left/:right` binding margins must stay physical; mirroring is the point. (`float: inline-end` verified working if mirrored spreads are ever wanted.)

## Appendix G — verification log

Findings re-checked by the lead before publication. Three did not survive.

| Claim | Verdict | Evidence |
|---|---|---|
| `@page { background }` paints the full sheet incl. margins, in the PDF | **CONFIRMED** | own fixture: p1 `#2d6cdf`, p2 `:left` `#d94f2b`, corner + centre pixels |
| `var()` in `@page { size }` → Letter | **CONFIRMED** | own fixture: `var()` 612×792 vs literal 621×810 |
| `var()` in `@page { margin }` disables the width guard | **CONFIRMED** | own fixture: literal → hard error; `var()`, identical geometry → clean build |
| `counter-set` unsupported (per book docs) | **FALSE — doc is wrong** | own fixture rendered `[sec=41]` |
| design guide omits `native-furniture.css` | **CONFIRMED** | `index.css` has 7 `@import`s, 0 references |
| `.fg-art-founders-house` undo-pair | **CONFIRMED** | both rules read in full |
| `@continue` skill branch unreachable | **CONFIRMED (static)** | core claims `continue` at `markdown-it-paged.js:96`, consumes at `:553`; core registered before user plugins. A runtime repro was inconclusive for an unrelated reason and is not the basis for the claim |
| `examples/.reviews/` shipped by accident, 24 MB | **REJECTED** | gitignored at `.gitignore:56`; `git ls-files` returns 0 |
| `.section { break-inside: avoid }` should be removed at source | **REJECTED** | deliberate and documented: "Sections are atomic units — they MUST NOT span pages… the dead zone is intentional design behavior" |
| lead's own earlier call to leave `.fg-art-founders-house` abspos alone | **REJECTED (self)** | native-furniture overrides it to `position: static`; the −2.5in bleed never applies |

Independent baselines gathered during verification: **0** `!important` across ~7,700 lines · **0** vendor prefixes · **3** superseded `page-break-*` · **158 of 171** `dc-components.css` classes referenced (the 13 unreferenced are documented author-facing span utilities in a library whose contract is reuse — not dead code).

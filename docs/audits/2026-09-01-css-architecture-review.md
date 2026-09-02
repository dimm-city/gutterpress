# CSS architecture review — gutterpress core vs dc-design-guide vs field guide

Date: 2026-09-01. Read-only review, no code changed.

**Method.** Read in full: `gutterpress-css.ts` (GUTTERPRESS_CSS), `markers.js`
(MARKER_CSS + doctrine), the three built-in themes, `style-resolver.ts`,
`assemble.ts`'s injection order, and all nine dc-design-guide sheets (7,012
lines). Counted class and macro usage against both books' markdown source.
Cross-checked every claim of the 2026-08-12 layer-boundary audit against the
current tree.

Companion document: `2026-09-01-extensions-review.md` (plugins + themes
architecture). The two are designed to land together — §6 of this review is the
file layout that §6 of that one packages.

---

## TLDR

26 findings: **9 core** (C1–C9), **14 theme-layer** (T1–T14), **3 book-layer**
(F1–F3), plus a 20-item prioritized inventory.

The three that are actively misbehaving today:

1. **T2** — the Contextual Cascade Principle is broken for three components.
   `.dc-ap`, `.dc-sidebar` and `.dc-fiction-excerpt` declare their public tokens
   *on the component element itself*, so an ancestor-scope override
   (`#ch-x { --dc-ap-bg: … }`) silently does nothing.
2. **T7** — `fg-overrides.css`'s "PER-CHAPTER VARIANT ASSIGNMENT (Field Guide
   book scope)" block targets `#ch-example-*` — the **design guide's** demo
   chapters. The field guide's real chapters match none of it.
3. **T5** — the 2026-08-12 audit's reconciliation note claims `.section` chrome
   was inverted to `.dc-panel` / `.dc-panel-sections`. **Those classes do not
   exist in the current tree.** Bare `.section` still paints opt-out chrome with
   five live suppression sites.

The structural argument: property-ownership files ("all `columns:N` in
page-templates.css") shred each component across up to five files, which is the
single biggest obstacle to the stated goal of a drop-in component library. The
keystone fix is `@layer` in core (C3), which replaces load-order archaeology
with a guaranteed cascade contract and makes every subsequent file move safe.

---

## 1. How the stack actually loads

Eleven sheets participate in every field-guide render, in this order. Nothing
uses `@layer`; the architecture is held together by injection order,
equal-specificity source-order battles, `:where()` zero-specificity hacks in
core, and prose contracts in file headers.

| # | Sheet | Layer | Owns |
|---|---|---|---|
| 1 | `MARKER_CSS` (markers.js) | core | structural DOM contract (`.page`/`.section`/breaks) |
| 2 | `GUTTERPRESS_CSS` (gutterpress-css.ts) | core | `gp-*` author vocabulary (floats, sizes, pin, columns, grid, z-ladder) |
| 3 | plugin CSS | core | user-plugin `css` exports (the dimm-city plugin ships none) |
| 4 | `dc-tokens.css` | theme | fonts + brand palette + specialty identity + per-component defaults (547 lines) |
| 5 | `dc-core.css` | theme | element baseline (headings, tables, lists, dl) |
| 6 | `dc-components.css` | theme | every `.dc-*` component + `.section` chrome + utilities (3,944 lines) |
| 7 | `page-templates.css` | theme | `.page.*` layouts + **all** `columns:N` + `.pmd-*` + frontmatter/intro composites |
| 8 | `page-rules.css` | theme | `@page` declarations, folio/chip content, most named-page wiring |
| 9 | `dg-overrides.css` | theme | guide-only scaffolding — but loaded by **every** book |
| 10 | `fg-overrides.css` | book | "field-guide overrides" — loaded by both books |
| 11 | `native-furniture.css` | engine | `engineStyles.native`; margin-box chrome, brick wall, fragmentation fixes; loads last |

---

## 2. What is working

Credit where due — this stack is far above average for a project of this size.

- **The header contracts** (OWNS / MUST NOT CONTAIN / AGENT RULE) are real and
  mostly honored. Category D of the prior audit (book tuning leaking into
  shared layers) is still clean.
- **The Contextual Cascade Principle** is a genuinely good architecture doc, and
  the token-driven variant pattern (`#ch-x .dc-alert { --dc-alert-bg: … }`) is
  exactly the right shape for the component-library goal.
- **Measured comments.** Nearly every weird rule carries the measurement that
  justifies it. The `columns: unset` post-mortem in page-templates.css is a
  model of institutional memory.
- **Core's discipline** — one `gp-` prefix, `:where()` for every default an
  author might override, no theme vocabulary leaked into core, and the
  `.two-column` → `.gp-columns-2` unification actually landed.
- **Zero `!important`** across all nine theme sheets.

The problems below are mostly the *cost* of that success: the rules that keep
the system honest today are exactly what will stop it becoming a drop-in
component library tomorrow.

---

## 3. Core findings (gutterpress)

### C1 — The vocabulary has a hole exactly where authors reach

Core ships `.gp-columns-2`/`.gp-columns-3` but **no way to span them**. The
predictable result already happened: an author typed `@section .gp-columns-all`
— a class that does not exist — and got a silent no-op. The book layer papers
over the hole with `.pmd-col-span { column-span: all }`, a legacy-prefixed
utility in page-templates.css. The same shape recurs: books reinvent
`.pmd-no-break` and `.pmd-break-before`, which are as generic as anything in
GUTTERPRESS_CSS.

**Recommendation.** Add to GUTTERPRESS_CSS: `.gp-span-all { column-span: all }`
(or literally `.gp-columns-all` — the name an author guessed unprompted),
`.gp-no-break { break-inside: avoid }`, `.gp-break-before { break-before: page }`.
Then delete the book's `.pmd-*` trio (see T11). Per CLAUDE.md §0 this is exactly
"behavior broadly useful to non-technical authors belongs in core".

### C2 — Unknown `gp-*` classes fail silently

The `.gp-columns-all` incident rendered as an ordinary section with no warning.
Core already walks marker tokens and reads attrs-attached classes for
`gp_pin_scope_check`; it knows the full legal `gp-*` vocabulary.

**Recommendation.** Add a parse-time diagnostic: any class matching `gp-*` that
is not in core's vocabulary emits `unknown_gp_class`, same channel as
`pin_outside_page`. Converts every future misremembered utility from a silent
layout bug into a one-line fix.

### C3 — No cascade layers: the whole stack is load-order archaeology

Core's answer to "author must win" is injecting itself first plus `:where()` on
every default. The book's answer to "engine furniture must win" is a manifest
key that appends a sheet last. In between, eleven sheets fight at equal
specificity by source order — and at least one real regression is documented in
page-templates.css (a theme's `columns: unset` silently eating core's
`columns: 2` for months). Chromium's print path supports `@layer` fully.

**Recommendation.** Core wraps its two blocks: `@layer gp.marker, gp.vocab;`.
Author/theme CSS stays unlayered — unlayered beats layered, so the author wins
*by construction* at any specificity, and much of the `:where()` gymnastics
becomes unnecessary over time. Document a recommended book-side convention
(`@layer tokens, base, components, templates, book;`) so themes stop depending
on manifest file order. Engine styles stay appended-last and unlayered.

This is the single highest-leverage structural change for "easy to reason about".

### C4 — MARKER_CSS's own docs contradict assemble.ts

The MARKER_CSS docstring says consumers should inject it *after* their user
stylesheets "so the layout contract wins at equal specificity". `assemble.ts`
injects it **first**, "so author rules win at equal specificity". Both comments
cannot be the contract. The shipped behavior — core first — is the right one;
the docstring is stale.

**Recommendation.** Fix the MARKER_CSS comment. If C3 lands, the question
dissolves.

### C5 — Themes and component stacks are two unconnected worlds

Core's three built-in themes (~60 lines each) style bare elements only. The DC
stack — the flagship consumer — needed an 11-sheet, 7,000-line architecture that
core gives no scaffold, conventions or tooling for. Every future serious book
will re-derive the same shape from scratch. The `with-design-guide` example
demonstrates a *different*, simpler shape, so there are now three CSS
architectures in the ecosystem and no stated canonical one.

**Recommendation.** Ship a fourth "theme" that is actually a *starter
architecture*: `gutterpress new --theme layered` scaffolds
tokens/base/components/page-templates/page-rules/book CSS (+ engineStyles
wiring) with the header contracts pre-written and one worked component
demonstrating the token pattern. Move the Contextual Cascade doc's rules into
those file headers so they travel with the files.

### C6 — Prose contracts that lint could enforce

The load-bearing rules — "only page-templates.css may write `columns:`", "no
`@page` outside page-rules.css", "no `:root` tokens outside dc-tokens.css",
"everything the plugin emits is `dc-` prefixed" — live in comments and an AGENT
RULE honor system. Core already runs stylelint and custom source checks per book.

**Recommendation.** Support a per-project `css-contract` lint config:
property→file ownership map, prefix allowlist per file, "no bare `.dc-*` rules
in override files". The existing `checks/source` pipeline is the natural home.
Contracts that are enforced can then afford to get simpler (see T1).

### C7 — `column-fill` has doctrine but no vocabulary

Core deliberately ships no `column-fill` (correct — the right value depends on
whether the run fragments) and the build warns when balanced multicol
fragments. But the author's only remedy is writing CSS, so native-furniture.css
§10b now owns ~60 lines of measured lore choosing `auto` vs `balance` per shape
— knowledge every future book will need again.

**Recommendation.** Give the choice author-level names:
`.gp-columns-flow { column-fill: auto }` / `.gp-columns-balanced { column-fill: balance }`,
and have the existing fragmentation warning name the class instead of
prescribing raw CSS. Most of §10b then collapses into two class applications in
markdown.

### C8 — Generic print-safety fixes stranded in the book's engine sheet

native-furniture.css carries fixes that are engine-behavior-generic, not
DC-brand-specific, and are written entirely in terms of core's own published
contract (`--gp-content-h`):

- `:where(p) > :where(img:not([class])) { max-height: calc(var(--gp-content-h) - 4px); object-fit: contain }`
  — tall-placard slicing. Any book with big art hits this.
- `figure { break-inside: avoid }` for in-flow art.
- The §5 "spanner + unbreakable box strands the heading" glue pattern, already
  documented in the styling guide as an author remedy.

**Recommendation.** Adopt the placard cap and figure glue into MARKER_CSS at
`:where()` specificity (CLAUDE.md §0: fix the core primitive first). Each
adoption deletes book lines *and* removes a trap for every other book.

### C9 — Vestigial surface in core

- `engineStyles.paged` — accepted, warned, ignored. Dual-engine naming for a
  single-engine product; the schema still carries it.
- The `col-split` machinery in markers.js (`env.__colSplitDepth`, the
  `.col`-wrapper render branch) has zero users in both flagship books, and its
  class was confirmed dead in the 2026-08-12 audit.
- `style-resolver.ts` `FALLBACK_PRIORITY` still privileges the four legacy
  `css/*.css` names alongside the scaffolded `styles/book.css`.

**Recommendation.** Deprecate `engineStyles.paged` out of the schema; decide
col-split's fate (document it as public author surface, or remove the branch);
keep the legacy fallbacks but mark them deprecated in SOURCE-FILES-GUIDE.

---

## 4. Theme-layer findings (dc-design-guide)

### T1 — Property-ownership files shred components across the codebase

The "all `columns:N` in page-templates.css" rule splits a component's behavior
by *CSS property*, not by component. Understanding `.gp-columns-2` on a section
requires reading **five files**: core (columns), page-templates (gap),
dc-components (column-rule ornament), native-furniture (column-fill +
`.section` break-inside), and dc-components again for `.dc-column-panel`.

Three rule bodies now exist *only as tombstones*: `.two-column-list {}` and
`.dc-skill-card.two-col .dc-card-inner {}` in dc-components contain nothing but
a comment pointing at page-templates. `.dc-card-grid`, `.toc` and the
frontmatter composite are similarly split.

This directly fights the component-library goal: a component you cannot read in
one place is a component you cannot extract, document or ship.

**Recommendation.** Change the ownership rule's altitude: page-templates.css
owns columns *on page templates* (`.page.*`); a *component* that is inherently
multicol (`.dc-card-grid`, `.two-col` card bodies, `.toc`) owns its own columns,
co-located with its chrome. With C6's lint (or C3's layers) the anti-collision
purpose of the old rule is served mechanically, and the tombstones disappear.

### T2 — Three competing token conventions, one of which breaks the cascade principle

Public component tokens are declared in three different places depending on
which era the component was written in:

| Convention | Components | Consequence |
|---|---|---|
| `:root` defaults (dc-tokens.css) | `.dc-alert`, `.dc-skill-card`, `.dc-block`, most of the library | ✔ Overridable from any ancestor scope. The stated convention. |
| On the component element itself | `.dc-ap`, `.dc-sidebar`, `.dc-fiction-excerpt` | ✘ An element's own custom-property declaration beats any inherited value, so `#ch-x { --dc-ap-bg: … }` **silently does nothing**. |
| Inline `var(--x, fallback)` | pre-Workstream-B components | Redundant where `:root` also declares the token, and several fallbacks have drifted. |

Documentation drift compounds it: the `.dc-specialty-card` token contract
comment says the bg default is `--hud-panel`; `:root` says `--paper-cream`.
`fg-overrides.css` and the citizen-walkthrough header reference
`--section-accent`/`--section-bg` — token names that do not exist (actual:
`--dc-section-accent`/`--dc-section-bg`). `.section.tabbed` uses unprefixed
`--section-tab-overlap`/`--section-tab-indent`.

**Recommendation.** One convention, stated in the components header and
enforced by grep: *every public token defaults at `:root`; components consume
bare `var(--x)`; variants and contexts set tokens on ancestors or variant
classes; no inline fallbacks for public tokens.* Migrating the three offenders
is behavior-preserving and un-breaks ancestor overrides. Sweep the stale token
names in comments while there.

### T3 — dc-tokens.css is four files wearing one trench coat

547 lines mixing `@font-face` declarations, the brand palette, the Dimm City
specialty identity block (which the file itself marks "a different project…
would replace this entire block"), and ~250 lines of per-component defaults. A
project retheming the library must reverse-engineer which of the four strata to
touch.

**Recommendation.** Split along the seams the comments already draw:
`dc-fonts.css`, `dc-palette.css`, `dc-identity.css` (the swap-me file),
`dc-component-defaults.css`. Retheming instructions become "replace files 2 and 3".

### T4 — ~450 lines of specialty boilerplate that indirection collapses

Each of 10 specialties carries ~6 near-identical blocks wiring
`--<name>-accent/-mid/-dark` into each component's tokens. The mapping is the
same every time; only the shape polygons and a few genuine deltas differ.

**Recommendation.** Generic indirection: each specialty block declares only
`--spec-accent`, `--spec-mid`, `--spec-dark` + its shape tokens; ONE shared
block does the component wiring; real deltas stay as small per-specialty rules.
~300 lines deleted, and "add a specialty" drops from six blocks to one. The
tier-badge mapping becomes a `--spec-tier-bg/-fg` pair in the same block.

### T5 — `.section` panel chrome is still opt-out, and the audit doc says otherwise

The bare structural `.section` still paints panel chrome via unqualified
`::before`/`::after`. Five suppression sites undo it: `.section.tabbed::after`,
`.dc-column-panel`, `.dc-card-grid`, `.page-intro > .section`, and
`credits-colophon`. Meanwhile the 2026-08-12 audit's "FINAL RECONCILIATION"
claims the chrome was "inverted to `.dc-panel` / `.dc-panel-sections`" —
classes that **do not exist in the current tree**. Either the inversion
regressed or the note described another worktree; either way the audit doc now
misleads.

**Recommendation.** (a) Correct the audit note. (b) Per the audit's own
corrected math (191 bare sections, most of which *should* be panels), keep
opt-out but consolidate the escape: one canonical `.section.dc-plain` variant
that kills `::before`/`::after`/`filter` in one place, with the four template
suppressions rewritten to use or alias it.

### T6 — Dead and zombie rules in the current tree

| Rule | Status |
|---|---|
| `.section.dc-rules-definition` | Deleted per the audit, **back in the tree** in both page-templates.css and dc-components.css with full doc blocks. 0 uses, 0 plugin emissions. |
| `.two-column-list` + card variant | 0 uses, 0 emissions; defined in page-templates + two tombstones in dc-components. |
| `.column-break`, `.page-break` (unprefixed) | Nothing emits these; core emits `.gp-column-break`/`.gp-page-break`. Verify against built HTML, then delete. |
| `.dc-wide` | 0 uses. |
| `.dc-art-top` | 0 uses anywhere. `.dc-art-bottom` — documentation mentions only. |
| `@page clean` + `.pmd-suppress-footer` | Self-documented as having no opt-ins. |
| `.image-bottom` | Inert label on one `@page` marker; self-documented as deletable. |
| `.fg-art-intro-creaturepunk` | Class deleted from CSS as doubly inert; the markdown still carries it. |

**Recommendation.** Delete the lot after the raw-HTML verification pass for the
break classes. For `.dc-rules-definition`, decide once: author one real usage in
the guide's gallery so it is alive and demonstrated, or delete it in both files.
A documented-but-unreachable component is the worst state for a library.

### T7 — dg-overrides vs fg-overrides: the roles have collapsed

Both "override" files load into *both* books (the guide via index.css, the field
guide via its manifest). And the headline block of fg-overrides.css — "PER-CHAPTER
VARIANT ASSIGNMENT (**Field Guide book scope**)" — targets
`#ch-example-chapter-opener`, `#ch-example-dm-npcs` etc.: those are the **design
guide's demo chapters**. The field guide's real chapters (`#chapter-01`,
`#chapter-02-*`…) match *none* of these selectors and receive no per-chapter
accent mapping at all. The "copy the first six files and replace fg-overrides"
portability instruction in index.css does not describe reality.

**Recommendation.** Re-cut along real seams:

- `dg-overrides.css` → loaded *only* by the guide's manifest (specimen chrome,
  palette swatches, guide TOC, demo-chapter accent map absorbed from
  fg-overrides).
- The one rule every book needs from it — `div.chapter[data-ch] { string-set: … }`
  — moves to page-rules.css beside its consumers.
- `fg-overrides.css` → moves into `field-guide/styles/` and shrinks to the field
  guide's actual overrides (see F1).

### T8 — Named-page wiring lives in three files under contradictory contracts

page-rules.css's header claims ownership of "Named-page wiring" and holds most
of it — but page-templates.css's header *also* claims it and holds
`.full-page { page: full }` plus `.pmd-suppress-footer { page: clean }`, while
`.page.citizen-file { page: citizen-file }` sits in fg-overrides.

**Recommendation.** One home: page-rules.css, adjacent to each `@page` it wires
(already its pattern for front-matter/chapter-start). Fix the page-templates
header.

### T9 — Guide-only selectors squatting in shared sheets

`.toc` and `.guide-toc` column rules sit in page-templates.css under a
"DESIGN GUIDE LAYOUT OVERRIDES" heading — the file's own contract says
guide-specific goes to dg-overrides; the columns-ownership rule forced them in.
Worse, `.toc` is applied as a *chapter class* (`@chapter #ch-toc .toc.guide-toc`)
— a maximally generic unprefixed name in a "portable" layer.

**Recommendation.** Falls out of T1: when components own their columns, both
selectors move whole into dg-overrides.css. Rename to `.dg-toc`/`.dg-guide-toc`
while moving.

### T10 — native-furniture.css mixes three altitudes

One "engine" sheet holds (a) genuinely engine-generic fixes that belong in core
(C8); (b) theme-level engine tuning — dc-alert/multicol break glue, card-tab
glue (right file); and (c) **book- and instance-specific rules**:
`.fg-art-founders-house { height: 2.75in }` (an fg-prefixed rule in the shared
engine sheet), the credits-page flex column, and the p7/p243-measured
`.dc-citizen-walkthrough.gp-columns-2` exceptions. A second DC book wiring this
sheet inherits the field guide's credits-page geometry.

**Recommendation.** Three-way sort: promote (a) to core, keep (b), move (c) to
the owning book's engine sheet — manifests already accept a list under
`engineStyles.native`, so add `field-guide/styles/fg-native.css` after the
shared one.

### T11 — Prefix soup: five vocabularies and an unprefixed long tail

`gp-` (core), `pmd-` (dead product name), `dc-` (library), `fg-` (book), plus a
large unprefixed set in the portable layers: `.tabbed`, `.flush`, `.two-col`,
`.highlight`, `.allow-split`, `.guide`, `.credits`, `.toc`, `.guide-toc`,
`.specimen`, `.fg1`–`.fg4`, `.accent-*`, `.font-*`, `.chapter-start`,
`.citizen-file`, `.card-grid`… Every unprefixed name in
dc-components/page-templates is a collision waiting for the first project that
imports the library into an existing page.

**Recommendation.** Policy: core = `gp-`; library components *and their
variants* = `dc-` (`.dc-tabbed`, `.dc-flush`, `.dc-two-col`…); book = book
prefix. Retire `pmd-` entirely (C1 absorbs the three utilities). Mechanical
rename with markdown find/replace, done alongside T1's moves so files churn
once. The color/font utility singles (`.fg1`, `.accent-orange`) sit oddly in a
"no per-element styling classes" constitution — audit usage and either bless
them as documented `dc-` inline utilities or drop them.

### T12 — Load-bearing positional selectors where the plugin could emit classes

Several components encode semantics as DOM-position contracts:
`.dc-npc-stat blockquote + p` (primary stat line), `blockquote + p + p`
(secondary), `.dc-card > .dc-card-body blockquote:last-of-type` (footer),
colophon `p strong:first-child` (role label). These break silently the moment an
author adds a paragraph in the "wrong" slot — the failure mode is invisible
restyling, not an error.

**Recommendation.** For macro-backed components, emit real classes
(`.dc-npc-primary`, `.dc-card-footer`) and keep the positional selector one
release as fallback. For markdown-convention components (colophon), document the
convention in the component's doc block as author-facing API.

### T13 — The component library has no per-component manifest

The design guide's chapters are excellent narrative documentation, but the
machine-checkable ground truth — which classes exist, which macro or markdown
recipe produces each, which tokens are public, what DOM is emitted — is
scattered across CSS comments, macros.md and plugin source. The result is the
drift this review keeps finding: documented-but-dead components (T6), stale
token names (T2), features documented that never shipped.

**Recommendation.** One `components.yaml` (or a doc-block convention above each
component) recording: name · recipe (macro or `@section .dc-x`) · emitted DOM ·
public tokens · break behavior · status. A check script cross-references it
against the plugin's emissions and both books' usage — the audit run by hand in
August becomes CI. This is also the catalog a new author browses, and the source
the snippet picker reads (see the extensions review, U4).

### T14 — 3,944 lines is past the single-file component library's ceiling

dc-components.css is roughly half archaeology-grade comments (a strength — keep
them) and half code, but at this size the "one file = the library" premise
inverts: contributors search rather than read, and the ordering is historical,
not navigational. The `.section` chassis — the most consequential block — sits
at line ~2,850.

**Recommendation.** Once T1 moves columns in and T6/T4 shrink it, split by
family with an index: `components/section.css`, `callouts.css`, `cards.css`,
`specialty.css`, `blocks.css`, `misc.css`, imported by dc-components.css in
order. Same cascade, one file per mental unit, each independently liftable into
the future shared package.

---

## 5. Book-layer findings (field guide)

### F1 — The field guide owns no stylesheet

Every field-guide-specific rule lives inside `dc-design-guide/css/` —
fg-overrides.css, plus an `fg-` rule in native-furniture.css. The book cannot be
moved, forked or diffed as a unit, and design-guide edits routinely churn
field-guide behavior.

**Recommendation.** Create `field-guide/styles/fg-overrides.css` (+
`fg-native.css` per T10), listed in the field-guide manifest after the shared
sheets. Move there: the `.fg-art-*` family, the citizen-file wiring (or leave
wiring in page-rules per T8), the `.dc-specialty .dc-learning-path` break
policy, and the cybersurgeon portrait width fix.

### F2 — Inert classes still in the manuscript

`.fg-art-intro-creaturepunk` (chapter-00; attrs not even attached because of the
space before the brace) and the `.image-bottom` page label (chapter-01) are both
documented-as-dead in CSS comments but still present in markdown.

### F3 — The per-chapter theming mechanism is unused by the real book

The accent-map pattern (chapter id → `--dc-section-accent`) is built, documented
and demonstrated — on the guide's demo chapters only (T7). The field guide's
actual chapters all render the default magenta register. If that is a deliberate
art decision, record it; if not, this is the cheapest visible-quality win
available.

---

## 6. Target architecture for the component library

```
gutterpress core            @layer gp.marker, gp.vocab   (C3)
  gp-* structural DOM + author vocabulary, incl. span/break/fill utilities (C1, C7)
  unknown-gp-class diagnostic (C2) · css-contract lint (C6)

dc component library        (extractable package — today: dc-design-guide/css/)
  dc-fonts.css              @font-face
  dc-palette.css            brand + pillar tokens                     (T3)
  dc-identity.css           project identity tokens — the swap file   (T3, T4)
  dc-component-defaults.css :root public token API, one convention    (T2)
  dc-base.css               element baseline (today's dc-core)
  components/*.css          one family per file, columns co-located   (T1, T14)
  dc-page-templates.css     .page.* layouts only
  dc-page-rules.css         @page + ALL named-page wiring             (T8)
  dc-native.css             shared engine furniture only              (T10)
  components.yaml           the catalog, CI-checked                   (T13)

design guide (a consumer)   dg-overrides.css, guide-only              (T7, T9)
field guide (a consumer)    styles/fg-overrides.css + fg-native.css   (F1)
```

Three properties make this a real component library rather than a shared
stylesheet:

1. **One block per component.** Everything about `.dc-card-grid` — columns,
   chrome, break policy, tokens consumed — readable in one place, liftable in
   one cut (T1).
2. **One theming convention.** All public tokens default at `:root`; any
   ancestor scope overrides; no component can accidentally opt out of the
   cascade (T2). That is the "customized using CSS properties" contract made
   trustworthy.
3. **A catalog with teeth.** The recipe surface is enumerated and CI-verified
   against emissions and usage, so "documented" and "works" cannot drift apart
   again (T13).

Distribution comes later — see the extensions review §6, where this file layout
becomes the contents of a single installable extension package.

---

## 7. Prioritized cleanup inventory

Ordered for dependency and payoff, not severity. Effort: S < ½ day · M ≈ 1–2
days · L ≈ a week with verification renders. Every item that touches pagination
should be gated on a before/after page-count + raster diff.

| # | Item | Layer | Refs | Effort | Risk |
|---|---|---|---|---|---|
| 1 | Delete dead rules: `.dc-rules-definition` (both files), `.two-column-list` + tombstones, `.column-break`, `.page-break`, `.dc-wide`, `.dc-art-top`; markdown: inert fg-art class, `.image-bottom` label | theme, book | T6 F2 | S | Low (verify break classes vs built HTML first) |
| 2 | Fix stale docs: MARKER_CSS injection-order comment; audit reconciliation note re `.dc-panel`; `--section-accent`/`--hud-panel` token-name drift; page-templates named-page ownership claim | core, theme | C4 T2 T5 T8 | S | None |
| 3 | Core vocabulary: `.gp-span-all`, `.gp-no-break`, `.gp-break-before`, `.gp-columns-flow/-balanced`; migrate books off `.pmd-*` | core | C1 C7 T11 | S | Low |
| 4 | Unknown-`gp-*`-class parse warning | core | C2 | S | None |
| 5 | Token convention unification: move `.dc-ap`/`.dc-sidebar`/`.dc-fiction-excerpt` tokens to `:root`; strip redundant inline fallbacks | theme | T2 | M | Low — behavior-preserving |
| 6 | Named-page wiring consolidated into page-rules.css | theme | T8 | S | Low |
| 7 | Re-cut override files: guide-only sheet out of book manifests; string-set producer to page-rules; `#ch-example-*` map into dg-overrides; new `field-guide/styles/fg-overrides.css` | theme, book | T7 T9 F1 | M | Medium — gate on full-book raster diff |
| 8 | native-furniture three-way sort: generic fixes → core; instance fixes → fg-native.css | core, engine | C8 T10 | M | Medium — pagination-sensitive |
| 9 | Specialty boilerplate collapse via `--spec-*` indirection (+ tier tokens) | theme | T4 | M | Low-medium |
| 10 | Consolidate `.section` chrome escape into one `.dc-plain` variant; rewrite the 4 bespoke suppressions | theme | T5 | M | Medium — visual invariants on intro/credits/card-grid |
| 11 | Prefix normalization (`.tabbed`→`.dc-tabbed` etc.); retire `pmd-`; decide fate of color/font singles | theme | T11 | M | Low — mechanical |
| 12 | Columns ownership re-scoped to page templates; component columns co-located (kills tombstones; `.toc` moves to dg-overrides) | theme | T1 T9 | M | Low-medium |
| 13 | `components.yaml` catalog + CI cross-check vs plugin emissions and book usage | theme | T13 | M | None — additive |
| 14 | `@layer` adoption: core wraps MARKER_CSS/GUTTERPRESS_CSS; document book-side layer convention | core | C3 | M | Medium — do before file splits so moves are order-proof |
| 15 | Split dc-tokens.css (fonts/palette/identity/component-defaults) and dc-components.css (per family) | theme | T3 T14 | M | Low after item 14 |
| 16 | Plugin emits explicit classes for positional contracts (npc stat lines, card footer) | theme | T12 | M | Low — additive |
| 17 | css-contract lint in core checks pipeline (ownership map, prefix allowlists) | core | C6 | L | None — additive |
| 18 | Core "layered" starter theme scaffolding the canonical architecture | core | C5 | L | None — additive |
| 19 | Core vestige pass: `engineStyles.paged`, col-split machinery decision, legacy style-resolver fallback deprecation | core | C9 | S–M | Low |
| 20 | Field guide per-chapter accent map (or record the single-register decision) | book | F3 | S | None |

Items 1–6 are safe immediately. Item 14 (`@layer`) is the keystone: land it
before the file re-cuts (7, 12, 15) and every subsequent move stops being a
cascade-order gamble. Items 13 and 17 are what keep the system honest after the
humans stop looking.

# CSS layer-boundary audit — gutterpress core vs dc-design-guide vs field-guide

> **CORRECTIONS — verified independently 2026-08-12, after the audit was written.**
> Counts below were re-measured against both books' built DOM:
> - The field guide's `.two-column` usage is **19** (14 of them on `.section`), not 5 — the audit understated it ~4x.
> - The `.section` chrome finding is reported as "1 live defect + 2 instances". The real scope is
>   **191 bare structural `.section` elements** (108 field guide, 83 design guide), every one painted by an
>   unqualified `.section::before`/`::after`. Most of those *should* look like panels; the defect is that there
>   is no way to opt out, which is why three reset rules exist.
> - Because of that scope, the audit's recommended fix (invert to opt-in `.section.panel`) would touch 191
>   elements of markup across two books. The cheaper inversion — keep the default and add an explicit
>   **opt-out** — eliminates the same defect with zero markdown churn. Treat the audit's migration order
>   as superseded on that point.
> - Confirmed as written: `.section.dc-rules-definition`, `.section.col-split` and `.col-split` are 0 matches
>   in both books (safe to delete), and the two parallel column vocabularies are real
>   (design guide: 37 `.two-column` / 0 `.gp-columns-*`).

Date: 2026-08-12. Read-only audit, no code changed. Method: read core
(`markers.js`, `gutterpress-css.ts`) and every dc-design-guide CSS file with
its header contract; built both books to HTML
(`bun packages/cli/src/cli.ts build <book> --format html --skip-pre-validate
--skip-lint`) and counted real DOM matches with a small Python `html.parser`
script against the emitted `book.html` (no bs4/lxml available in this
environment). Two missing image assets in the field guide
(`images/chapter-02/cybersurgeon.png`, `images/chapter-03/etherlock.png`,
both pre-existing, unrelated to this audit) were temporarily backfilled with
copies of sibling images to let the build complete, then removed —
`git status --short field-guide` is clean.

## TLDR

Found **1 confirmed live boundary violation** matching the motivating defect
pattern exactly, **2 already-mitigated instances of the same pattern** (the
mitigations are resets, which the design guide's own comments already flag as
smells), and a handful of smaller findings (one dead-in-both-books component,
one naming collision between core and design-guide column vocabularies). The
codebase is in unusually good shape for this kind of audit: the file-header
"OWNS / MUST NOT CONTAIN" contracts are enforced almost everywhere, and the
worst instance of the defect pattern is **already documented, root-caused,
and flagged as needing a follow-up** in `fg-overrides.css` §16 — this audit's
main job was to verify that self-diagnosis with real counts and check whether
other instances exist elsewhere. They do, in two more places.

The three findings that matter:

1. **`.section` structural class carries default panel chrome** (cream fill +
   accent rail + fake shadow) via `.section::before`/`::after` in
   `dc-components.css:3144-3168`. Three separate places have to reset it back
   off for non-panel uses (`fg-overrides.css` §16, `page.css:528-534`,
   `dc-components.css:3968-3971`), because the chrome is opt-out instead of
   opt-in. Measured: **1 live defect instance** in the field guide
   (`chapter-02 1 Augmerc.md`'s `@section .gp-columns-2`, already fixed by
   the §16 reset) plus **1 design-guide instance** (`.dc-card-grid`, reset at
   `dc-components.css:3968`) and **1 more** (`.page-intro > .section`, reset
   at `page.css:531`) that only exist because the same wrong default forces
   every non-panel use of `@section` to carry an explicit undo rule.
2. **Two parallel ways to "put a section in columns."** Core ships
   `.gp-columns-2`/`.gp-columns-3` (plain `columns:N`, no chrome) in
   `gutterpress-css.ts`; the design guide independently ships
   `.section.two-column`/`.three-column` (columns **plus** DC chrome
   suppression, border, padding, `column-fill`). An author reaching for the
   generic core utility on a `@section` — exactly what happened in the
   Augmerc chapter — gets columns without the chrome suppression the
   design-guide variant would have given for free, and trips finding #1.
   Measured: field guide uses `.two-column` 5× and `.gp-columns-2` 1×;
   design guide uses `.two-column`/`.three-column` 37× and `.gp-columns-2/3`
   0×. The two vocabularies aren't documented against each other anywhere an
   author would see before writing a marker.
3. **Two components are dead in both books' built HTML**:
   `.section.dc-rules-definition` (page.css:186, dc-components.css:4251) and
   `.section.col-split` (page.css:139). Both have real CSS, both are
   documented in code comments as if live ("Lucid ↔ Surreal in the
   dice-rolls chapter"), and both have **zero matches** in either book's
   built DOM. `@column-break` (the marker that would produce col-split
   content) appears only in the design guide's own demo/example chapters,
   never combined with a `.col-split`-classed `@section`.

## Category A — theme chrome keyed to structural classes

| Rule | file:line | What it paints | Affected elements (field-guide / design-guide) | Correct layer | Confidence |
|---|---|---|---|---|---|
| `.section::before` / `.section::after` | `dc-components.css:3144-3168` | Cream panel fill + magenta/accent left rail + clipped top-right corner + fake ink-dark drop shadow, on **every** `.section` that doesn't more-specifically override it | Bare `.section` (no other chrome-relevant class): **69 / 23** measured (these are largely the intended default — see "clean" section below) | Already `.section` is core's structural class (`markers.js`); the DEFAULT chrome is correctly a design-guide concern, but should be gated on an intent class (`.section.panel`) per the `fg-overrides.css` §16 comment, not the bare structural class | High — the design guide's own code comments (§16) already state this conclusion |
| `.chapter[data-chapter-label] > .page[data-page="intro"] > .section > h1:first-of-type` (chevron banner) | `dc-components.css:677, 740` | Magenta chevron banner styling reached via a raw structural-DOM ancestor chain (`.chapter`, `.page[data-page]`, `.section`, `h1:first-of-type`) instead of an author-facing class | **0 / 3** measured | Design guide (chapter-opener composite is a documented, deliberate, frozen contract — CLAUDE.md notes its plugin half lives in core, CSS half here) | Medium — intentional per file comments, but still a structural-DOM selector rather than an opt-in class; fragile to core DOM changes |
| `div.chapter[data-ch]` string-set / `.page.chapter-N` counter-reset | `page.css:615-631`, `page.css:1197-1199` | Chapter-number bookkeeping keyed directly to core's auto-applied `.chapter-N` class and `data-ch` attribute | N/A (mechanism, not visual chrome) | Correct as-is — this is the documented, intentional consumption of a core-emitted contract, not a boundary violation | High (clean) |

## Category B — resets and undo-rules

| Rule | file:line | What it undoes | Wrong default it implies | Affected elements (FG / DG) | Confidence |
|---|---|---|---|---|---|
| `.section.gp-columns-2::before/::after, .section.gp-columns-3::before/::after { content: none }` | `fg-overrides.css:892-897` | The `.section` base panel chrome (A above) | `.section` chrome should be opt-in (`.section.panel`), not default | **1 / 0** — the exact Augmerc-chapter defect this audit was scoped around | High — the file's own comment (§16) states this explicitly: "THIS IS STILL A RESET, and resets are a smell... the real fix is opt-in chrome" |
| `.section.dc-card-grid::before, .section.dc-card-grid::after { content: none }` | `dc-components.css:3968-3971` | Same `.section` base chrome | Same wrong default | **0 / 2** | High |
| `.page.page-intro > .section::before/::after { content: none }` and `.page.page-credits .section.credits-colophon::before/::after { content: none }` | `page.css:531-534`, `page.css:404-407` | Same `.section` base chrome | Same wrong default | **0 / 1** (page-intro) + **1 / 1** (credits-colophon) | High |
| `.section.two-column::before, .section.three-column::before { display: none }` and `.section.col-split::before { display: none }` | `dc-components.css:3199-3202, 3217-3219` | Same `.section` base chrome | Same wrong default, but this instance reads as an intentional **variant** definition (two-column/three-column/col-split are established, documented layout modes with their own full chrome contract below the reset) rather than an ad-hoc patch | **14+0 / 36+1** (two/three-column), **0/0** (col-split, dead — see Category E) | Medium — structurally the same pattern as the two rows above, but these are load-bearing variant definitions with 50 live uses between the books, not a one-off patch; folding the base rule into an opt-in class would let these become simple additive rules instead of override-then-redefine |
| `.section.tabbed::after, .section.two-column::after, .section.three-column::after, .section.col-split::after { content: none }` | `dc-components.css:3171-3176` | The base fake-shadow only | Same wrong default | Covered by the counts above | Medium (same reasoning as previous row) |
| `filter: none` (×2, on `.section.two-column/.three-column` and `.section.col-split`) | `dc-components.css:3189, 3209` | An assumed inherited `filter` — but no ancestor or the base `.section` rule sets `filter` today (the base rule's own comment says "Do NOT add filter:drop-shadow here") | Defensive/vestigial — likely left over from when `.section` did carry a `filter` (pre pure-vector-shadow conversion, see the file's CORE CONSTRAINT note on `filter`) | N/A (no visible effect either way today) | Low — could not confirm this is presently masking anything; flag for cleanup, not urgent |
| `box-shadow: none` (×5 total across `dc-components.css`, `page.css`, `fg-overrides.css`) | `dc-components.css` (chevron variant), `page.css:500,509,525`, `fg-overrides.css:199,682` | Component-default box-shadow, in each case because the page-level composite (`page-intro`, chevron) supplies ONE `filter: drop-shadow` on the wrapper instead and per-child shadows would double up | The default is "every card-like component always casts its own shadow"; composites need a way to opt individual children out | Not independently counted; qualitatively confirmed by reading — each site has a specific composite-shadow comment explaining why | Medium — each instance is individually justified in comments (this is the intentional per-child-shadow-vs-wrapper-filter tradeoff, not an accidental wrong default), but the pattern recurring 5× across 3 files suggests the composite-shadow contract could be named/formalized once instead of re-derived per page template |

Note: the ~30 `content: none` hits inside `@page` margin-box blocks
(`page.css`, `fg-overrides.css:762-773`) are **not** boundary violations —
suppressing a margin-box's inherited footer content on a named page (e.g.
front-matter, full-bleed) is the standard CSS Paged Media idiom, not an
undo-rule for a wrong default.

## Category C — generic behavior stranded in a specific layer

| Candidate | file:line | Why it looked generic | Verdict | Confidence |
|---|---|---|---|---|
| `.two-column-list` / `:is(.dc-skill-card, .dc-card-body) .two-column-list` | `page.css:194-209` | "Put this list in 2 columns" sounds like a `.gp-columns-2`-shaped primitive | Not a duplicate: it deliberately switches to `column-width` inside cards for narrow-fragment behavior that `.gp-columns-2` doesn't do. Correctly DC-specific. Measured live: **2 / 0** | Medium |
| `.dc-skill-card.two-col .dc-card-inner { column-count: 2 }` | `page.css:217-221` | Same shape | Same verdict — component-internal column tuning, not a general authoring primitive | Medium |
| `.section.two-column` / `.three-column` composite (see Category B row above) | `page.css:115-158`, `dc-components.css:3183-3421` | Overlaps conceptually with core's `.gp-columns-2/3` | This is the audit's #2 TLDR finding — not stranded generic behavior exactly, but a **second, richer vocabulary for the same author intent** that core's utility doesn't know about and vice versa. See Category E below for the duplicate/collision framing. | High |

No instance was found of design-guide or field-guide CSS implementing a
plain, non-DC-branded authoring primitive that should have gone into core
instead (the historical example, `.two-column` → `.gp-columns-2`, already
happened and is done).

## Category D — book-specific tuning stranded in a shared layer

**Checked, found clean.** Grepped `dc-components.css` and `page.css` for
book-scoped selectors (`#ch-*` ids, `.chapter-N` combined with book-specific
context) that should live in `fg-overrides.css`/`dg-overrides.css` instead.
The only hits are inside **comments** documenting the override pattern
(`dc-components.css:662, 4067`), not actual live rules — the file-header
contracts ("MUST NOT CONTAIN... div.chapter scaffolding", "no UNSCOPED
component restyling") are being followed in the current rule bodies.

## Category E — duplicate/conflicting definitions and dead rules

| Concept | Definitions | Status | Confidence |
|---|---|---|---|
| "Put a section/page in N columns" | `gutterpress-css.ts` `.gp-columns-2/3` (core, bare `columns:N`) vs. `page.css`/`dc-components.css` `.section.two-column`/`.three-column` (design guide, columns + chrome-suppression + border + padding + column-fill) | **Live collision**, not simple duplication — see TLDR #2. Both vocabularies work, produce visibly different results, and nothing tells an author which one to reach for. Measured: FG uses `.two-column` 5×, `.gp-columns-*` 1×; DG uses `.two-column`/`.three-column` 37×, `.gp-columns-*` 0× | High |
| `.section.dc-rules-definition` | `page.css:186-190` (column authority) + `dc-components.css:4251-4276` (chrome/tokens) | **Dead in both books.** Zero `dc-rules-definition` class matches in either built `book.html`; zero markdown source hits for the string in either book | High — measured zero in built DOM, corroborated by zero source hits |
| `.section.col-split` / `.col-split .col` | `page.css:139-146` (flex layout) + `dc-components.css` col-split chrome suppression rows | **Dead in both books.** Zero `col-split` class matches in either built DOM (the 16 textual "col-split" hits per book in the raw HTML are the embedded `<style>` block's own CSS source, not DOM class attributes — confirmed by parsing DOM elements specifically, not text-grepping the HTML). `@column-break` appears only in the design guide's own demo chapters and is never paired with an `@section .col-split` marker in either book | High |
| `.dc-stamp` / `.dc-classified` | moved to `deprecated.css` per `dc-components.css:1041-1043` comment | Confirmed dead (0/0), and already correctly parked, not a live finding | High (clean — correctly handled already) |
| `.chapter-end`, `.dc-art-top`, `.dc-art-bottom`, `.image-top` | `page.css` comments explicitly say these are unused/removed | Confirmed dead (0/0 each), already correctly documented as dead in the file itself | High (clean — correctly self-documented) |
| `.image-bottom` | `page.css:536-548` (comment says lives in "native-furniture.css §7") | **Live**, not dead: 2 matches in field guide, 0 in design guide. Sanity-checked because the file comment could have implied dead code — it is not | High (clean) |

## Proposed migration order

1. **Mechanical, do first — introduce `.section.panel` as the opt-in gate for
   the base `.section::before`/`::after` chrome** (Category A/B's core
   finding). This is mechanical in the sense that the CHROME RULES
   themselves don't change — only the selector `.section` becomes
   `.section.panel` in `dc-components.css:3144-3168`, and every currently
   panel-shaped `.section` usage (the 69 FG / 23 "bare" sections measured
   above, minus the ones already opting out via `.two-column` etc.) needs
   `.panel` added. This is find-and-replace across markdown, not a design
   decision, EXCEPT for the ~92 bare-`.section` call sites: each one needs a
   human/author judgment call ("is this actually meant to be a panel?"),
   which is exactly the same judgment call `fg-overrides.css` §16 already
   deferred. Doing this FIRST is what makes step 2 possible without a
   second reset.
2. **Delete the now-redundant resets** — `fg-overrides.css` §16, the
   `.dc-card-grid` reset (`dc-components.css:3968-3971`), the `page-intro`/
   `credits-colophon` resets (`page.css:404-407, 528-534`) — once step 1
   ships, these become dead code (their targets no longer carry the chrome
   in the first place). Mechanical, but blocked on step 1 landing everywhere
   first, since deleting a reset before its call site stops needing it
   reintroduces the original defect.
3. **Design decision, needs the owner's call**: reconcile
   `.gp-columns-2/3` vs `.section.two-column/.three-column` (Category E's
   top row). Options are (a) document the split clearly ("use `.two-column`
   inside a DC-styled `@section`; `.gp-columns-2` is the bare primitive for
   anything else") so authors stop colliding with it, or (b) have
   `.section.two-column` ADD `.gp-columns-2`'s declarations instead of
   redeclaring `columns:2` independently, so there is exactly one column
   primitive and the design-guide class is purely additive chrome on top of
   it. (b) is more work but closes the collision at the root; (a) is a
   one-paragraph doc fix. Not mechanical — needs a decision on how much
   coupling between the two layers is acceptable.
4. **Mechanical, low-risk, do whenever**: delete
   `.section.dc-rules-definition` and `.section.col-split` (both CSS
   definitions and their chrome-suppression counterparts) since both are
   confirmed dead in both books. Low risk because "zero matches in both
   books' built DOM" is about as strong a deletion signal as this kind of
   audit can produce, though a final grep across any other DC-branded
   project consuming `dc-components.css` (per its "portable component
   library" contract) should happen before actually deleting, since this
   audit only covers these two books.

## What was checked and found clean

- Core (`markers.js` / `gutterpress-css.ts`) does not leak any DC-specific
  vocabulary — confirmed by reading both files in full; the `gp-*` prefix
  and role split (structural DOM vs. author utility vocabulary) described in
  CLAUDE.md §6 is followed exactly as documented.
- File-header "OWNS / MUST NOT CONTAIN" contracts in `dc-tokens.css`,
  `dc-core.css`, `dc-components.css`, `page.css` are being honored in the
  actual rule bodies — no stray `columns:N` outside `page.css`, no `@page`
  declarations outside `page.css`, no `:root` token blocks outside
  `dc-tokens.css` (spot-checked via grep for each owned concern).
- Category D (book-specific tuning leaking into the shared component
  library) — clean, see above.
- Previously-flagged dead components (`.dc-stamp`, `.dc-classified`,
  `.chapter-end`, `.dc-art-top/bottom`, `.image-top`) — all confirmed
  actually dead (0/0), the file's own "this is dead" comments are accurate.
- `.image-bottom` and `.dc-card-grid` — confirmed live, not dead, despite
  ambiguous-sounding comments nearby.

## What could not be determined and why

- **Whether `.section.two-column`/`.three-column`'s composite definition
  (Category E) is intentional design or accidental drift from core's
  `.gp-columns-2/3`.** No commit history or design note was found
  explaining why the design guide re-implemented `columns:N` instead of
  building on the core utility; this needs the owner's institutional
  memory, not more code reading.
- **Whether other DC-branded projects (outside this repo) consume
  `dc-components.css` and rely on `.section.dc-rules-definition` /
  `.section.col-split`.** `dc-components.css`'s own header states it "IS the
  DC component library" for "any DC-branded print-md project" — this audit
  only had access to `field-guide` and `dc-design-guide`, so "dead in both
  books" is not the same claim as "dead everywhere"; deletion (migration
  step 4) should be preceded by a search across any other consuming repo.
- **Precise `th:empty` counts** (dc-core.css:268's empty-header-cell
  suppression) — the HTML parsing script used (Python's stdlib
  `html.parser`, no bs4/lxml available in this environment) counts `<th>`
  elements but not their emptiness reliably against self-closing/whitespace
  content; qualitatively the rule's own comment cites a specific measured
  case (chapter-01 size/age/origin/dream lists) which was not independently
  re-verified.
- **The `filter: none` and `box-shadow: none` rows in Category B** — could
  not fully confirm whether removing them today would change rendered
  output (i.e., whether they're load-bearing or vestigial), since that
  requires a visual diff / screenshot comparison, which is out of scope for
  a DOM-count-based read-only audit.

## Files referenced

- `/home/founder3/code/dimm-city/print-md/packages/cli/src/lib/markdown/markers.js`
- `/home/founder3/code/dimm-city/print-md/packages/cli/src/lib/markdown/gutterpress-css.ts`
- `/home/founder3/code/dimm-city/dc-op-manual/dc-design-guide/css/dc-tokens.css`
- `/home/founder3/code/dimm-city/dc-op-manual/dc-design-guide/css/dc-core.css`
- `/home/founder3/code/dimm-city/dc-op-manual/dc-design-guide/css/dc-components.css`
- `/home/founder3/code/dimm-city/dc-op-manual/dc-design-guide/css/page.css`
- `/home/founder3/code/dimm-city/dc-op-manual/dc-design-guide/css/fg-overrides.css`
- `/home/founder3/code/dimm-city/dc-op-manual/field-guide/*.md`
- `/home/founder3/code/dimm-city/dc-op-manual/dc-design-guide/*.md`

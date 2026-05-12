# DC Design Guide & Field Guide — Master Roadmap
*Generated 2026-05-12 from 4-agent research pass (session logs, AKM memories, git history, CSS audit, field guide migration audit, plugin audit)*

---

## What was completed this session

| Commit | What |
|---|---|
| `0941026` | CSS alias consolidation (float, terms, lede, sidebar, specialty); lede container fix (`createAliasedContainer`); audit updated |
| `4f15102` | Missing CSS rules for `@continue` cards (`dc-skill-card-cont`, `dc-card-tab-cont`) and `img-wrapper` |
| `15295f3` | Remove `pre` from column-span defaults — code blocks flow within column |
| `8f695cc` | Lede column-span, H2 word-break + 14.5pt in two-column, inline code overflow-wrap |
| `cb08a88` | Page breaks between NPC tiers; orphan heading fixes in Part 2 examples |
| `13c36f8` | Gear & Tech annotation pages expanded to fill sparse layout |

Prior sessions: 19 dead CSS classes removed; 7 functional bugs fixed (critical: `note-callout` plugin mismatch, `dc-dm-note` rename); all font tokens documented; `--bg` corrected; `--fs-base` retired.

---

## Phase 1: Quick Wins — CSS + Docs Cleanup
*No plugin dependency. Can be done in 1–2 sessions.*

### Token decisions — make the call, stop annotating

| Token pair | Gap | Recommended action |
|---|---|---|
| `--space-xs` / `--space-sm` | Resolved | `--space-xs` removed; note label now uses `--space-sm` |
| `--fs-pullquote` / `--fs-h2` | Resolved | Pull quotes now use `--fs-h2` directly |
| `--fs-chevron` / `--fs-h1` | Resolved | Chevron banners now use `--fs-h1` directly |
| `--gutter` / `--space-2xl` | Resolved | Semantics split: `--gutter` now drives 0.15in column gaps; `--space-2xl` stays a 0.25in spacing token |

### Design guide doc accuracy

- `04-dc-components.md` lines 261, 330 — `.dense` docs corrected to deprecated alias status
- `.two-column-list` remains live in active field-guide files; `.two-col-list` appears unused. Keep this as a migration follow-up, not a closable zero-usage audit item.
- `.procedure > ol` legacy CSS block removed after confirming zero active source usage

### H2 sizing in two-column layout

Resolved this session: two-column guide/content-template gutters now use `--gutter: 0.15in`, and chapter 01/02 H2s are back on `--fs-h2`.

### Banner heading repetition

The chapter-start example H1 now carries `{.dc-chevron}`, and the shared page-template chevron selectors have been reduced to `border: 0` overrides. TOC/credits/intro example pages still use `##` headings, so their duplicated selectors remain coupled to heading level until those examples are normalized.

---

## Phase 2: Plugin Macro Development
*Build in order — each macro unblocks a field guide migration batch.*

| # | Macro | Replaces | Emits | Complexity | Field guide scope |
|---|---|---|---|---|---|
| 1 | `@lede` | `:::lede` (already canonical) | `dc-intro` | Simple | Already converted — macro formalises it |
| 2 | `@sidebar` | `:::sidebar` / `:::wrapper {.dc-sidebar}` | `dc-sidebar` | Simple | 2 files, 2 sites |
| 3 | `@sidebar-box` | `:::wrapper {.dc-sidebar-box}` | `dc-sidebar-box` | Simple | 2 files, 2 sites |
| 4 | `@procedure` | `:::procedure` | `dc-steps > ol` | Medium | Rationalises two-procedure-system Category 5 item |
| 5 | `@definition` | `:::wrapper {.dc-definition-block}` | `dc-definition-block` | Simple | Low usage |
| 6 | `@three-column` | `:::three-column` | `three-column` | Medium | Low usage |
| 7 | `@item` | `:::item` | TBD — context-aware | Complex | Deferred — scoping decision required |

**Implementation notes:**
- Simple macros = wrap content in a named div, no special parsing; pattern follows existing `@lede` implementation
- Medium macros = structured sub-blocks or ordered list detection; follow `@skill` / `@outcome` patterns
- All emitted classes must use `dc-` prefix per CLAUDE.md (exception: `.scream` intentionally unprefixed)
- Each new macro needs a matching CSS rule in `dc-brand.css` before shipping
- Each new macro needs a design guide specimen in the appropriate `03-components.md` or `08-field-guide-components.md` section
- `dc-pullquote` should migrate to GFM alert syntax, not a new macro
- Two-column field-guide wrappers should migrate to `@section` with class modifiers, not a new macro
- No `@aug` macro is planned; chapter-05 needs a separate migration design

---

## Phase 3: Field Guide Migration
*Execute after the relevant macro from Phase 2 is built.*

### Immediate (existing macros, no plugin work needed)

Completed this session, plus a follow-up syntax cleanup pass (`@page` normalization and canonical class shorthand) in active field-guide sources.

| Item | Files | Lines | Action |
|---|---|---|---|
| `@chapter-opener` missing | `chapter-00.md`, `chapter-04.md`, `chapter-05.md` | Chapter opening | Completed — chapter opener badges added as `C.00`, `C.12`, `C.13` |
| `:::container` positional layouts | `chapter-03.md` | Lines 418, 499, 594 | Completed — source now uses page classes (`.surviving-the-sprawl`, `.rolling-die`, `.outcome-table`) instead of positional container classes |

### Macro-gated migrations (do after Phase 2 macro is built)

| Macro needed | Pattern in field guide | Files | Sites |
|---|---|---|---|
| `@sidebar-box` | `:::wrapper {.dc-sidebar-box}` | Multiple | 2 |
| `@section` migration | `:::: wrapper {.two-column .dc-terms}`, `:::wrapper {.two-column-list}` | `chapter-04.md`, `chapter-02 *` | 5 |
| GFM alert migration | `:::wrapper {.dc-pullquote}` | `chapter-00.md`, `chapter-05.md` | 2 |

### Bulk migration (low risk, any time)

- Re-audit required: the active source tree does **not** support the earlier blanket `---` → `@break` assumption. The remaining plain `---` markers in active field-guide files are acting as section dividers, not safe page-break markers.

### Needs macro design first (deferred)

These patterns exist in the field guide but have no planned macro yet. Do not migrate until the macro is designed and the CSS class is confirmed:

- `.specialty-intro`, `.specialty-art`, `.specialty-spread` — 8 occurrences in `chapter-02 *` specialty files
- `.at-a-glance-card*` — used in `chapter-01.md`
- `.weapon-01` — used in `chapter-05.md`
- `.grid` / `.item` wrappers — widespread in `chapter-01.md` (26 wrappers) and `chapter-05.md` (17 wrappers)

Total remaining `:::wrapper` containers in active field guide files: still macro/deferred work, not part of the completed Phase 3 immediate/syntax pass.

---

## Phase 4: Rationalization Decisions
*Deliberate design choices — cannot be automated. Each needs a decision before implementation.*

### Two-column layout mechanisms (6 exist)
`.two-column`, `.dc-ability-2col`, `.dc-ability-grid`, `.dc-procedure-grid`, `.columns`, `.dense` (deprecated)

→ Audit which produce meaningfully different column widths, gaps, or breakpoints. Consolidate any that are visually identical into one class with optional modifiers.

### Stat-grid patterns (3 exist)
1. `.dc-stat` + `.dc-stat-grid` + `.dc-stat-cell` — general NPC/creature stat blocks
2. `.citizen-at-a-glance` + `.citizen-stat` + `.citizen-stat-key` / `.citizen-stat-val` — citizen-file specific
3. `.at-a-glance-cards` + `.at-a-glance-card` — generic summary cards

→ Systems 1 and 3 are structurally similar. If visually identical, share a base class with a variant modifier. System 2 may intentionally differ (citizen-file format).

### Atmospheric callout cluster
`.dc-vibe-callout`, `.dc-origin-callout`, `.dc-visit-callout` — identical structure, differ only by border colour and `::before` label.

→ Decision: consolidate into `.dc-flavor-callout` with `data-label` attribute and CSS custom property for accent colour, OR keep as named classes if authoring ergonomics matter more than CSS elegance.

### Four identical `@page` declarations
`front-matter`, `colophon`, `chapter-start`, `clean` — all produce identical visual output.

→ Verify each is load-bearing for Paged.js chunker reliability (existing comment claims they are). If confirmed, add explicit documentation; if not, consolidate.

### Banner heading markup (longer-term)
Five page templates in `content-templates.css` hard-code the chevron banner treatment rather than relying on `.dc-chevron`. Fix requires adding `{.dc-chevron}` to H1 elements in markdown, which touches multiple field guide chapter openers. Coordinate with field guide migration work.

---

## Effort summary

| Phase | Estimated effort | Blocking? | Value |
|---|---|---|---|
| 1 — Quick wins | 1–2 sessions | No | Eliminates contradictory docs; resolves token ambiguity |
| 2 — Macros 1–4 | ~1 session each | Blocks Phase 3 batches | Makes field guide authoring canonical |
| 2 — Macros 5–9 | 1–2 sessions total | Blocks remaining Phase 3 | Lower urgency |
| 3 — Immediate migrations | Completed | No | Chapter opener coverage; chapter-03 container cleanup |
| 3 — Macro-gated migrations | After each macro | Needs macros | Brings 74 wrapper containers to macro form |
| 3 — Safe syntax cleanup | Completed | No | `@page` normalization and canonical class shorthand in active field-guide sources |
| 3 — Bulk `---` → `@break` | Re-audit required | No | Earlier count/automation assumption did not hold in active source |
| 4 — Rationalization | Ongoing | No | System coherence; maintenance reduction |

**Recommended next session:** Implement `@sidebar-box`, then migrate pullquotes to GFM alert syntax and two-column wrappers to `@section` with class modifiers. Leave chapter-05 `:::aug` content out of the macro plan.

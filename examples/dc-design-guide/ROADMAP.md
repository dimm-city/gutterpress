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
| `--space-xs` / `--space-sm` | 0.32pt | Drop `--space-xs`; replace its 1 CSS consumer with `--space-sm`; remove token |
| `--fs-pullquote` / `--fs-h2` | 0.3pt | Delete `--fs-pullquote`; use `--fs-h2` directly in pullquote component — or bump to 19–20pt if pullquotes should outweigh headings |
| `--fs-chevron` / `--fs-h1` | 0.7pt | Either collapse to `var(--fs-h1)` or set chevron to 22pt to visually outweigh body H1s |
| `--gutter` / `--space-2xl` | same | Add explicit "update in tandem" comment; evaluate narrowing gutter to 0.15in for two-column chapters to give H2s more room |

### Design guide doc accuracy

- `04-dc-components.md` lines 261, 330 — `.dense` still listed as a valid synonym; update to "deprecated alias — use `.columns`"
- `.two-column-list` / `.two-col-list` — grep field guide to confirm zero usage, then close the audit item
- `.procedure > ol` legacy CSS block — grep field guide for `class="procedure"` / `{.procedure}`; if zero hits, remove the block from `dc-brand.css`

### H2 sizing in two-column layout

The current `14.5pt` in `guide.css` is a workaround for column overflow, not a design decision. Two paths:

- **Preferred:** Narrow the two-column gutter from `0.25in` → `0.15in` in `guide.css` (`div.chapter.chapter-01/02` `column-gap`). This gives each column ~0.05in more room, likely enough to restore H2 to `--fs-h2` (~17pt). Verify visually.
- **Fallback:** Explicitly document `14.5pt` as the intentional size for two-column reference chapters and update the comment accordingly.

### Banner heading repetition

Five hard-coded selector blocks in `content-templates.css` (lines 524–618) duplicate the `.dc-chevron` treatment. Fix: add `{.dc-chevron}` to the H1 in markdown for each affected page type, then trim the duplicated declarations to `border: 0` overrides only.

---

## Phase 2: Plugin Macro Development
*Build in order — each macro unblocks a field guide migration batch.*

| # | Macro | Replaces | Emits | Complexity | Field guide scope |
|---|---|---|---|---|---|
| 1 | `@lede` | `:::lede` (already canonical) | `dc-intro` | Simple | Already converted — macro formalises it |
| 2 | `@sidebar` | `:::sidebar` / `:::wrapper {.dc-sidebar}` | `dc-sidebar` | Simple | 2 files, 2 sites |
| 3 | `@sidebar-box` | `:::wrapper {.dc-sidebar-box}` | `dc-sidebar-box` | Simple | 2 files, 2 sites |
| 4 | `@pullquote` | `:::pull-quote` / `:::wrapper {.dc-pullquote}` | `dc-pullquote` | Simple | 2 files, 2 sites (GFM alert already preferred) |
| 5 | `@two-column` | `:::: two-column` / `:::wrapper {.two-column}` | `two-column` | Medium | 3 files, 5 sites |
| 6 | `@procedure` | `:::procedure` | `dc-steps > ol` | Medium | Rationalises two-procedure-system Category 5 item |
| 7 | `@definition` | `:::wrapper {.dc-definition-block}` | `dc-definition-block` | Simple | Low usage |
| 8 | `@aug` | `:::aug` | `aug` | Simple | 9 sites in chapter-05 |
| 9 | `@three-column` | `:::three-column` | `three-column` | Medium | Low usage |
| 10 | `@item` | `:::item` | TBD — context-aware | Complex | Deferred — scoping decision required |

**Implementation notes:**
- Simple macros = wrap content in a named div, no special parsing; pattern follows existing `@lede` implementation
- Medium macros = structured sub-blocks or ordered list detection; follow `@skill` / `@outcome` patterns
- All emitted classes must use `dc-` prefix per CLAUDE.md (exception: `.scream` intentionally unprefixed)
- Each new macro needs a matching CSS rule in `dc-brand.css` before shipping
- Each new macro needs a design guide specimen in the appropriate `03-components.md` or `08-field-guide-components.md` section

---

## Phase 3: Field Guide Migration
*Execute after the relevant macro from Phase 2 is built.*

### Immediate (existing macros, no plugin work needed)

| Item | Files | Lines | Action |
|---|---|---|---|
| `@chapter-opener` missing | `chapter-00.md`, `chapter-04.md`, `chapter-05.md` | Chapter opening | Add `@chapter-opener C.NN` to each chapter opener page |
| `:::container` positional layouts | `chapter-03.md` | Lines 418, 499, 594 | Convert `.action-img`, `.dc-sidebar .top-right`, `.top-left .outcome-table` to `@page`-class positioning |

### Macro-gated migrations (do after Phase 2 macro is built)

| Macro needed | Pattern in field guide | Files | Sites |
|---|---|---|---|
| `@pullquote` | `:::wrapper {.dc-pullquote}` | `chapter-00.md`, `chapter-05.md` | 2 |
| `@sidebar-box` | `:::wrapper {.dc-sidebar-box}` | Multiple | 2 |
| `@two-column` | `:::: wrapper {.two-column .dc-terms}`, `:::wrapper {.two-column-list}` | `chapter-04.md`, `chapter-02 *` | 5 |
| `@aug` | `:::aug` | `chapter-05.md` | 9 |

### Bulk migration (low risk, any time)

- **273 `---` page breaks → `@break`** — automated find-replace across all active field guide files; no visual regression risk; `@break` is already implemented in core

### Needs macro design first (deferred)

These patterns exist in the field guide but have no planned macro yet. Do not migrate until the macro is designed and the CSS class is confirmed:

- `.specialty-intro`, `.specialty-art`, `.specialty-spread` — 8 occurrences in `chapter-02 *` specialty files
- `.at-a-glance-card*` — used in `chapter-01.md`
- `.weapon-01` — used in `chapter-05.md`
- `.grid` / `.item` wrappers — widespread in `chapter-01.md` (26 wrappers) and `chapter-05.md` (17 wrappers)

Total remaining `:::wrapper` containers in active field guide files: **74** across all chapters.

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
| 3 — Immediate migrations | 1 session | No | Chapter opener coverage; chapter-03 container cleanup |
| 3 — Macro-gated migrations | After each macro | Needs macros | Brings 74 wrapper containers to macro form |
| 3 — Bulk `---` → `@break` | 1 session | No | 273 replacements; automated |
| 4 — Rationalization | Ongoing | No | System coherence; maintenance reduction |

**Recommended next session:** Phase 1 — token decisions, H2 gutter evaluation, `.dense` doc fix, `.procedure > ol` dead-code check. All CSS/markdown, no plugin dependency, directly improves design guide accuracy as source of truth.

# Field Guide Component Mapping & Migration Reference

This document catalogs every content type across all six Field Guide chapters, maps each to the correct DC Design Guide component, and lists all migration work required to bring the source into compliance with the current print-md macro system.

---

## Section 1: Critical Migration Issues

### 1.1 Container Syntax (`:::`) — The Single Biggest Blocker

`:::` container syntax was **removed from print-md on 2026-05-17**. Every `:::` fence in the field guide produces silent garbage output — the markdown renderer ignores or mangles the block. There is no graceful degradation. This must be fixed before any page can render correctly.

**Total `:::` fence lines across all chapters:**

| Chapter | `:::` fence lines | Notes |
|---|---|---|
| chapter-00 | 12 | Cover, credits, TOC wrappers |
| chapter-01 | 16 | Character creation sidebars, wrappers |
| chapter-02 | 635 | Overwhelmingly `:::: ability`, `:::: learning-path`, `:::: specialty` (quad-colon variant) |
| chapter-03 | 16 | Rules wrappers, outcome table, sidebar |
| chapter-04 | 30 | Terms columns, wrapper items |
| chapter-05 | 53 | Gear grid, aug blocks, weapon wrappers |
| **Total** | **762** | |

Note: Chapter-02 uses a **quad-colon variant** (`::::`) that was a custom extension in the old pipeline. It is equally invalid. The breakdown for chapter-02 specifically:
- `:::: ability` opening fences: **253** (one per ability entry)
- `:::: learning-path` opening fences: **51**
- `:::: specialty` opening fences: **8** (one per specialty scope)
- `:::: wrapper` and other: **~1** (chapter intro class-panel)
- Closing `:::::` fences: **~253+** (every block has one)

### 1.1b Generic Container Macro — `@block` (to be moved to markdown-it-paged)

The `@block` macro currently lives in the DC plugin with a `variant=panel|slate|shard|codex` attribute system. This is being **refactored**:

1. `@block` moves to **`markdown-it-paged`** as a general-purpose container — available to any print-md project, not just DC-branded ones.
2. The `variant=` attribute system is **deprecated**. Authors use class names directly: `@block .slate` instead of `@block variant=slate`.
3. The DC plugin removes its `@block` handler entirely. CSS in `dc-components.css` is updated accordingly (`.dc-block.panel` not `.dc-block.dc-panel`).

**New spec:**
- Syntax: `@block .class-name` / `@end-block`
- Output: `<div class="dc-block class-name">…</div>` — base class `dc-block` always present; author-supplied class appended
- No default visual styles in `markdown-it-paged`. All appearance lives in `dc-components.css` (or the consuming project's CSS)
- Nestable inside `@section` — intended design pattern

**CSS migration required in dc-components.css:**
```
OLD selectors:          NEW selectors:
.dc-block.dc-panel  →   .dc-block.panel
.dc-block.dc-slate  →   .dc-block.slate
.dc-block.dc-shard  →   .dc-block.shard
.dc-block.dc-codex  →   .dc-block.codex
```

**⚠️ This is a prerequisite for completing the P0 sweep.** Approximately 30 `:::wrapper {.custom-class}` blocks across chapters 01, 03, 04, and 05 have no existing DC macro equivalent. `@block` must land before or in parallel with the P0 sweep.

**⚠️ COORDINATED BREAKING CHANGE.** This migration requires simultaneous deployment across three locations: (1) `markdown-it-paged` — add `@block`/`@end-block` handler; (2) `dimm-city-plugin.js` — remove `@block variant=X` handler; (3) `dc-components.css` — rename all four variant selectors. Partial deployment breaks existing DC design guide docs: old CSS has `.dc-block.dc-panel`; new paged `@block .panel` emits `.dc-block.panel` (no `dc-` prefix on variant). Until all three ship together, use current syntax: `@block variant=slate` / `@slate`.

**⚠️ Until `@block` lands in paged:** All `@block .X` recommendations in this document require the old syntax `@block variant=X` (or shorthand `@slate`, `@panel`, `@shard`, `@codex` if available). Do NOT write `@block .slate` in field guide source until the paged migration is confirmed deployed.

**Usage examples:**
```
Generic wrapper:          @block .bottom-center
                          ![image](img.png)
                          @end-block

DC semantic block:        @block .slate
                          Authority content here
                          @end-block

Nested inside section:    @section .dc-rules
                          @block .panel
                          Rule text
                          @end-block
                          @end-section
```

**Migration of existing `@block variant=X` syntax** (design guide + field guide):
```
OLD: @block variant=panel   →   NEW: @block .panel
OLD: @block variant=slate   →   NEW: @block .slate
OLD: @block variant=shard   →   NEW: @block .shard
OLD: @block variant=codex   →   NEW: @block .codex
```

### 1.1c Generic Card Macro — `@card` (to be added to DC plugin)

A new `@card` macro handles discrete authored-choice entries (ideals, flaws, dreams, specialty intro cards, spec tweaks — any content that is one item from a menu of options rather than a container or a skill).

**Spec:**
- Syntax: `@card .class-name` / `@end-card`
- Output: `<div class="dc-card class-name">…</div>` — base class `dc-card` always present
- Lives in the **DC plugin** (not paged core) — DC-brand-specific authored choices
- Designed to nest inside `@section .dc-X` scope, where the parent section drives visual styling via cascade

**The `@section .dc-X > @card` pattern (Contextual Cascade compliance):**

Authors write:
```
@section .dc-flaws
@card
### Megalomaniac
> "The city doesn't deserve me, but it needs me."
Driven by an unshakeable belief...
@end-card

@card
### Addictive Personality
> "Just one more hit."
@end-card
@end-section
```

CSS drives the appearance:
```css
.dc-flaws > .dc-card { /* flaw card default */ }
.dc-ideals > .dc-card { /* ideal card default */ }
.dc-dreams > .dc-card { /* dream card default */ }
```

This means `@card` carries no hardcoded styling — the parent section's class determines how its cards look. A `@card` inside `.dc-flaws` looks like a flaw; the same `@card` inside `.dc-ideals` looks like an ideal. No `@card .flaw` naming needed — the cascade handles it.

**For specialty intro cards**, the pattern is:
```
@specialty .augmerc
@card
### Augmerc
![aug](images/aug.png)
Heavily armed and wired for war...
@end-card
@end-specialty
```

The `@specialty .augmerc` scope sets the cascade; the `.dc-card` inside it inherits the augmerc accent automatically via `.dc-specialty.augmerc .dc-card { … }` rules in `dc-components.css`.

---

### 1.2 Raw HTML `<div>` Usage

All raw `<div>` elements need to be replaced with macro syntax:

| Chapter | Count | Usage |
|---|---|---|
| chapter-00 | 2 | `<div class="credits-wrapper">` and `<div class="credits-section">` |
| chapter-01 | 9 | 8× `<div class="faction-section">` (specialty intro cards) + 1× `<div class="caption">` |
| chapter-02 | 1 | `<div style="...">` inline-styled grapple rules note (line 325) |
| **Total** | **12** | |

### 1.3 Other Inline HTML

- `<ins>` tags used for underline on "always" in Proxy Spec Tweak (chapter-02, line 870 and lines 379–392). Replace with standard markdown emphasis or a DC block.
- `<style>` tags: none found.
- HTML comments (`<!-- -->`) are used throughout as author notes — these are fine and will not appear in output.
- Emoji in chapter-05 (⚠️ ☀️ 🔊 💥 🔥) may not render correctly in PDF depending on font; flag for review.

### 1.4 `{.class}` Attribute Syntax on Non-heading Elements

The field guide uses `{.class}` brace attributes (via markdown-it-attrs) on headings and some images. This syntax IS supported. Examples:

- `## 2. Vibe {.new-spread}` — heading class, works
- `### Load Your Gear {.load-gear-heading}` — heading class, works
- `#### Specialty Gear {.specialty-gear}` — heading class, works
- `![cover](images/cover.jpg) {.cover-image}` — image attribute, works

These are valid and do not need migration — but the CSS classes referenced (`new-spread`, `load-gear-heading`, `specialty-gear`, `cover-image`) will need corresponding rules in `fg-overrides.css` or `page-templates.css` to have any effect.

### 1.5 `data-augmented-ui` Attributes

Several `:::` wrappers in chapter-03 include `data-augmented-ui="tl-clip tr-clip..."` attributes for a third-party UI decoration library. These attributes were presumably used with a custom CSS setup. Their current fate is unclear — the augmented-ui library is not in the print-md asset pipeline. These blocks need a decision: either integrate the library or replace with DC macro equivalents.

Locations (chapter-03):
- Line 185: `{".bottom-center" data-augmented-ui="tl-clip-x br-clip b-rect border"}`
- Line 718: `{".bottom-center" data-augmented-ui="tl-rect tr-rect br-rect bl-rect border"}`
- Line 1105: `{data-augmented-ui="tl-clip border"}`

Same pattern in chapter-00, line 139.

---

## Section 2: Chapter-by-Chapter Component Mapping

### Chapter 00 — Cover, Credits, TOC, Introduction

| Section | Content Type | Current Syntax | Recommended Component | Action |
|---|---|---|---|---|
| Cover page | Full-bleed cover image + title text | `:::container {.cover-container}` + `{.cover-image}` | `@page .cover` + `.dc-cover-page` family | Needs migration: use `.dc-cover-page` / `.dc-cover-layout` / `.dc-cover-bigword` |
| Cover text block | Title "DIMM CITY / Field Guide / A Creaturepunk TTRPG" | `:::container {.cover-text}` nested | `.dc-cover-body` or `.dc-cover-strap` | Part of cover page migration |
| Credits page | Image + Credits heading + role/name list + dedication | `:::page {.credits}` + raw `<div class="credits-wrapper">` + raw `<div class="credits-section">` | New `.dc-credits` page template (see Section 4) | New component needed |
| Table of Contents | Chapter + bullet list structure in two column wrappers | `:::wrapper` (×2 for columns) | `@page .toc` + `.dc-toc` / `.dc-toc-row` | Needs migration to `.dc-toc` + `@section .two-column` for the two-column layout |
| Introduction prose | Narrative scene-setting text | Plain markdown (correct) | Plain markdown | Already correct |
| Introduction image | `cat-portrait` image | `:::wrapper {".bottom-center" data-augmented-ui=...}` | Floated image using `@section` + CSS class or `.dc-img-float-right` | Replace wrapper; remove augmented-ui dep |
| "Creaturepunk" section | Short genre manifesto text | Plain markdown | Plain markdown | Already correct |

### Chapter 01 — Character Creation

| Section | Content Type | Current Syntax | Recommended Component | Action |
|---|---|---|---|---|
| Chapter intro narrative | Long-form story prose (Lil Thump) | Plain markdown | `@lede … @end-lede` → `.dc-intro` | Optional: wrap in `@lede` for styled intro panel |
| "Citizen File" overview | Explanatory paragraph + blockquote tip | Plain markdown + `> Before You Fill Anything In:` | `> [!NOTE]` for the callout | Migrate tip to `> [!NOTE]` |
| "Image Is Everything" section | Section heading + body text | Plain markdown | `.dc-chevron` via `## Heading` in `@section` | Already correct if inside a section |
| Size definitions (Tiny/Small/Medium/Big) | Defined terms with description paragraphs | Plain markdown `#####` headings | `.dc-definition-block` | New component needed or use `@block .codex` for the group |
| "Why You Don't Play Humans" | Sidebar with title rail + subheadings + body text | `:::Sidebar: Why You Don't Play Humans` | `@sidebar-box … @end-sidebar-box` → `.dc-sidebar-box` | **Note**: two distinct sidebar components exist: `@sidebar` (`.dc-sidebar` — column float, no title rail) vs `@sidebar-box` (`.dc-sidebar-box` — framed inset with title rail). This entry has a title and subheadings → use `@sidebar-box`. |
| Specialty intro cards (8 specialties) | Compact specialty overview: name + image + 3-sentence description, shown in a card grid in ch01 | `<div class="faction-section">` (×8) | `@specialty-card … @end-specialty-card` → `.dc-specialty-card` inside `@specialty .NAME` scope | Replace each `<div>` with `@specialty .NAME` + `@specialty-card`. This is the CARD component (grid-sized, poster-header band, paper-cream substrate). Do NOT use `@specialty-intro` — that is the full-section chapter opener for chapter-02, not a summary card. See Gap 3 and naming note §6.5. |
| "Specialty Variants" section | Dual Specialist + Generalist descriptions | Plain markdown + image | `@block .panel` or `.dc-sidebar` | Optional: elevate to panel component |
| Vibe table | 4-column selection grid with blank interaction column (player circles one); used once at session zero, not referenced in play | Plain markdown table | New `.dc-vibe-table` component required (see Gap 8) | Plain table preserves structure but loses creaturepunk "item on the wall" identity. `.dc-at-a-glance-card` does NOT fit (wrong shape — 7-row multi-column grid, not a single-item card). Requires new component spec. Priority: see Gap 8 (P2 — needs spec before work can start). |
| "Origins Matter" section | Bullet list choices (where from / where stay) | Plain markdown | Plain markdown | Already correct |
| "Ideal" section | 5 named ideals, each with inline attribution quote + 3–4 prose paragraphs, no per-entry fence | `:::wrapper {.header}` | `@section .dc-ideals` + `@card` per entry | **Requires content restructure + author approval**: attribution quotes are inline paragraphs (not `>`), must be converted to `>` blockquotes; entries need individual `@card`/`@end-card` fences added. `.dc-ideals` and `.dc-card` CSS must be written first. See Gap 14. |
| "Flaw" section | 5 named flaws with inline quotes, two-column selection list | `:::wrapper {.header}` + `:::wrapper {.two-column .items}` | `@section .dc-flaws` + `@card` per entry + `@section .two-column` for selection list | **Requires content restructure + author approval**: same attribution-quote conversion as Ideals. `.dc-flaws` CSS must be written first. |
| "Dream" section | 5 named dreams using `**Bold**` titles (NOT `###`), single monolithic fence, 3–5 prose paragraphs each; "Other Dreams" blank-column table | `:::{.dream-callout}` (ONE fence around all five) | `@section .dc-dreams` + `@card` per entry | **Requires content restructure + author approval**: Dream titles are `**Bold**` not `###` — changing heading level is a content edit requiring explicit author sign-off. Each dream needs individual `@card`/`@end-card` fences. `.dc-dreams` CSS must be written first. See Gap 14. |
| Gear loadout / "Personal Items" sidebar | Sidebar box with personal items note | `:::SIDEBAR` | `@sidebar … @end-sidebar` | Migrate to `@sidebar` |
| "Quick Start Checklist" sidebar | Checklist sidebar | `:::SIDEBAR` | `@sidebar … @end-sidebar` | Migrate to `@sidebar` |
| Specialty starting abilities table | Specialty vs. starting ability list (table) | Plain markdown table | Plain markdown table | Already correct |
| Specialty starting gear table | Specialty vs. starting gear list (table) | Plain markdown table | Plain markdown table | Already correct |
| "caption" for image | Image caption div | `<div class="caption">` | Plain markdown italic below image (`*caption text*`) | Remove div; use italic caption |

### Chapter 02 — Specialties & Abilities (5218 lines, 8 specialties)

This is the most critical chapter. It contains virtually all of the game's ability content.

| Section | Content Type | Current Syntax | Recommended Component | Action |
|---|---|---|---|---|
| Chapter intro narrative (heist) | Narrative scene-setting prose | Plain markdown | `@lede … @end-lede` | Optional: wrap as lede |
| "How Abilities Work" section | Rules explanations | Plain markdown | Plain markdown | Already correct |
| "SIDEBAR: Breaking the lane" | Dual Specialist / Generalist rules box | Plain markdown bold "SIDEBAR" inline | `@sidebar … @end-sidebar` or `@block .panel` | Migrate to sidebar or panel |
| Example ability ("In and Out") | Single ability example with AP options | `::::: ability {.example}` | `@skill … @end-skill` | Migrate to `@skill` |
| Specialty scope container (×8) | Per-specialty wrapper scope providing color/accent inheritance | `:::: specialty {.class-panel}` then `:::: specialty` at each specialty heading | `@specialty .NAME … @end-specialty` | Migrate to `@specialty .augmerc` etc. |
| Specialty section opener (×8) | Full-section intro block at the start of each specialty: large heading, lore description, sub-sections, clip-path shape | `:::: wrapper {.specialty-intro}` (inside specialty scope) | `@specialty-intro … @end-specialty-intro` → `.dc-specialty-intro` | Migrate each opener block to `@specialty-intro` within its `@specialty .NAME` scope. Paper-light substrate + specialty-dark title band from the cascade. This is NOT the same as the ch01 summary card — see §6.5. |
| Learning path headers (51 total) | Path name + flavor quote + ability list | `:::: learning-path` | `@learning-path … @end-learning-path` | Migrate to `@learning-path` |
| Individual abilities (253 total) | Ability name, flavor quote, AP cost options, outcome table | `:::: ability` | `@skill … @end-skill` | Migrate to `@skill` — **requires `@skill` multi-tier spec first** (see Gap 15) |
| AP cost inline text | **0 AP**, **1 AP**, **2 AP** etc. as bold text | `**0 AP**` bold markdown | `.dc-ap` chip inline | Resolves when `@skill` migration completes; tier notation (`\| AUG1.1`) is optional for books without tier codes — do NOT add it if not present |
| Outcome tables in abilities | Roll/Outcome markdown table (20 / 11-19 / 6-10 / 2-5 / 1) | Plain markdown table | `.dc-outcome-row` rows | `@skill` macro handles outcome table rendering — migrates automatically |
| Spec Tweak description per specialty | Short narrative power description under `### Spec Tweak:` | Plain markdown (correct) | Plain markdown or `.dc-block.panel` | Acceptable as-is; optionally elevate to panel |
| Inline grapple note | Rules sidebar within Pain Compliance ability | `<div style="border:2px...">` raw HTML (line 325) | `> [!NOTE]` or `@block .panel` | Replace div with callout |
| `<ins>` underline tags | Used in "It's Personal" momentum levels and Proxy spec tweak | `<ins>text</ins>` raw HTML | Bold or custom CSS class | Replace with `**text**` or `{.dc-tag}` |
| Spec Tweak "Nanoswarm" etc. | One-paragraph tweak description per specialty | Plain markdown | Plain markdown | Already correct |

**Per-specialty ability count (approximate from grep):**
- Augmerc: ~5 learning paths × ~5 abilities = ~25 abilities
- Proxy: ~6 learning paths = ~30 abilities  
- Streetwarden: ~6 learning paths = ~30 abilities
- Gutterdruid: ~6 learning paths = ~30 abilities
- Cybersurgeon: ~6 learning paths = ~30 abilities
- Wirephreak: ~8 learning paths = ~40 abilities
- Technosorcerer: ~7 learning paths = ~35 abilities
- Etherlock: ~6 learning paths = ~30 abilities
- **Total: approximately 253 ability blocks** (confirmed by grep count)

### Chapter 03 — Core Rules

| Section | Content Type | Current Syntax | Recommended Component | Action |
|---|---|---|---|---|
| Chapter intro narrative (rooftop heist) | Narrative scene-setting prose | Plain markdown | `@lede … @end-lede` | Optional |
| "Dreams / The City / Dreamers / Dream Master" | Rules prose sections under `##` headings | Plain markdown | Plain markdown | Already correct |
| "Things You Need" numbered lists | Checklists for "what you need to play" | Plain markdown numbered lists | `.dc-steps` via `@procedure` | Optional: `@procedure` would render as styled steps |
| "How to Play" example of play | DM/player dialogue example | Plain markdown | `@block .shard` or `.dc-block.shard` for flavor | Optional upgrade |
| Image wrapper (rabbit portrait) | Decorative image with augmented-ui frame | `:::wrapper {".bottom-center" data-augmented-ui=...}` | CSS class float or `.dc-portrait` | Remove augmented-ui dep; use page-level CSS |
| Image wrapper (distances storyboard) | Inline distances diagram | `:::wrapper` | Plain markdown image or `.dc-img-float-right` | Remove wrapper |
| "ROLLING THE DIE!" rules section | Major rules section in a decorated wrapper | `:::wrapper` | `@section .rules-block` or plain markdown | Remove wrapper |
| "Dice Etiquette" sidebar | Sidebar rules box | `:::container {.sidebar .top-right}` | `@sidebar … @end-sidebar` | Migrate to `@sidebar` |
| "Table of Outcomes" | Full outcome table (20/11-19/6-10/2-5/1) | `:::container {.top-left .outcome-table}` | `@block .slate` header + `.dc-outcome-row` rows | The master outcomes table is THE player reference (scanned every session) — must have visual authority. Use `@block .slate` as the container header labeled "Table of Outcomes", then `.dc-outcome-row` rows inside. This distinguishes it from per-ability outcome sub-tables in chapter-02. See Gap 4. |
| "Distances" (In Reach / Nearby / In Range / Too Far) | Foundational 4-distance rules reference; referenced on every weapon, ability, and NPC trait | Plain markdown + `:::wrapper` | `@block .codex` for the full 4-definition section | Core rules reference consulted constantly — needs `.dc-block.codex` (reference register) for visual weight. Not just a wrapper removal — elevate to named reference card. |
| "Lucid and Surreal Rolls" table | Two-row modifier table | Plain markdown table | Plain markdown table | Already correct |
| "Deadly Scenes / HP / Injury" | Rules text | Plain markdown | Plain markdown | Already correct |
| "Abilities" section | Rules overview for how abilities work | Plain markdown | Plain markdown | Already correct |
| "Dream Economy" section | Economy rules prose | Plain markdown | Plain markdown | Already correct |
| "General Rules" subsections | Social contract + safety rules (Be Cool or Be Gone, Respect Boundaries, etc.) | Plain markdown `###` sections | `@block .slate` per rule | **Not optional** — social contract rules require authority register (`slate`), not mechanical register (`panel`) or informational (`> [!NOTE]`). Every professional TTRPG (Blades in the Dark, Mothership) gives table safety/conduct rules highest visual authority. |
| Image wrapper (Tech District) | Full-width decorative image | `:::wrapper {data-augmented-ui="tl-clip border"}` | `.dc-art-bottom` or page-scoped CSS | Remove augmented-ui dep |

### Chapter 04 — Dream Mastery + World/Cosmology

| Section | Content Type | Current Syntax | Recommended Component | Action |
|---|---|---|---|---|
| "Dream Mastery" intro | DM guidance prose | Plain markdown | Plain markdown | Already correct |
| "Core Elements" bulleted advice | Three-bullet principle list | Plain markdown | `@block .panel` | Optional upgrade |
| "Building Your Dream" | DM prep guidance with `>` quote examples | Plain markdown + `> Example:` | `> [!DM]` for DM-only examples | Optionally migrate examples to `> [!DM]` blocks |
| "DIMM CITY IS ALIVE" section header | Major section heading | Plain markdown `#` | Already correct — maps to `.dc-chevron` in section context | Already correct |
| NPC Core Stats section | Prose explanation of HP/Damage/Traits/Equipment/Cybernetics | Plain markdown | `@block .codex` for reference material | Optional upgrade |
| NPC Type: Fodder | Type description paragraph | Plain markdown + `>` blockquote | `.dc-npc-stat` | Migrate Fodder/Operator/Master type headers to `.dc-npc-stat` structure |
| NPC example: Patchhead | NPC stat block (HP, Damage, Traits, Equipment, Cybernetics) | Plain markdown `###`/`####`/`#####` prose | `.dc-npc-stat` | Migrate to `@npc-stat` or `.dc-npc-stat` block — see Section 4 |
| NPC example: Grease Monkey | Operator NPC stat block | Plain markdown `####`/`#####` prose | `.dc-npc-stat` | Same as above |
| NPC example: Undertow | Master NPC stat block | Plain markdown `####`/`######` prose | `.dc-npc-stat` | Same as above |
| Chromejaw quick example | Big-size NPC with full trait block | Plain markdown `### Quick NPC Example:` + bullet list stats + `####` entry | `.dc-npc-stat` | Same as above |
| NPC Core Stats reference table | Fodder/Operator/Master HP and Damage ratings | Plain markdown prose (not even a table) | `.dc-stat-grid` | Migrate to `.dc-stat-grid` component |
| Size Modifiers table | Tiny/Small/Medium/Big/Huge/Colossal HP modifiers | Plain markdown list | `.dc-definition-block` or `.dc-stat-grid` | Migrate to definition block or compact table |
| Traits catalog | Individual traits (Climb, Amphibious, Protection, etc.) | Plain markdown `####` entries | `@block .codex` entries or `.dc-definition-block` | Migrate to definition blocks |
| "Combat Guidelines" | Bulleted DM combat advice | Plain markdown | `@block .panel` | Optional |
| DimmC Cosmology section | Setting lore prose | Plain markdown | `> [!ORIGIN]` for key lore facts | Optional: key lore as origin callouts |
| District descriptions (The Dark, EntD, ArkD, Tech, Market) | Setting lore paragraphs per district | Plain markdown `####` | `> [!ORIGIN]` per district or `@block .shard` | Migrate to origin callouts for cross-reference visibility |
| "Time and Movement" section | Time terminology reference | `::::wrapper {.two-column .terms}` + `:::wrapper {.item}` ×multiple | `@section .two-column` + `.dc-terms` inside it | Migrate wrapper nesting to `@section .two-column` + `@section` items |
| Time terms glossary | Tick/Shortly/Bit/While/Cycle etc. defined terms | `:::wrapper {.item}` with bold term + description | `.dc-terms` or `.dc-definition-block` | Migrate to `.dc-terms` |
| Temporal Anchors | Event-based time references | Plain markdown | `> [!ORIGIN]` or `@block .shard` | Optional |
| District events (Descent, LongGleam, etc.) | Per-district festival entries | Plain markdown `#####` | `> [!ORIGIN]` callout per event | Optional upgrade |
| City-Wide Anchors | Three city-wide event entries | Plain markdown `#####` | `> [!ORIGIN]` | Optional |
| "Etherburn Contamination" | World-building lore | Plain markdown | `> [!ORIGIN]` | Optional |
| "Important Keywords" glossary | Terms: Objects, Animals, Spirits, Creatures, NPCs, Fodder, Operators, Masters | `::::wrapper {.two-column .terms}` + `:::wrapper {.item}` ×multiple | `@section .two-column` + `.dc-terms` | Same as Time terms migration above |

### Chapter 05 — Gear & Cybernetics

| Section | Content Type | Current Syntax | Recommended Component | Action |
|---|---|---|---|---|
| Useful Items grid (first block) | Six gear items in a grid: Bypass Kit, Snake Cable, Cleaner Cup, Firefly ANF, Com Tape, Dystopack | `::::wrapper {class="grid"}` + `:::aug` ×6 | `@section .dc-card-grid` + `.dc-gear-entry` per item | Migrate to gear-entry cards |
| Useful Items (second block) | BioGrip, TechMech Kit, TactMed Kit | `:::aug` ×3 (ungrouped) | `.dc-gear-entry` | Same migration |
| "Dimm City Tech" section | Header wrapper + grid with image + Bananacom entry | `::::wrapper {".header"}` + `::::wrapper {".grid"}` + `:::wrapper {.item}` | `@section .header` + gear entry | Migrate wrappers to sections |
| UniArm 100 aug entry | Augmentation description | Plain markdown `####` under prose | `.dc-gear-entry` | Migrate to gear entry |
| Lumina Holo-Implants | Aug entry in grid | `::::wrapper {".grid"}` + `:::wrapper {.item}` | `.dc-gear-entry` | Migrate |
| NeuroLocks | Aug entry (unclosed — missing close fence!) | `:::wrapper {.item}` | `.dc-gear-entry` | Migrate AND fix unclosed fence at end of this entry |
| "Tech and Cybernetics" overview | Rules prose for EP system | Plain markdown | `@block .panel` for the intro; plain markdown for rules | Optional |
| Ego Points rules | EP/SysChk table | Plain markdown + table | Plain markdown table | Already correct; optionally `.dc-stat-grid` |
| SysChk table | EP vs. Outcome vs. SysChk threshold | Plain markdown table | Plain markdown table | Already correct |
| Firearms & Blasters intro | Weapon quirk definitions (Automatic, CQC Locked, etc.) | `:::wrapper {".item"}` + plain text | `@block .codex` per quirk or `.dc-definition-block` | Migrate wrappers; use definition blocks for quirks |
| Weapons table | Dentetsu lineup with Damage/Special/DC columns | Plain markdown table | Plain markdown table | Already correct |
| Throwaway Blaster entry | Individual weapon entry with outcome table | `::::wrapper` + `:::wrapper {".item Throwaway Blaster"}` + markdown table | `.dc-gear-entry` with embedded outcome table | Migrate to gear entry |
| Dentetsu Wakizashi entry | Individual weapon entry with outcome table | `:::wrapper {".item"}` + table | `.dc-gear-entry` | Migrate |
| Dentetsu Yari entry | Individual weapon entry with outcome table | `:::wrapper {".item"}` + table | `.dc-gear-entry` | Migrate |
| Pepperbox entry | Individual weapon entry | `:::wrapper {".item"}` + table | `.dc-gear-entry` | Migrate |
| Schraphose entry | Individual weapon entry with three range tables | `:::wrapper {".item schraphose"}` + tables | `.dc-gear-entry` with range sub-tables | Migrate; range sub-tables may need `.dc-distance-tags` |
| Grenades table | Grenade lineup (Black Pill, Popstar, Gutter Snap, Ashcan) | Plain markdown table | `.dc-gear-entry` per grenade or compact plain table | Optional; plain table is acceptable |
| Black Pill entry | Grenade entry with outcome list | Plain markdown `#####` + plain prose | `.dc-gear-entry` | Optional |
| Popstar entry | Grenade entry with effect descriptions and emoji | Plain markdown `#####` + emoji markers | `.dc-gear-entry` | Migrate; remove emoji in favour of DC `.dc-tag` spans |
| Gutter Snap / Ashcan entries | Grenade entries | Plain markdown `#####` | `.dc-gear-entry` | Optional |

---

## Section 3: Component Coverage Summary

### Components Used or Needed

| Component | Used In | Status |
|---|---|---|
| `.dc-skill-card` via `@skill` | Chapter 02 (253 abilities) | NOT used — all abilities use invalid `:::: ability` syntax |
| `.dc-learning-path` via `@learning-path` | Chapter 02 (51 paths) | NOT used — all paths use invalid `:::: learning-path` |
| `.dc-specialty` via `@specialty` | Chapter 02 (8 specialties) | NOT used — all scopes use invalid `:::: specialty` |
| `.dc-specialty-intro` via `@specialty-intro` | Chapter 02 (8 specialty section openers) | NOT used — currently `:::: wrapper {.specialty-intro}` inside each specialty scope |
| `.dc-intro` via `@lede` | All chapters (intro prose) | NOT used — prose is plain markdown |
| `.dc-block.panel` via `@block .panel` | Chapters 01–05 (rules boxes) | NOT used — `@block` macro not yet implemented in paged |
| `.dc-block.slate` via `@block .slate` | Chapters 01, 02, 03 (authority blocks, spec tweaks) | NOT used |
| `.dc-block.shard` via `@block .shard` | Chapter 03 (flavor/example blocks) | NOT used |
| `.dc-block.codex` via `@block .codex` | Chapter 04–05 (glossary, traits) | NOT used |
| `.dc-card` via `@card` | Chapter 01 (ideals, flaws, dreams), specialty intro cards | NOT used — `@card` macro not yet implemented in DC plugin |
| `.dc-sidebar` via `@sidebar` | Chapters 01, 03 (3+ sidebars) | NOT used — all sidebars use `:::SIDEBAR` |
| `> [!DM]` → `.dc-dm-note` | Chapter 04 (DM guidance) | NOT used |
| `> [!ORIGIN]` → `.dc-origin-callout` | Chapter 04 (district lore) | NOT used |
| `> [!NOTE]` | Chapters 01, 03 (tips) | NOT used — blockquotes used instead |
| `.dc-npc-stat` | Chapter 04 (4 NPCs) | NOT used — plain markdown headers |
| `.dc-stat-grid` | Chapter 04 (NPC core stats) | NOT used |
| `.dc-gear-entry` | Chapter 05 (gear, weapons, augs) | NOT used — `:::aug` containers |
| `.dc-cover-page` family | Chapter 00 | NOT used — `:::container` |
| `.dc-toc` | Chapter 00 | NOT used — `:::wrapper` |
| `.dc-terms` | Chapter 04 (time/keyword glossaries) | NOT used — `:::wrapper {.item}` |
| `.dc-definition-block` | Chapters 01, 04, 05 | NOT used |
| `.dc-outcome-row` | Chapter 03 (Table of Outcomes) | NOT used — plain table |
| `.dc-at-a-glance-card` | Chapter 01 (Vibe table) | NOT used |
| `.dc-pullquote` | Nowhere | NOT used anywhere |
| `.dc-vibe-callout` | Nowhere | NOT used anywhere |
| `.dc-distance-tags` | Chapter 05 (Schraphose range) | NOT used |
| `.dc-ap` | Chapter 02 (358 AP cost instances) | NOT used — all are bold markdown `**N AP**` |
| `.dc-steps` | Chapter 03 ("Things You Need" list) | NOT used |
| `.dc-spray` | Nowhere | NOT used anywhere |
| `.dc-tape`, `.dc-sticker` | Nowhere | NOT used anywhere |
| `.dc-portrait` | Chapter 01–02 (character art) | NOT used |

**Summary:** Zero DC macro components are currently active in the field guide. The entire document uses the pre-migration container syntax and raw HTML throughout.

---

## Section 4: Gaps — Sections With No Existing Component

### Gap 1: Credits Page

**Section:** Chapter 00, lines 12–39. Credits layout: image at top, "Credits" heading, role/name pairs, special thanks list, play testers list, dedication paragraph.

**What it needs:** A structured page template with: a header image area, a two-column credits block (role label + names), and a dedication paragraph at the bottom. Currently uses raw `<div class="credits-wrapper">` / `<div class="credits-section">`.

**Recommendation:** Assemble from existing components — no net-new component required. Use `@page .credits` as the named page (requires a CSS named-page definition in `page-rules.css` — must be written), `@section .two-column` for the dual-column block, and `@block .slate` for the dedication paragraph. The header image sits naturally as a plain markdown image above the section.

**Blocked by:** `@block` implementation (P0b) — `@block .slate` requires the new paged macro. The raw `<div>` replacement can proceed without `@block` by using plain markdown for the dedication paragraph as a temporary measure.

**Priority:** P2 (blocked by `@block` P0b implementation and `@page .credits` CSS named-page definition)

---

### Gap 2: Cover Page

**Section:** Chapter 00, lines 1–10.

**What it needs:** Full-bleed cover image, overlaid title text, subtitle, genre tagline.

**Recommendation:** MODIFY to use the existing `.dc-cover-page` / `.dc-cover-layout` / `.dc-cover-bigword` / `.dc-cover-strap` family. The design guide has this component. Map: `:::container {.cover-container}` → `@page .cover` + DC cover classes; `:::container {.cover-text}` → `.dc-cover-body` with `.dc-cover-bigword` for "DIMM CITY" and `.dc-cover-strap` for "Field Guide / A Creaturepunk TTRPG".

**Priority:** P1

---

### Gap 3: Specialty Intro Cards (Chapter 01, 8 instances)

**Section:** Chapter 01, lines 211–320. Eight `<div class="faction-section">` blocks, each containing a specialty `###` heading, an image, and a 3-sentence description. These are the quick-hit specialty summaries before the full chapter-02 deep dive.

**What it needs:** Compact specialty overview card — player's first encounter with each specialty. Must read as a physical poster tacked to the wall (paper-poster register, §II), with per-specialty color identity visible at a glance.

**Recommendation:** `@specialty-card … @end-specialty-card` → **`.dc-specialty-card`** inside `@specialty .NAME` scope. This is the correct component: compact grid card, paper-cream/paper-aged substrate (per cascade), colored poster-header band, per-specialty accent from the enclosing `@specialty .NAME` scope. Each `<div class="faction-section">` becomes one `@specialty .NAME` wrapping one `@specialty-card`.

**Do NOT use `@specialty-intro` here.** `@specialty-intro` / `.dc-specialty-intro` is the **full-section chapter opener** — the large intro block at the top of each specialty's chapter in chapter-02 (with clip-path treatment, large h2 heading, sub-section content). It is the wrong scale for a compact summary card. See §6.5 naming note.

**⚠️ Note on prior incorrect advice in this document:** An earlier review pass incorrectly stated `.dc-specialty-intro` has "HUD defaults that erase per-specialty identity." This is wrong. `.dc-specialty-intro` gets per-specialty token overrides (`--paper-light` substrate, specialty-dark title band) just like `.dc-specialty-card`. The reason NOT to use it for chapter-01 is scale/format, not register.

Canonical `@specialty` slugs: `augmerc`, `proxy`, `streetwarden`, `gutterdruid`, `cybersurgeon`, `wirephreak`, `technosorcerer`, `etherlock`, `dualist`, `generalist`.

**Priority:** P1 (raw HTML must be replaced)

---

### Gap 4: The "Table of Outcomes" (Chapter 03)

**Section:** Chapter 03, lines 594–606. The master outcome table: roll 20 = Triumph (long description), 11–19 = Success, 6–10 = Tough Choice, 2–5 = Failure, 1 = Catastrophe. This is a fundamental game mechanic reference, 5 rows with substantial prose per row.

**What it needs:** A visually prominent reference table with color-coded outcome rows matching the five result tiers. Currently in a `:::container {.top-left .outcome-table}` wrapper with a plain markdown table inside.

**Recommendation:** `.dc-outcome-row` components exist for this. Outcome mapping: 20 = `.crit`, 11–19 = `.hit`, 6–10 = `.mixed`, 2–5 = `.miss`, 1 = `.fail`. The mapping doc recommends `@block .slate` as an authority wrapper + `.dc-outcome-row` rows inside. **Before implementing, verify:** `.dc-outcome-row` styles may depend on a `.dc-skill-card` parent scaffold (flex/grid container, border-left tether). If `.dc-outcome-row` elements only have standalone styles in `dc-components.css`, they can sit inside `@block .slate` directly. If they are descendant-styled from `.dc-skill-card`, a standalone `.dc-outcomes-table` wrapper component is required. Grep `dc-components.css` for `.dc-outcome-row` parent context before building.

Also consider: the Table of Outcomes prose is longer than typical ability outcome rows — verify `.dc-outcome-row` handles multi-sentence text without wrapping issues.

**Priority:** P1 (pending nesting verification)

---

### Gap 5: Stat Blocks (Chapter 04 — 4 NPCs + future use)

**Section:** Chapter 04. Four NPCs: Patchhead (Fodder), Grease Monkey (Operator), Undertow (Master), Chromejaw (Master, Big). Each has: flavor quote, HP, Damage, Type, Size, Traits (with bold names), Equipment, Cybernetics.

**What it needs:** Structured stat block with: flavor quote at top, core stats row (HP, Damage, Type, Size), traits section (bolded name + description per trait), equipment section, cybernetics section.

**Recommendation:** CREATE a generic `@stat … @end-stat` macro in `dimm-city-plugin.js`. When `.npc` attribute is present, the macro emits `<div class="dc-npc-stat">` directly (using the existing styled component). Without `.npc`, it emits `<div class="dc-stat-block">` (unstyled base, for future vehicle/location/creature entries). Do NOT emit `<div class="dc-stat-block npc">` — the existing CSS class is `.dc-npc-stat` (not `.dc-stat-block.npc`), and introducing a new class name would require new CSS rules.

**Author-facing format inside `@stat .npc`:** The actual NPC entries in chapter-04 do NOT use clean key:value pairs. Stats appear as inline prose (`2 HP-1 Damage`, `Fodder-Usually Small to Medium`) or bulleted calculations (Chromejaw has `* Hit Points: 10 (Master) + 10 (Big) = 20 HP`). Grease Monkey uses inconsistent punctuation (`HP 4-Damage: 2` — note the stray colon). Undertow has no Equipment or Cybernetics section. Chromejaw has no flavor `>` blockquote — quote-equivalent is buried in a preceding paragraph. The macro spec must define a canonical author format, and **all four NPCs will require content rewrites by the author, not just syntax migration.**

Recommended canonical format:
```
@stat .npc
#### Patchhead
> "They come in pairs. Take one out and the other gets brave."
HP: 2 | Damage: 1 | Type: Fodder | Size: Small–Medium
##### Traits
**Climb.** Can scale walls and ceilings...
##### Equipment
Combat knife (1 Damage)
@end-stat
```

**⚠️ CONTENT REWRITE REQUIRED — AUTHOR APPROVAL NEEDED** before migrating any NPC entry. Author must decide on Chromejaw's pull quote and confirm the canonical stat-line format.

**NPC tier differentiation:** Must operate across two axes: (1) tier weight (Fodder = minimal chrome; Operator = standard; Master = escalated) AND (2) per-specialty accent from the enclosing `@specialty .NAME` scope. A Master-tier gutterdruid NPC must look different from a Master-tier augmerc NPC. Tier escalation alone is insufficient — the cascade must carry specialty accent through `dc-npc-stat` as with all other DC components.

**Priority:** P2 (blocked by `@stat` macro implementation, author content rewrites, and tier differentiation spec)

---

### Gap 6: Gear Entries (Chapter 05)

**Section:** Chapter 05 throughout. ~14 named gear items (Bypass Kit, Snake Cable, TechMech Kit, TactMed Kit, BioGrip, Firefly ANF, Com Tape, Dystopack, Bananacom YellaBox, UniArm 100, Lumina Holo-Implants, NeuroLocks) plus ~8 weapons (Dentetsu lineup + Pepperbox + Schraphose + Throwaway Blaster).

**What it needs:** Two distinct templates:
1. **Equipment item**: item name, description paragraph (1–3 sentences to a paragraph).
2. **Weapon entry**: item name, flavor quote, mod tags (Automatic, Pack Fed, etc.), outcome table (Roll / Result / Damage).

**Recommendation:** `.dc-gear-entry` exists for equipment. The `:::aug` containers map to `@gear-card … @end-gear-card` (the actual macro name in the DC plugin — NOT `@gear`). For weapons, `@gear-card` with embedded `.dc-outcome-row` rows handles single-outcome-table entries. **Split into two cases:** (a) standard weapons with one outcome table (Throwaway Blaster, Wakizashi, Pepperbox) — straightforward `@gear-card` migration; (b) multi-table weapons (Schraphose has three range-tier tables: In Reach / Nearby / In Range; Yari has non-standard 6-row outcomes) — these need explicit spec for how multiple tables nest inside one `@gear-card` block before migration.

**Priority:** P1 (raw `:::aug` must be replaced); multi-table weapon entries (Schraphose, Yari) are P2 pending spec

---

### Gap 7: Time/Keywords Glossary Two-Column Layout (Chapter 04)

**Section:** Chapter 04, two glossary blocks — "Time and Movement" terms (lines 624–811) and "Important Keywords" (lines 742–811). Both use `::::wrapper {.two-column .terms}` + `:::wrapper {.item}` nesting.

**What it needs:** Two-column term list where each term is bold header + description paragraph. Items alternate between violet-tinted and plain backgrounds (using `.violet` class on some items).

**Recommendation:** RESTRUCTURE to use `@section .two-column` + individual `@section` or `@block .codex` items. The `.dc-terms` component can handle the list format. The `.violet` tint variants would need a CSS rule at the chapter scope. No new component needed — migration is purely syntax conversion.

**Priority:** P2

---

### Gap 8: Vibe Selection Table (Chapter 01)

**Section:** Chapter 01, lines 376–388. A four-column table with header row asking "When others see me, they first notice my:" — columns Appearance / Behavior / Presence / (blank). 7 rows of vibe descriptors. Players circle or write in one at session zero; the blank column is the interaction surface.

**What it needs:** A player-selection grid (not a reference table, not a data table). Used once at session zero. The blank column is a write-in field. The "item hung on the wall" principle (§II) applies — this should read as a physical selection menu, not a web table.

**Note on `.dc-at-a-glance-card`:** This component does NOT fit — it is a single-item overview card, not a 7-row multi-column selection grid. A new component is required.

**Recommendation:** NEW `.dc-vibe-table` component required. Component spec: multi-column selection grid, first column is a player-fill-in checkbox/write-in zone (dashed border), header row contains the player-facing question, creaturepunk aesthetic (stamped appearance, paper-poster register per §II). Until the component is spec'd and built, plain markdown table preserves the content correctly.

**Priority:** P2 (needs component spec before work; plain table acceptable for initial release)

---

### Gap 9: AP Cost Chips Inline in Ability Text

**Section:** Chapter 02, every ability (358 instances of `**N AP**` bold text).

**What it needs:** Visually distinct AP cost badge/chip inline with ability text. The `@skill` macro should handle these as part of its parsing — when migrating `:::: ability` blocks to `@skill`, AP costs are parsed from the ability text and rendered as `.dc-ap` chips automatically (based on DC plugin spec).

**Recommendation:** This gap resolves itself when `:::: ability` is migrated to `@skill`. No standalone action needed — track as part of the ability migration.

**Priority:** P0 (resolves with P0 ability migration)

---

### Gap 10: Weapon Mod Tags (Chapter 05)

**Section:** Chapter 05. Each weapon entry has bolded mod tags: **Automatic**, **CQC Locked**, **Hand-Loader**, etc. These appear as `MODS: **Tag**, **Tag**` in the source.

**What it needs:** Small visual tags/chips indicating weapon properties — visually distinct from body text.

**Recommendation:** `.dc-tag` inline marker exists for this. Map `**Tag**` to `[Tag]{.dc-tag}` spans, or handle them in the `.dc-gear-entry` macro if it gets a mod-tags field.

**Priority:** P3 (functional as bold text; `.dc-tag` is an enhancement)

---

### Gap 11: "Outcomes" Tables Inside Individual Abilities (Chapter 02)

**Section:** Chapter 02. Approximately 11 abilities have their own custom outcomes table (Rage Hit, The Three Shouts, Meatgrinder, etc.) using plain markdown tables with Roll / Outcome columns.

**What it needs:** The same visual treatment as the master Table of Outcomes — color-coded rows for Crit/Hit/Mixed/Miss/Fail. The `@skill` macro already handles the standard AP-cost option list; the question is whether it also handles full per-ability outcome tables.

**Recommendation:** When migrating to `@skill`, verify whether the plugin parses in-ability outcome tables and emits `.dc-outcome-row` rows automatically, or whether those tables need explicit marking. If not handled automatically, MODIFY the `@skill` macro to support an `outcomes:` block.

**Priority:** P1 (part of ability migration; outcome table must render correctly)

---

### Gap 12: Spec Tweak Entries (Chapter 02, 8 entries)

**Section:** Chapter 02. Each specialty has one `### Spec Tweak: **Name**` section — a short paragraph describing the specialty's signature passive power.

**What it needs:** A visually elevated entry distinct from normal ability cards, since the Spec Tweak is a passive racial-style ability rather than an activated ability.

**Recommendation:** `@block .slate` (authority register). This is **mandatory, not optional**. With 253 `@skill` ability cards filling chapter-02, there is no way to distinguish Spec Tweaks from regular abilities without a visual register change. `slate` (authority voice) signals "this is who you are" vs. `skill` (what you do). The visual distinction is essential for chapter scan speed — a reader locating their Spec Tweak at the table must be able to find it instantly. Requires `@block` to be implemented in paged (P0b prerequisite).

**Per-specialty register differentiation (§III):** The `@block .slate` default renders in HUD-blue-dark authority chrome. All 8 Spec Tweaks in the same chrome erases specialty identity. Add a `fg-overrides.css` rule at each specialty scope to override `--dc-block-accent` with the specialty's accent token: `.dc-specialty.augmerc .dc-block.slate { --dc-block-accent: var(--augmerc-accent); }` etc. Without this, a gutterdruid's fungal-colony Spec Tweak looks identical to an augmerc's military-hardware Spec Tweak.

**Priority:** P2 (critical for chapter-02 navigation; blocked by `@block` P0b)

---

### Gap 13: Chapter Intro Narrative Prose

**Section:** Every chapter has an opening fiction scene (0.5–1 page of narrative prose) before the rules content begins.

**What it needs:** Styled intro text block that visually signals "this is flavor, not rules."

**Recommendation:** `@lede … @end-lede` → `.dc-intro` exists for exactly this. Wrapping chapter-opening narrative in `@lede` gives it the intro panel treatment. This is low effort and high visual impact.

**Priority:** P3 (optional but recommended for polish)

---

### Gap 14: "Dream" Block in Character Creation (Chapter 01)

**Section:** Chapter 01, lines 610–654. Five named dream examples (Hack Daemon, Free Myself, Discover Origins, Execute Heist, Whisper in Shadows). Actual content shape: titles use `**Bold**` (NOT `### heading`), all five are inside ONE `:::{.dream-callout}` fence, each has 3–5 prose paragraphs, attribution quotes are inline (NOT `>` blockquotes).

**What it needs:** A mood-board style block — evocative, atmospheric, visually distinct from the surrounding rules text.

**Recommendation:** `@card` per dream entry inside `@section .dc-dreams` scope (one card per dream, NOT one wrapper). The `@section .dc-dreams > .dc-card` cascade gives each dream the "torn-away poster" register (§II), controlled entirely by CSS.

**⚠️ CONTENT REWRITE REQUIRED — AUTHOR APPROVAL NEEDED:**
- Dream titles are `**Bold**` not `###` — changing heading level is a content edit
- All five dreams must be split out of their single fence into individual `@card`/`@end-card` pairs
- Attribution quotes (currently inline prose) must be converted to `>` blockquotes
- The `.dc-dreams` CSS section class AND `.dc-card` base CSS do not yet exist — must be created before migration

These are NOT mechanical syntax migrations. Do not proceed without author sign-off on heading-level and quote structure changes.

**Blank-column table note:** The "Other Dreams" table (and "Other Ideals" / "Other Flaws" equivalents) have an intentionally empty first column — print fill-in fields. Add `<!-- print fill-in field — blank column is intentional -->` comment.

**Priority:** P2 (blocked by `@card` macro + CSS implementation AND author approval)

---

### Gap 15: `@skill` Multi-Tier Ability Format (Chapter 02)

**Section:** Chapter 02, all 253 ability entries. The actual ability format is more complex than a simple AP cost line. Examples:

- **Pain Compliance**: three separate AP-tier options (`1 AP`, `4 AP`, `3 AP`), each with multiple sub-paragraphs and nested bullet choices (Shift/Toss/Drag under `1 AP`; Break Them / Strip Them under `4 AP`)
- **It's Personal**: 600+ words with named game states (Duel State: Intact/Broken), a momentum track, multi-step escalation logic, and a grapple escape sidebar
- **Heading format**: every ability uses plain `#### Ability Name` with NO tier notation — the `| AUG1.1` format does not exist in the current source

**What it needs:** A confirmed `@skill` spec that handles: (a) multiple numbered AP-cost options as a structured list where each option can have multiple paragraphs and nested bullets; (b) optional per-ability outcome tables (Roll | Outcome format, ~11 abilities); (c) heading format without mandatory tier notation.

**Recommendation:** Before migrating a single ability, produce a written spec with at least three worked examples representing the actual complexity range:
1. **Simple** (e.g. Punishing Counter): one AP tier, one paragraph body, no sub-options
2. **Multi-tier with sub-options** (e.g. Pain Compliance): three non-sequential AP tiers, each with nested bullet choices (Shift/Toss/Drag under `1 AP`; Break Them/Strip Them under `4 AP`)
3. **State-machine body** (e.g. It's Personal): ~600 words, named game states (Duel State: Intact/Broken), momentum track with `<ins>`-tagged levels, conditional effect chains — this ability may require a macro extension or an explicit "complex ability" pattern, NOT restructuring the content

If `@skill` cannot handle type-2 or type-3, the spec — not the content — needs extending. Do NOT restructure abilities to fit an under-specified macro.

**Priority:** P0b (hard prerequisite — NO ability migration can begin without this spec and worked examples)

---

### Gap 16: Blank-Column Fill-In Tables (Chapter 01)

**Section:** Three tables in chapter-01 with an intentionally empty first column:
- "Other Ideals" (~line 503): blank left column + ideal names
- "Other Flaws" (~line 589): blank left column + flaw names  
- "Other Dreams" (~line 658): blank left column + dream names / space for player writing

**What it needs:** These are player worksheets, not data tables. The blank column is a checkbox or write-in field. A plain markdown table migration preserves the visual structure but any reader looking at the PDF without context will see a mysterious empty column with no affordance.

**Recommendation:** Add an explicit `<!-- print fill-in field -->` HTML comment before each table. Long-term, consider a `.dc-checklist` or `.dc-worksheet-table` CSS class applied via `{.dc-worksheet}` markdown-it-attrs on the table, giving the first column a checkbox border and dashed fill to signal player interaction. This is an authoring intent documentation issue more than a component gap.

**Priority:** P2

---

### Gap 17: Alert Type Verification (`> [!ORIGIN]`, `> [!DM]`, `> [!VIBE]`, `> [!GEAR]`)

**Section:** Plan-wide — multiple migration recommendations across chapters 03 and 04 rely on `> [!ORIGIN]` and `> [!DM]` alert types.

**Status by type (confirmed by code review):**

| Alert type | Status | Notes |
|---|---|---|
| `> [!ORIGIN]` | ✅ Confirmed registered | `dc-origin-callout` handler exists in plugin |
| `> [!DM]` | ✅ Confirmed registered | Single-paragraph only — see note below |
| `> [!NOTE]` | ✅ Confirmed registered | Standard GFM type |
| `> [!VIBE]` | ❓ Needs verification | Proposed in this doc; not yet confirmed in plugin |
| `> [!GEAR]` | ❓ Needs verification | Proposed in this doc; not yet confirmed in plugin |

**Note on `> [!DM]` vs `@dm-note`:** `> [!DM]` handles **single-paragraph** DM notes only. Chapter-04 DM guidance blocks run 4–10 bullet points each with nested examples — these are definitively multi-paragraph. Use `@dm-note … @end-dm-note` for all chapter-04 DM guidance sections. Every mapping row in chapter-04 that says "Optionally migrate to `> [!DM]`" should be read as "use `@dm-note … @end-dm-note`." Confirm `@dm-note` is an implemented macro before scheduling.

**Action required:** Verify `[!VIBE]` and `[!GEAR]` in `dimm-city-plugin.js` before using them in any migration. Register if missing.

**Priority:** P1 (ORIGIN and DM confirmed; VIBE/GEAR need verification before use)

---

## Section 5: Priority List

### P0 — Invalid Syntax That Breaks the Renderer

These items produce no output or corrupt output. **Split into two tracks — P0-A can start immediately; P0-B is blocked on the `@skill` spec.**

#### P0-A: Can start immediately (no prerequisites)
~509 fence lines. These macros are confirmed to exist.

1. **All `:::: learning-path` fences in chapter-02** (51 opening fences). Migrate to `@learning-path … @end-learning-path`.
1a. **All `:::: wrapper {.specialty-intro}` fences in chapter-02** (8 — one per specialty). Migrate to `@specialty-intro … @end-specialty-intro` inside the enclosing `@specialty .NAME` scope.
2. **All `:::: specialty` fences in chapter-02** (8 opening fences). Migrate to `@specialty .NAME … @end-specialty`.
3. **All `:::` fences in chapter-00** (12 lines): cover, credits, TOC wrappers, intro image.
4. **All `:::` fences in chapter-01** (16 lines): sidebars, wrappers, dream callout, two-column items.
5. **All `:::` fences in chapter-03** (16 lines): image wrappers, outcome table container, dice sidebar, rules wrapper.
6. **All `:::` fences in chapter-04** (30 lines): time glossary columns, keyword columns.
7. **All `:::` / `::::` fences in chapter-05** (53 lines): gear grid, aug blocks, weapon wrappers.

#### P0-B: Blocked on `@skill` multi-tier spec (P0b prerequisite)
~253 fence lines.

8. **All `:::: ability` fences in chapter-02** (253 opening fences + 253 closing fences). Migrate to `@skill … @end-skill`. **Cannot start until `@skill` spec with worked examples (Gap 15) is written and approved.** Migrating without a spec produces 253 incorrectly structured ability cards.

**Total: 762 fence lines. P0-A: ~509 lines, can start now. P0-B: ~253 lines, blocked.**

### P0b — Prerequisites (block P0-B; also required for parts of P1 and P2)

1. **`@block` generic container macro** (markdown-it-paged) — covers all `:::wrapper {.custom-class}` patterns with no existing DC equivalent. **Coordinated breaking change**: paged plugin + DC plugin + `dc-components.css` must ship together. See §1.1b for full spec. Blocks P0-A items 4–7 (chapters 01, 03, 04, 05 wrappers), P1 items using `@block .slate`, and P2-4 (Spec Tweaks).
2. **`@skill` multi-tier AP spec with worked examples** — three worked examples required: simple / multi-tier-with-sub-options / state-machine-body. See Gap 15. Blocks P0-B.

### P1 — Components That Exist But Aren't Being Used

These sections have valid DC components available; using them will render correctly and look professional with no new component work.

1. **Ability AP costs** (358 instances): Resolves with `@skill` migration (pending P0b spec).
2. **Ability outcome tables** (11 custom, 253 ability entries): Resolves with `@skill` migration.
3. **Learning path ability lists**: Resolves with `@learning-path` migration.
4. **Specialty scope containers** (8 + 2 variants): Resolves with `@specialty` migration — canonical slugs: `augmerc`, `proxy`, `streetwarden`, `gutterdruid`, `cybersurgeon`, `wirephreak`, `technosorcerer`, `etherlock`, **`dualist`**, **`generalist``. CSS cascade rules exist for all 10 — do not use a slug not in this list.
5. **4 NPC stat blocks** (Patchhead, Grease Monkey, Undertow, Chromejaw): Migrate to `@stat .npc` once macro is built (see P2-2). Tier differentiation spec also required.
6. **~14 gear entries + standard weapon entries** in chapter-05: Migrate to `@gear-card … @end-gear-card` (the actual macro name — NOT `@gear`).
7. **3 SIDEBAR blocks** in chapters 01 and 03: Migrate to `@sidebar … @end-sidebar`.
8. **Cover page** (chapter-00): Migrate to `.dc-cover-page` family.
9. **TOC** (chapter-00): Migrate to `.dc-toc` + `@section .two-column`.
10. **Table of Outcomes** (chapter-03): Migrate to `@block .slate` header + `.dc-outcome-row` rows (authority wrapper required to distinguish from per-ability outcome sub-tables).
11. **Raw HTML** (12 instances): Replace `<div class="faction-section">` → `.dc-specialty-card` in `@specialty` scope; `<div class="caption">` → italic markdown; `<div style="...">` → `> [!NOTE]`; `<ins>` → bold.
12. **"Why You Don't Play Humans"** sidebar (chapter-01): Migrate to `@sidebar`.
13. **District lore paragraphs** (chapter-04): Multi-paragraph district descriptions → `@block .shard` (atmosphere register). Single-sentence world-facts inline → `> [!ORIGIN]` (confirmed registered ✅). Do NOT use `> [!ORIGIN]` for multi-paragraph lore — it only handles one paragraph.
14. **Credits page** (chapter-00)**: ~~P1~~ → moved to P2 (blocked by `@block` P0b and `@page .credits` CSS definition needed — see Gap 1).
15. **Specialty intro cards** (chapter-01, 8 instances): Migrate `<div class="faction-section">` to `@specialty-card … @end-specialty-card` inside `@specialty .NAME` scope. Use `.dc-specialty-card` (compact card, grid-sized). Do NOT use `@specialty-intro` — that component is for the ch02 full-section opener, not summary cards. See Gap 3 and §6.5 naming note.
16. **Ideals and Flaws** (chapter-01, 5+5 entries): `@card` inside `@section .dc-ideals` / `@section .dc-flaws`. **⚠️ Blocked by: P2-5 (`@card` macro), `.dc-ideals`/`.dc-flaws` CSS creation, AND author approval for content restructure** (inline quotes → `>` blockquotes; individual fences per entry).
17. **Vibe table** (chapter-01): New `.dc-vibe-table` component required — `.dc-at-a-glance-card` does NOT fit this shape. Moved to P2 (see Gap 8).
18. **General Rules** (chapter-03, social contract sections): Migrate to `@block .slate`. Add chapter-scoped token override in `fg-overrides.css` to shift title-bar from HUD-blue-dark → `--ink-dark`/`--rust` (avoid "clean corporate manual" §IX anti-pattern). Blocked by `@block` P0b.
19. **Distances reference** (chapter-03): Migrate wrapper; elevate to `@block .codex`. Consider paper-poster variant token (`--paper-cream` body, ruled heading) rather than HUD-blue-dark default. Blocked by `@block` P0b.

### P2 — New Macros and Specs Required

1. **`@block` generic container macro** (markdown-it-paged) — also listed as P0b prerequisite. Move `@block` from DC plugin to paged core; deprecate `variant=` attribute system; update `dc-components.css` selectors (`.dc-block.panel` not `.dc-block.dc-panel`).
2. **`@stat .npc` macro** (DC plugin) — generic stat wrapper, `.npc` emits `.dc-npc-stat`; with tier differentiation spec (Fodder/Operator/Master visual weight). See Gap 5.
3. **`@skill` multi-tier spec** — also listed as P0b prerequisite.
4. **Spec Tweak entries** (chapter-02, 8): **Mandatory** `@block .slate` — not optional. Required to distinguish passive powers from `@skill` ability cards in 253-ability chapter. Requires `@block` in paged (P0b).
5. **`@card` macro + CSS** (DC plugin) — new macro required for Ideals, Flaws, Dreams, and specialty intro cards. Three deliverables: (a) `@card`/`@end-card` handler in `dimm-city-plugin.js` emitting `<div class="dc-card">`; (b) `.dc-card` base CSS in `dc-components.css` (paper-poster register defaults); (c) cascade override rules: `.dc-ideals > .dc-card`, `.dc-flaws > .dc-card`, `.dc-dreams > .dc-card`, `.dc-specialty.augmerc .dc-card` etc. All three must land before P1-15 and P1-16 can complete. `.dc-flaws`, `.dc-ideals`, `.dc-dreams` section classes also need CSS rules.
6. **Dream examples** (chapter-01): `@card` per entry inside `@section .dc-dreams` — same pattern as Ideals/Flaws. Straightforward once `@card` macro is implemented.
7. **Time/Keywords glossaries** (chapter-04): `@section .two-column` + `.dc-terms`; verify `.dc-terms` renders term+description pairs correctly; add CSS for `.violet` tint variant at chapter scope.
8. **Multi-table weapon entries** (chapter-05 — Schraphose, Yari): Define how multiple outcome tables nest inside one `@gear-card` block.
9. **Blank-column fill-in tables** ("Other Ideals", "Other Flaws", "Other Dreams" — chapter-01): Add authorial intent note or `<!-- fill-in-field -->` comment; these are print form elements, not data tables.
10. **Quick Start Checklist** (chapter-01): `@sidebar` migration is syntactically correct but visual register (inset/small text) may not serve player-facing form content — flag for layout review.
11. **Weapon mod tags** (chapter-05): Define whether `@gear-card` handles mod tags as a structured field, or author uses `{.dc-tag}` inline spans.

### P3 — Polish (Plain Markdown Acceptable For Now)

1. **Chapter intro narratives** (all 6 chapters): Wrap in `@lede` for styled intro panel.
2. **DM guidance examples** (chapter-04): All chapter-04 DM guidance runs 4–10 bullet points — use `@dm-note … @end-dm-note` (multi-paragraph). `> [!DM]` is single-paragraph only; do NOT use it for the long guidance blocks. Verify `@dm-note` is an implemented macro before migration.
3. **AP cost chips** (chapter-02): Resolves automatically with `@skill` migration.
4. **Emoji in chapter-05**: Replace ⚠️ ☀️ 🔊 💥 🔥 with text or `.dc-tag` markers for PDF safety.
5. **`data-augmented-ui` attributes** (chapters 00, 03): Decision needed — integrate augmented-ui library or replace with DC macro/CSS equivalents.
6. **Spec Tweak "Scope" sections** (Wirephreak, Technosorcerer): Short scope-definition blocks before each specialty's opening — consider `@block .panel` to frame the specialty's gear/power scope before abilities begin.

---

---

## Section 6: Reverse Coverage — Design Guide Components with No Field Guide Home

Sections 1–5 document what the field guide needs from the design guide. This section is the inverse: design guide components with no natural authoring home in the field guide.

### 6.1 Design-Guide-Only (specimen scaffolds)

Built to showcase the component library. Should not appear in field guide source.

| Component | Why it stays in the design guide |
|---|---|
| `.section.dc-fiction-excerpt` | Specimen wrapper for styled fiction samples within the design guide; field guide opening prose uses `@lede` / `.dc-intro` |
| `.section.dc-rules-definition` | Documentation scaffold for demonstrating definition block rendering; field guide uses `@block .codex` / `.dc-definition-block` directly |

---

### 6.2 Flagged for Removal

These components have no field guide home, no registered macro trigger, and no plausible future use. **Do not use in the field guide.** Flag for CSS cleanup in a future design-guide maintenance pass (grep all markdown sources to confirm zero consumers before removing).

| Component | Reason for removal |
|---|---|
| `.dc-visit-callout` | No `> [!VISIT]` macro trigger exists; no field guide content type maps to "visit." Stale CSS with no active path to emit it. |
| `.dc-human-callout` | Listed in the reference doc callout group but no `> [!HUMAN]` trigger is registered anywhere. Active status unknown; no field guide content needs it. |
| `.dc-classtag` | Specialty identity dot-badges. The `@specialty .NAME` cascade delivers specialty accent to all components — standalone dot-badge class indicators are redundant and have no authoring surface in the field guide. |
| `.dc-citizen-walkthrough.two-column` | Design-guide-only filled citizen form example. The field guide has no equivalent fill-in form page and no plans to add one. |

---

### 6.3 Keep — Active Development (macro needed)

These components exist and have a clear field guide use; they just need a macro to be authored conveniently.

| Component | Field guide use | Required work |
|---|---|---|
| `.dc-roll-lucid` / `.dc-roll-surreal` | Chapter-03 lucid/surreal rules; chapter-02 ability outcomes that specify lucid or surreal dice. These components belong inline in running text — not just in a reference table. | Create a `@roll` macro (or `@roll .lucid` / `@roll .surreal` variant) similar to `@page-break` — a single-line inline marker that emits the correct `.dc-roll-lucid` or `.dc-roll-surreal` chip. No new CSS needed; the component exists. |

---

### 6.4 Potential Use (future content)

No current field guide content maps to these, but plausible expansion content exists. Retain.

| Component | Future content type |
|---|---|
| `.dc-spec-tweak` | If `@skill` migration converges on a dedicated spec-tweak element rather than `@block .slate`, this becomes the correct hook. Needs documentation in reference doc — current intent vs. `@block .slate` is unclear. |
| `.dc-prose-panel` | Floating prose panel for setting fiction interspersed with rules. Could serve expansion chapters. |
| `.dc-arrow` | Inline directional cross-reference marker. Future indexes or multi-page ability cross-references. |
| `.dc-sticker` / `.dc-sticker-ref` / `.dc-stickers` | Chapter-tab badge identity. Future expansions with chapter-specific badge design. |
| `.dc-tape` | Adhesive tape decoration. Handout-style insert pages in future supplements. |
| `.dc-at-a-glance-card` | Single-item overview card. No current field guide content fits this shape, but faction sourcebooks or NPC dossiers could use it. |

---

### 6.5 Superseded (old syntax only)

The field guide must NOT use these; the new syntax supersedes them.

| Component | Use instead |
|---|---|
| `.dc-block.dc-panel` / `.dc-block.dc-slate` / `.dc-block.dc-shard` / `.dc-block.dc-codex` (old `variant=` form) | Superseded by `.dc-block.panel` / `.dc-block.slate` / `.dc-block.shard` / `.dc-block.codex` pending the coordinated `@block` migration (§1.1b). CSS still uses old selectors until that ships. |

---

### 6.6 Naming Confusion — `@specialty-intro` vs `@specialty-card`

**⚠️ These two components are easily confused. Prior analysis in this document (and agent review passes) incorrectly claimed `.dc-specialty-intro` was wrong for the field guide due to "HUD register defaults." That was factually wrong.**

Both components are valid for the field guide and both use per-specialty token overrides (paper-poster register within `@specialty .NAME` cascade). The distinction is **scale and context, not register**:

| Component | Macro | Scale | Field guide context |
|---|---|---|---|
| `.dc-specialty-intro` | `@specialty-intro … @end-specialty-intro` | Full section opener — large h2 heading, clip-path shape, sub-sections, lore description | Chapter-02: the opening block at the TOP of each specialty's section before learning paths begin |
| `.dc-specialty-card` | `@specialty-card … @end-specialty-card` | Compact card for grids — poster-header band, paper-cream body, portrait image | Chapter-01: the brief overview card grid showing all 8 specialties at a glance |

**Both are paper-poster register** within their specialty scope. `.dc-specialty-intro` gets `--paper-light` substrate and `specialty-dark` title band from the cascade — NOT HUD defaults. The "HUD defaults erase per-specialty identity" claim was an error introduced by a review agent that confused the unscoped default token values with the actual in-use cascade values.

**Rename suggestion:** The names are genuinely confusing — both sound like "the intro to a specialty." Consider future rename to something like:
- `@specialty-header` / `.dc-specialty-header` (chapter-02 section opener)
- `@specialty-card` / `.dc-specialty-card` (chapter-01 overview card — keep as-is)

This is non-breaking documentation work; the CSS classes and plugin macros don't need to change immediately.

---

### 6.7 Undocumented CSS Classes

Defined in `dc-components.css` but absent from `components-and-palette-reference.md`.

| Class | Status | Action |
|---|---|---|
| `.dc-visit-callout` | Flagged for removal (§6.2) | Grep all sources; remove if zero consumers |
| `.dc-human-callout` | Flagged for removal (§6.2) | Confirm no `[!HUMAN]` trigger; remove CSS if confirmed unused |
| `.dc-spec-tweak` | Undocumented, retained (§6.4) | Document its intent vs. `@block .slate` in reference doc |
| `.section.dc-fiction-excerpt` | Design-guide specimen scaffold | Document as design-guide-only in reference doc |
| `.section.dc-rules-definition` | Design-guide specimen scaffold | Document as design-guide-only in reference doc |
| `.dc-outcome-name` | Sub-element of outcome row; not in reference doc sub-element list | Verify if alias or stale variant of `.dc-outcome-key`; document or remove |

---

## Appendix: Quick Migration Reference

```
CHAPTER 02 — Ability block:
OLD:
:::: ability
#### Ability Name
> Flavor quote
**0 AP** Description
::::

NEW:
@skill
#### Ability Name
> Flavor quote
**0 AP** Description
@end-skill

NOTE: Tier notation (| AUG1.1) is OPTIONAL — do not add it if the
content doesn't use tier codes. When used, format is | AUG1.1 (not T1.1).
The prefix (AUG, PRX, etc.) derives from the enclosing @specialty scope.
Confirm @skill multi-tier spec (Gap 15) before migrating any ability.

---
CHAPTER 02 — Learning path:
OLD:
:::: learning-path
### Path Name
> Quote
- Ability One
- Ability Two
::::

NEW:
@learning-path
### Path Name
> Quote
- Ability One
- Ability Two
@end-learning-path

---
CHAPTER 02 — Specialty scope:
OLD:
:::: specialty
## Specialty Name
...content...
::::

NEW (use exact slug from this list — all 10 have CSS cascade rules):
@specialty .augmerc      (or .proxy / .streetwarden / .gutterdruid /
## Specialty Name         .cybersurgeon / .wirephreak / .technosorcerer / .etherlock /
...content...             .dualist / .generalist)
@end-specialty

NOTE: @specialty .augmerc emits TWO separate classes: "dc-specialty augmerc"
(not one hyphenated class). The CSS selector .dc-specialty.augmerc matches
this correctly. Authors write @specialty .augmerc — not @specialty augmerc.

---
CHAPTERS 01, 03 — Sidebar:
OLD:
:::SIDEBAR
content
:::

NEW (choose the right variant):
@sidebar            ← column float, NO title rail (.dc-sidebar)
content
@end-sidebar

@sidebar-box        ← framed inset WITH title rail (.dc-sidebar-box)
### Title
content
@end-sidebar-box

---
CHAPTER 04 — Two-column terms:
OLD:
:::: wrapper {.two-column .terms}
::: wrapper {.item}
**Term:** Definition
:::
::::

NEW:
@section .two-column
**Term:** Definition
@end-section

---
CHAPTER 05 — Gear entry (equipment):
OLD:
::: aug
#### Item Name
Description
:::

NEW:
@gear-card
#### Item Name
Description
@end-gear-card

NOTE: The macro is @gear-card / @end-gear-card — NOT @gear / @end-gear.

---
ANY CHAPTER — Generic class wrapper (no existing DC macro):
OLD:
::: wrapper {".bottom-center"}
content
:::

NEW:
@block .bottom-center
content
@end-block

NOTE: @block moves from the DC plugin to markdown-it-paged (general-purpose,
available to all projects). The DC plugin's @block variant=X handlers are
deprecated. Use class names directly: @block .panel / @block .slate / etc.
CSS selectors in dc-components.css updated to .dc-block.panel (not .dc-block.dc-panel).

---
IDEALS / FLAWS / DREAMS — Authored-choice cards (@card macro, DC plugin):
OLD:
::: wrapper {.header}
### Megalomaniac
> "The city doesn't deserve me..."
:::

NEW:
@section .dc-flaws
@card
### Megalomaniac
> "The city doesn't deserve me..."
@end-card
@end-section

NOTE: @card is a new DC plugin macro. Appearance driven by parent section
class via cascade: .dc-flaws > .dc-card { … }, .dc-ideals > .dc-card { … }
```

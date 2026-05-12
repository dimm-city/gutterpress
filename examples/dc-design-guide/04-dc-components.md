@chapter #ch-dc-components .dc-components .chapter-01 ch="1"

# DC Component Library

::: wrapper {.dc-intro}
Dimm City-specific components. Ability cards, banners, stat blocks, AP chips, tags, and path chains — the chrome that makes the Field Guide look like Dimm City.
:::

---

## Banners & Headers

### Chevron Banner

The primary H1 opener for chapter and specialty pages. Renders with the DC chevron accent treatment. Use once per chapter, at the very top, in place of a plain `# Heading`.

**Syntax** — `# Title {.dc-chevron}`

```
# Augmerc {.dc-chevron}
```

---

### Spray Banner

H2 section opener for learning paths and major topic breaks. The spray treatment sets the heading apart from generic H2s and signals a structural shift in the content.

**Syntax** — `## Title {.dc-spray}`

```
## Biting Distance {.dc-spray}
```

---

### Spec Tweak Rule

H3 heading for optional mechanics and variant rules. The `.no-top` modifier removes the default top margin so the rule sits flush beneath whatever element precedes it.

**Syntax** — `### Title {.dc-spec-tweak .no-top}`

```
### Spec Tweak: Wired to Kill {.dc-spec-tweak .no-top}
```

---

## Ability Cards

The `@skill` macro generates the full card HTML automatically. Use `variant="1"` through `variant="5"` to select clip-path shapes. The next `@skill` or `@end-skill` closes the current card — no closing marker is needed between consecutive cards.

**Macro syntax** — H4 for the title, blockquote for flavor, ordered list for abilities, optional H5 for sub-header:

```
@skill variant="1"
#### Ability Title
> Flavor line.
1. **0 AP** *Action Name:* Effect description.
2. **2 AP** *Action Name:* Effect description.
##### Sub-header text
@end-skill
```

**Tier badge** — When used inside a `@learning-path`, the tab tier (`AUG1.1`, `AUG1.2`, …) is auto-generated from the path context. For standalone cards or a custom label, append ` | Badge` to the H4: `#### Ability Title | AUG1.1`.

**Optional attributes** — `id="slug"` sets the card's `name` attribute for anchor links. `{.allow-split}` permits Paged.js to split a tall card across a page break (prefer `@continue` instead for long abilities).

---

### Skill Card Continuation

When an ability description is too long to fit on one card, use `@continue` inside the active `@skill` block. It closes the current card and opens a new continuation card with the same variant shape. The continuation card's tab displays the original title followed by `▸` to signal it carries over from the preceding card. Prefer `@continue` over `.allow-split` — it gives the overflow content its own proper tab and frame rather than letting the card split mid-body across a page boundary.

`@continue` must appear between `@skill` and `@end-skill`. No closing marker is needed for the continuation itself — the next `@skill`, `@end-skill`, or end of file closes it automatically.

**Syntax** — place `@continue` anywhere inside an active `@skill` block:

```
@skill variant="3"
#### Deep Scan | AUG2.4
> Every system has a back door. Yours is already open.
1. **0 AP** *Passive Sweep:* Detect all networked devices within Near range at scene start.
2. **2 AP** *Root Access:* Read all signals on one target device until your next turn.
@continue
3. **3 AP** *Kill Switch:* Shut down one networked device in Near range.
4. **VAR AP** *Cascade Wipe:* Extend Kill Switch across a chain of linked targets (2 AP per device).
##### Every door has a hinge. You are the hinge.
@end-skill
```

The continuation tab renders as **"Deep Scan ▸"** — the original title with the `▸` suffix appended automatically. Both cards use the same variant clip-path so the pair reads as a matched set.

---

### AP Chip Variants

AP chips appear inline inside ability blocks. Three variants signal cost type at a glance:

**Syntax** — inline HTML span inside `@skill` ability text

```html
<span class="dc-ap free">0 AP</span>
<span class="dc-ap">2 AP</span>
<span class="dc-ap var">VAR</span>
```

- `free` — Free action (crimson fill)
- *(no modifier)* — Standard cost (HUD green)
- `var` — Variable cost (magenta fill)

---

### At-a-Glance Cards

Quick stat grid for character sheets, specialty summaries, and creature previews. Each card holds one label and one value.

**Syntax** — raw HTML

```html
<div class="at-a-glance-cards">
  <div class="at-a-glance-card"><h4>HP</h4><p>14</p></div>
  <div class="at-a-glance-card"><h4>Speed</h4><p>Near</p></div>
  <div class="at-a-glance-card"><h4>Edge</h4><p>+2</p></div>
</div>
```

---

## Tags & Chips

### Class Tag

Inline pill for specialty names and cost labels. Renders with a pill border in the accent color.

**Syntax** — `<span class="tag">Label</span>`

```html
<span class="tag">Augmerc</span>
```

---

### DC Path Sticker

Badge code displayed inside learning-path spray headers. Identifies the path index (e.g., `AUG1`, `AUG2`) so readers can navigate multi-path specialties at a glance.

**Syntax** — `<span class="dc-path-sticker">AUG1</span>`

```html
<span class="dc-path-sticker">AUG1</span>
```

---

### Tape Divider

Full-width tape strip that separates major sections within a specialty or chapter. The `.flush` modifier removes any margin so the tape bleeds edge-to-edge in the content column.

**Syntax** — `<div class="dc-tape flush">Label</div>`

```html
<div class="dc-tape flush">Section Break</div>
```

---

## Stat Blocks

### Creature Stat Block

Full creature entry: name, archetype line, stat grid (HP / DEF / AP / DMG), and a list of named abilities. Add `.flush` to remove the default side margins for bleed-edge placement.

**Syntax** — raw HTML

```html
<div class="dc-stat flush">
  <div class="dc-stat-head">
    <div class="dc-stat-name">Wirewolf, Pack-Beta</div>
    <div class="dc-stat-class">— Threat · Hunter —</div>
  </div>
  <div class="dc-stat-grid">
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">HP</div><div class="dc-stat-cell-val">22</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DEF</div><div class="dc-stat-cell-val">14</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">AP</div><div class="dc-stat-cell-val">3</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">DMG</div><div class="dc-stat-cell-val">d20</div></div>
  </div>
  <div class="dc-stat-line"><strong>Bite:</strong> Melee, basic. On a hit, drag target 1 square toward the pack.</div>
  <div class="dc-stat-line"><strong>Pack Tactic:</strong> While 2+ wirewolves are in reach, all gain advantage on bite rolls.</div>
  <div class="dc-stat-line"><strong>Falter:</strong> When below half HP, howls. Every wirewolf within 6 squares gains 1 AP.</div>
</div>
```

---

### NPC Stat Block

Same structure as the creature block. Social-facing NPCs swap combat stats for social stats: REP (reputation floor), HEAT (threat threshold), FEE (base price), and TURN (disposition shift on failed roll).

**Syntax** — raw HTML

```html
<div class="dc-stat flush">
  <div class="dc-stat-head">
    <div class="dc-stat-name">Doc Solenn</div>
    <div class="dc-stat-class">— Contact · Fixer —</div>
  </div>
  <div class="dc-stat-grid">
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">REP</div><div class="dc-stat-cell-val">4</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">HEAT</div><div class="dc-stat-cell-val">2</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">FEE</div><div class="dc-stat-cell-val">×1.5</div></div>
    <div class="dc-stat-cell"><div class="dc-stat-cell-key">TURN</div><div class="dc-stat-cell-val">−1</div></div>
  </div>
  <div class="dc-stat-line"><strong>Patch Job:</strong> Treat wounds between scenes. Costs FEE × severity. No questions asked.</div>
  <div class="dc-stat-line"><strong>Under the Counter:</strong> Carries one random augmentation part per session. Price doubles if HEAT is active.</div>
  <div class="dc-stat-line"><strong>Cold Shoulder:</strong> If HEAT fires, Solenn goes dark for one full session before contacts can reach her again.</div>
</div>
```

---

## Learning Path

A learning path wraps a set of skill cards under a named spray banner with a sticker chain and flavor line. Use `@learning-path` after `@specialty {.classname}` — the path index and specialty code (e.g., `AUG1`) are auto-computed from context. No attributes required.

**Macro syntax:**

```
@specialty {.augmerc}

@learning-path
### Path Title
> Path flavor line.
- Skill A
- Skill B
- Skill C

Description text about the path's signature augment or theme.

@skill variant="1"
#### Skill Name
> Skill flavor.
1. **0 AP** *Action Name:* Effect description.
2. **2 AP** *Action Name:* Effect description.
##### Sub-header text

@skill variant="2"
#### Next Skill Name
> Flavor.
1. **1 AP** *Action:* Description.
@end-skill

@end-learning-path
```

The tier badge on each card tab (`AUG1.1`, `AUG1.2`, …) is generated automatically from the specialty code and skill sequence. Use `#### Skill Name | Custom` only when overriding the auto-generated badge.

---

## Stickers & Path Chains

Slightly skewed paper labels connected by orange chevron arrows. The active step renders in crimson with a harder rotation and drop shadow — no fade, instant state flip.

### Path Step Chain

A horizontal chain of skill-name stickers showing progression order within a learning path. Auto-generated by `@learning-path` from a bullet list; the first sticker automatically receives `.active`. Never author this HTML manually inside chapter content.

**Syntax** — auto-generated by `@learning-path`; or raw HTML `<div class="dc-stickers flush">` with `<span class="dc-sticker">` and `<span class="dc-arrow">»</span>` separators

```html
<div class="dc-stickers flush">
  <span class="dc-sticker active">Punishing Counter</span>
  <span class="dc-arrow">»</span>
  <span class="dc-sticker">Rage Hit</span>
  <span class="dc-arrow">»</span>
  <span class="dc-sticker">Dirty Work</span>
  <span class="dc-arrow">»</span>
  <span class="dc-sticker">Pain Compliance</span>
  <span class="dc-arrow">»</span>
  <span class="dc-sticker">It's Personal</span>
</div>
```

---

### Path Subtitle

A secondary label rendered below the sticker chain, naming the path and its choice structure. Auto-generated by `@learning-path` from the `> blockquote` line inside the block; can be authored manually for standalone use.

**Syntax** — auto-generated by `@learning-path`; or raw HTML `<div class="dc-path-subtitle flush">text</div>`

```html
<div class="dc-path-subtitle flush">— Path · Choose your specialty —</div>
```

---

### Sub-header Sticker

A mono-cap label at the bottom of a skill card summarizing the stance, trigger, or cost type. Auto-generated by `@skill`/`@end-skill` from the final `type | AP cost` line; can also be authored directly inside a `.card-inner` body.

**Syntax** — auto-generated by `@skill`/`@end-skill`; or raw HTML `<div class="dc-sub-header flush">text</div>`

```html
<div class="dc-sub-header flush">Stance · Free counter · Once per round</div>
```

---

## Stamps

Rotated monospaced label chips used to mark content status — draft, deprecated, classified, or Dream Master-only. Use `.classified` for the orange-border variant that signals restricted or spoiler content.

**Syntax** — raw HTML `<span class="dc-stamp">TEXT</span>`; add `.classified` for the orange-border variant

```html
<span class="dc-stamp">DREAM MASTER</span>
<span class="dc-stamp classified">PRE-RELEASE</span>
```

---

## Clip-Path Card Variants (v1–v5)

Five clip-path shapes for the card tab and body corners. Set `variant="N"` on the `@skill` macro to choose, or apply class `v1`–`v5` directly to `.dc-card-tab` and `.dc-card-body` in raw HTML. Variant 1 is the default right-diagonal; variants 2–5 offer progressively distinct tech silhouettes.

**Syntax** — `variant="N"` on `@skill` macro; or add class `v1`–`v5` to `.dc-card-tab` and `.dc-card-body`

```html
<div class="dc-skill-card">
  <div class="dc-card-tab v1">…</div>
  <div class="dc-card-body v1">…</div>
</div>
```

| Variant | Shape |
|---------|-------|
| `v1` | Default right-diagonal tab, bottom-right notch body |
| `v2` | Sharp angular — diagonal cuts on all four tab corners and both body bottom corners |
| `v3` | Asymmetric tech — top-left step on tab, large single diagonal on body |
| `v4` | Soft angular — shallow corner cuts, more restrained than v1/v2 |
| `v5` | Scooped futuristic — center notch on tab top, pinched bottom corners on body |

---

## Card Layout Modifiers

Three modifier classes control how `.dc-skill-card` elements pack on a page when used inside a learning path or ability catalog section.

| Modifier | Width | Layout |
|----------|-------|--------|
| `.columns` | 3.5 in | Two cards per visual row (default for specialty sections) |
| `.dense` | 3.5 in | Synonym for `.columns` — use for tighter packs |
| `.rows` | Full column width | One card per row, stacked vertically |

**Syntax** — apply to the `.dc-specialty` wrapper or any parent container:

```markdown
@specialty specialty="augmerc"
### Augmerc Abilities
@end-specialty
```

Or in raw HTML as a modifier on a container:

```html
<div class="dc-specialty augmerc columns">
  <!-- skill cards pack 2-per-row -->
</div>
```

---

## Chapter Opener Number

A badge element rendered in the top-left corner of specialty chapter opener pages. Displays the chapter/specialty code (e.g., `AUG1`, `C.02`) in the DC mono font with an accent border.

**Syntax** — raw HTML (typically generated by the `@specialty` macro):

```html
<div class="dc-chapter-opener-no">AUG1</div>
```

**Macro shorthand** — the `@chapter-opener C.N` macro emits this badge automatically:

```markdown
@chapter-opener C.02
```

**Slug values by specialty:**

| Specialty | Slug |
|---|---|
| Augmerc | `AUG1` |
| Proxy | `PRX1` |
| Streetwarden | `SWD1` |
| Gutterdruid | `GDR1` |
| Cybersurgeon | `CYB1` |
| Wirephreak | `WPK1` |
| Technosorcerer | `TCS1` |
| Etherlock | `ETH1` |
| Non-specialty chapters | `C.01`, `C.02`, etc. |

**CSS class:** `.dc-chapter-opener-no` — no prefix variants; this is always DC-specific.

---

## Component Authoring Quick Reference

| Component | Authoring method | CSS class(es) |
|---|---|---|
| Chevron Banner | `# Title {.dc-chevron}` | `dc-chevron` |
| Spray Banner | `## Title {.dc-spray}` | `dc-spray` |
| Spec Tweak Rule | `### Title {.dc-spec-tweak .no-top}` | `dc-spec-tweak`, `no-top` |
| Skill Card (outer) | `@skill … @end-skill` macro | `dc-skill-card` |
| Skill Card Continuation | `@continue` inside `@skill` block | `dc-skill-card dc-skill-card-cont` |
| Card Tab | Generated by macro | `dc-card-tab` |
| Tab Title | Generated by macro | `dc-tab-title` |
| Tab Tier | Generated by macro | `dc-tab-tier` |
| Flavor Text | Generated by macro | `dc-flavor` |
| Ability Row | Generated by macro | `dc-ability` |
| AP Chip — Free | `<span class="dc-ap free">` | `dc-ap free` |
| AP Chip — Standard | `<span class="dc-ap">` | `dc-ap` |
| AP Chip — Variable | `<span class="dc-ap var">` | `dc-ap var` |
| At-a-Glance Cards | Raw HTML | `at-a-glance-cards`, `at-a-glance-card` |
| Class Tag | `<span class="tag">Label</span>` | `tag` |
| DC Path Sticker | `<span class="dc-path-sticker">AUG1</span>` | `dc-path-sticker` |
| Tape Divider | `<div class="dc-tape flush">Label</div>` | `dc-tape`, `flush` |
| Creature Stat Block | Raw HTML | `dc-stat`, `dc-stat-head`, `dc-stat-grid`, `dc-stat-cell` |
| NPC Stat Block | Raw HTML (social stats) | `dc-stat`, `dc-stat-head`, `dc-stat-grid`, `dc-stat-cell` |
| Learning Path | `@learning-path … @end-learning-path` macro | `dc-learning-path`, `dc-path-block`, `dc-path-shell` |
| Path Step Chain | auto via `@learning-path`; raw HTML fallback | `dc-stickers`, `dc-sticker`, `dc-sticker.active`, `dc-arrow` |
| Path Subtitle | auto via `@learning-path`; raw HTML fallback | `dc-path-subtitle`, `flush` |
| Sub-header Sticker | auto via `@skill`; raw HTML fallback | `dc-sub-header`, `flush` |
| Stamp — Default | `<span class="dc-stamp">TEXT</span>` | `dc-stamp` |
| Stamp — Classified | `<span class="dc-stamp classified">TEXT</span>` | `dc-stamp`, `classified` |
| Clip-Path v1–v5 | `variant="1"` through `variant="5"` on `@skill` | `dc-card-tab v1`–`v5`, `dc-card-body v1`–`v5` |
| `.columns` / `.dense` / `.rows` | modifier class on specialty wrapper | `columns`, `dense`, `rows` |
| `.dc-chapter-opener-no` | Raw HTML | `dc-chapter-opener-no` |

---

## See It In Action

These examples show the above components rendered in real book pages using actual Dimm City Field Guide content.

- [Specialty Overview](#ch-example-specialty-overview) — chevron banners, class tags, and specialty listing cards
- [Specialty Profile](#ch-example-specialty-profile) — full learning path: spray banner, sticker chain, skill cards with AP chips and clip-path variants
- [Dream Master Pages](#ch-example-dm) — creature and NPC stat blocks, DM stamps, encounter hooks
- [Gear & Tech](#ch-example-gear) — aug cards, weapon tables, classified stamps, cybernetics entries

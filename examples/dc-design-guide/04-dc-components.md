@chapter #ch-dc-components .dc-components .chapter-01 ch="1"

# DC Component Library

::: wrapper {.dc-intro}
Dimm City-specific components. Ability cards, banners, stat blocks, AP chips, tags, and path chains — the chrome that makes the Field Guide look like Dimm City.
:::

---

## Banners & Headers

| Element | Syntax | Role |
|---|---|---|
| Chevron Banner | `# Title {.dc-chevron}` | Primary H1 opener — once per chapter, replaces plain `#` |
| Spray Banner | `## Title {.dc-spray}` | H2 opener for learning paths and major topic breaks |
| Spec Tweak Rule | `### Title {.dc-spec-tweak .no-top}` | H3 for optional mechanics; `.no-top` removes top margin |

```
# Augmerc {.dc-chevron}
## Biting Distance {.dc-spray}
### Spec Tweak: Wired to Kill {.dc-spec-tweak .no-top}
```

---

## Ability Cards

The `@skill` macro generates the full card HTML automatically. Use `variant="1"` through `variant="5"` to select clip-path shapes. The next `@skill` or `@end-skill` closes the current card.

**Macro syntax** — H4 title, blockquote flavor, ordered list abilities, optional H5 sub-header:

```
@skill variant="1"
#### Ability Title | AUG1.1
> Flavor line.
1. **0 AP** *Action Name:* Effect description.
2. **2 AP** *Action Name:* Effect description.
##### Sub-header text
@end-skill
```

**Tier badge** — Inside `@learning-path` the tab tier (`AUG1.1`, `AUG1.2`, …) is auto-generated. For standalone cards or custom labels, append ` | Badge` to the H4.

**Optional attributes** — `id="slug"` sets the card's `name` for anchor links. `{.allow-split}` permits Paged.js to split a tall card across a page break (prefer `@continue` instead).

---

### Skill Card Continuation

When an ability is too long for one card, use `@continue` inside the active `@skill` block. It closes the current card and opens a new continuation card with the same variant and a `▸` suffix on the tab title. Prefer `@continue` over `.allow-split` — the continuation gets its own proper tab and frame.

`@continue` must appear between `@skill` and `@end-skill`. The next `@skill`, `@end-skill`, or end of file closes the continuation automatically.

```
@skill variant="3"
#### Deep Scan | AUG2.4
> Every system has a back door. Yours is already open.
1. **0 AP** *Passive Sweep:* Detect networked devices within Near at scene start.
2. **2 AP** *Root Access:* Read all signals on one target until your next turn.
@continue
3. **3 AP** *Kill Switch:* Shut down one networked device in Near range.
4. **VAR AP** *Cascade Wipe:* Extend Kill Switch across linked targets (2 AP each).
##### Every door has a hinge. You are the hinge.
@end-skill
```

---

### AP Chip Variants

Inline HTML spans inside `@skill` ability text. Three variants signal cost type at a glance:

| Class | Example | Meaning |
|---|---|---|
| `dc-ap free` | `<span class="dc-ap free">0 AP</span>` | Free action — crimson fill |
| `dc-ap` | `<span class="dc-ap">2 AP</span>` | Standard cost — HUD green |
| `dc-ap var` | `<span class="dc-ap var">VAR</span>` | Variable cost — magenta fill |

---

### At-a-Glance Cards

Quick stat grid for character sheets, specialty summaries, and creature previews. Each card holds one label and one value.

```html
<div class="at-a-glance-cards">
  <div class="at-a-glance-card"><h4>HP</h4><p>14</p></div>
  <div class="at-a-glance-card"><h4>Speed</h4><p>Near</p></div>
  <div class="at-a-glance-card"><h4>Edge</h4><p>+2</p></div>
</div>
```

---

## Tags & Chips

| Element | Syntax | Role |
|---|---|---|
| Class Tag | `<span class="tag">Label</span>` | Inline pill for specialty names and cost labels |
| DC Path Sticker | `<span class="dc-path-sticker">AUG1</span>` | Badge inside learning-path spray headers |
| Tape Divider | `<div class="dc-tape flush">Label</div>` | Full-width tape strip separating major sections |

```html
<span class="tag">Augmerc</span>
<span class="dc-path-sticker">AUG1</span>
<div class="dc-tape flush">Section Break</div>
```

---

## Stat Blocks

Both block types use the same `.dc-stat` structure. Creature blocks use combat stats (HP / DEF / AP / DMG); NPC blocks use social stats (REP / HEAT / FEE / TURN). Add `.flush` to remove default side margins.

### Creature Stat Block

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
  <div class="dc-stat-line"><strong>Pack Tactic:</strong> While 2+ wirewolves are in reach, all gain advantage.</div>
</div>
```

### NPC Stat Block — social stats variant

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
  <div class="dc-stat-line"><strong>Patch Job:</strong> Treat wounds between scenes. Costs FEE × severity.</div>
</div>
```

---

## Learning Path

A learning path wraps skill cards under a named spray banner with a sticker chain and flavor line. Use `@learning-path` after `@specialty {.classname}` — the path index and specialty code (e.g., `AUG1`) are auto-computed. Tab tiers (`AUG1.1`, `AUG1.2`, …) are generated automatically from position; use `#### Skill Name | Custom` only to override.

**Macro syntax:**

```
@specialty {.augmerc}

@learning-path
### Path Title
> Path flavor line.
- Skill A
- Skill B
- Skill C

@skill variant="1"
#### Skill Name
> Skill flavor.
1. **0 AP** *Action:* Effect.
2. **2 AP** *Action:* Effect.
@end-skill

@end-learning-path
```

---

## Stickers & Path Chains

Slightly skewed paper labels connected by orange chevron arrows. The active step renders in crimson with a harder rotation — no fade, instant state flip.

### Path Step Chain

Horizontal chain of skill-name stickers auto-generated by `@learning-path` from the bullet list; first sticker gets `.active`. Never author manually inside chapter content.

**Syntax** — auto-generated by `@learning-path`; raw HTML fallback: `<div class="dc-stickers flush">` with `<span class="dc-sticker">` and `<span class="dc-arrow">»</span>` separators

```html
<div class="dc-stickers flush">
  <span class="dc-sticker active">Punishing Counter</span>
  <span class="dc-arrow">»</span>
  <span class="dc-sticker">Rage Hit</span>
  <span class="dc-arrow">»</span>
  <span class="dc-sticker">Pain Compliance</span>
</div>
```

---

### Path Subtitle & Sub-header Sticker

Both are auto-generated from the `@learning-path` / `@skill` macros. Author manually only for standalone use.

```html
<!-- Path Subtitle — auto from @learning-path blockquote line -->
<div class="dc-path-subtitle flush">— Path · Choose your specialty —</div>

<!-- Sub-header Sticker — auto from @skill H5 line -->
<div class="dc-sub-header flush">Stance · Free counter · Once per round</div>
```

---

## Stamps

Rotated monospaced label chips for content status (draft, deprecated, classified, DM-only). `.classified` adds the orange-border variant.

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

Badge in the top-left corner of specialty chapter opener pages. Auto-generated by `@specialty`; `@chapter-opener C.N` emits it for non-specialty chapters.

```html
<div class="dc-chapter-opener-no">AUG1</div>
```

| Specialty | Slug | Specialty | Slug |
|---|---|---|---|
| Augmerc | `AUG1` | Cybersurgeon | `CYB1` |
| Proxy | `PRX1` | Wirephreak | `WPK1` |
| Streetwarden | `SWD1` | Technosorcerer | `TCS1` |
| Gutterdruid | `GDR1` | Etherlock | `ETH1` |
| Non-specialty | `C.01`, `C.02`, … | | |

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

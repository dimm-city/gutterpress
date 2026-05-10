@chapter #ch-dc-components .dc-components

# DC Component Library

<div class="dc-intro">Dimm City-specific components. Ability cards, banners, stat blocks, AP chips, tags, and path chains — the chrome that makes the Field Guide look like Dimm City.</div>

---

## Banners & Headers

### Chevron Banner

The primary H1 opener for chapter and specialty pages. Renders with the DC chevron accent treatment. Use once per chapter, at the very top, in place of a plain `# Heading`.

**Syntax** — `# Title {.dc-chevron}`

<h1 class="dc-chevron">Augmerc</h1>

---

### Spray Banner

H2 section opener for learning paths and major topic breaks. The spray treatment sets the heading apart from generic H2s and signals a structural shift in the content.

**Syntax** — `## Title {.dc-spray}`

<h2 class="dc-spray">Biting Distance</h2>

---

### Spec Tweak Rule

H3 heading for optional mechanics and variant rules. The `.no-top` modifier removes the default top margin so the rule sits flush beneath whatever element precedes it.

**Syntax** — `### Title {.dc-spec-tweak .no-top}`

<h3 class="dc-spec-tweak no-top">Spec Tweak: Wired to Kill</h3>

---

## Ability Cards

The `@skill` / `@end-skill` macro generates the card HTML automatically. Use `variant="1"` through `variant="5"` to select clip-path shapes for the card tab. The macro accepts an `id` attribute for anchor linking and internal cross-references.

### Standard Card

The rendered HTML output the macro produces:

<div class="dc-skill-card">
  <div class="card-tab dc-card-tab">
    <span class="tab-title dc-tab-title">Punishing Counter</span>
    <span class="tab-tier dc-tab-tier">AUG1.1</span>
  </div>
  <div class="card-body dc-card-body">
    <div class="card-inner dc-card-inner">
      <p class="flavor dc-flavor">See an opening, ya take it.</p>
      <div class="ability dc-ability">
        <span class="ap-tag free dc-ap">0 AP</span>
        <p class="ability-text dc-ability-text dc-prose"><strong>Steel Says No:</strong> When an enemy in reach makes a basic attack, your Backbiters knock the strike off line.</p>
      </div>
      <div class="ability dc-ability">
        <span class="ap-tag dc-ap">2 AP</span>
        <p class="ability-text dc-ability-text dc-prose"><strong>Bullet to Blood:</strong> When an enemy you can see makes a ranged basic attack, you slip the shot.</p>
      </div>
      <div class="sub-header dc-sub-header">— Openings are invitations to take a chunk out 'em —</div>
    </div>
  </div>
</div>

Macro authoring syntax:

```
@skill variant="1" id="punishing-counter"
#### Punishing Counter
AUG1.1
> See an opening, ya take it.
1. **0 AP** *Steel Says No:* Description…
2. **2 AP** *Bullet to Blood:* Description…
— Openings are invitations to take a chunk out 'em —
@end-skill
```

---

### AP Chip Variants

AP chips appear inline inside ability blocks. Three variants signal cost type at a glance:

<span class="ap-tag free dc-ap">0 AP</span> — Free action (crimson fill).

<span class="ap-tag dc-ap">2 AP</span> — Standard cost (HUD green).

<span class="ap-tag var dc-ap">VAR</span> — Variable cost (magenta fill).

---

### At-a-Glance Cards

Quick stat grid for character sheets, specialty summaries, and creature previews. Each card holds one label and one value.

<div class="at-a-glance-cards">
  <div class="at-a-glance-card"><h4>HP</h4><p>14</p></div>
  <div class="at-a-glance-card"><h4>Speed</h4><p>Near</p></div>
  <div class="at-a-glance-card"><h4>Edge</h4><p>+2</p></div>
</div>

---

## Tags & Chips

### Class Tag

Inline pill for specialty names and cost labels. Renders with a pill border in the accent color.

**Syntax** — `<span class="tag">Label</span>`

<span class="tag">Augmerc</span>

---

### DC Path Sticker

Badge code displayed inside learning-path spray headers. Identifies the path index (e.g., `AUG1`, `AUG2`) so readers can navigate multi-path specialties at a glance.

**Syntax** — `<span class="dc-path-sticker">AUG1</span>`

<span class="dc-path-sticker">AUG1</span>

---

### Tape Divider

Full-width tape strip that separates major sections within a specialty or chapter. The `.flush` modifier removes any margin so the tape bleeds edge-to-edge in the content column.

**Syntax** — `<div class="dc-tape flush">Label</div>`

<div class="dc-tape flush">Section Break</div>

---

## Stat Blocks

### Creature Stat Block

Full creature entry: name, archetype line, stat grid (HP / DEF / AP / DMG), and a list of named abilities. Add `.flush` to remove the default side margins for bleed-edge placement.

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

---

### NPC Stat Block

Same structure as the creature block. Social-facing NPCs swap combat stats for social stats: REP (reputation floor), HEAT (threat threshold), FEE (base price), and TURN (disposition shift on failed roll).

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

---

## Learning Path

A learning path wraps a set of skill cards under a named spray header with an intro flavor line. The `@learning-path` macro generates the outer shell; each `@skill` block inside it produces a card.

Macro authoring syntax:

```
@learning-path specialty="augmerc" index="1"
### Breach Protocols
> Close enough to count teeth. Far enough to keep yours.

@skill variant="1" id="breach-and-clear"
#### Breach and Clear
AUG1.1
1. **0 AP** *Stack Up:* Position one ally in reach without spending AP.
2. **2 AP** *Dynamic Entry:* Move through a door and make a basic attack in the same action.
@end-skill
@end-learning-path
```

Rendered output HTML (simplified specimen):

```html
<section class="dc-learning-path dc-path-block" data-path-ref="AUG1">
  <div class="dc-path-shell">
    <h2 class="dc-spray"><span class="dc-path-sticker">AUG1</span>Breach Protocols</h2>
    <div class="dc-intro">Close enough to count teeth. Far enough to keep yours.</div>
    <!-- skill cards follow -->
  </div>
</section>
```

---

## Component Authoring Quick Reference

| Component | Authoring method | CSS class(es) |
|---|---|---|
| Chevron Banner | `# Title {.dc-chevron}` | `dc-chevron` |
| Spray Banner | `## Title {.dc-spray}` | `dc-spray` |
| Spec Tweak Rule | `### Title {.dc-spec-tweak .no-top}` | `dc-spec-tweak`, `no-top` |
| Skill Card (outer) | `@skill … @end-skill` macro | `dc-skill-card` |
| Card Tab | Generated by macro | `card-tab`, `dc-card-tab` |
| Tab Title | Generated by macro | `tab-title`, `dc-tab-title` |
| Tab Tier | Generated by macro | `tab-tier`, `dc-tab-tier` |
| Flavor Text | Generated by macro | `flavor`, `dc-flavor` |
| Ability Row | Generated by macro | `ability`, `dc-ability` |
| AP Chip — Free | `<span class="ap-tag free dc-ap">` | `ap-tag free dc-ap` |
| AP Chip — Standard | `<span class="ap-tag dc-ap">` | `ap-tag dc-ap` |
| AP Chip — Variable | `<span class="ap-tag var dc-ap">` | `ap-tag var dc-ap` |
| At-a-Glance Cards | Raw HTML | `at-a-glance-cards`, `at-a-glance-card` |
| Class Tag | `<span class="tag">Label</span>` | `tag` |
| DC Path Sticker | `<span class="dc-path-sticker">AUG1</span>` | `dc-path-sticker` |
| Tape Divider | `<div class="dc-tape flush">Label</div>` | `dc-tape`, `flush` |
| Creature Stat Block | Raw HTML | `dc-stat`, `dc-stat-head`, `dc-stat-grid`, `dc-stat-cell` |
| NPC Stat Block | Raw HTML (social stats) | `dc-stat`, `dc-stat-head`, `dc-stat-grid`, `dc-stat-cell` |
| Learning Path | `@learning-path … @end-learning-path` macro | `dc-learning-path`, `dc-path-block`, `dc-path-shell` |

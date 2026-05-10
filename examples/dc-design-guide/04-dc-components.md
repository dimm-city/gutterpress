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

The `@skill` / `@end-skill` macro generates the full card HTML automatically. Use `variant="1"` through `variant="5"` to select clip-path shapes. Two live cards below — same macro, different variants:

@skill variant="1" id="punishing-counter"
#### Punishing Counter | AUG1.1
> See an opening, ya take it.
1. **0 AP** *Steel Says No:* When an enemy in reach makes a basic attack, your Backbiters knock the strike off line.
2. **2 AP** *Bullet to Blood:* When an enemy you can see makes a ranged basic attack, you slip the shot.
##### Openings are invitations to take a chunk out 'em
@end-skill

@skill variant="2" id="wire-tap"
#### Wire Tap | AUG1.2
> You don't need access — you need patience and a good antenna.
1. **1 AP** *Signal Ghost:* Until your next turn, you are invisible to surveillance cameras and smart-weapon targeting.
2. **3 AP** *Hostile Takeover:* Seize control of one networked device within reach until the end of the scene.
##### Chrome sees everything. You see through chrome.
@end-skill

**Macro syntax** — tier after `|` in the heading, sub-header as `#####`:

```
@skill variant="1" id="ability-id"
#### Ability Title | AUG1.N
> Flavor line.
1. **0 AP** *Action Name:* Effect description.
2. **2 AP** *Action Name:* Effect description.
##### Sub-header text
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

**Macro syntax:**

```
@learning-path specialty="augmerc" index="1"
### Path Title
> Path flavor line.
- Skill A
- Skill B
- Skill C

@skill variant="1" id="skill-id"
#### Skill Name | AUG1.1
> Skill flavor.
1. **0 AP** *Action Name:* Effect description.
2. **2 AP** *Action Name:* Effect description.
##### Sub-header text
@end-skill
@end-learning-path
```

Live rendered learning path — three cards using variants 1, 2, and 3:

@learning-path specialty="augmerc" index="1"
### Breach Protocols
> Close enough to count teeth. Far enough to keep yours.
- Breach and Clear
- Suppression Fire
- Ghost Protocol

@skill variant="1" id="breach-and-clear-lp"
#### Breach and Clear | AUG1.1
> The door opens inward. You don't.
1. **0 AP** *Stack Up:* Position one ally in reach without spending AP.
2. **2 AP** *Dynamic Entry:* Move through a door and make a basic attack in the same action. The attack gains advantage.
##### Door's just a wall that didn't commit.
@end-skill

@skill variant="2" id="suppression-fire-lp"
#### Suppression Fire | AUG1.2
> They stop moving. You start.
1. **2 AP** *Pin Down:* One enemy in range cannot move or take reactions until the start of your next turn.
2. **VAR AP** *Sustained Pressure:* Spend 1 additional AP per round to extend pin-down.
##### Keep their heads down long enough to matter.
@end-skill

@skill variant="3" id="ghost-protocol-lp"
#### Ghost Protocol | AUG1.3
> You were never there. The bodies disagree.
1. **1 AP** *Fade:* Move up to your speed without triggering opportunity attacks.
2. **3 AP** *Vanishing Act:* Become undetectable to all sensors and cameras until you attack or the scene ends.
##### The best breach is the one they never see.
@end-skill

@end-learning-path

---

## Stickers & Path Chains

Slightly skewed paper labels connected by orange chevron arrows. The active step renders in crimson with a harder rotation and drop shadow — no fade, instant state flip.

### Path Step Chain

A horizontal chain of skill-name stickers showing progression order within a learning path. Auto-generated by `@learning-path` from a bullet list; the first sticker automatically receives `.active`. Never author this HTML manually inside chapter content.

**Syntax** — auto-generated by `@learning-path`; or raw HTML `<div class="dc-stickers flush">` with `<span class="dc-sticker">` and `<span class="dc-arrow">»</span>` separators

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

---

### Path Subtitle

A secondary label rendered below the sticker chain, naming the path and its choice structure. Auto-generated by `@learning-path` from the `> blockquote` line inside the block; can be authored manually for standalone use.

**Syntax** — auto-generated by `@learning-path`; or raw HTML `<div class="dc-path-subtitle flush">text</div>`

<div class="dc-path-subtitle flush">— Path · Choose your specialty —</div>

---

### Sub-header Sticker

A mono-cap label at the bottom of a skill card summarizing the stance, trigger, or cost type. Auto-generated by `@skill`/`@end-skill` from the final `type | AP cost` line; can also be authored directly inside a `.card-inner` body.

**Syntax** — auto-generated by `@skill`/`@end-skill`; or raw HTML `<div class="dc-sub-header flush">text</div>`

<div class="dc-sub-header flush">Stance · Free counter · Once per round</div>

---

## Stamps

Rotated monospaced label chips used to mark content status — draft, deprecated, classified, or Dream Master-only. Use `.classified` for the orange-border variant that signals restricted or spoiler content.

**Syntax** — raw HTML `<span class="dc-stamp">TEXT</span>`; add `.classified` for the orange-border variant

<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:0.1in 0;">
  <span class="dc-stamp">DREAM MASTER</span>
  <span class="dc-stamp classified">PRE-RELEASE</span>
  <span class="dc-stamp">DEPRECATED</span>
</div>

```html
<span class="dc-stamp">DREAM MASTER</span>
<span class="dc-stamp classified">PRE-RELEASE</span>
```

---

## Clip-Path Card Variants (v1–v5)

Five clip-path shapes for the card tab and body corners. Set `variant="N"` on the `@skill` macro to choose, or apply class `v1`–`v5` directly to `.dc-card-tab` and `.dc-card-body` in raw HTML. Variant 1 is the default right-diagonal; variants 2–5 offer progressively distinct tech silhouettes.

**Syntax** — `variant="N"` on `@skill` macro; or add class `v1`–`v5` to `.dc-card-tab` and `.dc-card-body`

<div style="display:flex;flex-wrap:wrap;gap:12px;margin:0.1in 0;">

<div class="dc-skill-card" style="width:180px;">
  <div class="card-tab dc-card-tab v1"><span class="tab-title dc-tab-title">Variant 1</span><span class="tab-tier dc-tab-tier">V1</span></div>
  <div class="card-body dc-card-body v1"><div class="card-inner dc-card-inner"><div class="ability dc-ability"><span class="ap-tag dc-ap">2 AP</span><p class="ability-text dc-ability-text dc-prose"><strong>Default.</strong> Right-diagonal tab, bottom-right notch body.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:180px;">
  <div class="card-tab dc-card-tab v2"><span class="tab-title dc-tab-title">Variant 2</span><span class="tab-tier dc-tab-tier">V2</span></div>
  <div class="card-body dc-card-body v2"><div class="card-inner dc-card-inner"><div class="ability dc-ability"><span class="ap-tag dc-ap">2 AP</span><p class="ability-text dc-ability-text dc-prose"><strong>Sharp angular.</strong> Diagonal cuts on all four tab corners and both body bottom corners.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:180px;">
  <div class="card-tab dc-card-tab v3"><span class="tab-title dc-tab-title">Variant 3</span><span class="tab-tier dc-tab-tier">V3</span></div>
  <div class="card-body dc-card-body v3"><div class="card-inner dc-card-inner"><div class="ability dc-ability"><span class="ap-tag dc-ap">2 AP</span><p class="ability-text dc-ability-text dc-prose"><strong>Asymmetric tech.</strong> Top-left step on tab, large single diagonal on body.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:180px;">
  <div class="card-tab dc-card-tab v4"><span class="tab-title dc-tab-title">Variant 4</span><span class="tab-tier dc-tab-tier">V4</span></div>
  <div class="card-body dc-card-body v4"><div class="card-inner dc-card-inner"><div class="ability dc-ability"><span class="ap-tag dc-ap">2 AP</span><p class="ability-text dc-ability-text dc-prose"><strong>Soft angular.</strong> Shallow corner cuts, more restrained than v1/v2.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:180px;">
  <div class="card-tab dc-card-tab v5"><span class="tab-title dc-tab-title">Variant 5</span><span class="tab-tier dc-tab-tier">V5</span></div>
  <div class="card-body dc-card-body v5"><div class="card-inner dc-card-inner"><div class="ability dc-ability"><span class="ap-tag dc-ap">2 AP</span><p class="ability-text dc-ability-text dc-prose"><strong>Scooped futuristic.</strong> Center notch on tab top, pinched bottom corners on body.</p></div></div></div>
</div>

</div>

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
| Path Step Chain | auto via `@learning-path`; raw HTML fallback | `dc-stickers`, `dc-sticker`, `dc-sticker.active`, `dc-arrow` |
| Path Subtitle | auto via `@learning-path`; raw HTML fallback | `dc-path-subtitle`, `flush` |
| Sub-header Sticker | auto via `@skill`; raw HTML fallback | `dc-sub-header`, `flush` |
| Stamp — Default | `<span class="dc-stamp">TEXT</span>` | `dc-stamp` |
| Stamp — Classified | `<span class="dc-stamp classified">TEXT</span>` | `dc-stamp`, `classified` |
| Clip-Path v1 | `variant="1"` on `@skill`; or `.v1` on tab/body | `dc-card-tab v1`, `dc-card-body v1` |
| Clip-Path v2 | `variant="2"` on `@skill`; or `.v2` on tab/body | `dc-card-tab v2`, `dc-card-body v2` |
| Clip-Path v3 | `variant="3"` on `@skill`; or `.v3` on tab/body | `dc-card-tab v3`, `dc-card-body v3` |
| Clip-Path v4 | `variant="4"` on `@skill`; or `.v4` on tab/body | `dc-card-tab v4`, `dc-card-body v4` |
| Clip-Path v5 | `variant="5"` on `@skill`; or `.v5` on tab/body | `dc-card-tab v5`, `dc-card-body v5` |

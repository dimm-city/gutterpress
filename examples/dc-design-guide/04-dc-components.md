@chapter #ch-dc-components .dc-components .chapter-01

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

**Specimen**

# Augmerc {.dc-chevron}

---

### Spray Banner

H2 section opener for learning paths and major topic breaks. The spray treatment sets the heading apart from generic H2s and signals a structural shift in the content.

**Syntax** — `## Title {.dc-spray}`

```
## Biting Distance {.dc-spray}
```

**Specimen**

## Biting Distance {.dc-spray}

---

### Spec Tweak Rule

H3 heading for optional mechanics and variant rules. The `.no-top` modifier removes the default top margin so the rule sits flush beneath whatever element precedes it.

**Syntax** — `### Title {.dc-spec-tweak .no-top}`

```
### Spec Tweak: Wired to Kill {.dc-spec-tweak .no-top}
```

**Specimen**

### Spec Tweak: Wired to Kill {.dc-spec-tweak .no-top}

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

**Specimen**

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

**Specimen**

@skill variant="3" id="deep-scan-demo"
#### Deep Scan | AUG2.4
> Every system has a back door. Yours is already open.
1. **0 AP** *Passive Sweep:* At the start of each scene, you automatically detect all networked devices within Near range.
2. **2 AP** *Root Access:* Until your next turn, you read all incoming and outgoing signals on one target device.
@continue
3. **3 AP** *Kill Switch:* Immediately shut down one networked device in Near range. If the device is a smart weapon, the wielder loses their next attack action.
4. **VAR AP** *Cascade Wipe:* Spend 2 AP per additional device to extend Kill Switch to a chain of linked targets.
##### Every door has a hinge. You are the hinge.
@end-skill

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

**Specimen**

<span class="dc-ap free">0 AP</span> — Free action (crimson fill).

<span class="dc-ap">2 AP</span> — Standard cost (HUD green).

<span class="dc-ap var">VAR</span> — Variable cost (magenta fill).

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

**Specimen**

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

```html
<span class="tag">Augmerc</span>
```

**Specimen**

<span class="tag">Augmerc</span>

---

### DC Path Sticker

Badge code displayed inside learning-path spray headers. Identifies the path index (e.g., `AUG1`, `AUG2`) so readers can navigate multi-path specialties at a glance.

**Syntax** — `<span class="dc-path-sticker">AUG1</span>`

```html
<span class="dc-path-sticker">AUG1</span>
```

**Specimen**

<span class="dc-path-sticker">AUG1</span>

---

### Tape Divider

Full-width tape strip that separates major sections within a specialty or chapter. The `.flush` modifier removes any margin so the tape bleeds edge-to-edge in the content column.

**Syntax** — `<div class="dc-tape flush">Label</div>`

```html
<div class="dc-tape flush">Section Break</div>
```

**Specimen**

<div class="dc-tape flush">Section Break</div>

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

**Specimen**

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

**Specimen**

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

**Specimen**

@specialty {.augmerc}

@learning-path
### Biting Distance
> If you can touch it, you can maul it. When things get close, they bleed.
- Punishing Counter
- Rage Hit
- Dirty Work

Augmercs on the Biting Distance path install reactive Backbiter Spines — hardware rigged beneath the skin that blooms outward on contact. Spending an action doing nothing but defending, the rig braces and answers every swing, letting you resist 2 damage from all melee attacks and dealing 1 damage to all creatures in reach at the start of your turn.

@skill variant="2"
#### Punishing Counter
> See an opening, ya take it. Best time to hit 'em is when they think it's over.

When an enemy falters, you may trigger one of the following counters:

1. **0 AP** *Steel Says No:* When an enemy in reach makes a basic attack and rolls a hard choice or worse, your Backbiters knock the strike off line. No damage. Free counter, once per round.
2. **2 AP** *Bullet to Blood:* When an enemy you can see makes a ranged basic attack and rolls a hard choice or worse, you slip the shot as it screams past. No damage. Free counter, once per round.
3. **2 AP** *Bad Timing:* When an enemy in reach rolls a hard choice or worse on a basic attack against you, your Backbiters snap out and steal the moment. No damage and you have their weapon. Free counter, once per round.

Openings are invitations to take a chunk out 'em.

@skill variant="2"
#### Rage Hit
> In some situations, it's best to risk it, swing wild, and hit hard!

1. **0 AP** *Full Send:* You throw everything into a reckless attack. Describe the chaos and **ROLL THE DIE!** On a Hit you deal double damage; on a Hard Choice you deal double damage but the target immediately counters; on a Miss the target immediately counters with a Lucid attack.
2. **2 AP** *All Gas, No Brakes:* **ROLL THE DIE TWICE!** Make two basic attacks against one target. If either roll is a 1, both attacks catastrophically fail.

Until the start of your next turn, any enemy that starts their turn in reach takes 1 damage as your Backbiters stick anything that moves too close.

@skill variant="2"
#### Dirty Work
> Fair fights are for nice mercs who lose. Never fight clean. Fight to finish.

Once per round, outside your turn, you exploit a target in reach. Choose one technique:

1. **0 AP** *Off-Hand Insurance:* Slip in a hidden strike. Make an attack that deals 1 damage.
2. **1 AP** *Street Tricks:* Snag their balance or misdirect their focus. Gain Lucidity on your next roll against the target and deal +1 damage on hit.
3. **2 AP** *Cheap Shot:* Break something important — sight, breath, balance, or nerve. **ROLL THE DIE!** On a hit, the target rolls. On 10 or less, they are Blinded or Stunned until the end of their next turn.

You don't need an opening. You make one.

@end-skill

@end-learning-path

@end-specialty

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

**Specimen**

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

```html
<div class="dc-path-subtitle flush">— Path · Choose your specialty —</div>
```

**Specimen**

<div class="dc-path-subtitle flush">— Path · Choose your specialty —</div>

---

### Sub-header Sticker

A mono-cap label at the bottom of a skill card summarizing the stance, trigger, or cost type. Auto-generated by `@skill`/`@end-skill` from the final `type | AP cost` line; can also be authored directly inside a `.card-inner` body.

**Syntax** — auto-generated by `@skill`/`@end-skill`; or raw HTML `<div class="dc-sub-header flush">text</div>`

```html
<div class="dc-sub-header flush">Stance · Free counter · Once per round</div>
```

**Specimen**

<div class="dc-sub-header flush">Stance · Free counter · Once per round</div>

---

## Stamps

Rotated monospaced label chips used to mark content status — draft, deprecated, classified, or Dream Master-only. Use `.classified` for the orange-border variant that signals restricted or spoiler content.

**Syntax** — raw HTML `<span class="dc-stamp">TEXT</span>`; add `.classified` for the orange-border variant

```html
<span class="dc-stamp">DREAM MASTER</span>
<span class="dc-stamp classified">PRE-RELEASE</span>
```

**Specimen**

<div style="display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:0.1in 0;">
  <span class="dc-stamp">DREAM MASTER</span>
  <span class="dc-stamp classified">PRE-RELEASE</span>
  <span class="dc-stamp">DEPRECATED</span>
</div>

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

**Specimen**

<div style="display:flex;flex-wrap:wrap;gap:16px;margin:0.1in 0;">

<div class="dc-skill-card" style="width:330px;flex-shrink:0;">
  <div class="dc-card-tab v1"><span class="dc-tab-title">Variant 1</span><span class="dc-tab-tier">V1</span></div>
  <div class="dc-card-body v1"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap">2 AP</span><p class="dc-ability-text dc-prose"><strong>Default.</strong> Right-diagonal tab, bottom-right notch body. The standard shape used on all @skill cards unless overridden.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:330px;flex-shrink:0;">
  <div class="dc-card-tab v2"><span class="dc-tab-title">Variant 2</span><span class="dc-tab-tier">V2</span></div>
  <div class="dc-card-body v2"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap">2 AP</span><p class="dc-ability-text dc-prose"><strong>Sharp angular.</strong> Diagonal cuts on all four tab corners and both body bottom corners.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:330px;flex-shrink:0;">
  <div class="dc-card-tab v3"><span class="dc-tab-title">Variant 3</span><span class="dc-tab-tier">V3</span></div>
  <div class="dc-card-body v3"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap">2 AP</span><p class="dc-ability-text dc-prose"><strong>Asymmetric tech.</strong> Top-left step on tab, large single diagonal on body.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:330px;flex-shrink:0;">
  <div class="dc-card-tab v4"><span class="dc-tab-title">Variant 4</span><span class="dc-tab-tier">V4</span></div>
  <div class="dc-card-body v4"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap">2 AP</span><p class="dc-ability-text dc-prose"><strong>Soft angular.</strong> Shallow corner cuts, more restrained than v1/v2.</p></div></div></div>
</div>

<div class="dc-skill-card" style="width:330px;flex-shrink:0;">
  <div class="dc-card-tab v5"><span class="dc-tab-title">Variant 5</span><span class="dc-tab-tier">V5</span></div>
  <div class="dc-card-body v5"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap">2 AP</span><p class="dc-ability-text dc-prose"><strong>Scooped futuristic.</strong> Center notch on tab top, pinched bottom corners on body.</p></div></div></div>
</div>

</div>

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

**Live specimen — two-column pack:**

<div style="display:flex;flex-wrap:wrap;gap:14px;margin:0.1in 0;">
<div class="dc-skill-card" style="width:280px;flex-shrink:0;">
  <div class="dc-card-tab v1"><span class="dc-tab-title">Punishing Counter</span><span class="dc-tab-tier">AUG1.1</span></div>
  <div class="dc-card-body v1"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap free">0 AP</span><p class="dc-ability-text dc-prose"><em>Steel Says No:</em> When an enemy in reach attacks, your Backbiters knock the strike off line.</p></div></div></div>
</div>
<div class="dc-skill-card" style="width:280px;flex-shrink:0;">
  <div class="dc-card-tab v1"><span class="dc-tab-title">Wire Tap</span><span class="dc-tab-tier">AUG1.2</span></div>
  <div class="dc-card-body v1"><div class="dc-card-inner"><div class="dc-ability"><span class="dc-ap">2 AP</span><p class="dc-ability-text dc-prose"><em>Signal Ghost:</em> Until your next turn, you are invisible to surveillance cameras and smart-weapon targeting.</p></div></div></div>
</div>
</div>

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

**Specimen** — badge at print scale:

<div class="dc-chapter-opener-no">AUG1</div>

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

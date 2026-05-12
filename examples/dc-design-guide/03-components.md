@chapter #ch-components .components .chapter-01 data-ch="1"

# Core Components

::: wrapper {.dc-intro}
The base prose and callout layer. These components work in all chapter types without needing a specialty or learning-path wrapper.
:::

---

## Body Prose

The default text style for all narrative and rules content. Standard markdown paragraphs automatically inherit the DC type scale, leading, and color — no class or wrapper required.

**Syntax** — plain markdown paragraph

```markdown
When an enemy falters, you may trigger one of the following counters.
**Backbiters** are simply part of what makes an Augmerc dangerous.
```

**Specimen**

When an enemy falters, you may trigger one of the following counters. **Backbiters** are simply part of what makes an Augmerc dangerous.

---

## Flavor Text

An italic variant of body prose used for in-world voice, atmospheric quotes, and short dramatic lines. Inside `@skill` cards, flavor text is automatically styled from the `>` blockquote line. For standalone flavor paragraphs, use the `> [!FLAVOR]` alert.

**Syntax** — `> [!FLAVOR]` blockquote alert

```markdown
> [!FLAVOR]
> See an opening, ya take it. Best time to hit 'em is when they think it's over.
```

**Specimen**

> [!FLAVOR]
> See an opening, ya take it. Best time to hit 'em is when they think it's over.

---

## Intro Lede

A slightly larger, heavier opening paragraph used at the top of a chapter or major section. Wrap the opening paragraph in `:::lede` — CSS applies the larger type scale automatically.

**Syntax** — `:::lede` … `:::`

```markdown
:::lede
An Augmerc is muscle for hire. Street thugs, corporate bodyguards,
deniable enforcers — the difference is gear, grafts, and how much
of them is still original.
:::
```

**Specimen**

:::lede
An Augmerc is muscle for hire. Street thugs, corporate bodyguards, deniable enforcers — the difference is gear, grafts, and how much of them is still original.
:::

---

## Note

A boxed aside for rules clarifications, reminders, and supplementary information. Uses a distinct left-border accent and a labeled header to separate it from body prose. No label boilerplate needed — the alert type sets the label automatically.

**Syntax** — `> [!NOTE]` blockquote alert

```markdown
> [!NOTE]
> Free counters trigger only once per round. Pick the one that hurts most.
```

**Specimen**

> [!NOTE]
> Free counters trigger only once per round. Pick the one that hurts most.

---

## Warning

A high-visibility callout for rules that have critical consequences or are frequently misread. Renders in amber to signal elevated importance.

**Syntax** — `> [!WARNING]` blockquote alert

```markdown
> [!WARNING]
> Trauma Patches stabilize a dying character but do not restore HP. A character
> at 0 HP with a Patch applied is still incapacitated — they can take no actions
> until healed above 0.
```

**Specimen**

> [!WARNING]
> Trauma Patches stabilize a dying character but do not restore HP. A character at 0 HP with a Patch applied is still incapacitated — they can take no actions until healed above 0.

---

## Pull Quote

A large-format excerpt set off with accent rules above and below. Use sparingly — one per chapter or major section at most. Attribution goes as the last paragraph inside the blockquote.

**Syntax** — `> [!PULLQUOTE]` blockquote alert

```markdown
> [!PULLQUOTE]
> The rig braces and answers every swing.
>
> Field manual, second draft
```

**Specimen**

> [!PULLQUOTE]
> The rig braces and answers every swing.
>
> Field manual, second draft

---

## Tape Divider

A horizontal section break styled as a piece of torn tape or a label strip. Use to visually separate major sections within a page without starting a new chapter. The `.flush` modifier extends the tape edge to edge.

**Syntax** — `<div class="dc-tape flush">…</div>`

```html
<div class="dc-tape flush">Section Break</div>
```

**Specimen**

<div class="dc-tape flush">Section Break</div>

---

## Section H3 Divider

A compact, high-contrast H3 heading for use inside dense multi-column reference layouts. Designed to remain legible at narrow column widths without the decorative weight of a full chapter subhead.

**Syntax** — `### Heading {.dc-section-h3}`

```markdown
### Cybernetics & Augments {.dc-section-h3}
```

**Specimen**

### Cybernetics & Augments {.dc-section-h3}

---

## Vibe Callout

A full-width atmospheric block for in-world voice that establishes the emotional or cultural register of a section. Typically placed at the top of a chapter or faction entry before the rules content begins.

**Syntax** — `> [!VIBE]` blockquote alert

```markdown
> [!VIBE]
> The Gutterdruid doesn't fight because they have to — they fight because
> something feral in them still remembers what it felt like to be free.
```

**Specimen**

> [!VIBE]
> The Gutterdruid doesn't fight because they have to — they fight because something feral in them still remembers what it felt like to be free.

---

## Origin Callout

A second-person backstory block that addresses the reader as their character, used for origin and background entries. Draws the reader into the fiction by making them the subject of the narrative.

**Syntax** — `> [!ORIGIN]` blockquote alert

```markdown
> [!ORIGIN]
> You didn't choose the street — the street chose you. Before the grafts,
> before the crew, there was just hunger and the particular talent for
> surviving what should have killed you. That's enough. That's always
> been enough.
```

**Specimen**

> [!ORIGIN]
> You didn't choose the street — the street chose you. Before the grafts, before the crew, there was just hunger and the particular talent for surviving what should have killed you. That's enough. That's always been enough.

---

## Human Callout (NPC Sidebar)

A compact NPC stat block nested inside a `.sidebar` float. Displays name, role, and key stats in a tight format suited for margin or column-gutter placement.

**Syntax** — `<div class="sidebar"><div class="dc-human-callout">…</div></div>`

```html
<div class="sidebar">
  <div class="dc-human-callout">
    <p><strong>Rennick "Two-Tab" Farrow</strong></p>
    <p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p>
  </div>
</div>
```

**Specimen**

<div class="sidebar"><div class="dc-human-callout"><p><strong>Rennick "Two-Tab" Farrow</strong></p><p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p></div></div>

---

## Gear Callout

A named equipment block for weapons, armor, and notable items. Groups the item name, type, and mechanical properties in a scannable panel distinct from body prose. The bold item name is the first line inside the alert.

**Syntax** — `> [!GEAR]` blockquote alert

```markdown
> [!GEAR]
> **Ripper Blades (Mk II)**
>
> Melee. Damage 1d8+STR. *Serrated:* on a critical hit, the target bleeds
> for 1d4 damage at the start of their next turn.
```

**Specimen**

> [!GEAR]
> **Ripper Blades (Mk II)**
>
> Melee. Damage 1d8+STR. *Serrated:* on a critical hit, the target bleeds for 1d4 damage at the start of their next turn.

---

## Item Block

A self-contained rules item — ability, move, or equipment entry — wrapped in a fenced container with a structured heading. The `.item` wrapper keeps the block together across page breaks.

**Syntax** — `:::item` … `:::` with a `###` title inside

```markdown
:::item
### Hardline Graft

**Passive.** Your cybernetic frame absorbs the first 2 points of physical
damage you take each round. This reduction applies before armor.

*When you're fully wired, hits just feel like feedback.*
:::
```

**Specimen**

:::item
### Hardline Graft

**Passive.** Your cybernetic frame absorbs the first 2 points of physical damage you take each round. This reduction applies before armor.

*When you're fully wired, hits just feel like feedback.*
:::

---

## Table

Standard markdown tables automatically receive DC styling: a colored header row, alternating row fills, and body text set at the small type scale. No extra syntax required.

**Syntax** — Standard markdown pipe table

```markdown
| Augment          | Slot   | Effect                              |
|------------------|--------|-------------------------------------|
| Reflex Booster   | Legs   | +2 to initiative rolls              |
| Subdermal Plating| Torso  | Reduce incoming damage by 1         |
| Optic Splice     | Head   | Ignore darkness penalties           |
| Neural Tap       | Head   | +1 die on Hack and Interface checks |
```

**Specimen**

| Augment | Slot | Effect |
|---------|------|--------|
| Reflex Booster | Legs | +2 to initiative rolls |
| Subdermal Plating | Torso | Reduce incoming damage by 1 |
| Optic Splice | Head | Ignore darkness penalties |
| Neural Tap | Head | +1 die on Hack and Interface checks |

---

## Blockquote

For epigraphs, thematic quotes, and attributed in-world text. Styled with an accent-alt left border and italic body text. Attribution goes on its own line prefixed with an em dash.

**Syntax** — Standard markdown `>` blockquote

```markdown
> Every city has a language. Dimm City's is neon, static, and the sound
> of someone's implants glitching at 3am.
>
> — Hollis Vance, *Street Anthropology Vol. 4*
```

**Specimen**

> Every city has a language. Dimm City's is neon, static, and the sound of someone's implants glitching at 3am.
>
> — Hollis Vance, *Street Anthropology Vol. 4*

---

## Code Blocks

Fenced code blocks for CSS snippets, stat expressions, or any literal syntax. Rendered with an orange left border, cream background, and Tomorrow monospace. No extra class required.

**Syntax** — Triple-backtick fenced block with an optional language hint

````markdown
```css
.dc-note {
  border-left: 3pt solid var(--color-accent);
}
```
````

**Specimen**

```css
:root {
  --color-accent: #e87c2b;
  --font-mono:    'Tomorrow', 'Courier New', monospace;
  --fs-small:     8.5pt;
}

.dc-note {
  border-left: 3pt solid var(--color-accent);
  background:  var(--color-tint);
  padding:     0.5em 0.75em;
}
```

---

## Visit Callout

An in-world location description written in present tense, as if the reader is arriving on-site. Use on location pages and before encounter content to establish place before mechanics begin.

**Syntax** — `> [!VISIT]` blockquote alert

```markdown
> [!VISIT]
> The Neon Bazaar doesn't close. Day shift workers and third-shift scavengers
> brush shoulders between stalls selling augment cartridges, black-market
> permits, and fried synthetic crab. If someone's selling it somewhere in
> Dimm City, it started here.
```

**Specimen**

> [!VISIT]
> The Neon Bazaar doesn't close. Day shift workers and third-shift scavengers brush shoulders between stalls selling augment cartridges, black-market permits, and fried synthetic crab. If someone's selling it somewhere in Dimm City, it started here.

---

## Dream Master Note

A Dream Master–addressed instruction block, visually distinct from player-facing notes. Use for GM guidance, scene hooks, and pacing advice that should not be read aloud at the table.

**Syntax** — `> [!DM]` blockquote alert

```markdown
> [!DM]
> If a player hasn't chosen their starting gear by the end of session zero,
> hand them a Scavenger Pack and move on. Gear anxiety is real but the game
> shouldn't wait for it.
```

**Specimen**

> [!DM]
> If a player hasn't chosen their starting gear by the end of session zero, hand them a Scavenger Pack and move on. Gear anxiety is real but the game shouldn't wait for it.

---

## Glossary / Term List

A definition list of game terms rendered as a styled block. Use for rules glossaries, jargon indexes, and any list of named concepts that need consistent, scannable formatting.

**Syntax** — raw HTML `.dc-terms` wrapper (alias: `.terms`) containing one or more `.dc-terms-list` items (alias: `.terms-list`), each with a `<strong>` term label and a `<p>` definition

```html
<div class="dc-terms terms">
  <div class="terms item">
    <strong>Augmerc</strong>
    <p>A specialist who combines cybernetic augmentation with close-range
    combat training.</p>
  </div>
  <div class="terms item">
    <strong>Hard Choice</strong>
    <p>A roll result where the fiction advances but at a cost.</p>
  </div>
</div>
```

**Specimen**

<div class="dc-terms terms">
  <div class="terms item">
    <strong>Augmerc</strong>
    <p>A specialist who combines cybernetic augmentation with close-range combat training. Chrome bones, reflex implants, and licensed edge.</p>
  </div>
  <div class="terms item">
    <strong>Dream Master</strong>
    <p>The facilitating player who narrates the world, controls adversaries, and adjudicates outcomes. Not the enemy. Usually.</p>
  </div>
  <div class="terms item">
    <strong>Hard Choice</strong>
    <p>A roll result where the fiction advances but at a cost. Something breaks, something reveals itself, someone gets hurt.</p>
  </div>
</div>

---

## Numbered Procedure

A zero-padded ordered list for sequential rules — character creation, contract resolution, scene framing. Wrap a standard ordered list in `:::procedure` — CSS applies zero-padded numbering automatically.

**Syntax** — `:::procedure` … `:::` with a standard ordered list inside

```markdown
:::procedure
1. **Pick a Spec.** Augmerc, Proxy, Streetwarden — one of eight.
2. **Spend 6 Spec Points.** Distribute across paths.
3. **Take a Signature Augment.** Free at character creation.
:::
```

**Specimen**

:::procedure
1. **Pick a Spec.** Augmerc, Proxy, Streetwarden — one of eight. Your spec sets your starting paths and signature gear.
2. **Spend 6 Spec Points.** Distribute across paths. Each point unlocks one tier. You may not exceed tier 3 at character creation.
3. **Take a Signature Augment.** Pulled from your spec's gear list. Free at start. Replaceable later only by a Cybersurgeon contact.
4. **Roll your Heat.** d20 + Spec modifier. Heat is what the city already has against you when play begins.
5. **Name a Debt.** One contract you owe, one person you owe it to. The Dream Master may call it in.
:::

---

## Outcome Ladder

The five-rung d20 result table used for all rolls in Dimm City. Each row is color-coded by result severity. Use the `@outcome` / `@end-outcome` macro — one pipe-delimited row per result.

**Syntax** — `@outcome` … `@end-outcome` macro; columns are `roll | name | description`

```
@outcome
20 | Crit | You flow. Automatic success — no further roll needed.
11–19 | Hit | You succeed at what you were trying to do without a hitch.
6–10 | Hard Choice | You succeed, but at a cost.
2–5 | Miss | You fail. The only consequence is what you had riding on the roll.
1 | Catastrophe | Dark. Automatic fail with a severe setback.
@end-outcome
```

**Specimen**

@outcome

20 | Crit | You flow. Automatic success — no further roll needed. If dealing damage, check your weapon's bonus stats. Your next die roll: ROLL LUCID.
11–19 | Hit | You succeed at what you were trying to do without a hitch. If attacking, deal standard damage based on your weapon's stats.
6–10 | Hard Choice | You succeed, but at a cost. Weapon overheats, ammo burns, or something else gives. The DM offers two impactful options — pick one.
2–5 | Miss | You fail. The only consequence is what you had riding on the roll. Miss an opponent in a duel? They get to attack you on their turn.
1 | Catastrophe | Dark. Automatic fail with a severe setback — broken gear, cyberware malfunction, or friendly fire. Your next die roll: ROLL SURREAL.

@end-outcome

---

## Component Token Reference {.break-before}

| Component | Authoring method | CSS class / output |
|-----------|-----------------|-------------------|
| Body Prose | Plain markdown paragraph | `.dc-prose` (auto) |
| Flavor Text | `> [!FLAVOR]` blockquote alert | `.dc-prose.flavor` |
| Intro Lede | `:::lede` … `:::` | `.dc-intro` |
| Note | `> [!NOTE]` blockquote alert | `.dc-note` |
| Warning | `> [!WARNING]` blockquote alert | `.dc-note.warning` |
| Pull Quote | `> [!PULLQUOTE]` blockquote alert | `.dc-pullquote.flush` |
| Tape Divider | `<div class="dc-tape flush">…</div>` | `.dc-tape`, `.flush` |
| Section H3 Divider | `### Heading {.dc-section-h3}` | `.dc-section-h3` |
| Vibe Callout | `> [!VIBE]` blockquote alert | `.dc-vibe-callout` |
| Origin Callout | `> [!ORIGIN]` blockquote alert | `.dc-origin-callout` |
| Human Callout | Raw HTML inside `.sidebar` | `.dc-human-callout` |
| Gear Callout | `> [!GEAR]` blockquote alert | `.dc-gear-callout` |
| Item Block | `:::item` … `:::` with `###` title | `.item` |
| Table | Standard markdown pipe table | *(auto)* |
| Blockquote | Standard markdown `>` blockquote | *(auto)* |
| Code Block | Triple-backtick fenced block | *(auto)* |
| Visit Callout | `> [!VISIT]` blockquote alert | `.dc-visit-callout` |
| Dream Master Note | `> [!DM]` blockquote alert | `.dc-note-callout` |
| Glossary / Term List | Raw HTML `.dc-terms` wrapper | `.dc-terms`, `.terms-list` |
| Numbered Procedure | `:::procedure` … `:::` ordered list | `.dc-steps` |
| Outcome Ladder | `@outcome` … `@end-outcome` macro | `.dc-outcomes`, `.dc-outcome-row` |
| Roll Lucid badge | auto via `@outcome` Crit row | `.dc-roll-lucid` |
| Roll Surreal badge | auto via `@outcome` Catastrophe row | `.dc-roll-surreal` |

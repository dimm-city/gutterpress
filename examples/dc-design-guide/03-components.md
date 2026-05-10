@chapter #ch-components .components

# Core Components

<div class="dc-intro">The base prose and callout layer. These components work in all chapter types without needing a specialty or learning-path wrapper.</div>

---

## Body Prose

The default text wrapper for all narrative and rules content. Apply `.dc-prose` to any paragraph or block of body text to inherit the DC type scale, leading, and color.

**Syntax** — `<p class="dc-prose">…</p>` or `<div class="dc-prose">…</div>`

<p class="dc-prose">When an enemy falters, you may trigger one of the following counters. <strong>Backbiters</strong> are simply part of what makes an Augmerc dangerous.</p>

```html
<p class="dc-prose">When an enemy falters, you may trigger one of the
following counters. <strong>Backbiters</strong> are simply part of what
makes an Augmerc dangerous.</p>
```

---

## Flavor Text

An italic variant of body prose used for in-world voice, atmospheric quotes, and short dramatic lines. Add the `.flavor` modifier to `.dc-prose`.

**Syntax** — `<p class="dc-prose flavor">…</p>`

<p class="dc-prose flavor">See an opening, ya take it. Best time to hit 'em is when they think it's over.</p>

```html
<p class="dc-prose flavor">See an opening, ya take it. Best time to hit
'em is when they think it's over.</p>
```

---

## Intro Lede

A slightly larger, heavier opening paragraph used at the top of a chapter or major section. The `.flush` modifier removes the default top margin so it sits immediately under the chapter title.

**Syntax** — `<div class="dc-intro flush">…</div>`

<div class="dc-intro flush">An Augmerc is muscle for hire. Street thugs, corporate bodyguards, deniable enforcers — the difference is gear, grafts, and how much of them is still original.</div>

```html
<div class="dc-intro flush">An Augmerc is muscle for hire. Street thugs,
corporate bodyguards, deniable enforcers — the difference is gear, grafts,
and how much of them is still original.</div>
```

---

## Note

A boxed aside for rules clarifications, reminders, and supplementary information. Uses a distinct left-border accent and a labeled header to separate it from body prose.

**Syntax** — `<div class="dc-note">…</div>` with an inner `<span class="dc-note-label">` for the label

<div class="dc-note">
  <span class="dc-note-label">Note</span>
  <p>Free counters trigger only once per round. Pick the one that hurts most.</p>
</div>

```html
<div class="dc-note">
  <span class="dc-note-label">Note</span>
  <p>Free counters trigger only once per round. Pick the one that hurts most.</p>
</div>
```

---

## Warning

A high-visibility callout for rules that have critical consequences or are frequently misread. Uses the same structure as `.dc-note` but renders in amber to signal elevated importance.

**Syntax** — `<div class="dc-note warning">…</div>`

<div class="dc-note warning">
  <span class="dc-note-label">Warning</span>
  <p>Trauma Patches stabilize a dying character but do not restore HP. A character at 0 HP with a Patch applied is still incapacitated — they can take no actions until healed above 0.</p>
</div>

```html
<div class="dc-note warning">
  <span class="dc-note-label">Warning</span>
  <p>Trauma Patches stabilize a dying character but do not restore HP.
  A character at 0 HP with a Patch applied is still incapacitated — they
  can take no actions until healed above 0.</p>
</div>
```

---

## Pull Quote

A large-format excerpt set off with accent rules above and below. Use sparingly — one per chapter or major section at most. The `.flush` modifier removes the default side margins for full-column impact.

**Syntax** — `<div class="dc-pullquote flush">…</div>` with an optional `<span class="dc-pullquote-attr">` for attribution

<div class="dc-pullquote flush">
  The rig braces and answers every swing.
  <span class="dc-pullquote-attr">Field manual, second draft</span>
</div>

```html
<div class="dc-pullquote flush">
  The rig braces and answers every swing.
  <span class="dc-pullquote-attr">Field manual, second draft</span>
</div>
```

---

## Tape Divider

A horizontal section break styled as a piece of torn tape or a label strip. Use to visually separate major sections within a page without starting a new chapter. The `.flush` modifier extends the tape edge to edge.

**Syntax** — `<div class="dc-tape flush">…</div>`

<div class="dc-tape flush">Section Break</div>

```html
<div class="dc-tape flush">Section Break</div>
```

---

## Section H3 Divider

A compact, high-contrast H3 heading for use inside dense multi-column reference layouts. Designed to remain legible at narrow column widths without the decorative weight of a full chapter subhead.

**Syntax** — `<h3 class="dc-section-h3">…</h3>`

<h3 class="dc-section-h3">Cybernetics & Augments</h3>

```html
<h3 class="dc-section-h3">Cybernetics & Augments</h3>
```

---

## Vibe Callout

A full-width atmospheric block for in-world voice that establishes the emotional or cultural register of a section. Typically placed at the top of a chapter or faction entry before the rules content begins.

**Syntax** — `::: wrapper {.dc-vibe-callout}` … `:::` in markdown, or raw `<div class="dc-vibe-callout">` in HTML

<div class="dc-vibe-callout"><p>The Gutterdruid doesn't fight because they have to — they fight because something feral in them still remembers what it felt like to be free.</p></div>

```markdown
::: wrapper {.dc-vibe-callout}
The Gutterdruid doesn't fight because they have to — they fight because
something feral in them still remembers what it felt like to be free.
:::
```

---

## Origin Callout

A second-person backstory block that addresses the reader as their character, used for origin and background entries. Draws the reader into the fiction by making them the subject of the narrative.

**Syntax** — `<div class="dc-origin-callout">…</div>`

<div class="dc-origin-callout"><p>You didn't choose the street — the street chose you. Before the grafts, before the crew, there was just hunger and the particular talent for surviving what should have killed you. That's enough. That's always been enough.</p></div>

```html
<div class="dc-origin-callout">
  <p>You didn't choose the street — the street chose you. Before the
  grafts, before the crew, there was just hunger and the particular talent
  for surviving what should have killed you. That's enough. That's always
  been enough.</p>
</div>
```

---

## Human Callout (NPC Sidebar)

A compact NPC stat block nested inside a `.sidebar` float. Displays name, role, and key stats in a tight format suited for margin or column-gutter placement.

**Syntax** — `<div class="sidebar"><div class="dc-human-callout">…</div></div>`

<div class="sidebar"><div class="dc-human-callout"><p><strong>Rennick "Two-Tab" Farrow</strong></p><p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p></div></div>

```html
<div class="sidebar">
  <div class="dc-human-callout">
    <p><strong>Rennick "Two-Tab" Farrow</strong></p>
    <p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p>
  </div>
</div>
```

---

## Gear Callout

A named equipment block for weapons, armor, and notable items. Groups the item name, type, and mechanical properties in a scannable panel distinct from body prose.

**Syntax** — `<div class="dc-gear-callout">…</div>`

<div class="dc-gear-callout"><p><strong>Ripper Blades (Mk II)</strong></p><p>Melee. Damage 1d8+STR. <em>Serrated:</em> on a critical hit, the target bleeds for 1d4 damage at the start of their next turn.</p></div>

```html
<div class="dc-gear-callout">
  <p><strong>Ripper Blades (Mk II)</strong></p>
  <p>Melee. Damage 1d8+STR. <em>Serrated:</em> on a critical hit, the
  target bleeds for 1d4 damage at the start of their next turn.</p>
</div>
```

---

## Item Block

A self-contained rules item — ability, move, or equipment entry — wrapped in a fenced container with a structured heading. The `.item` wrapper keeps the block together across page breaks.

**Syntax** — `::: wrapper {.item}` … `:::` with a `###` title inside

::: wrapper {.item}
### Hardline Graft

**Passive.** Your cybernetic frame absorbs the first 2 points of physical damage you take each round. This reduction applies before armor.

*When you're fully wired, hits just feel like feedback.*
:::

```markdown
::: wrapper {.item}
### Hardline Graft

**Passive.** Your cybernetic frame absorbs the first 2 points of physical
damage you take each round. This reduction applies before armor.

*When you're fully wired, hits just feel like feedback.*
:::
```

---

## Table

Standard markdown tables automatically receive DC styling: a colored header row, alternating row fills, and body text set at the small type scale. No extra syntax required.

**Syntax** — Standard markdown pipe table

| Augment | Slot | Effect |
|---------|------|--------|
| Reflex Booster | Legs | +2 to initiative rolls |
| Subdermal Plating | Torso | Reduce incoming damage by 1 |
| Optic Splice | Head | Ignore darkness penalties |
| Neural Tap | Head | +1 die on Hack and Interface checks |

```markdown
| Augment          | Slot   | Effect                              |
|------------------|--------|-------------------------------------|
| Reflex Booster   | Legs   | +2 to initiative rolls              |
| Subdermal Plating| Torso  | Reduce incoming damage by 1         |
| Optic Splice     | Head   | Ignore darkness penalties           |
| Neural Tap       | Head   | +1 die on Hack and Interface checks |
```

---

## Blockquote

For epigraphs, thematic quotes, and attributed in-world text. Styled with an accent-alt left border and italic body text. Attribution goes on its own line prefixed with an em dash.

**Syntax** — Standard markdown `>` blockquote

> Every city has a language. Dimm City's is neon, static, and the sound of someone's implants glitching at 3am.
>
> — Hollis Vance, *Street Anthropology Vol. 4*

```markdown
> Every city has a language. Dimm City's is neon, static, and the sound
> of someone's implants glitching at 3am.
>
> — Hollis Vance, *Street Anthropology Vol. 4*
```

---

## Code Blocks

Fenced code blocks for CSS snippets, stat expressions, or any literal syntax. Rendered with an orange left border, cream background, and Tomorrow monospace. No extra class required.

**Syntax** — Triple-backtick fenced block with an optional language hint

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

````markdown
```css
.dc-note {
  border-left: 3pt solid var(--color-accent);
}
```
````

---

## Visit Callout

An in-world location description written in present tense, as if the reader is arriving on-site. Use on location pages and before encounter content to establish place before mechanics begin.

**Syntax** — `::: wrapper {.dc-visit-callout}` … `:::` in markdown, or raw `<div class="dc-visit-callout">` in HTML

<div class="dc-visit-callout"><p>The Neon Bazaar doesn't close. Day shift workers and third-shift scavengers brush shoulders between stalls selling augment cartridges, black-market permits, and fried synthetic crab. If someone's selling it somewhere in Dimm City, it started here.</p></div>

```html
<div class="dc-visit-callout">
  <p>The Neon Bazaar doesn't close. Day shift workers and third-shift
  scavengers brush shoulders between stalls selling augment cartridges,
  black-market permits, and fried synthetic crab.</p>
</div>
```

---

## Admonition Block

A Dream Master–addressed instruction block, visually distinct from player-facing notes. Use for GM guidance, scene hooks, and pacing advice that should not be read aloud at the table.

**Syntax** — raw HTML `<div class="dc-note-callout">` with a `<strong class="dc-note-label">` header followed by the body paragraph

<div class="dc-note-callout">
  <strong class="dc-note-label">Dream Master Note</strong>
  <p>If a player hasn't chosen their starting gear by the end of session zero, hand them a Scavenger Pack and move on. Gear anxiety is real but the game shouldn't wait for it.</p>
</div>

```html
<div class="dc-note-callout">
  <strong class="dc-note-label">Dream Master Note</strong>
  <p>If a player hasn't chosen their starting gear by the end of session zero,
  hand them a Scavenger Pack and move on.</p>
</div>
```

---

## Glossary / Term List

A definition list of game terms rendered as a styled block. Use for rules glossaries, jargon indexes, and any list of named concepts that need consistent, scannable formatting.

**Syntax** — raw HTML `.dc-terms` wrapper (alias: `.terms`) containing one or more `.dc-terms-list` items (alias: `.terms-list`), each with a `<strong>` term label and a `<p>` definition

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

---

## Numbered Procedure

A zero-padded ordered list for sequential rules — character creation, contract resolution, scene framing. Each step is kept together across page breaks by Paged.js.

**Syntax** — raw HTML `<ol class="dc-steps">` with `<li><span class="dc-step-no">01</span><span>content</span></li>` for each step; zero-pad all step numbers

<ol class="dc-steps flush">
  <li><span class="dc-step-no">01</span><span><strong>Pick a Spec.</strong> Augmerc, Proxy, Streetwarden — one of eight. Your spec sets your starting paths and signature gear.</span></li>
  <li><span class="dc-step-no">02</span><span><strong>Spend 6 Spec Points.</strong> Distribute across paths. Each point unlocks one tier. You may not exceed tier 3 at character creation.</span></li>
  <li><span class="dc-step-no">03</span><span><strong>Take a Signature Augment.</strong> Pulled from your spec's gear list. Free at start. Replaceable later only by a Cybersurgeon contact.</span></li>
  <li><span class="dc-step-no">04</span><span><strong>Roll your Heat.</strong> d20 + Spec modifier. Heat is what the city already has against you when play begins.</span></li>
  <li><span class="dc-step-no">05</span><span><strong>Name a Debt.</strong> One contract you owe, one person you owe it to. The Dream Master may call it in.</span></li>
</ol>

```html
<ol class="dc-steps flush">
  <li>
    <span class="dc-step-no">01</span>
    <span><strong>Pick a Spec.</strong> Augmerc, Proxy, Streetwarden —
    one of eight.</span>
  </li>
  <li>
    <span class="dc-step-no">02</span>
    <span><strong>Spend 6 Spec Points.</strong> Distribute across paths.</span>
  </li>
</ol>
```

---

## Outcome Ladder

The five-rung d20 result table used for all rolls in Dimm City. Each row is color-coded by result severity via a modifier class on the row element.

**Syntax** — raw HTML `.dc-outcomes` wrapper containing `.dc-outcome-row.{crit|hit|mixed|miss|fail}` rows, each with `.dc-outcome-key` (holding `.dc-outcome-name` and `.dc-outcome-roll`) and `.dc-outcome-text`

<div class="dc-outcomes flush">
  <div class="dc-outcome-row crit">
    <div class="dc-outcome-key"><span class="dc-outcome-name">Crit</span><span class="dc-outcome-roll">20</span></div>
    <div class="dc-outcome-text">You flow. Automatic success — no further roll needed. If dealing damage, check your weapon's bonus stats. Your next die roll: <span class="dc-roll-lucid roll-lucid">ROLL LUCID.</span></div>
  </div>
  <div class="dc-outcome-row hit">
    <div class="dc-outcome-key"><span class="dc-outcome-name">Hit</span><span class="dc-outcome-roll">11–19</span></div>
    <div class="dc-outcome-text">You succeed at what you were trying to do without a hitch. If attacking, deal standard damage based on your weapon's stats.</div>
  </div>
  <div class="dc-outcome-row mixed">
    <div class="dc-outcome-key"><span class="dc-outcome-name">Hard Choice</span><span class="dc-outcome-roll">6–10</span></div>
    <div class="dc-outcome-text">You succeed, but at a cost. Weapon overheats, ammo burns, or something else gives. The DM offers two impactful options — pick one.</div>
  </div>
  <div class="dc-outcome-row miss">
    <div class="dc-outcome-key"><span class="dc-outcome-name">Miss</span><span class="dc-outcome-roll">2–5</span></div>
    <div class="dc-outcome-text">You fail. The only consequence is what you had riding on the roll. Miss an opponent in a duel? They get to attack you on their turn.</div>
  </div>
  <div class="dc-outcome-row fail">
    <div class="dc-outcome-key"><span class="dc-outcome-name">Catastrophe</span><span class="dc-outcome-roll">1</span></div>
    <div class="dc-outcome-text">Dark. Automatic fail with a severe setback — broken gear, cyberware malfunction, or friendly fire. Your next die roll: <span class="dc-roll-surreal roll-surreal">ROLL SURREAL.</span></div>
  </div>
</div>

```html
<div class="dc-outcomes flush">
  <div class="dc-outcome-row crit">
    <div class="dc-outcome-key">
      <span class="dc-outcome-name">Crit</span>
      <span class="dc-outcome-roll">20</span>
    </div>
    <div class="dc-outcome-text">Automatic success…</div>
  </div>
  <!-- repeat for hit / mixed / miss / fail -->
</div>
```

---

## Component Token Reference {.break-before}

| Class | Element | Purpose |
|-------|---------|---------|
| `.dc-prose` | `<p>`, `<div>` | Base body text with DC type scale and leading |
| `.dc-prose.flavor` | `<p>` | Italic atmospheric or in-world voice text |
| `.dc-intro` | `<div>` | Larger opening lede paragraph for chapters or sections |
| `.dc-intro.flush` | `<div>` | Lede with top margin removed for tight chapter openers |
| `.dc-note` | `<div>` | Rules clarification or supplementary aside, accent border |
| `.dc-note.warning` | `<div>` | High-priority rules note in amber, same structure as `.dc-note` |
| `.dc-pullquote` | `<div>` | Large-format excerpt with accent rules above and below |
| `.dc-pullquote.flush` | `<div>` | Pull quote extended to full column width |
| `.dc-tape` | `<div>` | Tape-strip section divider for within-page breaks |
| `.dc-tape.flush` | `<div>` | Tape divider extended edge to edge |
| `.dc-section-h3` | `<h3>` | Compact reference H3 for multi-column dense layouts |
| `.dc-vibe-callout` | `<div>` | Full-width atmospheric callout for in-world voice |
| `.dc-origin-callout` | `<div>` | Second-person backstory block for origin and background entries |
| `.dc-human-callout` | `<div>` (inside `.sidebar` / `.dc-sidebar`) | NPC stat block nested in a sidebar float |
| `.dc-gear-callout` | `<div>` | Named equipment or item panel |
| `.dc-visit-callout` | `<div>` | Present-tense in-world location description |
| `.dc-note-callout` | `<div>` | Dream Master–addressed admonition block with `.dc-note-label` header |
| `.dc-terms` (alias: `.terms`) | `<div>` | Glossary wrapper containing one or more `.dc-terms-list` children |
| `.dc-terms-list` (alias: `.terms-list`) | `<div>` | Individual term definition with `<strong>` label and `<p>` body |
| `.dc-steps` | `<ol>` | Zero-padded numbered procedure list with `.dc-step-no` spans |
| `.dc-outcomes` | `<div>` | Outcome ladder wrapper for five-rung d20 result table |
| `.dc-outcome-row.{crit\|hit\|mixed\|miss\|fail}` | `<div>` | Single outcome row, color-coded by severity modifier class |
| `.dc-roll-lucid` (alias: `.roll-lucid`) | `<span>` | Inline badge for "ROLL LUCID" state on a critical hit result |
| `.dc-roll-surreal` (alias: `.roll-surreal`) | `<span>` | Inline badge for "ROLL SURREAL" state on a catastrophe result |
| `.item` (wrapper) | `::: wrapper {.item}` | Self-contained rules item block, break-inside avoided |
| *(auto)* | markdown table | DC-styled table: colored header, alternating rows, small type |
| *(auto)* | `> blockquote` | Accent-border block quote for epigraphs and attribution |

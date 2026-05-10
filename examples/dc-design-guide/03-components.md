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

**Syntax** — `::: wrapper {.vibe-callout}` … `:::` in markdown, or raw `<div class="vibe-callout">` in HTML

<div class="vibe-callout"><p>The Gutterdruid doesn't fight because they have to — they fight because something feral in them still remembers what it felt like to be free.</p></div>

```markdown
::: wrapper {.vibe-callout}
The Gutterdruid doesn't fight because they have to — they fight because
something feral in them still remembers what it felt like to be free.
:::
```

---

## Origin Callout

A second-person backstory block that addresses the reader as their character, used for origin and background entries. Draws the reader into the fiction by making them the subject of the narrative.

**Syntax** — `<div class="origin-callout">…</div>`

<div class="origin-callout"><p>You didn't choose the street — the street chose you. Before the grafts, before the crew, there was just hunger and the particular talent for surviving what should have killed you. That's enough. That's always been enough.</p></div>

```html
<div class="origin-callout">
  <p>You didn't choose the street — the street chose you. Before the
  grafts, before the crew, there was just hunger and the particular talent
  for surviving what should have killed you. That's enough. That's always
  been enough.</p>
</div>
```

---

## Human Callout (NPC Sidebar)

A compact NPC stat block nested inside a `.sidebar` float. Displays name, role, and key stats in a tight format suited for margin or column-gutter placement.

**Syntax** — `<div class="sidebar"><div class="human-callout">…</div></div>`

<div class="sidebar"><div class="human-callout"><p><strong>Rennick "Two-Tab" Farrow</strong></p><p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p></div></div>

```html
<div class="sidebar">
  <div class="human-callout">
    <p><strong>Rennick "Two-Tab" Farrow</strong></p>
    <p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p>
  </div>
</div>
```

---

## Gear Callout

A named equipment block for weapons, armor, and notable items. Groups the item name, type, and mechanical properties in a scannable panel distinct from body prose.

**Syntax** — `<div class="gear-callout">…</div>`

<div class="gear-callout"><p><strong>Ripper Blades (Mk II)</strong></p><p>Melee. Damage 1d8+STR. <em>Serrated:</em> on a critical hit, the target bleeds for 1d4 damage at the start of their next turn.</p></div>

```html
<div class="gear-callout">
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

## Component Token Reference

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
| `.vibe-callout` | `<div>` | Full-width atmospheric callout for in-world voice |
| `.origin-callout` | `<div>` | Second-person backstory block for origin and background entries |
| `.human-callout` | `<div>` (inside `.sidebar`) | NPC stat block nested in a sidebar float |
| `.gear-callout` | `<div>` | Named equipment or item panel |
| `.item` (wrapper) | `::: wrapper {.item}` | Self-contained rules item block, break-inside avoided |
| *(auto)* | markdown table | DC-styled table: colored header, alternating rows, small type |
| *(auto)* | `> blockquote` | Accent-border block quote for epigraphs and attribution |
| *(auto)* | ` ``` ` fenced block | Code block: orange border, cream background, Tomorrow mono |

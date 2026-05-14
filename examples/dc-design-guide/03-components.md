@chapter #ch-components .components .chapter-01 ch="1"

# Core Components

:::lede
The base prose and callout layer. These components work in all chapter types without needing a specialty or learning-path wrapper.
:::

---

## Body Prose

Default text style for all narrative and rules content. Standard markdown paragraphs automatically inherit the DC type scale, leading, and color — no class or wrapper required.

```markdown
When an enemy falters, you may trigger one of the following counters.
**Backbiters** are simply part of what makes an Augmerc dangerous.
```

---

## Flavor Text

Italic in-world voice for card flavor and atmospheric lines. Inside `@skill` cards the `>` blockquote line is auto-styled; for standalone flavor paragraphs use `> [!FLAVOR]`.

```markdown
> [!FLAVOR]
> See an opening, ya take it. Best time to hit 'em is when they think it's over.
```

---

## Intro Lede

Slightly larger opening paragraph at the top of a chapter or major section. **Syntax** — `:::lede` … `:::` (canonical)

```markdown
:::lede
An Augmerc is muscle for hire. Street thugs, corporate bodyguards,
deniable enforcers — the difference is gear, grafts, and how much
of them is still original.
:::
```

> **Canonical path:** `:::lede` … `:::` is the preferred shorthand for intro text. Older documents may still mention `.dc-intro`, but new authoring should use `:::lede`.

---

## Note

Boxed rules clarification with a labeled header and left-border accent. **Syntax** — `> [!NOTE]`

> **Component pattern:** `.dc-alert` is the alert shell. `dc-note`, `dc-vibe-callout`, `dc-origin-callout`, `dc-visit-callout`, `dc-gear-callout`, and `dc-dm-note` are thin variants layered on top of that shell, overriding only the properties that actually change.

```markdown
> [!NOTE]
> Free counters trigger only once per round. Pick the one that hurts most.
```

> [!NOTE]
> Free counters trigger only once per round. Pick the one that hurts most.

---

## Warning

High-visibility callout in amber for rules with critical consequences. **Syntax** — `> [!WARNING]`

```markdown
> [!WARNING]
> Trauma Patches stabilize a dying character but do not restore HP. A character
> at 0 HP with a Patch applied is still incapacitated.
```

> [!WARNING]
> Trauma Patches stabilize a dying character but do not restore HP. A character
> at 0 HP with a Patch applied is still incapacitated.

---

## Pull Quote

Large-format excerpt with accent rules above and below. Use sparingly — one per chapter. **Syntax** — `> [!PULLQUOTE]` (preferred)

```markdown
> [!PULLQUOTE]
> The rig braces and answers every swing.
>
> Field manual, second draft
```

> [!PULLQUOTE]
> The rig braces and answers every swing.
>
> Field manual, second draft

> **Legacy path:** `:::pull-quote` … `:::` is the older container form. Prefer `> [!PULLQUOTE]` for consistency with other callout types.

---

## Tape Divider

Horizontal section break styled as a torn-tape strip. `.flush` extends edge to edge. **Syntax** — `<div class="dc-tape flush">…</div>`

```html
<div class="dc-tape flush">Section Break</div>
```

---

## Vibe Callout

Full-width atmospheric block for in-world voice at the top of a chapter or faction entry. **Syntax** — `> [!VIBE]`

```markdown
> [!VIBE]
> The Gutterdruid doesn't fight because they have to — they fight because
> something feral in them still remembers what it felt like to be free.
```

> [!VIBE]
> The Gutterdruid doesn't fight because they have to — they fight because
> something feral in them still remembers what it felt like to be free.

---

## Origin Callout

Second-person backstory block addressing the reader as their character. **Syntax** — `> [!ORIGIN]`

```markdown
> [!ORIGIN]
> You didn't choose the street — the street chose you. Before the grafts,
> before the crew, there was just hunger and the particular talent for
> surviving what should have killed you.
```

> [!ORIGIN]
> You didn't choose the street — the street chose you. Before the grafts,
> before the crew, there was just hunger and the particular talent for
> surviving what should have killed you.

---

## Human Callout (NPC Sidebar)

Compact NPC stat block inside a `.dc-sidebar` float. **Syntax** — `<div class="dc-sidebar"><div class="dc-human-callout">…</div></div>`

```html
<div class="dc-sidebar">
  <div class="dc-human-callout">
    <p><strong>Rennick "Two-Tab" Farrow</strong></p>
    <p>Fixer. HP 8 | DEF 11 | Intimidate +4.</p>
  </div>
</div>
```

---

## Gear Callout

Named equipment block for weapons, armor, and notable items. **Syntax** — `> [!GEAR]`

```markdown
> [!GEAR]
> **Ripper Blades (Mk II)**
>
> Melee. Damage 1d8+STR. *Serrated:* on a critical hit, the target bleeds
> for 1d4 damage at the start of their next turn.
```

> [!GEAR]
> **Ripper Blades (Mk II)**
>
> Melee. Damage 1d8+STR. *Serrated:* on a critical hit, the target bleeds
> for 1d4 damage at the start of their next turn.

---

## Table

Standard markdown tables receive DC styling automatically: colored header row, alternating fills, small type scale. **Syntax** — standard markdown pipe table

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

Epigraphs and attributed in-world text with accent-alt left border and italic body. **Syntax** — standard markdown `>` blockquote

```markdown
> Every city has a language. Dimm City's is neon, static, and the sound
> of someone's implants glitching at 3am.
>
> — Hollis Vance, *Street Anthropology Vol. 4*
```

---

## Code Blocks

Fenced code blocks with orange left border, cream background, and Tomorrow monospace. **Syntax** — triple-backtick fenced block with optional language hint

````markdown
```css
.dc-note {
  border-left: 3pt solid var(--color-accent);
}
```
````

---

## Visit Callout

In-world location description in present tense, placed before encounter content. **Syntax** — `> [!VISIT]`

```markdown
> [!VISIT]
> The Neon Bazaar doesn't close. Day shift workers and third-shift scavengers
> brush shoulders between stalls selling augment cartridges, black-market
> permits, and fried synthetic crab.
```

> [!VISIT]
> The Neon Bazaar doesn't close. Day shift workers and third-shift scavengers
> brush shoulders between stalls selling augment cartridges, black-market
> permits, and fried synthetic crab.

---

## Dream Master Note

Dream Master–addressed instruction block for GM guidance and scene hooks, visually distinct from player-facing notes. **Syntax** — `> [!DM]`

```markdown
> [!DM]
> If a player hasn't chosen their starting gear by the end of session zero,
> hand them a Scavenger Pack and move on.
```

> [!DM]
> If a player hasn't chosen their starting gear by the end of session zero,
> hand them a Scavenger Pack and move on.

---

## Glossary / Term List

Definition list of game terms rendered as a styled block. **Syntax** — raw HTML `.dc-terms` wrapper

```html
<div class="dc-terms">
  <div class="dc-terms-item">
    <strong>Augmerc</strong>
    <p>A specialist who combines cybernetic augmentation with close-range combat training.</p>
  </div>
  <div class="dc-terms-item">
    <strong>Hard Choice</strong>
    <p>A roll result where the fiction advances but at a cost.</p>
  </div>
</div>
```

---

## Numbered Procedure

Zero-padded ordered list for sequential rules. **Syntax** — `@procedure` … `@end-procedure` with a standard ordered list inside

```markdown
@procedure
1. **Pick a Spec.** Augmerc, Proxy, Streetwarden — one of eight.
2. **Spend 6 Spec Points.** Distribute across paths.
3. **Take a Signature Augment.** Free at character creation.
@end-procedure
```

---

## Outcome Ladder

Five-rung d20 result table for all rolls. Each row is color-coded by result severity. **Syntax** — `@outcome` … `@end-outcome` macro; columns: `roll | name | description`

```
@outcome
20 | Crit | You flow. Automatic success — no further roll needed.
11–19 | Hit | You succeed at what you were trying to do without a hitch.
6–10 | Hard Choice | You succeed, but at a cost.
2–5 | Miss | You fail. The only consequence is what you had riding on the roll.
1 | Catastrophe | Dark. Automatic fail with a severe setback.
@end-outcome
```

---

## Component Token Reference {.pmd-break-before}

| Component | Authoring method | CSS class / output |
|-----------|-----------------|-------------------|
| Body Prose | Plain markdown paragraph | *(auto)* |
| Flavor Text | `> [!FLAVOR]` blockquote alert | `.dc-alert`, `.dc-flavor` |
| Intro Lede | `:::lede` … `:::` | `.dc-intro` |
| Note | `> [!NOTE]` blockquote alert | `.dc-note` |
| Warning | `> [!WARNING]` blockquote alert | `.dc-note.warning` |
| Pull Quote | `> [!PULLQUOTE]` blockquote alert | `.dc-pullquote.flush` |
| Tape Divider | `<div class="dc-tape flush">…</div>` | `.dc-tape`, `.flush` |
| Vibe Callout | `> [!VIBE]` blockquote alert | `.dc-vibe-callout` |
| Origin Callout | `> [!ORIGIN]` blockquote alert | `.dc-origin-callout` |
| Human Callout | Raw HTML inside `.dc-sidebar` | `.dc-human-callout` |
| Gear Callout | `> [!GEAR]` blockquote alert | `.dc-gear-callout` |
| Table | Standard markdown pipe table | *(auto)* |
| Blockquote | Standard markdown `>` blockquote | *(auto)* |
| Code Block | Triple-backtick fenced block | *(auto)* |
| Visit Callout | `> [!VISIT]` blockquote alert | `.dc-visit-callout` |
| Dream Master Note | `> [!DM]` blockquote alert | `.dc-dm-note` |
| Glossary / Term List | Raw HTML `.dc-terms` wrapper | `.dc-terms` |
| Numbered Procedure | `@procedure` … `@end-procedure` ordered list | `.dc-steps` |
| Outcome Ladder | `@outcome` … `@end-outcome` macro | `.dc-outcomes`, `.dc-outcome-row` |
| Roll Lucid badge | auto via `@outcome` Crit row | `.dc-roll-lucid` |
| Roll Surreal badge | auto via `@outcome` Catastrophe row | `.dc-roll-surreal` |

---

## See It In Action

These examples show the above components rendered in real book pages using actual Dimm City Field Guide content.

- [Front Matter & TOC](#ch-example-front-matter) — credits, TOC, intro pages
- [Chapter Openers](#ch-example-chapter-opener) — chapter start spreads
- [Specialty Overview](#ch-example-specialty-overview) — chapter-02 specialty intro pages with vibe callouts and origin blocks
- [Specialty Profile](#ch-example-specialty-profile) — full specialty spread with flavor text and pull quotes
- [Rules & Mechanics](#ch-example-rules) — outcome ladder, notes, warnings, numbered procedures in context
- [Dream Master Pages](#ch-example-dm-npcs) — DM notes, NPC sidebars, encounter hooks
- [Gear & Tech](#ch-example-gear-tech) — gear callouts, tables, and cybernetics rules

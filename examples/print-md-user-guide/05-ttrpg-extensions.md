# TTRPG Extensions {#ch-ttrpg}

<div class="lede">Print-md includes specialized markdown syntax for tabletop RPG content. Enable the TTRPG plugin in your manifest and you get stat blocks, dice notation, cross-references, trait callouts, and challenge ratings.</div>

## Enabling TTRPG Features

Add the plugin to your `manifest.yaml`:

```yaml
plugins:
  - ttrpg
```

This enables all TTRPG-specific syntax features documented in this chapter.

## Stat Blocks

Inline character and monster stats use curly-brace syntax:

```markdown
The goblin {HP:12 AC:14 DMG:1d6+2} attacks from the shadows.

Boss encounter: {HP:85 AC:18 DMG:2d8+5 STR:18 DEX:12}
```

### Stat block syntax

- Wrap stats in curly braces: `{STAT:value}`
- Separate multiple stats with spaces
- Common stats: `HP`, `AC`, `DMG`, `STR`, `DEX`, `CON`, `INT`, `WIS`, `CHA`
- Values can be numbers, dice notation, or text

Stat blocks render as styled inline components with consistent label-and-value formatting designed for print.

## Dice Notation

Dice expressions are automatically detected and styled:

```markdown
Roll 2d6+3 for damage.

The dragon breathes fire for 10d10 damage!

Make a DC 15 check or take 3d8-2 damage.
```

### Supported formats

@section

| Format | Example |
|--------|---------|
| Basic | `1d6`, `2d8`, `3d10` |
| With modifier | `2d6+3`, `1d20-2` |
| Percentile | `1d100`, `d%` |
| Any die size | `1d4`, `1d12`, `2d20` |

@end-section

Dice notation renders with a 🎲 icon and monospace font in preview mode, and clean styled formatting in the PDF.

## Cross-References

Link to game elements using `@[...]` syntax:

```markdown
The @[shadowkin] emerges from darkness.

Check @[ITEM:flickerblade] in the equipment section.

See @[NPC:investigator] for full details.
```

### Syntax

Two formats:

1. **Simple reference:** `@[identifier]` → links to `#ref-identifier`
2. **Typed reference:** `@[TYPE:identifier]` → links to `#type-identifier`

### Reference types

| Type | Example | Links to |
|------|---------|----------|
| `NPC` | `@[NPC:guard-captain]` | `#npc-guard-captain` |
| `ITEM` | `@[ITEM:sword-of-flames]` | `#item-sword-of-flames` |
| `SPELL` | `@[SPELL:fireball]` | `#spell-fireball` |
| `LOCATION` | `@[LOCATION:ironhold]` | `#location-ironhold` |
| `FACTION` | `@[FACTION:night-guild]` | `#faction-night-guild` |
| `CREATURE` | `@[CREATURE:goblin]` | `#creature-goblin` |

## Trait & Ability Callouts

Highlight special abilities inline with `::trait[...]` and `::ability[...]`:

```markdown
The creature has ::trait[Shadow Step] — it can teleport up to 60 feet.

Its primary attack is ::ability[Umbral Strike].
```

Traits render with a ⚡ icon; abilities with a 💫 icon. Both get colored highlighting distinct from standard inline text.

## Challenge Ratings

Display encounter difficulty with `CR:NUMBER`:

```markdown
CR:3 encounter ahead!

Boss fight: CR:12
```

Challenge ratings are automatically colored by difficulty:

@section

| CR Range | Difficulty | Color |
|----------|-----------|-------|
| 1–3 | Easy | Green |
| 4–7 | Medium | Yellow |
| 8–12 | Hard | Orange |
| 13+ | Deadly | Red |

@end-section

## Complete Example

A full creature entry combining all TTRPG features. Start with a page break and the creature heading:

```markdown
@page

## Shadow Assassin
```

Add the challenge rating and a cross-reference to the creature type:

```markdown
CR:8

The @[shadowkin] emerges from darkness with deadly precision.
```

Inline stat block, traits, and abilities together:

```markdown
**Stats:** {HP:68 AC:16 DMG:2d6+4 STR:10 DEX:18 CON:12 INT:14 WIS:12 CHA:8}

- ::trait[Shadow Step]: Teleport up to 60 feet (recharge 5–6)
- ::ability[Umbral Strike]: 2d6+4 slashing + 2d8 necrotic
```

Combat and equipment using dice notation and item cross-references:

```markdown
**Combat:** DC 15 Dexterity save or take 4d6 damage.
Roll 1d20+6 for stealth checks.

**Equipment:** Carries @[ITEM:flickerblade] and a shadow cloak.
```

## Best Practices

### Consistency

- Use the same stat format throughout your document
- Stick to established dice notation conventions
- Keep cross-reference types consistent (don't mix `NPC` and `npc`)

### Print considerations

All TTRPG features are optimized for print output:

- No emoji dependency — icons are pure CSS
- No color-only indicators — structure and typography carry meaning too
- Proper page break handling
- WCAG AA color contrast ratios

### When not to use TTRPG extensions

TTRPG extensions are for game content. For general documentation, fiction, or other non-game books, standard markdown is sufficient — the plugin adds rendering overhead and game-specific visual conventions that look out of place in non-game contexts.

## Combining with Other Features

TTRPG extensions work alongside all other Print-md features:

```markdown
@page

## Monsters

The orc {HP:15 AC:13 DMG:1d12+3} lurks at CR:2.

> [!warning]
> This creature has ::trait[Pack Tactics] — it attacks with advantage
> when an ally is adjacent.

| Creature | CR  | HP      | AC |
|----------|-----|---------|----|
| Goblin   | CR:1 | {HP:7}  | 15 |
| Orc      | CR:2 | {HP:15} | 13 |
```

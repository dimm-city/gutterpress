# TTRPG Extensions

Specialized markdown syntax for tabletop RPG content.

## Enabling TTRPG Features

In `manifest.yaml`:

```yaml
plugins:
  - ttrpg
```

This enables all TTRPG-specific markdown features.

## Stat Blocks (Inline)

Quick inline stats for characters or monsters:

```markdown
The goblin {HP:12 AC:14 DMG:1d6+2} attacks!

Boss monster {HP:85 AC:18 DMG:2d8+5 STR:18 DEX:12}
```

### Syntax

- Wrap stats in curly braces: `{STAT:value}`
- Separate multiple stats with spaces
- Common stats: HP, AC, DMG, STR, DEX, CON, INT, WIS, CHA
- Values can be numbers, dice notation, or text

### Rendering

Stat blocks render as:
- Styled inline components
- Label and value formatting
- Consistent typography
- Print-safe styling

## Dice Notation

Automatic dice formatting:

```markdown
Roll 2d6+3 for damage.

The dragon breathes fire for 10d10 damage!

Make a DC 15 check or take 3d8-2 damage.
```

### Supported Formats

- Basic: `1d6`, `2d8`, `3d10`
- With modifier: `2d6+3`, `1d20-2`
- Any sided die: `1d4`, `1d100`

### Rendering

Dice notation gets styled with:
- 🎲 icon
- Monospace font
- Interactive hover styling (in preview mode)
- Proper inline formatting
- Print-safe colors

## Cross-References

Link to game elements:

```markdown
The @[shadowkin] appears from the darkness.

Check the @[ITEM:flickerblade] in the equipment section.

See @[NPC:investigator] for details.
```

### Syntax

Two formats supported:

1. **Simple reference:** `@[identifier]`
   - Example: `@[shadowkin]`
   - Generates link to `#ref-shadowkin`

2. **Typed reference:** `@[TYPE:identifier]`
   - Example: `@[NPC:investigator]`
   - Generates link to `#npc-investigator`

### Common Types

- `NPC` - Non-player characters
- `ITEM` - Items and equipment
- `SPELL` - Spells and abilities
- `LOCATION` - Places and areas
- `FACTION` - Organizations and groups
- `CREATURE` - Monsters and creatures

### Rendering

Cross-references render as:
- Formatted links with type-specific styling
- Auto-generated anchor links
- Hover tooltips with type and name
- Print-safe colors

## Trait & Ability Callouts

Highlight special abilities inline:

```markdown
The creature has ::trait[Shadow Step] allowing it to teleport.

Its primary attack is ::ability[Umbral Strike].
```

### Syntax

- **Traits:** `::trait[Name]`
- **Abilities:** `::ability[Name]`

### Rendering

Renders with:
- Icon indicators (⚡ for traits, 💫 for abilities)
- Colored highlighting
- Inline styling
- Distinct visual treatment

## Challenge Ratings

Display difficulty ratings:

```markdown
CR:3 encounter ahead!

Boss fight: CR:12
```

### Syntax

Format: `CR:NUMBER`
- Numbers only (1-30 typical range)
- Must be uppercase CR

### Rendering

Automatically styled with:
- Difficulty-based colors:
  - Easy: CR 1-3 (green)
  - Medium: CR 4-7 (yellow)
  - Hard: CR 8-12 (orange)
  - Deadly: CR 13+ (red)
- CR label formatting
- Consistent styling

## Complete Example

Here's a complete TTRPG stat block using all features:

```markdown
## Shadow Assassin

CR:8

> [!note] Creature Type
> Medium humanoid (shadowkin), chaotic neutral

The @[shadowkin] emerges from darkness with deadly precision.

**Stats:** {HP:68 AC:16 DMG:2d6+4 STR:10 DEX:18 CON:12 INT:14 WIS:12 CHA:8}

**Special Abilities:**

- ::trait[Shadow Step]: Teleport up to 60 feet to an unoccupied space
  in dim light or darkness (recharge 5-6)
- ::ability[Umbral Strike]: Melee attack deals 2d6+4 slashing plus 2d8 necrotic damage

**Combat:** Make a DC 15 Dexterity saving throw or take 4d6 damage.
Roll 1d20+6 for stealth checks.

**Equipment:** Carries a @[ITEM:flickerblade] and shadow cloak.

**Faction:** Member of the @[FACTION:night-guild].
```

## Best Practices

### When to Use TTRPG Extensions

**Use for:**
- RPG rulebooks and supplements
- Adventure modules
- Character guides
- Monster manuals
- Campaign settings
- Game master resources

**Consider alternatives for:**
- General fiction (use standard markdown)
- Non-game documentation
- Books without game mechanics

### Consistency

- Use same stat format throughout document
- Stick to established dice notation
- Keep cross-reference types consistent
- Use challenge ratings appropriately

### Print Considerations

All TTRPG features are optimized for print:
- No reliance on color (works in grayscale)
- Print-safe icons (CSS, not emoji)
- Proper page break handling
- Professional typography
- WCAG AA color contrast

## Combining with Other Features

TTRPG extensions work seamlessly with:

```markdown
@page

## Monsters

The orc {HP:15 AC:13 DMG:1d12+3} attacks!

<!-- Use with callouts -->
> [!warning]
> This creature has ::trait[Pack Tactics] - be careful!

<!-- Use with tables -->
| Creature | CR | HP | AC |
|----------|----|----|----|
| Goblin   | CR:1 | {HP:7} | {AC:15} |
| Orc      | CR:2 | {HP:15} | {AC:13} |

<!-- Use with images -->
![Shadow Assassin](assets/assassin.jpg){.center width="50%"}

CR:8 challenge with ::ability[Umbral Strike]
```

## Disabling Specific Features

You can selectively disable features in custom CSS:

```css
/* Hide dice icons */
.dice-notation .dice-icon {
  display: none;
}

/* Remove stat block styling */
.stat-block {
  background: transparent;
  border: none;
  padding: 0;
}
```

## Syntax Migration

If migrating from older TTRPG markdown systems:

### Old Container Syntax

```markdown
::: ability
**Shadow Step**
Teleport up to 60 feet.
:::
```

### New Inline Syntax

```markdown
::ability[Shadow Step]: Teleport up to 60 feet.
```

The new syntax is more concise and better for inline usage.

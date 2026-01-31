# Combining Features

This page demonstrates how custom plugins work alongside built-in print-md features.

## Using Multiple Plugins

Our manifest loads both a custom plugin and the built-in TTRPG plugin:

```yaml
plugins:
  - path: "../plugins/callouts-plugin.js"
    priority: 100
  - name: "ttrpg"
    priority: 50
```

Higher priority plugins run first, so the callouts plugin processes before TTRPG directives.

## Callouts + TTRPG Features

You can use callouts to highlight game mechanics:

> [!tip] Combat Strategy
> When facing multiple enemies, use area-of-effect spells to maximize damage.
>
> **Recommended tactics:**
> - Position yourself to hit 3+ targets
> - Save single-target spells for bosses
> - Use terrain to your advantage

Here's a stat block for a creature you might encounter:

{HP:45 AC:15 DMG:2d6+3}

> [!warning] Boss Fight
> This enemy has a special ability that triggers at 50% health. Be prepared!

## Page Breaks and Layout

Both plugins respect print layout features:

> [!note]
> This callout will stay together on one page, thanks to `page-break-inside: avoid`.

@break

After a manual page break, we can start fresh on a new page.

> [!info] Page Break Directive
> The `@break` directive above comes from the TTRPG plugin and forces a page break.

## Cross-References

The TTRPG plugin provides cross-reference syntax:

> [!tip] Finding NPCs
> Talk to @[NPC:the-innkeeper] to learn about the quest.

You can combine this with callouts to create informative boxes:

> [!note] Quest Information
> **Quest Giver:** @[NPC:innkeeper]
>
> **Reward:** 100 gold pieces
>
> **Difficulty:** CR:3
>
> **Location:** The tavern in @[LOCATION:town-square]

## Dice Notation

The TTRPG plugin auto-styles dice notation:

> [!danger] Trap Damage
> If triggered, this trap deals 3d6 fire damage.
>
> **Save:** DC 15 Dexterity
>
> **Effect:** On a failed save, the character is also knocked prone.

## Custom Styling

You can override callout styles in your own CSS:

```css
/* Make danger callouts more prominent */
.callout-danger {
  border-left-width: 8px;
  box-shadow: 0 2px 8px rgba(239, 68, 68, 0.1);
}

/* Add icons before titles */
.callout-title::before {
  content: "ℹ️ ";
  margin-right: 0.5em;
}
```

## Creating Your Own Plugins

The callouts plugin source is available at `examples/plugins/callouts-plugin.js`. Key features:

1. **Plugin function** - Overrides blockquote renderer
2. **Metadata export** - Provides plugin information
3. **CSS export** - Injects styles automatically
4. **Options support** - Configurable behavior

See `examples/plugins/README.md` for a complete guide on creating plugins.

## Build This Example

To build this example project:

```bash
cd examples/with-custom-plugin
print-md build .
```

The output will include:
- All callout styles from the plugin
- TTRPG features (dice notation, cross-refs, stat blocks)
- Proper page layout and breaks
- Professional PDF formatting

> [!tip] Preview Mode
> Try preview mode to see live updates as you edit:
>
> ```bash
> print-md preview .
> ```

## Summary

> [!info] Key Takeaways
> - Custom plugins extend markdown-it functionality
> - Multiple plugins work together seamlessly
> - Priority controls load order
> - Plugins can include CSS for styling
> - All features work in both HTML and PDF output

> [!note] Next Steps
> Create your own plugin! See the examples/plugins directory for starter templates and documentation.

# Custom Plugin Example

Demonstrates using a custom local plugin for callouts/admonitions alongside a built-in plugin.

## What's Included

| File | Purpose |
|------|---------|
| `manifest.yaml` | Plugin configuration with custom plugin and built-in TTRPG plugin |
| `callouts-plugin.js` | Custom plugin that adds callout/admonition box support |
| `introduction.md` | Introduction to the example |
| `using-callouts.md` | Examples of using callouts in markdown |
| `combining-features.md` | Demonstrates combining multiple plugins |

## Running the Example

```bash
# Build the PDF
print-md build .

# Preview in browser with live reload
print-md preview .

# Full validated PDF/X pipeline
print-md build . --format pdfx
```

## Plugin Configuration

The manifest.yaml shows:

1. **Custom local plugin** - `callouts-plugin.js` with priority 100 (loads first)
2. **Built-in plugin** - `ttrpg` with priority 50 (loads second)

### Priority

Lower priority numbers load later. In this example:
- `callouts-plugin.js` (priority 100) runs first
- `ttrpg` (priority 50) runs second

### Custom Plugin Options

The callouts plugin is configured with:
- `types`: Array of allowed callout types
- `className`: CSS class prefix for styling

## Callout Syntax

The plugin supports GitHub-style callout blocks:

```markdown
> [!note] Note Title
> Note content here

> [!tip] Helpful Tip
> Tip content here

> [!warning] Warning Title
> Warning content here

> [!danger] Danger Title
> Danger content here

> [!info] Info Title
> Info content here
```

Each callout type has distinctive styling applied by the plugin's built-in CSS.

## Plugin Structure

Custom plugins are JavaScript files that export:

1. **Default export** - The markdown-it plugin function
2. **metadata** (optional) - Information about the plugin
3. **css** (optional) - Styles to inject

See `callouts-plugin.js` for a complete example, or read `/examples/plugins/README.md` for comprehensive plugin development documentation.

## Notes

- Both local and built-in plugins can be mixed in the same manifest
- Plugins load in priority order (highest number first)
- Options are passed to the plugin's default function
- The TTRPG plugin provides additional styling for tabletop RPG content

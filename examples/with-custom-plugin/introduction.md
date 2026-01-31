# Custom Plugin Example

This example demonstrates how to create and use custom markdown-it plugins with print-md.

## What is a Plugin?

A plugin extends markdown-it's functionality by:

- Adding new markdown syntax
- Modifying how elements are rendered
- Injecting custom CSS styles
- Processing content in custom ways

## The Callouts Plugin

This project uses a custom **callouts plugin** that adds support for GitHub-style admonition boxes:

> [!note] What are callouts?
> Callouts (also called admonitions) are special boxes that highlight important information in your documentation.

The plugin demonstrates:

1. **Custom markdown syntax** - Using blockquotes with `[!type]` markers
2. **CSS injection** - Automatically adding styled components
3. **Plugin options** - Configurable callout types and class names
4. **Metadata export** - Plugin information for print-md

## How It Works

The plugin is loaded via `manifest.yaml`:

```yaml
plugins:
  - path: "../plugins/callouts-plugin.js"
    options:
      types: ["note", "tip", "warning", "danger", "info"]
      className: "callout"
```

When you build this project, print-md:

1. Loads the plugin file
2. Registers it with markdown-it
3. Injects the plugin's CSS
4. Processes markdown using the extended syntax

## Next Steps

Continue reading to see the callouts plugin in action!

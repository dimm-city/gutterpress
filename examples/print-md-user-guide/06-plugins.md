# Plugins {#ch-plugins}

<div class="lede">Print-md uses standard markdown-it plugins. Any plugin published to npm with the signature <code>(md, options) =&gt; void</code> will work — there is no Print-md-specific plugin API to learn.</div>

## Adding a Plugin

Plugins are declared in `manifest.yaml` under the `plugins` key:

```yaml
plugins:
  # npm package (must be installed in the project)
  - markdown-it-emoji

  # local file (relative to manifest)
  - ./plugins/my-plugin.js

  # full form with options and load priority
  - name: markdown-it-mark
    options:
      cssClass: highlight
    priority: 50
```

### String shorthand

A bare string is treated as either a **file path** or an **npm package name**:

- Starts with `./`, `../`, `/`, or `C:\` → local file path (resolved relative to manifest)
- Otherwise → npm package name

### Full config object fields

@section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `path` | string | — | Local file path. Mutually exclusive with `name`. |
| `name` | string | — | npm package name. Mutually exclusive with `path`. |
| `version` | string | — | Informational — print-md does not pin or install versions. |
| `options` | object | `{}` | Passed as the second argument to the plugin function. |
| `priority` | number | `100` | Higher loads first. Built-in plugins always run before user plugins. |

@end-section

## Installing npm Plugins

Print-md does **not** auto-install plugins. Install them in your project directory before building:

```bash
bun add markdown-it-emoji
# or
npm install markdown-it-emoji
```

This is intentional: builds are reproducible and don't perform network access during `print-md build`. If a plugin cannot be resolved, you will see a clear error pointing you to the install command.

## Writing a Plugin

A print-md plugin is a standard markdown-it plugin. The minimum is one exported function:

```js
// plugins/my-plugin.js
export default function myPlugin(md, options = {}) {
  md.core.ruler.push('my-rule', (state) => {
    // transform state.tokens here
  });
}
```

Reference it from your manifest:

```yaml
plugins:
  - ./plugins/my-plugin.js
```

For block rules, inline rules, renderer overrides, and core rules, follow the [markdown-it documentation](https://markdown-it.github.io/markdown-it/).

### TypeScript plugin authoring

Install `@dimm-city/print-md` as a **dev-only** dependency and import the type:

```ts
// plugins/my-plugin.ts
import type { PrintMdPlugin } from '@dimm-city/print-md';

const plugin: PrintMdPlugin = (md, options) => {
  // same as a standard markdown-it plugin
};

export default plugin;
```

`PrintMdPlugin` is identical to a standard markdown-it plugin type. The type alias exists for documentation clarity only — it adds no runtime coupling.

### Optional metadata

Export a `metadata` object so Print-md can log which plugins are active:

```js
export const metadata = {
  name: 'my-plugin',
  version: '1.0.0',
  description: 'Adds support for @custom-marker blocks',
  author: 'Your Name',
};
```

### Optional CSS injection

A plugin can ship its own CSS by exporting a `css` string:

```js
export const css = `
.my-custom-class {
  color: var(--color-accent);
  font-weight: bold;
}
`;
```

Print-md collects all plugin CSS exports and injects them as a single `<style>` block in `book.html`, **after** user stylesheets. Use CSS custom properties from the theme to stay consistent.

## Built-in Plugins

These run automatically before any user plugins and do not need to be declared in the manifest:

@section

| Plugin | Purpose |
|--------|---------|
| `markdown-it-attrs` | `{#id .class key=val}` inline attribute syntax |
| `markdown-it-footnote` | `[^1]` footnote syntax |
| `markdown-it-paged` | `@page`, `@section`, `@column-break` layout markers |
| DC alerts | `> [!NOTE]` GitHub-style alert syntax |
| Source map | `data-source-line` attributes for error reporting |

@end-section

> The `markdown-it-container` (`:::name ... :::`) block syntax was removed in 2026-05-17. Use `@`-prefixed markers instead — a named block like `::: callout-note ... :::` becomes `@section .callout-note ... @end-section`.

## Plugin Load Order

1. Built-in plugins (fixed order as listed above)
2. User plugins from the manifest, sorted by `priority` descending (higher first), then in manifest order for ties

If a user plugin needs to inspect tokens produced by another user plugin, set its `priority` lower so it runs later.

## Error Handling

Print-md **fails the build** on plugin errors. Silent skipping was the previous default and made misconfigured manifests very hard to diagnose.

@section

| Error | Fix |
|-------|-----|
| `Plugin file not found: ...` | Check the `path` is correct and the file exists |
| `Plugin "foo" not found. Install it ...` | Run `bun add foo` in your project directory |
| `Plugin "foo" does not export a valid plugin function` | Ensure the default export is a function |
| `Plugin manifest entry must specify ...` | Each entry needs either `path` or `name` |

@end-section

## Reference Example

The Dimm City Field Guide plugin — a full-featured reference (~1,800 lines) covering custom markers, block rules, token transforms, and CSS shipping — used to live in this repo under `examples/dc-design-guide/`. That example has moved to the `dc-op-manual` repo (`dc-op-manual/dc-design-guide/`); see it there for a worked example of what a complex plugin looks like. Most real-world plugins are far smaller.

Treat it as a demonstration of the plugin API surface, not a template to copy wholesale.

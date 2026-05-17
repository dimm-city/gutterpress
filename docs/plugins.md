# Plugins

print-md uses **standard [markdown-it](https://github.com/markdown-it/markdown-it) plugins**. Any plugin published to npm with the signature `(md, options) => void` will work — there is no print-md-specific plugin API to learn.

This page covers:

- How to add a plugin in your manifest
- How to author a custom plugin
- Optional metadata and CSS exports
- Error handling

---

## Adding a plugin

Plugins are declared in `manifest.yaml`:

```yaml
plugins:
  # npm package (must be installed via your package manager)
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

### Full config object

| Field      | Type   | Default | Description                                                              |
| ---------- | ------ | ------- | ------------------------------------------------------------------------ |
| `path`     | string | —       | Local file path (relative to manifest). Mutually exclusive with `name`.  |
| `name`     | string | —       | npm package name. Mutually exclusive with `path`.                        |
| `version`  | string | —       | Informational; print-md does not pin or install versions.                |
| `options`  | object | `{}`    | Passed as the second arg to the plugin function.                         |
| `priority` | number | `100`   | Higher loads first among user plugins. Built-in plugins always run first.|

---

## Installing npm plugins

print-md does **not** auto-install plugins. Install them yourself in the directory containing your `manifest.yaml`:

```sh
bun add markdown-it-emoji
# or
npm install markdown-it-emoji
```

This is intentional: builds are reproducible and don't perform network access during `print-md build`.

If a plugin can't be resolved, you'll see a clear error pointing you to the install command.

---

## Writing a plugin

A print-md plugin is a standard markdown-it plugin. The minimum is one file:

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

For block rules, inline rules, renderer overrides, and core rules, follow the standard [markdown-it documentation](https://markdown-it.github.io/markdown-it/).

### TypeScript

Plugin authors can install `@dimm-city/print-md` as a **dev-only** dependency and import the type:

```ts
// plugins/my-plugin.ts
import type { PrintMdPlugin } from '@dimm-city/print-md';

const plugin: PrintMdPlugin = (md, options) => {
  // ...
};

export default plugin;
```

`PrintMdPlugin` is identical to a standard markdown-it plugin function — the type alias exists for clarity, not to introduce a print-md-specific API.

### Optional metadata

Export `metadata` so print-md logs which plugins are active:

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
  color: var(--dc-accent);
}
`;
```

print-md collects all plugin CSS exports and injects them as a single `<style>` block in `book.html`, **after** user stylesheets. Equal cascade specificity — use sparingly and prefer letting users override via tokens.

---

## Built-in plugins

These run automatically before any user plugins and don't need to be declared:

| Plugin                 | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `markdown-it-attrs`    | `{#id .class key=val}` attribute syntax                |
| `markdown-it-footnote` | `[^1]` footnote syntax                                 |
| `markdown-it-container`| `:::name ... :::` block containers                     |
| `markdown-it-paged`    | `@page`, `@section`, `@column-break` layout markers    |
| DC alerts plugin       | `> [!NOTE]` GitHub-style alerts                        |
| Source map plugin      | `data-source-line` attributes for error reporting      |

---

## Plugin load order

1. Built-in plugins (fixed order — see above)
2. User plugins from the manifest, sorted by `priority` descending (higher first), tied entries in manifest order

If a user plugin needs to inspect tokens produced by another user plugin, set its priority lower so it runs later.

---

## Error handling

print-md **fails the build** on plugin errors. Silent skipping was previously the default and made misconfigured manifests very hard to diagnose.

Common errors:

| Error                                          | Fix                                                                                        |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `Plugin file not found: ...`                   | Check the `path` is correct and the file exists                                            |
| `Plugin "foo" not found. Install it ...`       | `bun add foo` (or `npm install foo`) in your manifest directory                            |
| `Plugin "foo" does not export a valid plugin function` | The default export isn't a function — see ["Writing a plugin"](#writing-a-plugin)  |
| `Plugin manifest entry must specify ...`       | Each entry needs `path` or `name`                                                          |

---

## Example: full reference plugin

The Dimm City Field Guide plugin at `examples/dc-design-guide/plugins/dimm-city-plugin.js` is a full-featured reference (~1800 lines) covering custom markers, block rules, token transforms, and CSS shipping. Treat it as a worked example, not a template — most plugins are far smaller.

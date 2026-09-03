# Plugins {#ch-plugins}

@section .lede

Gutterpress uses standard markdown-it plugins. Pure-JavaScript plugins published to npm with the signature `(md, options) => void` work without a Gutterpress-specific plugin API.

@end-section

## Adding a Plugin

Plugins are declared in `manifest.yaml` under the `plugins` key:

```yaml
plugins:
  # npm package installed and pinned by Gutterpress
  - name: markdown-it-highlightjs
    version: 4.3.0

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
| `version` | string | — | Exact version of a project-local npm plugin installed by Gutterpress. |
| `export` | string | — | Named module export to use when the package has no default plugin export. |
| `options` | object | `{}` | Passed as the second argument to the plugin function. |
| `priority` | number | `100` | Higher loads first. Built-in plugins always run before user plugins. |

@end-section

## Installing npm Plugins

Install an npm plugin from the desktop app under **Project settings → Plugins →
Install npm plugin**, or with the standalone CLI:

```bash
gutterpress plugin add markdown-it-highlightjs ./my-book
# Request an exact version instead of npm's latest tag:
gutterpress plugin add markdown-it-highlightjs@4.3.0 ./my-book
# Select a named plugin export when the package has no default export:
gutterpress plugin add markdown-it-emoji@3.0.0 ./my-book --export full
```

Gutterpress resolves the npm registry metadata to exact versions, verifies each
registry integrity hash, and vendors the plugin's complete runtime dependency
tree under the project's `plugins/npm/` folder. A receipt records the package
graph and a hash of every file. Gutterpress records `{ name, version }` in
`manifest.yaml`, so the vendored graph travels with the project and later
builds do not access the network. Explicit reinstall always downloads fresh
bytes rather than trusting the existing folder.

No Bun, npm, Node.js installation, or package lifecycle script is used.
Pure-JavaScript packages with normal registry dependencies are supported.
Packages that require install/build scripts, native addon compilation, bundled
`node_modules`, or Git/file/workspace dependency selectors are not. Optional
dependencies may be skipped when unavailable or incompatible with the current
platform; required dependencies and required peers must install successfully.

Most plugins use a default export. When a package exposes multiple named plugin
functions instead, select one in the desktop app's optional **export** field or
with `--export`. Gutterpress records that choice in the manifest, for example:

```yaml
plugins:
  - name: markdown-it-emoji
    version: 3.0.0
    export: full
```

Only install packages you trust. Plugins and their dependencies are not
sandboxed: they run in-process with the app's full filesystem and network
privileges. The desktop app shows this warning in a native confirmation before
downloading a third-party plugin.

## Writing a Plugin

A Gutterpress plugin is a standard markdown-it plugin. The minimum is one exported function:

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

Install `gutterpress` as a **dev-only** dependency and import the type:

```ts
// plugins/my-plugin.ts
import type { GutterpressPlugin } from 'gutterpress';

const plugin: GutterpressPlugin = (md, options) => {
  // same as a standard markdown-it plugin
};

export default plugin;
```

`GutterpressPlugin` is identical to a standard markdown-it plugin type. The type alias exists for documentation clarity only — it adds no runtime coupling.

### Optional metadata

Export a `metadata` object so Gutterpress can log which plugins are active:

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

Gutterpress collects all plugin CSS exports and injects them into the single `<style>` block in `book.html`, **before** your own stylesheets — so your project CSS wins at equal specificity and you can always override a plugin's styling. Use CSS custom properties from the theme to stay consistent.

## Built-in Plugins

These run automatically before any user plugins and do not need to be declared in the manifest:

@section

| Plugin | Purpose |
|--------|---------|
| `markdown-it-attrs` | `{#id .class key=val}` inline attribute syntax |
| `markdown-it-footnote` | `[^1]` footnote syntax |
| `markdown-it-deflist` | `Term` / `: definition` definition lists |
| Source map | `data-source-line` attributes for error reporting |
| Gutterpress markers | `@page`, `@section`, `@column-break` layout markers |

@end-section

> **Callouts are bundled:** GitHub-style `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]`
> / `[!WARNING]` / `[!CAUTION]` alert syntax ships with Gutterpress as the
> **Callouts** feature — turn it on from the recommended-features list and it
> renders each one as a `.gp-alert` box with a labelled title and a coloured
> rule, in core's own unbranded vocabulary so any theme can restyle it. It is
> off by default so an existing book keeps rendering exactly as before.
> `.callout-tip` is **this guide's own** project-layer class (defined in
> `styles/guide.css`), not something core renders — use
> `@section .callout-tip` … `@end-section` (see
> [Chapter 8 — Publishing](./08-publishing.md)) if you want that look.

> The `markdown-it-container` (`:::name ... :::`) block syntax was removed in 2026-05-17. Use `@`-prefixed markers instead — a named block like `::: callout-note ... :::` becomes `@section .callout-note ... @end-section`.

> **Core marker names are reserved — give yours a branded name.** These eight
> belong to core: `@chapter`, `@spread`, `@page`, `@section`, `@continue`,
> `@page-break`, `@column-break`, `@end-section`. Core claims those lines
> while parsing blocks, which happens *before* your plugin is consulted, so a
> plugin marker sharing one of these names **never runs and never warns** —
> your handler is simply skipped and core's own meaning applies. This has
> happened in a real book: a plugin defined `@continue` to split a card across
> a page, and every use produced a confusing core warning while the intended
> split silently never happened. Prefix yours (`@skill-continue`,
> `@dc-sidebar`) and the collision cannot occur.

## Bundled Optional Plugins

These four are **not** loaded by default, but they ship inside the binary —
enabling them by name in the manifest resolves instantly, with no npm
install and no network access, unlike arbitrary third-party plugins:

@section

| Name | Adds | Example |
|------|------|---------|
| `markdown-it-mark` | `==highlighted==` → `<mark>highlighted</mark>` | `==important==` |
| `markdown-it-sub` | `H~2~0` → `H<sub>2</sub>0` | `CO~2~` |
| `markdown-it-sup` | `29^th^` → `29<sup>th</sup>` | `x^2^` |
| `markdown-it-abbr` | `*[HTML]: definition` → `<abbr>` tooltips | `*[W3C]: World Wide Web Consortium` |

@end-section

```yaml
plugins:
  - markdown-it-mark
  - markdown-it-sub
```

## Plugin Load Order

1. Built-in plugins (fixed order as listed above)
2. User plugins from the manifest, sorted by `priority` descending (higher first), then in manifest order for ties

If a user plugin needs to inspect tokens produced by another user plugin, set its `priority` lower so it runs later.

## Error Handling

Gutterpress **fails the build** on plugin errors. Silent skipping was the previous default and made misconfigured manifests very hard to diagnose.

@section

| Error | Fix |
|-------|-----|
| `Plugin file not found: ...` | Check the `path` is correct and the file exists |
| `Plugin "foo" not found` | Install it from Project settings → Plugins, or run `gutterpress plugin add foo` |
| `Vendored plugin "foo@1.2.3" is missing` | Reinstall that exact version; make sure `plugins/npm/` travels with the project |
| `Plugin "foo" does not export a valid plugin function` | Ensure the default export is a function, or select its named function with `export` |
| `Plugin manifest entry must specify ...` | Each entry needs either `path` or `name` |

@end-section

## Reference Example

The Dimm City Field Guide plugin — a full-featured reference (~1,800 lines) covering custom markers, block rules, token transforms, and CSS shipping — used to live in this repo under `examples/dc-design-guide/`. That example has moved to the `dc-op-manual` repo (`dc-op-manual/dc-design-guide/`); see it there for a worked example of what a complex plugin looks like. Most real-world plugins are far smaller.

Treat it as a demonstration of the plugin API surface, not a template to copy wholesale.

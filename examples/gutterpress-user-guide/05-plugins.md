# Plugins {#ch-plugins}

@section .lede

Gutterpress uses standard markdown-it plugins. Pure-JavaScript plugins published to npm with the signature `(md, options) => void` work without a Gutterpress-specific plugin API. A plugin is one kind of **extension** — this chapter also covers the manifest's `extensions:` list, which holds looks ([Chapter 4](#ch-styling)) and component libraries alongside plugins.

@end-section

## Adding a Plugin

Everything a book loads beyond core — markdown plugins, looks, component libraries — is one entry in the manifest's `extensions:` list. Each entry is a bare string, and its form says what it is:

```yaml
extensions:
  # a feature bundled with Gutterpress — nothing to install
  - markdown-it-mark

  # a folder or plugin file, relative to manifest.yaml — referenced in place
  - ./plugins/my-plugin.js

  # an npm package, pinned to the version `gutterpress ext add` installed
  - markdown-it-highlightjs@4.3.0
```

### How a specifier resolves

@section

| Written as | Resolves to |
|------------|-------------|
| One of the five bundled names — `markdown-it-mark`, `markdown-it-sub`, `markdown-it-sup`, `markdown-it-abbr`, `gutterpress-gfm-alerts` | The copy compiled into Gutterpress. No install, no network; a bundled name shadows any npm package of the same name and cannot be pinned (`markdown-it-mark@3.0.0` is an error). |
| Starts with `./`, `../`, `/`, or a Windows drive (`C:\`) | A path relative to the manifest: a folder holding a `gutterpress.json` (or a theme-era `theme.json` / `theme.css`), or a bare `.js` markdown-it plugin file. Referenced in place — never copied. |
| Anything else | An npm package name. `name@version` pins it; `gutterpress ext add` installs the package and writes the pin for you. |

@end-section

A bare `plugins/my-plugin.js` is neither: it does not start with `./`, so Gutterpress refuses it and tells you to write `./plugins/my-plugin.js`. Scoped names (`@dimm-city/components`) are never mistaken for paths.

### The object form

Use an object only when an entry needs more than its specifier. `use:` carries the same specifier the bare string would:

```yaml
extensions:
  - use: markdown-it-emoji@3.0.0
    export: full            # the package exposes its plugin as a named export
  - use: markdown-it-anchor@9.2.0
    options:
      level: 2              # passed straight through to the plugin
  - use: ./plugins/drafts.js
    enabled: false          # keep the entry, skip loading it
```

@section

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `use` | string | — | The specifier — exactly what the bare form would be. |
| `options` | object | `{}` | Passed as the second argument to the plugin function. |
| `export` | string | — | Named module export to use when the package has no default plugin export. |
| `enabled` | boolean | `true` | `false` keeps the entry in the manifest but skips loading it at build and preview time. |

@end-section

Those four keys are the whole object form. There is no `path:`, `name:`, `version:` (the version lives in the specifier) or `priority:` — a manifest that carries one of those fails with a message saying what to write instead (see [Error Handling](#error-handling)).

### Order is everything

The list is read top to bottom, and its order means two things at once:

- **Markdown registration.** A later entry's plugin is registered with markdown-it after the earlier ones, so it runs later during parsing and sees the tokens earlier plugins produced. If plugin B needs plugin A's output, list A first.
- **The cascade.** Extension stylesheets land in the book in list order, and a later sheet wins ties. Your own `styles:` always load after every extension, so you can override any extension rule at equal specificity from your own stylesheet.

Underneath all of it, core's built-in plugins (below) always run first, and core's own CSS sits in two cascade layers that every extension beats automatically. To change who wins, move the entry: `gutterpress ext list` prints the list in this order, and the desktop's Look and Features views let you drag entries into a new order.

## Managing Extensions from the Terminal

`gutterpress ext` is the one verb set for every kind of extension. The project directory is the trailing positional and defaults to the current directory:

```bash
gutterpress ext list ./my-book                          # what's loaded, in load (= cascade) order
gutterpress ext add markdown-it-highlightjs ./my-book   # install from npm and pin the exact version
gutterpress ext add markdown-it-highlightjs@4.3.0 ./my-book
gutterpress ext add markdown-it-emoji@3.0.0 ./my-book --export full
gutterpress ext add markdown-it-mark ./my-book          # turn on a bundled feature
gutterpress ext add ./plugins/field-notes ./my-book     # reference a folder (or a .js file) in place
gutterpress ext disable markdown-it-mark ./my-book      # keep it listed, stop loading it
gutterpress ext enable markdown-it-mark ./my-book
gutterpress ext remove markdown-it-highlightjs ./my-book
```

`add` also takes a `.zip` or `.css` file, an `http(s)` URL, or — with `--look` — a built-in look id; those land a copy in `extensions/<id>/` and list it as `./extensions/<id>` ([Chapter 4](#ch-styling)). `remove`, `enable` and `disable` take the specifier as it appears in the manifest (for an npm package the bare name is enough). Re-running `add` on something already listed re-pins that entry in place rather than adding a second one; `remove` deletes an npm package's vendored copy but never touches a folder you referenced by path.

The desktop app shows the same list under **Project settings → Features** (the entries that carry markdown) and **Project settings → Look** (the entries that carry styles) — two views over one list, with the same add, enable/disable, reorder and remove actions.

## Installing npm Plugins

Install an npm plugin from the desktop app under **Project settings → Features**, or with the standalone CLI:

```bash
gutterpress ext add markdown-it-highlightjs ./my-book
# Request an exact version instead of npm's latest tag:
gutterpress ext add markdown-it-highlightjs@4.3.0 ./my-book
# Select a named plugin export when the package has no default export:
gutterpress ext add markdown-it-emoji@3.0.0 ./my-book --export full
```

Gutterpress resolves the npm registry metadata to exact versions, verifies each
registry integrity hash, and vendors the plugin's complete runtime dependency
tree under the project's `plugins/npm/` folder. A receipt records the package
graph and a hash of every file. Gutterpress then writes the pinned specifier —
`markdown-it-highlightjs@4.3.0` — into `extensions:`, so the vendored graph
travels with the project and later builds do not access the network. Explicit
reinstall always downloads fresh bytes rather than trusting the existing folder.

No Bun, npm, Node.js installation, or package lifecycle script is used.
Pure-JavaScript packages with normal registry dependencies are supported.
Packages that require install/build scripts, native addon compilation, bundled
`node_modules`, or Git/file/workspace dependency selectors are not. Optional
dependencies may be skipped when unavailable or incompatible with the current
platform; required dependencies and required peers must install successfully.

An npm package that ships a `gutterpress.json` is read exactly like a folder
extension: its declared stylesheets load with it, in list order, and its
snippets appear in the picker. Its markdown-it plugin is the package's own
entry module — a `markdown` field, if present, must name that same file.

Most plugins use a default export. When a package exposes multiple named plugin
functions instead, select one in the desktop app's optional **export** field or
with `--export`. Gutterpress records that choice in the object form:

```yaml
extensions:
  - use: markdown-it-emoji@3.0.0
    export: full
```

Only install packages you trust. Plugins and their dependencies are not
sandboxed: they run in-process with the app's full filesystem and network
privileges. The desktop app shows this warning in a native confirmation before
downloading a third-party plugin.

## Writing a Plugin

### Start from the scaffold

```sh
gutterpress new "Field Notes" --kind plugin
cd field-notes && bun install && bun test
```

That produces a complete, runnable package: `gutterpress.json`, a `plugin.js` with one declarative container and one hand-written rule, component CSS with public `:root` tokens, an insertable snippet, and a fixture test you run with `bun test`. Its README explains which conventions are load-bearing and why — class prefixing, why you cannot import `gutterpress` at runtime, and where your CSS belongs in the cascade. Add it to a book with `gutterpress ext add ./field-notes <book>`, which lists the folder under `extensions:` and references it in place.

Use `--prefix` to choose the class prefix it claims (it defaults to the package slug):

```sh
gutterpress new "Field Notes" --kind plugin --prefix fn-
```

The rest of this chapter explains what the scaffold contains.

### By hand

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
extensions:
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

Gutterpress collects every extension's CSS and injects it into the single `<style>` block in `book.html` at the entry's position in `extensions:` — after earlier entries, before later ones, and always **before** your own `styles:` — so your project CSS wins at equal specificity and you can always override a plugin's styling. Use CSS custom properties from the look to stay consistent.

For anything longer than a few rules, ship the CSS as **files** instead of a
string, by exporting a `styles` list. Paths are relative to the plugin's own
file:

```js
export const styles = ["./styles/components.css", "./styles/callouts.css"];
```

A `styles` file is treated exactly like one of your project's own stylesheets:
a `url()` to a font or image next to it is embedded in the build, a local
`@import` is followed, and `gutterpress lint` checks it for print-safety
problems — none of which a `css` string gets, because a string is opaque to
every other part of the tool. The files land in the same cascade position as
`css` (the entry's position in `extensions:`, before your stylesheets), in the
order you list them. A listed file that does not exist stops the build with an
error naming the plugin and the path, rather than silently rendering without
it. `css` and `styles` can coexist; the string is placed after the files.

### A folder: markdown, CSS and snippets together

A bare `.js` file gives a book markdown behaviour and nothing else. To ship
component CSS and insertable snippets with it, make the plugin a **folder**
with a `gutterpress.json` — the same package format a look uses:

```json
{
  "name": "Field Notes",
  "author": "Your Name",
  "description": "Term boxes and inline definitions",
  "markdown": "plugin.js",
  "styles": ["styles/plugin.css"],
  "snippets": "snippets"
}
```

`markdown` names the plugin module (loaded through exactly the plain
markdown-it contract above), `styles` lists sheets in cascade order,
`snippets` names a folder of insertable recipes, and `components` a catalog
file; `preview` and `tokensFile` are the look-side fields ([Chapter 4](#ch-styling)).
Every path is relative to the folder and must stay inside it. List the
folder, not the `.js` file — `./plugins/field-notes` — and Gutterpress reads
the metadata and picks up everything it declares. A folder that declares only
`styles` is a look; one that declares only `markdown` is a plugin; the format
is the same. This is what `gutterpress new --kind plugin` scaffolds.

## Built-in Plugins

These run automatically before any extension and do not need to be declared in the manifest:

@section

| Plugin | Purpose |
|--------|---------|
| `markdown-it-attrs` | `{#id .class key=val}` inline attribute syntax |
| `markdown-it-footnote` | `[^1]` footnote syntax |
| `markdown-it-deflist` | `Term` / `: definition` definition lists |
| Source map | `data-source-line` attributes for error reporting |
| Gutterpress markers | `@page`, `@section`, `@column-break` layout markers |

@end-section

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

## Bundled Features

These five are **not** loaded by default, but they ship inside the binary —
listing one by name in `extensions:` resolves instantly, with no npm install
and no network access, unlike arbitrary third-party plugins:

@section

| Name | Adds | Example |
|------|------|---------|
| `markdown-it-mark` | `==highlighted==` → `<mark>highlighted</mark>` | `==important==` |
| `markdown-it-sub` | `H~2~0` → `H<sub>2</sub>0` | `CO~2~` |
| `markdown-it-sup` | `29^th^` → `29<sup>th</sup>` | `x^2^` |
| `markdown-it-abbr` | `*[HTML]: definition` → `<abbr>` tooltips | `*[W3C]: World Wide Web Consortium` |
| `gutterpress-gfm-alerts` | GitHub-style `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!WARNING]` / `[!CAUTION]` callout boxes | `> [!TIP]` |

@end-section

```yaml
extensions:
  - markdown-it-mark
  - markdown-it-sub
  - gutterpress-gfm-alerts
```

The desktop lists the same five as recommended features under **Project settings → Features** — turning one on writes exactly this entry.

> **Callouts are bundled:** `gutterpress-gfm-alerts` (the **Callouts** feature
> in the desktop) renders each `> [!NOTE]`-style alert as a `.gp-alert` box
> with a labelled title and a coloured rule, in core's own unbranded
> vocabulary so any look can restyle it. It is off by default so an existing
> book keeps rendering exactly as before.
> `.callout-tip` is **this guide's own** project-layer class (defined in
> `styles/guide.css`), not something core renders — use
> `@section .callout-tip` … `@end-section` (see
> [Chapter 8 — Publishing](#ch-publishing)) if you want that look.

## Error Handling

Gutterpress **fails the build** on extension errors — a final PDF must never silently omit formatting you configured. The live preview is the one exception: an extension that cannot load is skipped with a loud warning (and a "Needs install" state in the desktop's Features view) so one broken entry does not blank the whole preview.

@section

| Error | Fix |
|-------|-----|
| `` Manifest field `plugins` was replaced by `extensions` `` | The message prints your own entries rewritten as an `extensions:` list, in the order they used to load — paste it in place of `plugins:`. |
| `` extensions[0]: `priority` was removed `` | Delete the key and move the entry — list order is load order. |
| `` extensions[0]: an `extensions` entry carries its specifier in `use:` `` | Replace `path:` / `name:` with `use:` (or the bare string); a version belongs in the specifier, as `name@version`. |
| `"plugins/x.js" looks like a path — write it as "./plugins/x.js"` | A path must start with `./`, `../` or `/`; anything else is read as an npm name. |
| `"markdown-it-mark" is bundled with Gutterpress … drop "@3.0.0"` | Bundled names always resolve to the built-in copy and cannot be pinned. |
| `Plugin file not found: …` | Check the path (relative to `manifest.yaml`) and that the file exists |
| `` Extension "foo" not found. Install it with `gutterpress ext add foo` `` | Run that, or add it from Project settings → Features; make sure `plugins/npm/` travels with the project |
| `Plugin "foo" does not export a valid plugin function` | Ensure the default export is a function, or select its named function with `export:` |
| `Plugin "foo" does not export a plugin function named "bar"` | Fix the `export:` name to one the package really exports |

@end-section

`gutterpress ext list` warns about the two states a build will trip over before you build: `Not pinned` (an npm name without a version — run `ext add` to install and pin it) and `Not installed` (a pinned entry whose vendored copy is missing — the same `ext add` reinstalls it).

## Reference Example

**The template is the scaffold**: `gutterpress new "My Plugin" --kind plugin`. It is small on purpose, every convention in it is one you should keep, and its test suite runs with `bun test` from the moment it is created.

For a look at what a large plugin becomes, the Dimm City Field Guide plugin (~1,800 lines — custom markers, block rules, token transforms, CSS shipping) lives in the `dc-op-manual` repo under `dc-op-manual/dc-design-guide/`. Read it to see the scale a mature plugin reaches; do not copy it as a starting point. Most real-world plugins are far smaller, and the scaffold is where they should start.

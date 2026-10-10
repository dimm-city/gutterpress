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
| Starts with `./`, `../`, `/`, or a Windows drive (`C:\`) | A path relative to the manifest: a folder holding a `package.json`, or a bare `.js` markdown-it plugin file. Referenced in place — never copied. |
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
- **The cascade.** Each extension's stylesheets are wrapped in a cascade layer of their own (`@layer ext.<name>`), declared in list order, so a later entry wins ties whatever its CSS looks like. Your own `styles:` stay unlayered and load after every extension, so a rule in your own stylesheet beats any extension rule at any specificity.

Underneath all of it, core's built-in plugins (below) always run first, and core's own CSS sits in two cascade layers declared before every extension's. To change who wins, move the entry: `gutterpress ext list` prints the list in this order, and the desktop's Look and Features views let you drag entries into a new order.

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

Not sure what's out there? `gutterpress ext search [query]` searches **npm**
(not project-scoped — it takes no directory) for packages tagged `gutterpress`
or `markdown-it-plugin`, and prints each match's `name@version`, ready to hand
straight to `ext add`:

```bash
gutterpress ext search              # the most relevant tagged packages
gutterpress ext search footnote
```

Publishing one is `npm publish` with `"gutterpress"` in your package's
`keywords` — there is no index to be added to. A plain markdown-it plugin
needs no Gutterpress keyword at all: the ecosystem's own `markdown-it-plugin`
tag already finds it, and it works here unchanged.

The desktop app shows the same list under **Project settings → Features** (the entries that carry markdown) and **Project settings → Look** (the entries that carry styles) — two views over one list, with the same add, enable/disable, reorder and remove actions.

## Installing npm Plugins

Install an npm plugin from the desktop app under **Project settings → Features**, or with the standalone CLI. Features has three tabs:

- **Installed & built-in** — everything your book already uses (with each package's **Version** menu and **Update** button), and the built-in formatting extras you can turn on.
- **Search** — packages on npm tagged `gutterpress` or `markdown-it-plugin`. The list loads the first time you open the tab, so it never slows opening a book; type a word and press Enter to narrow it, then **Add** a package. The new entry is listed under **Installed & built-in**.
- **Advanced** — **Install from npm** by package name (add `@version` for an exact version, and an export name for packages with named plugin functions), and **Add a plugin file or folder…** to use one from disk where it is.

The CLI equivalent:

```bash
gutterpress ext add markdown-it-highlightjs ./my-book
# Request an exact version instead of npm's latest tag:
gutterpress ext add markdown-it-highlightjs@4.3.0 ./my-book
# Select a named plugin export when the package has no default export:
gutterpress ext add markdown-it-emoji@3.0.0 ./my-book --export full
```

Gutterpress resolves the npm registry metadata to exact versions, verifies each
registry integrity hash, and vendors the plugin's complete runtime dependency
tree under the project's `plugins/npm/` folder as a plain `node_modules`
layout. Gutterpress then writes the pinned specifier —
`markdown-it-highlightjs@4.3.0` — into `extensions:`. The pin is what travels
with your book; the downloaded copy under `plugins/npm/` does not (see
[Cloning a book](#cloning-a-book-with-installed-extensions) below), and an
ordinary build, with every copy present, does not access the network. Explicit
reinstall always downloads fresh bytes rather than trusting the existing folder.

No Bun, npm, Node.js installation, or package lifecycle script is used.
Pure-JavaScript packages with normal registry dependencies are supported.
Packages that require install/build scripts, native addon compilation, bundled
`node_modules`, or Git/file/workspace dependency selectors are not. Optional
dependencies may be skipped when unavailable or incompatible with the current
platform; required dependencies and required peers must install successfully.

An npm package's `package.json` is read exactly like a folder extension's: a
`"gutterpress"` block's declared stylesheets load with it, in list order, and
its snippets appear in the picker. Its markdown-it plugin is the package's own
entry module (resolved by `exports`/`main`, npm's rules) — a
`gutterpress.markdown` field, if present, must name that same file.

If you publish an extension, add `"gutterpress"` to your package's `keywords`
so `gutterpress ext search` finds it.

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

## Cloning a Book with Installed Extensions

Downloaded extensions are not part of your book's version history. New books
(and folders you set up as a book) list `plugins/npm/` in their `.gitignore`
next to `dist/`, and installing an extension adds that line to an older book's
`.gitignore` if it is missing. A book inside a larger repository keeps the rule
in its own folder's `.gitignore`, which version history honours. Nothing else in
your `.gitignore` is changed, and if you have deliberately re-included
`plugins/npm/` (a `!` rule) it is left alone and the install tells you
downloaded extensions shouldn't be committed.

So a fresh clone has your `manifest.yaml` and its pins but not the downloaded
files — and it does not need you to do anything:

- **Desktop app** — opening the book downloads any missing pinned version
  first, with a short notice saying what it fetched. If the download fails (you
  are offline, say), the book still opens and the extension's row under
  **Project settings → Features** reads **Needs install**; its **Install**
  button tries again.
- **CLI** — `gutterpress build`, `validate` and `preview` download a missing
  pinned version before they start, printing one line per package:

  ```text
  info  Downloaded gp-dimm-city@1.2.0-alpha.3 (pinned in manifest.yaml)
  ```

  If it cannot (offline, registry error, failed integrity check), `build` and
  `validate` stop and name the extension, the reason and how to try again —
  run the command once you are online, or `gutterpress ext add name@version`.
  `preview` only warns and keeps going, like any other plugin it cannot load.

Restoring downloads exactly the version in `manifest.yaml`, never a newer one,
through the same hash-verified install as `ext add`, and it never edits the
manifest. It does nothing, and uses no network, when every copy is already
there; local paths, unpinned names and bundled features are never touched.
Because you pinned that exact version yourself, the desktop app does not ask
for confirmation again when it restores it.

If an older book already committed `plugins/npm/`, adding the ignore rule does
not remove those files from its history — git keeps tracking what it already
tracks. Remove them when you are ready (`git rm -r --cached plugins/npm`);
Gutterpress never deletes anything from git for you.

## Updating a Pinned Extension

A book pins an exact version and builds from its vendored copy, so nothing
moves until you say so. Two commands cover the rest. Both reach npm — the only
project commands that do — and neither runs during a build or preview:

```bash
gutterpress ext outdated ./my-book            # each pinned package against npm's latest; exit 1 if any is behind
gutterpress ext update ./my-book              # re-pin every outdated package to npm's latest
gutterpress ext update gp-dimm-city ./my-book # just one
```

`update` is `ext add name@latest` for each outdated entry: the new version is
downloaded, verified against the registry hash, vendored, load-tested, and
re-pinned in place — the entry's `export:` and `enabled:` stay as written —
and the previous version's folder under `plugins/npm/` is removed (a re-pin
with `ext add` does the same). Commit the manifest; the new downloaded copy
stays out of git, and a clone fetches it from the new pin. To move to a specific version instead of the latest, or to go back,
run `ext add name@x.y.z`.

The desktop app does the same under **Project settings → Features**: opening
the tab checks npm once, an entry with a newer version shows it with an
**Update** button on the **Installed & built-in** tab, and *Check for updates*
re-checks.

Every npm package there also has a **Version** menu listing its published
versions, newest first. Choosing one is `ext add name@version`: Gutterpress
downloads, verifies and load-tests it, and only then moves the pin. If that
fails, a message says why and the book keeps the version — and the downloaded
copy — it had. The menu lists stable releases only; switch on **Include
pre-release versions** (`-alpha`, `-beta`, `-rc`) to see the rest and to have
the update check count them as newer. That switch is an app preference, shared
by all your books, and off by default. The version a book pins is always
listed, even a pre-release.

If a book's pin names a version whose downloaded copy is missing — a changed
`manifest.yaml`, or a copy that was deleted or is broken — its row says **Needs
install** with an **Install** button that downloads exactly the pinned version.

`ext outdated` exits 1 when a package is behind, so a CI step can watch a
book's pins without updating anything.

## Writing a Plugin

### Start from the scaffold

```sh
gutterpress new "Field Notes" --kind plugin
cd field-notes && bun install && bun test
```

That produces a complete, runnable package: `package.json`, a `plugin.js` with one declarative container and one hand-written rule, component CSS with public `:root` tokens, an insertable snippet, and a fixture test you run with `bun test`. Its `@term-box` component shows both component helpers — an example snippet the editor inserts and an opt-in `validate` check (see [Components](#plugin-components) below). Its README explains which conventions are load-bearing and why — class prefixing, why you cannot import `gutterpress` at runtime, and where your CSS belongs in the cascade. Add it to a book with `gutterpress ext add ./field-notes <book>`, which lists the folder under `extensions:` and references it in place.

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
`@import` is followed, and `gutterpress validate` checks it for print-safety
problems — none of which a `css` string gets, because a string is opaque to
every other part of the tool. The files land in the same cascade position as
`css` (the entry's position in `extensions:`, before your stylesheets), in the
order you list them. A listed file that does not exist stops the build with an
error naming the plugin and the path, rather than silently rendering without
it. `css` and `styles` can coexist; the string is placed after the files.

### A folder: markdown, CSS and snippets together

A bare `.js` file gives a book markdown behaviour and nothing else. To ship
component CSS and insertable snippets with it, make the plugin a **folder**
with a `package.json` — the same standard file npm already wants, and the same
package format a look uses:

```json
{
  "name": "field-notes",
  "description": "Term boxes and inline definitions",
  "author": "Your Name",
  "keywords": ["gutterpress", "markdown-it-plugin"],
  "main": "plugin.js",
  "gutterpress": {
    "styles": ["styles/plugin.css"],
    "snippets": "snippets"
  }
}
```

`name`, `description`, `author`, `keywords` and `main` are npm's own fields,
read as-is: `main` is the plugin module, loaded through exactly the plain
markdown-it contract above. Everything else sits under `"gutterpress"` —
`styles` lists sheets in cascade order, `snippets` names a folder of
insertable recipes, `components` a catalog file; `preview` and `tokensFile`
are the look-side fields ([Chapter 4](#ch-styling)). `markdown` is there for
the one case `main` can't express: a package whose `main` is not the plugin.
Every path is relative to the folder and must stay inside it. List the
folder, not the `.js` file — `./plugins/field-notes` — and Gutterpress reads
the package.json and picks up everything it declares. A folder that declares
only `gutterpress.styles` is a look; one whose `main` is a markdown-it plugin
is a plugin; the format is the same. This is what `gutterpress new --kind
plugin` scaffolds.

Older packages carried a separate `gutterpress.json` or `theme.json`. Neither
is read any more: move their fields into `package.json` as above.

### Components: a marker, its snippet and its checks {#plugin-components}

A **component** is a container your plugin declares in `export const markers`
— the scaffold's `term-box`, used as `@term-box … @end-term-box`. Two optional
fields on that declaration help the authors who use it.

**`snippet` — show the structure.** When an author picks a component in the
desktop editor — typing `@` at the start of a line, or from the snippet picker
(Ctrl/Cmd+Shift+S), where its row is marked `@term-box` — Gutterpress inserts
its example snippet, so the author starts from the structure the component
expects. By default the snippet is `<snippets folder>/<marker name>.md`
inside your package (the scaffold's `snippets/term-box.md`; the folder is the
one `gutterpress.snippets` names, or `snippets`). To keep it somewhere else,
point at any `.md` file inside your package:

```js
export const markers = {
  "term-box": { class: "fn-term-box", snippet: "examples/term-box.md" },
};
```

A snippet can use `{{fields}}`: the picker asks for them, and `@` autocomplete
selects the first one so the author can type straight over it. A component
without a snippet still autocompletes, as an empty marker pair.

Snippets come from three levels: your book's own `snippets/` folder, each
extension, and Gutterpress itself (core). The picker lists every one, grouped
by where it comes from, even when two share a name. When a component needs
a single snippet, your book's `snippets/term-box.md` wins over the
extension's copy (and an extension's over core's), so you can change a
component's starting structure for one book without touching the extension.

**`variants` — name the choices.** A component's `variants` map each word an
author can put after the marker to a class: `variants: { note: "fn-note" }`
makes `@term-box note` add `fn-note`. The word is also kept as
`data-term-box="note"`. If an author types a word that is not one of the
variants — `@term-box nots` — it adds no styling, so Gutterpress says so in the
Problems panel, listing the variants and suggesting the close match: `"nots" is
not a variant of @term-box, so it adds no styling. Variants: note, warning. Did
you mean "note"?` A component with no `variants` reports any word the same way
(`@term-box has no variants`). An alias's `preset: { variant }` is yours, not the
author's, so it is never reported.

**`validate` — check the structure (opt-in).** Add a `validate` function and
Gutterpress runs it for every use of the component whenever it checks the
book: the desktop Problems panel, `gutterpress validate`, and builds. You don't
need to know anything about markdown-it or Gutterpress internals — the
function receives a plain description of what the author wrote:

```js
export const markers = {
  "term-box": {
    class: "fn-term-box",
    validate(box) {
      const problems = [];
      if (!box.attrs.label) problems.push('Give the term box a label: @term-box label="…"');
      if (!box.blocks.some((block) => block.type === "paragraph")) {
        problems.push("Add a paragraph explaining the term.");
      }
      return problems;
    },
  },
};
```

What `validate` receives:

- `name` — the marker as typed (`"term-box"`)
- `variant` — the bare word after it (`@term-box note` → `"note"`), or `null`
- `attrs` — its attributes (`{ label: "…" }`)
- `line` — the marker's line in the file
- `text` — the raw markdown inside the component
- `blocks` — the content, in order. Each block has a `type` and a `line`:
  `heading` (`level`, `text`), `paragraph` (`text`), `image` (`alt`, `src` —
  a paragraph holding only an image), `list` (`ordered`, `items`), `quote`
  (`text`), `code` (`lang`, `text`), `table`, `rule`, `html` (`text`), and
  `component` (`name`) for a component nested inside — which its own
  `validate` checks. `text` is the block's raw markdown.

What it returns: nothing when the content is fine, or a list of problems. A
problem is a message, or `{ message, line, severity }` to point at a specific
line or choose `"error"`, `"warning"` (the default) or `"info"`. Each one
appears as `@term-box: <message>` at that line. Use `"error"` sparingly: it
fails `gutterpress validate` and stops a build, though a book can downgrade
the whole check with `validate.checks."source.markdown.layout-markers"`.
`validate` must be synchronous; if it throws, the author sees that as a
problem instead of a broken preview.

A few recipes:

```js
// The first thing inside must be a heading.
if (box.blocks[0]?.type !== "heading") problems.push("Start with a heading.");

// No more than two paragraphs.
const paragraphs = box.blocks.filter((b) => b.type === "paragraph");
if (paragraphs.length > 2) problems.push({ message: "Keep it to two paragraphs.", line: paragraphs[2].line });

// Every image needs alt text.
for (const b of box.blocks) {
  if (b.type === "image" && !b.alt.trim()) problems.push({ message: "Describe this image.", line: b.line });
}

// A list of at least two items.
const list = box.blocks.find((b) => b.type === "list");
if (!list || list.items.length < 2) problems.push("List at least two options.");

// Variants you check yourself (words missing from `variants` are already reported).
if (box.variant && !["note", "warning"].includes(box.variant)) problems.push(`Unknown variant "${box.variant}".`);
```

Because `validate` takes a plain object, you test it with plain objects too
— the scaffold's `test/plugin.test.js` shows how.

**`section: true` — a component that is a section.** Some components are page
layouts rather than boxes: a column run, a card grid, a stat block. Declare
them as sections and they behave exactly like `@section` — they close at the
next `@section`, `@page`, `@chapter` or `@spread`, `@continue` reopens them
with the same classes, and `.gp-columns-2` and friends work:

```js
export const markers = {
  "npc-stat": {
    section: true,
    class: "fn-npc-stat",
    variants: { wirephreak: "fn-wirephreak" },
  },
};
```

`@npc-stat wirephreak .extra` renders exactly like
`@section .fn-npc-stat .fn-wirephreak .extra` (classes in that order), and
`@end-npc-stat` is `@end-section`. The variant is not a section name, so it
becomes `data-npc-stat="wirephreak"` instead of `data-section`. A section
marker cannot also set `tag`, `label` or `autoCloseAt`; aliases of it are
sections too. `validate` works on it as well (a `@continue` continuation is
not checked separately).

### Components that rebuild their content: declare, then transform

Some components need more than a wrapper and classes — a card that turns its
list into a grid, a procedure that numbers its steps. You do not need a
special API for these. **Declare the marker** in `markers` so core parses it
(autocomplete, closing rules, warnings, source lines), then **rewrite the
tokens inside it** with an ordinary markdown-it core rule pushed from your
default export. This is opt-in: a plugin that never declares a marker is a
plain markdown-it plugin, exactly as before.

A declared container renders as a `layout_component_open` token, its content
tokens, and a matching `layout_component_close`. The open token's `meta` is a
stable, public contract:

| Field | Meaning |
|-------|---------|
| `line` | the marker's 1-based line |
| `component` | the marker name as typed (an alias's own name, e.g. `dm-note`) |
| `kind` | the resolved base marker name (the alias's target, e.g. `callout`) |
| `variant` | the bare word after the marker (or an alias's preset), or `null` |
| `attrs` | the marker's attributes as authored (`{ label: "…" }`) |
| `labelled` | `true` when core injected a label element right after the open token |

Match on `kind` and a rule for `callout` also catches `@dm-note`. The content
is `tokens[from..close)`, where `from` is the index after the open token (two
after it when `labelled`). A `section: true` marker produces
`layout_section_open` / `layout_section_close` instead, with the same `meta`
minus `labelled` (plus `continued: true` on a `@continue` reopening).

Plugins cannot import from `gutterpress`, so copy this small helper into your
plugin:

```js
// Calls fn(open, from, close) for each @<kind> component; the content is
// tokens[from..close). Walks backwards so a transform can edit the tokens
// without shifting the components it has yet to visit.
function forEachComponent(tokens, kind, fn) {
  for (let i = tokens.length - 1; i >= 0; i--) {
    const open = tokens[i];
    if (open.type !== "layout_component_open" || open.meta.kind !== kind) continue;
    let depth = 0;
    let close = i;
    for (; close < tokens.length; close++) {
      depth += tokens[close].nesting;
      if (depth === 0) break;
    }
    fn(open, i + (open.meta.labelled ? 2 : 1), close);
  }
}

export const markers = {
  steps: { class: "fn-steps" },
};

export default function fieldNotes(md) {
  md.core.ruler.push("fn_steps", (state) => {
    forEachComponent(state.tokens, "steps", (open, from, close) => {
      let count = 0;
      for (let i = from; i < close; i++) {
        const token = state.tokens[i];
        if (token.type !== "list_item_open") continue;
        token.attrJoin("class", "fn-step");
        count++;
      }
      open.attrSet("data-steps", String(count));
    });
  });
}
```

Your rule runs after core has placed the markers and parsed the inline
content, after `validate` (which therefore sees what the author wrote), and
before source ranges are attached.

This is unrelated to the `gutterpress.components` catalog file, which nothing
reads yet. Looks (CSS-only packages) have no JavaScript, so their components
cannot carry `validate`.

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

**Project settings → Features** in the desktop writes exactly this entry.

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
| `` Extension "foo" not found. Install it with `gutterpress ext add foo` `` | Run that, or add it from Project settings → Features. A pinned entry whose copy is missing is downloaded automatically by `build`, `validate`, `preview` and when the desktop opens the book; this message is for an unpinned name |
| `Plugin "foo" does not export a valid plugin function` | Ensure the default export is a function, or select its named function with `export:` |
| `Plugin "foo" does not export a plugin function named "bar"` | Fix the `export:` name to one the package really exports |

@end-section

`gutterpress ext list` warns about the two states a build will trip over before you build: `Not pinned` (an npm name without a version — run `ext add` to install and pin it) and `Not installed` (a pinned entry whose vendored copy is missing — `build`, `validate` and `preview` download it for you, or `ext add` does it by hand).

## Reference Example

**The template is the scaffold**: `gutterpress new "My Plugin" --kind plugin`. It is small on purpose, every convention in it is one you should keep, and its test suite runs with `bun test` from the moment it is created.

For a look at what a large plugin becomes, the Dimm City Field Guide plugin (~1,800 lines — custom markers, block rules, token transforms, CSS shipping) lives in the `dc-op-manual` repo under `dc-op-manual/dc-design-guide/`. Read it to see the scale a mature plugin reaches; do not copy it as a starting point. Most real-world plugins are far smaller, and the scaffold is where they should start.

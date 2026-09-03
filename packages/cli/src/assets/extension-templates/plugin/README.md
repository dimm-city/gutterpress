# {{NAME}}

> {{DESCRIPTION}}

A Gutterpress **plugin** — a folder that adds markdown behaviour, component
CSS and insertable snippets to a book.

```
{{SLUG}}/
├── gutterpress.json     what this package declares to Gutterpress
├── plugin.js            the markdown-it plugin (declarative + bespoke halves)
├── styles/plugin.css    component CSS, with public tokens at :root
├── snippets/            insertable recipes, one per component
├── test/                fixture.md → expected.html, runnable with `bun test`
└── package.json         only needed for `bun test` and publishing to npm
```

## Try it

```sh
bun install     # once — pulls markdown-it, the suite's only dependency
bun test
```

Then wire it into a book. In the book's `manifest.yaml`:

```yaml
plugins:
  - path: plugins/{{SLUG}}
```

`path:` names the FOLDER, not `plugin.js`. That is what makes Gutterpress read
`gutterpress.json` and pick up the stylesheet and snippets alongside the
markdown behaviour — point it at the `.js` file and you get the markdown and
nothing else.

Now `gutterpress preview` the book and write:

```markdown
@term-box warning label="Read this first"
The rule of three applies here, and [[initiative]] is defined inline.
@end-term-box
```

## The conventions that are load-bearing

Most of what is in this folder is a suggestion. These five are not — each one
is something Gutterpress does not check for you, and each one fails silently
in somebody else's book when you get it wrong.

### 1. One prefix, and it is yours

Every class, every CSS custom property and every marker name this package
emits starts with `{{PREFIX}}`.

A book loads core, a theme and any number of plugins into a single flat CSS
namespace and a single flat marker namespace. Nothing scopes them. Without a
prefix, your `.callout` and somebody else's `.callout` are the same selector,
and the one that loads second wins — in their book, not yours, with no error.

`gp-` is reserved for Gutterpress core. Taking it does not conflict; it
overrides, which is worse.

`test/plugin.test.js` enforces both halves of this.

### 2. Never import from `gutterpress`

Not at runtime. Gutterpress ships as a single compiled binary with no
`node_modules` for plugin code to resolve against, so the import that works on
your machine throws on a reader's.

If you need a helper from core, inline a copy of it.

TYPE-only imports are the exception, because they are erased before the code
ever runs:

```js
/** @param {import("gutterpress").GutterpressPlugin} _ */
```

```ts
import type { GutterpressPlugin, GutterpressMarkerTable } from "gutterpress";
```

### 3. A plugin is a plain markdown-it plugin

`export default function (md, options) {}` and nothing else. No base class, no
registration call, no context object handed to you by the host. This is why
any markdown-it plugin on npm works in Gutterpress unchanged — and the price
of that is that your plugin has to be one too.

`markers`, `styles`, `css` and `metadata` are additional exports the loader
READS. They are data, not an API.

### 4. Declarative markers for containers, a rule for everything else

`export const markers` describes a wrapper element and Gutterpress's own
marker parser does the rest — same grammar, same class merging, same warnings
as core's `@section`. Use it whenever "wrap a block in an element with a
class" is the whole job.

Write a markdown-it rule by hand when it is not: inline syntax, token
rewriting, custom renderers. `plugin.js` has one of each so you can see the
line.

Marker names are global across every plugin a book loads. Two plugins
declaring `@callout` is a hard load error naming both — which is a good
outcome, and another reason to prefix.

### 5. Put your CSS in your own cascade layer

`styles/plugin.css` wraps everything in `@layer {{SLUG}}`.

Plugin CSS is injected before the book's own stylesheets, and in CSS an
unlayered rule beats a layered one at any specificity. So an unlayered plugin
sheet outranks every rule in a book that uses the recommended
`@layer tokens, base, components, templates, pages, book;` convention — the
author edits their CSS and nothing happens.

Because this sheet loads first, its layer sorts first, which makes it the
weakest thing in the book. That is the right place for a plugin to sit.

Adopt it for the whole file: a rule left outside the layer is unlayered and
beats everything inside it, including your own.

## Theming: the token pattern

Every look this package ships is driven by a custom property declared once at
`:root`, and consumed bare:

```css
:root { --{{PREFIX}}term-box-accent: #2f5d8a; }

.{{PREFIX}}term-box { border-left: 3px solid var(--{{PREFIX}}term-box-accent); }
```

`var(--x)`, not `var(--x, #2f5d8a)` — the default lives at `:root` exactly
once, so there is one place to look and no second copy to drift.

A book retunes it without touching this package, globally or per chapter:

```css
#ch-appendix { --{{PREFIX}}term-box-accent: #7a1f1f; }
```

A variant does the same thing internally: it only ever resets tokens, never
restates the component's rules.

## Publishing

Anything a book can reach works. Committing the folder into the book's
`plugins/` directory is the simplest and needs no registry at all.

To publish to npm, `npm publish` this folder and have readers install it with
`gutterpress plugin add {{SLUG}}`.

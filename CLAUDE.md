# CLAUDE.md — guidance for AI coding sessions on this repo

## What print-md ships

A standalone binary built with `bun build --compile` (see `scripts/compile.ts`).
Users download a single executable from GitHub Releases — no Node, no Bun, no
`node_modules` on the host. The CLI also runs from source via `bun src/cli.ts`
during development.

## Architectural rules

These are non-negotiable for any change that touches the runtime or build
pipeline.

### 1. No bundlers at runtime

Do **not** import `vite`, `rollup`, `esbuild`, or any other bundler at runtime
(eager or lazy) inside `src/`. Bundlers carry native bindings, large transitive
graphs, and `package.json`/`__dirname`-relative resolution patterns that break
under `bun build --compile`. Past attempts to ship vite inside the binary
required a compile-time regex plugin to rewrite `JSON.parse(readFileSync(new
URL("../package.json", import.meta.url)))` patterns inside `node_modules` — a
hack we are eliminating.

If you need a dev server with live reload, use **`Bun.serve`** with its built-in
`websocket` upgrade. The historical use case (`src/preview/`) is a static file
server + a "full-reload" websocket message on file change — which is exactly
what `Bun.serve` provides natively in ~150 lines without any bundler.

### 2. Lazy-load heavy optional deps

Anything used by a single subcommand (e.g. `stylelint` in `print-md lint`)
should be imported with a dynamic `import()` inside the command handler, not at
top-level. This keeps `print-md --help` fast and isolates compile failures to
the specific command path.

### 3. Don't add bun-patch files for upstream `package.json` reads

If a third-party package reads its own `package.json` at module load via
`readFileSync(new URL(...))` and breaks under `--compile`, prefer to:

  1. Drop the dep (often it's a bundler we shouldn't be running at runtime
     anyway — see rule 1).
  2. If the dep is essential, add a narrow rewrite to
     `scripts/compile-plugin.ts`. Each rewrite must target one specific file
     path inside `node_modules` and be guarded by the exact source pattern.
  3. Never use `bun patch` — it requires re-patching on every dep version
     bump.

### 4. Embedded static assets are fine

`with { type: "file" }` imports and `src/lib/embedded-assets.ts`'s extraction
pattern are the **canonical** way to ship the viewer chrome (HTML/CSS/JS)
inside the binary. This pattern works under `bun build --compile` and should
not be rewritten.

## DC Design Guide

The `examples/dc-design-guide/` folder is the **canonical design reference** for
the Dimm City print system. Once complete, it is the single source of truth for:

- Every CSS component, token, and layout rule
- The Dimm City plugin's macro system and emitted class names
- Authoring patterns for the Field Guide and any future DC book

### Design guide as source of truth

Any change to `css/dc-brand.css`, `css/page-rules.css`, `css/content-templates.css`,
or `plugins/dimm-city-plugin.js` should be reflected in the design guide documentation.
If the design guide documents one behaviour and the code does another, the code is wrong.

### Macro-first authoring direction

The system is moving from triple-colon container syntax toward named macros:

**Already implemented:**
`@chapter`, `@page`, `@section`, `@spread`, `@break`, `@specialty`, `@learning-path`,
`@skill`, `@continue`, `@outcome`, `@chapter-opener`

**Planned — `:::` containers that need macros built:**
`:::sidebar` → `@sidebar`, `:::lede` → `@lede`, `:::pull-quote` → `@pullquote`,
`:::procedure` → `@procedure`, `:::two-column` → `@two-column`,
`:::wrapper {.dc-definition-block}` → `@definition`,
`:::wrapper {.dc-sidebar-box}` → `@sidebar-box`

New components should always start as a named macro in the plugin, not a
triple-colon container wrapper.

### Per-page styling via `@page` named classes

Individual page layout — image position, column arrangement, decorative elements
specific to one spread — is done via `@page .class-name` in markdown. A class used
only once is not an anti-pattern; it is the intended mechanism. Do not generalise
one-off page classes into reusable components unless the pattern genuinely recurs.

### Plugin class naming convention

All classes emitted by `plugins/dimm-city-plugin.js` must use the `dc-` prefix
(e.g. `dc-note-callout`, `dc-outcomes-label`). The only exception is `.scream`,
which is intentionally unprefixed as a semantic name. When adding new plugin output,
always check that the emitted class name has a matching CSS rule before shipping.

### CSS layer contract (four-file hierarchy)

Each CSS file has a strict ownership boundary. Read the ARCHITECTURAL CONTRACT
comment in the first 50 lines of each file before adding any rule.

| File | Owns |
|---|---|
| `dc-brand.css` | Tokens, `@font-face`, shared `.dc-*` components |
| `page-rules.css` | `@page` declarations, named pages, Paged.js counter fixes |
| `content-templates.css` | `.page.*` layouts, general print utilities (`.pmd-*`) |
| `guide.css` | `div.chapter` scaffolding, specimen chrome, guide-specific footer |

### Class alias consolidation rule

When retiring a deprecated alias class name, a full find-replace is required across:
1. All field guide markdown (`dc-op-manual/field-guide/*.md`)
2. All design guide markdown (`examples/dc-design-guide/*.md`)
3. The plugin JS (`examples/dc-design-guide/plugins/dimm-city-plugin.js`)
4. All CSS files

Renaming only in CSS is not sufficient.

## Background reading

- ADR `docs/adr/0001-no-bundlers-at-runtime.md`
- [Single-file executable — Bun](https://bun.com/docs/bundler/executables)
- [Embed directory in executable with `bun build --compile` (#5445)](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly (#15374)](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` (#13405)](https://github.com/oven-sh/bun/issues/13405)

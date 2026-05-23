# CLAUDE.md — guidance for AI coding sessions on this repo

## Monorepo layout

This repo is a Bun workspace with three packages:

- **`packages/cli/`** (`@dimm-city/print-md`) — the markdown-to-PDF CLI. A
  thin shell over `@dimm-city/print-md-lib`. Ships as a standalone binary
  via `bun build --compile` AND as an npm package. The no-bundlers rule
  (§1 below) applies to this package.
- **`packages/lib/`** (`@dimm-city/print-md-lib`, private) — all runtime
  logic: markdown rendering, preview HTTP server, PDF generation via
  puppeteer-core, lint, validation. Pure ESM. Built with `bun build`
  (target: node) to `dist/`. Consumed by both the CLI and the viewer as a
  workspace dependency.
- **`packages/viewer/`** (`@dimm-city/print-md-viewer`) — Electron desktop
  app with a static SvelteKit SPA frontend. The SPA is built with
  `@sveltejs/adapter-static` and served by Electron via a custom `app://`
  protocol handler. The 3 API endpoints (status, preview, build) are
  `ipcMain.handle()` calls, not HTTP routes. The lib is loaded via a
  dynamic `import()` from `electron-dist/main.js` (CJS → ESM bridge using
  the `new Function("spec", "return import(spec)")` trick). No afterPack
  hook; electron-builder packages the lib via its standard dep walker.
  See [project_viewer_architecture] memory for the full picture.

The lib's runtime is Node.js-compatible — no `Bun.serve`/`Bun.file`/
runtime Bun APIs. `with { type: "file" }` is used as a build-time syntax
only; bun build compiles it to plain string constants in the dist output.
This is what enables the viewer to run with Electron's bundled Node.
Bun is required for development (workspace install, lib build, CLI
compile, tests) but NOT for end users of the packaged viewer.

## What print-md ships

A standalone binary built with `bun build --compile` (see
`packages/cli/scripts/compile.ts`). Users download a single executable from
GitHub Releases — no Node, no Bun, no `node_modules` on the host. The CLI also
runs from source via `bun packages/cli/src/cli.ts` during development.

## print-md Primary Goals
> [!ALERT]
> VERY IMPORTANT: All changes to this repo MUST comply with these goals.
> All changes must REDUCE complexity unless it can be properly justified.

- Create a way for non-technical writes to easily publish print materials using markdown and modern CSS
- Allow most authors to write and perform layout using simple markdown syntax
- Allow non-technical users to style their projects by setting CSS custom properties
- Make handling page layout trivial
- Allow authors to convert markdown and CSS into print ready PDFs
- Simplify the process of creating 


## Architectural rules

These are non-negotiable for any change that touches the runtime or build
pipeline.

### 1. No bundlers at runtime (packages/cli only)

Do **not** import `vite`, `rollup`, `esbuild`, or any other bundler at runtime
(eager or lazy) inside `packages/cli/src/`. Bundlers carry native bindings,
large transitive graphs, and `package.json`/`__dirname`-relative resolution
patterns that break under `bun build --compile`. Past attempts to ship vite
inside the binary required a compile-time regex plugin to rewrite
`JSON.parse(readFileSync(new URL("../package.json", import.meta.url)))`
patterns inside `node_modules` — a hack we are eliminating.

If you need a dev server with live reload, use **`Bun.serve`** with its built-in
`websocket` upgrade. The historical use case (`packages/cli/src/preview/`) is a
static file server + a "full-reload" websocket message on file change — which is
exactly what `Bun.serve` provides natively in ~150 lines without any bundler.

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

`with { type: "file" }` imports and `packages/cli/src/lib/embedded-assets.ts`'s
extraction pattern are the **canonical** way to ship the viewer chrome
(HTML/CSS/JS) inside the binary. This pattern works under `bun build --compile`
and should not be rewritten.

### 5. Plugins are plain markdown-it plugins

User plugins loaded via the manifest follow the standard `(md, options) => void`
markdown-it signature. Do **not** introduce a print-md-specific plugin API
(no host-injected `ctx` arg, no required base class, no custom hooks).
Reasons:

  1. Any of the hundreds of markdown-it plugins on npm Just Works in print-md.
  2. Plugin authors cannot reliably import from `@dimm-city/print-md` because
     the compiled binary has no `node_modules` for plugin code to resolve
     against. If a plugin needs an internal helper, it must inline-copy it.
     See `examples/dc-design-guide/plugins/dimm-city-plugin.js` for an
     example: its marker parser is an inlined copy of `markdown-it-paged`'s
     `parseMarkerLine`, not an import.
  3. `packages/cli/src/index.ts` re-exports type-only definitions
     (`PrintMdPlugin`, `PrintMdPluginMetadata`, `PrintMdPluginExport`) for
     TypeScript plugin authors. Types only — zero runtime coupling.

Plugin loader (`packages/cli/src/lib/markdown/plugins.ts`) fails fast on any
load error with messages identifying the offending manifest entry; it does NOT
auto-install missing npm packages. Authoring guide lives in [User Guide: Chapter 6 — Plugins](./examples/print-md-user-guide/06-plugins.md).

**Block container syntax** (`:::name ... :::` via `markdown-it-container`) was
removed 2026-05-17. The DC plugin's `@marker` family (`@page`, `@section`,
`@sidebar`, `@callout`, etc.) is the canonical author surface for wrapped
blocks. See `docs/migrations/2026-05-removing-container-syntax.md` for the
mapping. Do NOT reintroduce `markdown-it-container` to core.

### 6. `markdown-it-paged` owns its full contract

The inlined `packages/cli/src/lib/markdown/markdown-it-paged.js` owns: markers
→ tokens → HTML emission → the supporting CSS (`PAGED_CSS` named export).
`index.ts` imports the CSS and injects it; it does NOT override the plugin's
renderer rules or maintain its own layout state. Per-render state lives on
`env.__colSplitDepth`, not a module-level closure, so a thrown render can't
leak depth state into the next chapter.

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

### Per-page styling via `@page` named classes

Individual page layout — image position, column arrangement, decorative elements
specific to one spread — is done via `@page .class-name` in markdown. A class used
only once is not an anti-pattern; it is the intended mechanism. Do not generalise
one-off page classes into reusable components unless the pattern genuinely recurs.


### CSS layer contract (seven-file hierarchy)

Each CSS file has a strict ownership boundary. Read the ARCHITECTURAL CONTRACT
comment in the first 50 lines of each file before adding any rule.

| File | Owns |
|---|---|
| `dc-tokens.css` | `:root` tokens, `@font-face`, `* { print-color-adjust }` |
| `dc-core.css` | `html`/`body` baseline, element resets, heading defaults |
| `dc-components.css` | Every `.dc-*` + `.pmd-*` component (base + thin variants), specialty parent-container overrides |
| `page-templates.css` | **ALL `columns:N` rules** (exclusive), `.page.*` layouts, paged wrapper scaffolding, print utilities |
| `page-rules.css` | `@page` declarations, named pages, Paged.js counter fixes |
| `dg-overrides.css` | `div.chapter` scaffolding, `.specimen` chrome, guide-specific footer |
| `fg-overrides.css` | Context-scoped layout rules only: `.page.*`, `.example-*`, `.section.two-column` selectors and pure break control |

### Contextual Cascade Principle — variant assignment via CSS, not markdown

The DC design guide demonstrates the recommended pattern for print-md projects:
component variants flow from the document's natural hierarchy (chapter id →
page template class → section component class) via CSS selector chains that
set component custom properties — NOT via utility classes the author has to
apply to wrappers or per-element class attributes.

Authors write semantic markdown only (`@section .dc-X`). Components in
`dc-components.css` expose their look via `var(--dc-X, fallback)` patterns
and work in any context with no setup. Per-book overrides in
`fg-overrides.css` use natural selector chains to set component custom
properties for that book's variant choices.

`@section .dc-X` is the **minimum viable parent** for any variant. Chapter
and page selectors are layered on top only when a variant needs scope-
specific overrides. See [`docs/contextual-cascade-principle.md`](./docs/contextual-cascade-principle.md)
for the full pattern explanation with worked examples.

**FORBIDDEN:** utility variant classes on wrappers (`.dc-accent-X`,
`.variant-Y`); per-element class attributes for styling (`{.dc-table-blue}`
on tables); HTML wrappers in markdown for styling; raw values in per-book
overrides (always set component custom properties, never the raw property).

### Component style isolation — CORE CONSTRAINT

> **All component styles belong in `dc-components.css`. The override files
> (`fg-overrides.css`, `dg-overrides.css`) must NOT contain bare `.dc-*` style
> rules — they exist only for layout context and document-specific positioning.**

The test: if a selector is `.dc-something { ... }` with no page/chapter context
qualifier, it belongs in `dc-components.css`. Period.

**What belongs in `fg-overrides.css`:**
- Selectors scoped to a page or chapter class: `.page.card-grid`, `.example-rules >`, `.page.citizen-file`
- Pure CSS break control (`break-before/after/inside`) on bare component selectors
- Document-specific element overrides: `.page.chapter-04 h4`, `.chapter-start > blockquote`
- Field-guide-only image utility classes: `.fg-art-*`

**What does NOT belong in `fg-overrides.css`:**
- Any `.dc-*` rule without a context-scope qualifier
- Spacing, font-size, padding, color, or margin changes to components
- Any rule that would need to be duplicated in a second DC project

This constraint is what makes `dc-components.css` a reusable component library.
A new DC project imports `dc-components.css` and gets all correct default values
with zero override files required.

### Specialty variant system

Card variants (skill cards, path shells, specialty cards) are controlled by the
`.dc-specialty.<name>` parent container. Authors wrap the full specialty section in
`@specialty .augmerc` and every card inside inherits the augmerc shape and accent
automatically. Do NOT add `variant=` attributes to `@skill`, `@continue`, or
`@learning-path` macros.


## Background reading

- ADR `docs/adr/0001-no-bundlers-at-runtime.md`
- `packages/viewer/README.md` — viewer dev and packaging instructions
- [Single-file executable — Bun](https://bun.com/docs/bundler/executables)
- [Embed directory in executable with `bun build --compile` (#5445)](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly (#15374)](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` (#13405)](https://github.com/oven-sh/bun/issues/13405)

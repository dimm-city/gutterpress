# CLAUDE.md — guidance for AI coding sessions on this repo

## Monorepo layout

This repo is a Bun workspace with two packages:

- **`packages/cli/`** (`@dimm-city/print-md`) — the markdown-to-PDF CLI and
  its library API. All architectural rules below apply to this package.
- **`packages/viewer/`** (`@dimm-city/print-md-viewer`) — Electron + SvelteKit
  desktop app. Imports `@dimm-city/print-md` directly as a workspace dep.
  SvelteKit's Vite/Rollup build is intentional here; `@dimm-city/print-md` is
  marked SSR-external in `packages/viewer/vite.config.ts` so it is never
  bundled by Vite. The no-bundlers rule (§1 below) applies only to
  `packages/cli/src/`. Vite scripts in the viewer must be invoked with
  `bun --bun ./node_modules/.bin/vite` so that Bun's module resolver handles
  `@dimm-city/print-md` correctly at dev time.

> **Future work — Node.js compatibility for `@dimm-city/print-md`:**
> The CLI package currently uses Bun-specific APIs throughout its runtime
> (`Bun.serve`, `Bun.file`, `with { type: "file" }` import attributes). This
> means the viewer's SvelteKit server **must** run under Bun, which is why
> `packages/viewer/scripts/build-win.ts` bundles a `bun.exe` with the
> Windows package. The correct long-term fix is to make the CLI's runtime
> Node.js-compatible by replacing Bun APIs with Node.js equivalents:
> - `Bun.serve` → `node:http` createServer + `ws` for WebSocket
> - `Bun.file` → `node:fs/promises` readFile/createReadStream
> - `with { type: "file" }` → `new URL('../assets/...', import.meta.url)`
>
> Until that refactor is done, do **not** try to run the SvelteKit server
> in-process inside Electron's Node.js runtime — the CLI imports will fail.

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
auto-install missing npm packages. Authoring guide lives in `docs/plugins.md`.

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


### CSS layer contract (six-file hierarchy)

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

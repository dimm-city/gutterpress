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
  `ipcMain.handle()` calls, not HTTP routes. The Electron main + preload are
  built by **electron-vite** to `out/main/main.js` + `out/preload/`; the main
  is ESM and loads the lib with a plain dynamic `import("@dimm-city/print-md-lib")`
  (no CJS→ESM `new Function` bridge — that was removed when the build moved to
  electron-vite + asar, commit `c5e75ae`). No afterPack hook; electron-builder
  packages the lib + its transitive deps from the workspace `node_modules` via
  its standard dep walker (puppeteer-core is `asarUnpack`ed; PDF export itself
  uses Electron's own Chromium via `webContents.printToPDF` — see ADR 0002).
  See [project_viewer_architecture] memory + `packages/viewer/README.md` for the
  full picture.

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

### 0. Author-first primitive layering

Default, author-facing layout primitives belong in the most general reusable
layer that can own them:

1. Put generic markdown authoring behavior in core print-md / `markdown-it-paged`
2. Put DC-specific component chrome and macro semantics in the DC plugin and `dc-components.css`
3. Put book-specific positioning and context-only break tuning in `fg-overrides.css`

If a behavior is broadly useful to non-technical authors using simple markdown,
fix the default/core primitive first instead of solving it only in a project or
override layer.

### 0b. Resize review screenshots before judge runs

Before any AI visual review or three-judge design gate run, resize or otherwise
reduce screenshot payloads so they stay small enough to survive agent context
compaction.

1. Do not send large full-resolution chapter screenshots directly to judges.
2. Prefer smaller JPEGs or tighter page-range batches that remain legible.
3. Treat screenshot sizing as part of the review pipeline, not an optional
   cleanup step.

If review evidence is too large to stay in context, the judge pass is invalid
and must be re-run with resized screenshots.

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

Anything used by a single subcommand (e.g. `puppeteer-core` in `print-md build`)
should be imported with a dynamic `import()` inside the command handler, not at
top-level. This keeps `print-md --help` fast and isolates failures to the
specific command path.

### 3. Keep the binary free of deps that need filesystem resolution at runtime

The compiled binary must be fully self-contained — **there are currently zero
source rewrites** (`scripts/compile-plugin.ts` was removed when stylelint was
dropped). stylelint was the one offender: it read its own `package.json` and
`css-tree` data at runtime AND loaded its ~200 rule modules via a computed-path
dynamic `import()` that no bundler can embed. CSS print-safety checks now run on
**postcss** (`packages/lib/src/lib/printsafe.ts`), which bundles cleanly.

If a future dep breaks under `--compile` (runtime `package.json`/data reads,
`createRequire` JSON, or computed-path dynamic imports), prefer to **drop it**
(rule 1). Only if it is essential, re-introduce a narrow build-time `onLoad`
rewrite plugin — each rewrite targeting one exact `node_modules` file, guarded
by the exact source pattern. Never use `bun patch` (it needs re-patching on
every dep bump).

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

### 7. Git/source operations are Node-native — no external OS tools (0.4.0+)

The upcoming project-source / version-history / GitHub features (milestones
0.4.0 and 0.5.0 — see GitHub issues #12, #13, #14, #15, #16, #25) must perform
**all Git and GitHub operations with a Node-native, pure-JS implementation
(e.g. `isomorphic-git`)**. Non-negotiable:

- **Do NOT shell out to the system `git` binary.** The user must not be required
  to have Git installed, and we do **not** bundle a Git binary on any platform
  (this supersedes the original "bundle Git on Windows" framing of #16).
- **Do NOT depend on the GitHub CLI (`gh`)** or any other external CLI. GitHub
  API access uses the REST API directly (`fetch` / a JS SDK such as
  `@octokit/rest`), authenticated via the managed GitHub App / OAuth token.
- **Default new projects to a local Git repo** (`git init` + automatic
  "snapshot" commits) so non-technical users get local version control with **no
  credentials and no remote**, plus an **escape hatch** to run as a plain
  `local-folder` (no Git) when Git can't or shouldn't be used.
- **Shared lib, not duplicated.** Project scaffolding (with embedded-asset
  templates), source-type detection/capabilities, and the Git/provider layer
  live in `@dimm-city/print-md-lib` and are consumed by **both** the CLI
  (`print-md new`, etc.) and the viewer — one implementation, two thin
  front-ends.

Rationale: this keeps the `bun build --compile` CLI binary and the packaged
viewer fully self-contained (consistent with §1/§3) and makes the features work
for users with nothing pre-installed. NOTE: the existing PDF-validation external
tools (qpdf/gs/pdf* via `execCapture`) are a separate, pre-existing concern and
are unaffected by this rule — this rule governs the new Git/source surface only.

### 8. Platform abstraction — the renderer is host-agnostic; the host runs platform code (CORE REQUIREMENT)

> [!ALERT]
> This is a **non-negotiable core architecture requirement** for the viewer and
> for **every Electron application started in this org** — it is the gold
> standard, applied by default. See ADR `docs/adr/0004-platform-abstraction.md`.

The viewer is an Electron shell hosting a **static SvelteKit SPA**. The SPA is
written so it could run unchanged in a browser PWA tomorrow. To make that true —
and to keep the desktop build correct — there is exactly **one seam** between the
UI and the host, and it is honoured absolutely:

**The renderer (the SPA, everything under `packages/viewer/src/`) MUST stay
"PWA-clean": it contains ZERO platform/host code.**

- **No runtime imports from `@dimm-city/print-md-lib`** in the SPA. `import type`
  is fine (erased at build). A *value* import (e.g. `import { checkCss }`) drags
  the Node-target lib — and its transitive `fileURLToPath`/`node:*`/`postcss`/
  `isomorphic-git` code — into the browser bundle, which builds fine (vite shims
  `node:*`) but **crashes at runtime**. This exact mistake shipped a `500`/
  `fileURLToPath is not a function` crash in 0.4.0-beta.4.
- **No `node:*` / `fs` / `path` / `url` / `child_process` / `postcss` imports**
  in the SPA. Node-oriented libraries (postcss included) belong in the host.
- **All host work goes through the platform adapter.** App code does
  `import { getPlatform, isDesktop } from "$lib/platform"` and calls
  `platform.X(...)` — a platform-agnostic, typed, async API. It never touches
  `window.electron`/`ipcRenderer` directly (only `electron-adapter.ts` may).

**Adding a new host capability** means wiring it across the **five layers**, then
calling it via `getPlatform()`:

1. `electron/main.ts` — `ipcMain.handle("ns:op", …)` (the real Node work)
2. `electron/preload.ts` — expose it on the `contextBridge` object
3. `electron/types.d.ts` — add it to the `Window.electron` shape
4. `src/lib/platform/contract.ts` — add it to `HostServices` + `ElectronBridge`
   (and define any payload types **locally**, decoupled from the lib)
5. `ElectronAdapter` (delegate to `bridge().op`) **and** `WebAdapter` (stub:
   reject / throw / safe no-op until the PWA lands)

**The canonical fix when node code is needed by the UI:** don't bundle it into
the renderer — run it in the host and expose a narrow async method. Example:
CSS print-safety linting (`checkCss`) is postcss-based, so it runs in `main` via
a `lint:checkCss` IPC and the editor's lint gutter calls
`getPlatform().checkCss(...)` (CodeMirror accepts a `Promise` lint source).

**Verification (must pass before any viewer change is "done"):** after
`npm run build`, the SPA bundle must contain no host code —
`grep -rlE "fileURLToPath|node:module|createRequire|node:fs|node:url|isomorphic-git" build/_app/`
must output **nothing**. Treat a hit as a release-blocking regression. (The
`bun build --compile` CLI binary is the *opposite* environment — it bundles the
lib's Node code on purpose; §1/§3 govern it. This rule governs the renderer.)

Why this is the default for new Electron apps: the renderer/host split is the
only thing that keeps an Electron UI portable to web, testable without a host,
and free of the "works in `vite dev`, crashes in the packaged app" trap. Build
the typed adapter seam **first**, before the first feature adds a host call.

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

### 🔒 Frozen components (do not modify without approval)

**Chapter-opener / intro composite** — APPROVED 2026-05-25 after 14
iterations on the DC design guide. The author markdown surface is:

```
@chapter C.01
@page intro
@section
# Who Do You Dream to Be?
```

The implementation surface (DO NOT modify without explicit per-change
user approval — full surface list in project memory
`feedback_chapter_opener_frozen.md`):

- `packages/lib/src/lib/markdown/markdown-it-paged.js` — `@chapter NAME`
  parsing, `chapterLabel` context, `data-chapter-label` propagation, and
  `<div class="chapter-opener">` element injection.
- `examples/dc-design-guide/css/dc-tokens.css` — `--dc-chapter-opener-*`
  token defaults (co-located with `--space-*` / `--clip-banner` deps;
  cross-file `var()` chains are unreliable in paged.js).
- `examples/dc-design-guide/css/dc-components.css` — `.chapter-opener`
  badge, the `.chapter[data-chapter-label] > .page[data-page="intro"] >
  .section` substrate variant chain, the chevron auto-extension via
  shared `.dc-chevron` selector lists, and the `filter: drop-shadow()`
  on the intro page that produces the composite's cohesive shadow.

Only approved customisation: per-chapter token overrides at the chapter
id scope (`#ch-name .chapter { --dc-chapter-opener-accent: ... }`).

If a future task seems to require a chapter-opener change, STOP and
ask the user. Cite the frozen-component memory and request explicit
approval. Diagnostic notes on the paged.js quirks the architecture
relies on are in AKM `memory:paged-js-css-quirks-discovered-2026-05-25`.

### CSS anti-patterns (learned the hard way over 8 gate iterations)

Apply these BEFORE making any CSS edit. Each rule came from a user callout
of "lazy shortcut" or "poor architecture" during the 2026-05-25 DC gate.
Durable notes live in AKM memory `print-css-architectural-anti-patterns`
and project memory `feedback_css_architectural_anti_patterns.md`.

**R1. Component-level rule before per-page override.** Before writing
`.page.X > .Y`, ask: is this expressible at the component level? If yes,
change the component default. Per-page selectors are one-offs that don't
compose.

**R2. Verify selectors target classes that exist in rendered DOM.** Grep
the plugin source or inspect the DOM before writing a CSS selector against
a class. The `@lede` macro emits `.dc-intro`, NOT `.dc-lede` — five
iterations of dead selectors lived in fg-overrides.css because no one
checked the plugin.

**R3. Flush attachment = single-direction margins.** Components space
themselves via `margin-bottom` only; `margin-top: 0`. Consecutive siblings
collapse to the bottom-margin gap. First sibling after a chevron is
automatically flush. NEVER use negative margins or z-index to mask a wrong
margin convention.

**R4. Block sibling beside a float — source order or BFC, NEVER z-index.**
If a styled block "covers" a float, the root cause is normal CSS float
behaviour (blocks extend full-width behind floats). Three fixes, ranked:
(1) reorder DOM source so visual order matches; (2) `display: flow-root`
on the sibling block (creates BFC, block shrinks beside float); (3)
`clear: both` (block sits below float). Z-index is for stacking situations
(overlays, modals, decorative pseudos), not for layout flow.

**R5. Don't shrink a block that's meant to be full-width.** If the intent
is "pullquote spans the section width, image floats below it", the answer
is source order (pullquote first, image second). Reaching for `display:
flow-root` to shrink the pullquote breaks the intent.

**R6. The "CSS or DOM order?" diagnostic.** Before any CSS layout fight:
write the intended visual order (top-to-bottom, left-to-right), compare
to current DOM order, and if they don't match the fix is source order not
CSS. CSS is only the right tool when intent can't be expressed by source
order (true 2D grids, overlays, components used across multiple contexts).

**R7. Response to user callout of "lazy" or "poor architecture".** Revert
the shortcut; restate the intent in plain language; identify the right
primitive; apply at the component level. Do NOT respond with another
shortcut variant.

**R8. Composite shadows = `filter: drop-shadow()` on the wrapper.** Per-element
`box-shadow` on stacked children with different widths/clips produces
stepped offsets. `filter: drop-shadow(<offset>)` on the common wrapper
follows the union silhouette of all visible descendants — one continuous
shadow respecting clip paths.

**R9. Co-locate dependent CSS custom properties.** Paged.js resolves
cross-stylesheet `var()` chains unreliably. If `--x: var(--y)`, declare
both `--x` and `--y` in the same `:root` block (same file). Otherwise the
chain can resolve to `""` and the property comes out empty.

**R10. Selector chains on `.page` survive paged.js; `::before` on `.page`/
`.chapter` does NOT.** Paged.js's polisher strips static pseudo-element
declarations on those classes (likely because `@page` is a CSS at-rule
it processes specially). For visible composite elements that can't be a
pseudo, inject a real DOM element via the markdown plugin. Selector
CHAINS through `.page[data-page="X"]` to descendants are fine.

**R11. Split visual-edge tokens from content-edge tokens.** A clipped
composite has two edges: the visual edge (where the substrate ends) and
the content edge (where body text ends). Conflating them makes body text
flush with the clip — cramped. Use two tokens: `--clip-tail` and
`--pad-right: calc(var(--clip-tail) + var(--space-md))`.

**R12. Propagation > tree-walking.** CSS `attr()` reads the SAME element
only. When a CSS rule needs context from a parent ("this is in a labeled
chapter"), have the markdown plugin propagate the context as a data
attribute on the child. Don't try to walk up the tree with `:has()` —
it's unreliable in paged.js.


## Background reading

- ADR `docs/adr/0001-no-bundlers-at-runtime.md`
- `packages/viewer/README.md` — viewer dev and packaging instructions
- [Single-file executable — Bun](https://bun.com/docs/bundler/executables)
- [Embed directory in executable with `bun build --compile` (#5445)](https://github.com/oven-sh/bun/issues/5445)
- [`bun build` does not embed binaries from node_modules correctly (#15374)](https://github.com/oven-sh/bun/issues/15374)
- [`bun build --compile`: `Bun.resolve(..., import.meta.url)` resolves relative to `cwd` (#13405)](https://github.com/oven-sh/bun/issues/13405)

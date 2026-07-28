# Print-MD Compatibility with Filesystem Design Tools

## Technical analysis and implementation plan

**Audience:** Print-MD maintainers and contributors  
**Purpose:** Make ordinary Print-MD projects work smoothly with Open Design and similar filesystem-based tools without coupling Print-MD to any external application.  
**Verified against:** Print-MD `main` at `06403ab`, July 28, 2026. Every contract below was re-read from the source on that date.

> **Revision note (2026-07-28).** This document was originally written against
> `719173c`, when a book shipped as a staged file tree assembled from a
> `source.assets` list. That field, its flattening rules, and the whole staging
> step were deleted in the asset-pipeline rewrite
> ([`docs/reviews/asset-pipeline-deep-analysis-2026-07-27.md`](../reviews/asset-pipeline-deep-analysis-2026-07-27.md)
> §9.6); a manifest that still carries `source.assets` or `output` now fails
> with an explicit error. Sections describing shared/local asset composition
> have been rewritten around the current inline model, and three of the eight
> proposed changes are resolved: two became unnecessary, one had already
> shipped. Their entries record what happened rather than being deleted.

## Decision

Print-MD should not contain an Open Design integration. Open Design should behave like another local editor that reads and writes the repository files Print-MD already understands.

```text
Filesystem design tool edits ordinary repository files
                         ↓
Print-MD watches the active book and its declared dependencies
                         ↓
Print-MD renders the authoritative paginated preview
                         ↓
The design tool displays or inspects that preview
```

Do not add an Open Design dependency, command, button, manifest section, write API, session format, or Print-MD-owned project-state directory.

The Print-MD work is limited to generic correctness and interoperability improvements: keep the theme in its intended cascade position, repaginate after external layout changes, watch the files a book actually reads, and make the normal preview URL easy to use.

## Current implementation contracts

### Manifest and manuscript discovery

Print-MD recognizes, in order:

```text
manifest.yaml
manifest.yml
print-md.yaml
```

(`MANIFEST_FILENAMES`, `packages/cli/src/lib/manifest.ts`.) Paths in a manifest resolve from the manifest directory.

When `source.files` is non-empty, those files are rendered in the declared order. Otherwise Print-MD renders every **top-level** `.md` file in the book directory alphabetically; it does not recursively discover manuscript files (`resolveActiveMarkdownFiles`, `packages/cli/src/lib/markdown/index.ts`).

This creates an important interoperability rule:

> A root-level `DESIGN.md`, `README.md`, or other control document becomes manuscript content when `source.files` is implicit. Keep control documents in a nested `design/` directory, outside the book folder, or make `source.files` explicit.

### The output contract

A build produces `book.html` plus the images it references — nothing else, and nothing configurable. `book.html` is self-contained: every active stylesheet is inlined into a single `<style data-project-css>` block, fonts become `data:` URIs, and small images become data URIs too.

Two consequences matter to a design tool:

- **A `styles:` entry is a path to READ, not a file to ship.** Its location is irrelevant to the output, which is what makes shared stylesheets and themes work with no copying step (see "Shared and book-local composition" below).
- **`output` and `source.assets` no longer exist.** Output goes to `dist/<title-slug>/` by convention (`packages/cli/src/lib/output-paths.ts`); the asset set is derived from what the book actually references. A manifest carrying either field fails with a message naming it.

### Themes

A project theme remains a self-contained package:

```text
themes/<id>/
├── theme.css               # required
├── theme.json              # optional metadata
├── fonts/                  # optional theme-owned assets
├── images/                 # optional theme-owned assets
└── ...                     # anything referenced by theme.css
```

Applying or importing a theme copies the complete package into the book and records `themes/<id>/theme.css` in `manifest.styles`. The Theme panel discovers project themes by scanning `themes/`. This behavior should not change.

The theme manager treats any `themes/<id>/theme.css` entry as the active theme and keeps one such entry active at a time.

### Styles

`styles/` contains ordinary publication CSS, not selectable theme packages. New projects start with `styles/book.css`. A small project may keep its tokens, reusable components, page rules, and book-specific styling in that single file. Larger projects may split CSS into more files, but Print-MD should not assign special semantics to filenames such as `tokens.css` or `components.css`.

`manifest.styles` remains the only explicit stylesheet contract. When omitted, `resolveActiveStyles` (`packages/cli/src/lib/style-resolver.ts`) prefers:

```text
styles/book.css
css/print.css
css/index.css
css/style.css
css/main.css
```

then the first discovered CSS file (root `.css`, `styles/*.css`, `css/*.css`, `themes/<id>/theme.css`, alphabetically), then `[]` — an honest "no stylesheet", never a link to a file that does not exist.

`resolveActiveStyles` is the single source of stylesheet truth: the renderer, the CLI's lint runner, and the viewer's CSS editor all call it, so what is edited is what is rendered.

### Publication assets

Assets are **discovered from references, never declared**:

- Every `url()` in an active stylesheet resolves against **that stylesheet's own location**. Fonts always inline as `data:` URIs; images ≤ 512 KB inline; larger images are copied — keeping their project-relative path when they live inside the book, or content-addressed into `assets/<hash><ext>` when they come from outside it (`packages/cli/src/lib/asset-inline.ts`).
- Every markdown image reference is recorded by the renderer and copied verbatim at its authored relative path (`planImageCopies`).
- A missing stylesheet or font is a build **error** at read time, named and located — not a 404 during pagination.

One standing rule follows from this and a design tool must respect it: **a markdown image reference must live inside the book**. An absolute path or a `../` escape is a build error telling the author to copy the file into the project. CSS `url()` has no such restriction, because a stylesheet's references are resolved and embedded rather than re-pathed.

### Print-MD plugins

There are two distinct storage models.

**Authored local plugins** are normal JavaScript modules referenced by path, including paths outside the book (resolved against the manifest directory):

```yaml
plugins:
  - path: ../../shared/plugins/publisher-components.js
  - path: ./plugins/book-components.js
```

**Registry-installed npm plugins** are installed explicitly with the current public CLI:

```bash
print-md plugin add markdown-it-highlightjs@4.3.0 ./books/core-book
print-md plugin add markdown-it-emoji@3.0.0 ./books/core-book --export full
```

The CLI currently exposes the `add` subcommand. Broader listing, toggling, importing, and removal behavior belongs to the desktop plugin-management surface and its shared library, not to undocumented CLI commands.

`plugin add` downloads and verifies the npm archive and required production dependency graph, vendors exact versions beneath the target book's `plugins/npm/` tree, writes integrity receipts, load-tests the plugin, and records the exact version in the manifest. It does not invoke npm, Bun, package lifecycle scripts, or a system Node installation.

The managed `plugins/npm/` tree is book-local reproducible runtime content. It should be committed when a team expects the book to build offline on another machine. It is not a publication asset and must not be edited by a design tool.

### Profiles

`profiles/` is an optional team convention for ICC profiles and related print configuration — Print-MD attaches no meaning to the directory name; the manifest names the file directly (`pdfx.icc`). Profiles are direct build inputs, not browser assets.

### Existing source metadata

Print-MD already emits `data-source-line` through `markdown-it-source-map`. The live preview also wraps source chapters with `data-chapter-src` (`assembleBookHtml`'s `wrapChapters`). These are the source-location primitives to preserve and reuse. Do not create another source-map format for design tools.

### Git scope

When a book is opened inside a larger repository, Print-MD records the book's subpath but snapshots, history, restore, pull, and push operate on the enclosing repository root (`packages/cli/src/lib/project-source.ts`). This already supports multi-book repositories with shared assets and design documentation.

## Supported repository layouts

### Single book

```text
my-book/
├── manifest.yaml
├── chapters/                   # only with an explicit source.files list
├── design/                     # safe with implicit manuscript discovery
│   ├── DESIGN.md
│   ├── notes/
│   └── references/
├── themes/                     # optional applied/imported themes
├── styles/
│   └── book.css
├── fonts/                      # optional
├── images/                     # optional
├── assets/                     # optional
├── plugins/                    # optional authored or managed plugins
│   └── npm/                    # managed by Print-MD; do not hand-edit
├── profiles/                   # optional
└── design-guide/               # optional companion Print-MD project
```

A root-level `DESIGN.md` is valid only when the manifest explicitly lists manuscript files. So is a `chapters/` directory: implicit discovery is top-level only, so chapters in a subdirectory must be listed in `source.files`.

### Multi-book team repository

```text
publication-project/
├── DESIGN.md                         # safe: outside every book root
├── design/
│   ├── notes/
│   ├── references/
│   └── open-design/
│       ├── skills/
│       └── plugins/
├── shared/
│   ├── themes/
│   ├── styles/
│   ├── fonts/
│   ├── images/
│   ├── plugins/                      # authored Print-MD plugins
│   └── profiles/
└── books/
    ├── core-book/
    │   ├── manifest.yaml
    │   ├── chapters/
    │   ├── design/
    │   │   └── DESIGN.md
    │   ├── themes/
    │   ├── styles/
    │   ├── images/
    │   ├── plugins/
    │   │   └── npm/                  # Print-MD-managed packages
    │   ├── profiles/
    │   └── design-guide/
    └── supplement/
        └── ...
```

Every directory is optional. A book repeats only the categories it needs to extend or intentionally replace.

`shared/fonts/` and `shared/images/` are reachable **through shared CSS** — a shared stylesheet's own `url("../fonts/…")` resolves relative to that stylesheet and the font is embedded. They are not reachable from a book's markdown prose; see the standing rule under "Publication assets".

## Shared and book-local composition

There is no asset list and no staging step. A book composes shared and local design by naming the files it reads, in cascade order:

```yaml
title: Core Book
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
styles:
  - ../../shared/themes/publisher/theme.css
  - ../../shared/styles/publisher-components.css
  - styles/book.css
plugins:
  - path: ../../shared/plugins/publisher-components.js
  - path: ./plugins/book-components.js
pdfx:
  icc: ../../shared/profiles/CGATS21_CRPC1.icc
```

Each `styles:` entry is read and inlined in order, with its fonts and images resolved relative to itself. Nothing is copied, flattened, or renamed, so there is no destination indirection to reason about and no collision rule to remember: **later entries win at equal specificity, and that is the whole model.**

Shared images and fonts used by shared CSS therefore travel with that CSS automatically. Shared art used directly in **prose** does not — copy it into the book that uses it.

### CSS cascade

The emitted order is:

```text
1. markdown-it-paged layout primitives (PAGED_CSS)
2. Print-MD plugin default CSS
3. manifest styles, in listed order
```

(`assembleBookHtml`, `packages/cli/src/lib/markdown/assemble.ts`.) Project CSS is last, so it is authoritative at equal specificity.

Use one active theme, listed first. Later ordinary styles extend it. Accepted design-tool changes belong in the stable shared theme, reusable component stylesheet, local theme, local book stylesheet, semantic Markdown, or authored plugin — not in a tool-specific override file.

### Shared themes and the Theme panel

A book can reference a shared theme package directly (`styles: [../../shared/themes/publisher/theme.css]`) and it renders exactly like a local one. The Theme panel, however, only lists a theme physically present inside the opened book's `themes/` directory as a project theme.

Teams may either:

- reference the live shared package so multiple books receive shared changes; or
- import/copy the theme into a book when the book should own and diverge from it.

Print-MD does not need a shared-theme registry.

## Required generic Print-MD changes

### 1. Complete theme staging — **withdrawn (no longer applicable)**

The original finding was that `themes` was missing from the conventional
`source.assets` defaults, so an applied theme's package was never staged into
the output. The staging step and the asset list are both gone: a theme's
`theme.css` is inlined by reference and its fonts/images are embedded through
that stylesheet's own `url()`s. There is nothing left to stage.

### 2. Preserve theme cascade position — **done**

The theme manager removed the active theme entry and appended the replacement, which could move the base theme *after* book-specific CSS and silently invert every override the author had written.

`setActiveThemeStyle` now reuses the outgoing theme's index when replacing a theme, and inserts a project's first theme at the front of `styles:`, ahead of the ordinary stylesheets that extend it. All non-theme entries are preserved, as before.

### 3. Put plugin default CSS before project CSS — **done (already shipped)**

Plugin-exported CSS was injected after linked user styles, so equal-specificity plugin rules could defeat the project's intended final styling. `assembleBookHtml` now emits paged primitives → plugin CSS → project CSS in one `<style>` block. No further change needed.

### 4. Repaginate after active CSS changes — **done**

The preview's CSS fast path re-fetched the changed stylesheet as a fresh `<link>` without rerunning Paged.js. That is unsafe for publication design: fonts, line height, spacing, custom properties, page geometry, columns, tables, images, and break rules all alter pagination, so the live view showed new styling on stale page boxes.

The fast path is removed. A stylesheet edit now takes the same debounced rebuild and double-buffered swap as a content edit — `book.html` is re-rendered (which re-runs the inline pass) and connected clients full-reload, which is a complete Paged.js pagination. Scroll position survives through the existing `data-source-line` anchor restore.

No Open Design-specific preview mode is needed.

### 5. Resolve shared/local overlays consistently — **withdrawn (no longer applicable)**

This asked for one `resolveAssetSource(outputRelativePath, orderedSourceAssets)` helper, because a flattened output href could be produced by several source roots and build/lint/preview/editor each guessed differently.

Flattening is gone, so an href has exactly one source: the path the manifest names. `resolveActiveStyles` is already the single resolver shared by the renderer, the lint runner, and the viewer's CSS editor, and it returns real source paths. The ambiguity this item existed to remove no longer has a way to occur.

### 6. Make watching dependency-aware — **done**

The watcher had exactly one root — the book folder — so editing a shared stylesheet or a shared authored plugin in a multi-book repository never refreshed the preview.

`externalWatchTargets` (`packages/cli/src/preview/file-watcher.ts`) now resolves the book's declared `styles:` and authored `plugins[].path` entries and adds each one that lands outside the book as an extra watch target. The set is re-synced after every rebuild, so a manifest edit that adds or drops a shared entry takes effect without restarting the preview. Only declared entries are watched, not their parent directories — a file reached only through an `@import` from a shared stylesheet is not watched individually.

| Change | Action |
|---|---|
| Markdown listed in `source.files` | Rebuild; splice that chapter |
| Top-level Markdown under implicit discovery | Rebuild; splice that chapter |
| Any stylesheet, local or declared-shared | Rebuild and repaginate |
| Font or image referenced by the book | Rebuild |
| Manifest | Reload configuration, re-sync watch targets, rebuild |
| Configured authored local plugin, local or declared-shared | Reload plugin and rebuild |
| Managed npm package changed by `plugin add` | Reload as required |
| Multi-file burst (restore, sync merge) | One rebuild, full reload |
| `design/` notes, references, or Open Design package source | Ignored unless the book declares it |
| Dot directories, output, and tool caches | Ignored |

### 7. Reuse source metadata

Verify that Paged.js preserves or clones `data-source-line` and nearby `data-chapter-src` context sufficiently for browser inspection. Add only a small DOM helper if necessary to walk from a generated page fragment to the nearest semantic source-bearing element.

Do not create a source-map database, sidecar protocol, or Open Design-specific metadata.

### 8. Expose generic preview access

The CLI already prints the bound preview URL (`Preview server running at http://localhost:<port>`), and the preview server answers `GET /api/status` with `{ hasInput, currentPath }` for liveness and project identification. The desktop viewer may add a generic **Copy preview URL** action.

Do not add a remote write API or name a particular design application.

## Explicit non-goals

Do not add:

- Open Design dependencies or product-specific code;
- a **Design with Open Design** action;
- a `design:` manifest section;
- a Print-MD-created `.print-md` or `.design` project directory;
- required token JSON;
- tool-specific override CSS;
- Open Design session, approval, or recovery state;
- a second source-map implementation; or
- a network file-write API.

## Delivery sequence

### Phase 1 — current correctness gaps — **complete**

1. ~~Complete active-theme staging.~~ Withdrawn with the staging step (§1).
2. Preserve theme position when switching themes. **Done** (§2).
3. Move plugin default CSS before project styles. **Already shipped** (§3).
4. Regression coverage for all three manifest filenames. **Present** (`manifest.test.ts`).

### Phase 2 — preview and shared-overlay correctness — **complete**

1. Repaginate after active CSS, font, theme, manifest, and relevant asset changes. **Done** (§4).
2. ~~Centralize ordered shared/local source resolution.~~ Withdrawn (§5); `resolveActiveStyles` already is that resolver.
3. Use the same resolution in preview, lint, validation, and the stylesheet editor. **Present** — all call `resolveActiveStyles`.
4. Make rebuild decisions dependency-aware. **Done** (§6).
5. Preserve source-anchor restoration and double buffering. **Preserved**.

### Phase 3 — interoperability documentation

1. Document the single-book and multi-book layouts.
2. Document the root control-Markdown hazard when `source.files` is implicit.
3. Document reference-based shared composition and the in-book markdown image rule.
4. Separate authored local plugins from Print-MD-managed npm packages.
5. Verify existing source metadata through real Paged.js output.
6. Add generic preview URL copying if useful.

## Acceptance criteria

- Existing `themes/<id>/theme.css` projects continue to work unchanged.
- Applied/imported themes remain project-local self-contained packages, and keep their cascade position when switched.
- All three current manifest names work.
- Root control Markdown is never created automatically in a book that uses implicit manuscript discovery.
- A starter project may continue using only `styles/book.css`.
- A repository may share themes, styles, fonts, images, authored plugins, and profiles by reference.
- A book may shadow a shared decision by listing its own stylesheet later in `styles:`.
- Build, preview, lint, validation, and stylesheet editing resolve the same active CSS source.
- Print-MD-managed npm plugins remain book-local, verified, and reproducible.
- Arbitrary active CSS edits — local or shared — trigger a rebuild and accurate repagination.
- Existing source-line metadata remains the basis for visual inspection.
- Print-MD contains no Open Design-specific runtime behavior.

## Research basis

Paths are current as of `06403ab`; the asset pipeline this document originally described (`packages/cli/src/lib/assets.ts`) no longer exists.

- [Manifest lookup and resolution](../../packages/cli/src/lib/manifest.ts)
- [Manuscript file resolution](../../packages/cli/src/lib/markdown/index.ts)
- [Stylesheet resolution](../../packages/cli/src/lib/style-resolver.ts)
- [CSS/font/image inlining](../../packages/cli/src/lib/asset-inline.ts)
- [Book HTML assembly and cascade order](../../packages/cli/src/lib/markdown/assemble.ts)
- [Theme manager](../../packages/cli/src/lib/theme-manager.ts)
- [Plugin command and vendoring](../../packages/cli/src/commands/plugin.ts)
- [npm plugin vendoring decision](../adr/0007-npm-plugin-vendoring.md)
- [Preview file watching](../../packages/cli/src/preview/file-watcher.ts)
- [Enclosing repository detection](../../packages/cli/src/lib/project-source.ts)
- [Asset pipeline analysis that removed staging](../reviews/asset-pipeline-deep-analysis-2026-07-27.md)
- [Companion design guides](../design-guides.md)

## Final principle

External design tools edit ordinary source files. Print-MD owns manuscript selection, plugin loading, asset resolution, pagination, preview, and publication output. Shared and book-local resources compose by reference through the existing manifest — not through an integration-specific layer, and not through a staged file tree.

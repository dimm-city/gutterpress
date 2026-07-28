# Print-MD Compatibility with Filesystem Design Tools

## Technical analysis and implementation plan

**Audience:** Print-MD maintainers and contributors  
**Purpose:** Make ordinary Print-MD projects work smoothly with Open Design and similar filesystem-based tools without coupling Print-MD to any external application.  
**Verified against:** Print-MD `main` at [`719173c`](https://github.com/dimm-city/print-md/commit/719173c1ce68d7acd91494f477eb8e74533171a0), July 27, 2026.

## Decision

Print-MD should not contain an Open Design integration. Open Design should behave like another local editor that reads and writes the repository files Print-MD already understands.

```text
Filesystem design tool edits ordinary repository files
                         ↓
Print-MD watches the active book and declared dependencies
                         ↓
Print-MD renders the authoritative paginated preview
                         ↓
The design tool displays or inspects that preview
```

Do not add an Open Design dependency, command, button, manifest section, write API, session format, or Print-MD-owned project-state directory.

The Print-MD work is limited to generic correctness and interoperability improvements: complete theme staging, preserve the intended CSS cascade, resolve shared assets consistently, repaginate after external layout changes, and make the normal preview URL easy to use.

## Current implementation contracts

### Manifest and manuscript discovery

Print-MD recognizes, in order:

```text
manifest.yaml
manifest.yml
print-md.yaml
```

Paths in a manifest resolve from the manifest directory.

When `source.files` is non-empty, those files are rendered in the declared order. Otherwise Print-MD renders every **top-level** `.md` file in the book directory alphabetically; it does not recursively discover manuscript files.

This creates an important interoperability rule:

> A root-level `DESIGN.md`, `README.md`, or other control document becomes manuscript content when `source.files` is implicit. Keep control documents in a nested `design/` directory, outside the book folder, or make `source.files` explicit.

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

`manifest.styles` remains the only explicit stylesheet contract. When omitted, current fallback discovery prefers:

```text
styles/book.css
css/print.css
css/index.css
css/style.css
css/main.css
```

and then the first discovered CSS file.

### Publication assets

The conventional asset roots are currently:

```text
css
fonts
images
styles
assets
```

`css/` remains supported for existing projects. New examples should prefer `styles/`, `fonts/`, `images/`, and optional generic `assets/` without breaking older layouts.

An external asset entry beginning with `..` is flattened to its basename. Entries are copied in manifest order and later copies win path collisions:

```text
../../shared/styles → styles/
../../shared/fonts  → fonts/
```

### Print-MD plugins

There are two distinct storage models.

**Authored local plugins** are normal JavaScript modules referenced by path, including paths outside the book:

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

The managed `plugins/npm/` tree is book-local reproducible runtime content. It should be committed when a team expects the book to build offline on another machine. It is not a publication asset and must not be placed in `source.assets` or edited by a design tool.

### Profiles

`profiles/` is an optional convention for ICC profiles and related print configuration. Profiles are direct build inputs, not browser assets.

### Existing source metadata

Print-MD already emits `data-source-line` through `markdown-it-source-map`. Incremental preview also wraps source chapters with `data-chapter-src`. These are the source-location primitives to preserve and reuse. Do not create another source-map format for design tools.

### Git scope

When a book is opened inside a larger repository, Print-MD records the book's subpath but snapshots, history, restore, pull, and push operate on the enclosing repository root. This already supports multi-book repositories with shared assets and design documentation.

## Supported repository layouts

### Single book

```text
my-book/
├── manifest.yaml
├── chapters/                   # or root Markdown manuscript files
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

A root-level `DESIGN.md` is valid only when the manifest explicitly lists manuscript files.

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
│   ├── assets/
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
    │   ├── fonts/
    │   ├── images/
    │   ├── assets/
    │   ├── plugins/
    │   │   └── npm/                  # Print-MD-managed packages
    │   ├── profiles/
    │   └── design-guide/
    └── supplement/
        └── ...
```

Every directory is optional. A book repeats only the categories it needs to extend or intentionally replace.

## Shared and book-local composition

Declare shared renderable roots first and matching local roots second:

```yaml
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
  assets:
    - ../../shared/themes
    - ../../shared/styles
    - ../../shared/fonts
    - ../../shared/images
    - ../../shared/assets
    - themes
    - styles
    - fonts
    - images
    - assets
```

Do not list the entire `../../shared` directory when it also contains profiles, plugin source, notes, or other files that should not be copied into HTML output.

Plugins and profiles remain direct references:

```yaml
plugins:
  - path: ../../shared/plugins/publisher-components.js
  - path: ./plugins/book-components.js

pdfx:
  icc: ../../shared/profiles/CGATS21_CRPC1.icc
```

### CSS cascade

A practical book cascade is:

```yaml
styles:
  - themes/publisher/theme.css
  - styles/publisher-components.css
  - styles/book.css
```

The intended order is:

```text
1. Print-MD and Paged.js defaults
2. Print-MD plugin default CSS
3. Manifest styles in listed order
```

Use one active theme. Later ordinary styles extend it. Accepted design-tool changes belong in the stable shared theme, reusable component stylesheet, local theme, local book stylesheet, semantic Markdown, or authored plugin—not in a tool-specific override file.

### Shared themes and the Theme panel

A shared theme copied through `source.assets` can render at `themes/<id>/theme.css`, but the Theme panel only treats a theme physically present inside the opened book's `themes/` directory as a project theme.

Teams may either:

- reference the live shared package so multiple books receive shared changes; or
- import/copy the theme into a book when the book should own and diverge from it.

Print-MD does not need a shared-theme registry.

## Required generic Print-MD changes

### 1. Complete theme staging

Current conventional asset defaults omit `themes`, while theme application activates a stylesheet under `themes/<id>/`. Make final HTML/PDF staging reliable without changing the theme model.

Implement both protections:

- include `themes` in conventional asset defaults when `source.assets` is not explicitly overridden; and
- when theme application updates a manifest with explicit `source.assets`, ensure the local `themes` root is represented without replacing the author's other asset entries.

Preserve theme ownership and no-data-loss behavior.

### 2. Preserve theme cascade position

The current theme manager removes the active theme entry and appends the replacement. That can move the base theme after book-specific CSS.

When replacing a theme, retain the previous theme index. When adding the first theme, insert it before ordinary project styles. Continue preserving all non-theme style entries.

### 3. Put plugin default CSS before project CSS

Plugin-exported CSS is currently injected after linked user styles. Equal-specificity plugin rules can therefore defeat the project's intended final styling.

Emit plugin defaults before `manifest.styles`, or place them in a lower cascade layer. Project CSS must remain authoritative.

### 4. Repaginate after active CSS changes

The current CSS-only preview fast path re-fetches the stylesheet without rerunning Paged.js. This is unsafe for publication design because fonts, line height, spacing, custom properties, page geometry, columns, tables, images, and break rules can all alter pagination.

The normal preview should:

- rebuild and repaginate after any active stylesheet change;
- wait for fonts before accepting pagination;
- debounce multi-file writes into one rebuild;
- retain the hidden-frame/double-buffered swap; and
- restore location using existing source-line anchors.

No Open Design-specific preview mode is needed.

### 5. Resolve shared/local overlays consistently

A clean build stages assets in ordered, last-entry-wins order. Linting, the stylesheet editor, and incremental mirroring do not all resolve the source behind a flattened href with the same rules.

Add one generic resolver:

```text
resolveAssetSource(outputRelativePath, orderedSourceAssets)
    → highest-precedence existing source file
```

Use it for:

- active stylesheet linting;
- preview mirroring after shared or local edits;
- the viewer's active-stylesheet edit target; and
- validation that needs the source behind a staged href.

Re-staging an affected destination directory in manifest order is an acceptable simpler implementation. Build, preview, lint, and editing must use the same winning bytes.

### 6. Make watching dependency-aware

The watcher may monitor the book and declared external roots, but rebuild decisions should use the resolved configuration.

| Change | Action |
|---|---|
| Markdown listed in `source.files` | Rebuild and repaginate |
| Top-level Markdown under implicit discovery | Rebuild and repaginate |
| Active stylesheet | Rebuild and repaginate |
| Referenced theme/font/image/asset | Rebuild as required |
| Manifest | Reload configuration and rebuild |
| Configured authored local plugin | Reload plugin and rebuild |
| Managed npm package changed by `plugin add` | Reload as required |
| `design/` notes, references, or Open Design package source | Ignore unless explicitly referenced by the book |
| Output and tool caches | Ignore |

### 7. Reuse source metadata

Verify that Paged.js preserves or clones `data-source-line` and nearby `data-chapter-src` context sufficiently for browser inspection. Add only a small DOM helper if necessary to walk from a generated page fragment to the nearest semantic source-bearing element.

Do not create a source-map database, sidecar protocol, or Open Design-specific metadata.

### 8. Expose generic preview access

The CLI already prints the bound preview URL. The desktop viewer may add a generic **Copy preview URL** action. A small read-only status response may expose the current project and preview URL for general tooling.

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

### Phase 1 — current correctness gaps

1. Complete active-theme staging.
2. Preserve theme position when switching themes.
3. Move plugin default CSS before project styles.
4. Add regression coverage for all three manifest filenames.

### Phase 2 — preview and shared-overlay correctness

1. Repaginate after active CSS, font, theme, manifest, and relevant asset changes.
2. Add or centralize ordered shared/local source resolution.
3. Use the same resolution in preview, lint, validation, and the stylesheet editor.
4. Make rebuild decisions dependency-aware.
5. Preserve source-anchor restoration and double buffering.

### Phase 3 — interoperability documentation

1. Document the single-book and multi-book layouts.
2. Document the root control-Markdown hazard when `source.files` is implicit.
3. Document shared-first/local-second asset ordering.
4. Separate authored local plugins from Print-MD-managed npm packages.
5. Verify existing source metadata through real Paged.js output.
6. Add generic preview URL copying if useful.

## Acceptance criteria

- Existing `themes/<id>/theme.css` projects continue to work unchanged.
- Applied/imported themes remain project-local self-contained packages.
- All three current manifest names work.
- Root control Markdown is never created automatically in a book that uses implicit manuscript discovery.
- A starter project may continue using only `styles/book.css` and `assets/`.
- A repository may share themes, styles, fonts, images, assets, authored plugins, and profiles.
- A book may repeat those categories to extend or intentionally shadow shared resources.
- Shared assets stage first and book-local assets consistently win intentional collisions.
- Build, preview, lint, validation, and stylesheet editing resolve the same active CSS source.
- Print-MD-managed npm plugins remain book-local, verified, and reproducible.
- Arbitrary active CSS edits trigger accurate repagination.
- Existing source-line metadata remains the basis for visual inspection.
- Print-MD contains no Open Design-specific runtime behavior.

## Research basis

- [Current CLI and manifest behavior](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/README.md)
- [Manifest lookup and resolution](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/manifest.ts)
- [Theme manager](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/theme-manager.ts)
- [Asset copying and collision handling](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/assets.ts)
- [Plugin command and vendoring](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/commands/plugin.ts)
- [npm plugin vendoring decision](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/docs/adr/0007-npm-plugin-vendoring.md)
- [Preview file watching](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/preview/file-watcher.ts)
- [Enclosing repository detection](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/project-source.ts)
- [Companion design guides](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/docs/design-guides.md)

## Final principle

External design tools edit ordinary source files. Print-MD owns manuscript selection, plugin loading, asset resolution, pagination, preview, and publication output. Shared and book-local resources compose through the existing manifest and directory conventions—not through an integration-specific layer.

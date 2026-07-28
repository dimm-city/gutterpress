# Git Collaboration with Print-MD and Open Design

**Audience:** teams producing one or more Print-MD books with Open Design  
**Goal:** keep publication source, reusable assets, design decisions, and Open Design workflows synchronized through Git with little or no Print-MD change.  
**Verified against:** Print-MD `main` at [`719173c`](https://github.com/dimm-city/print-md/commit/719173c1ce68d7acd91494f477eb8e74533171a0) and Open Design `main` at [`fac1013`](https://github.com/nexu-io/open-design/commit/fac10139c0138a5700c128079e23c3e7a622516c), July 27, 2026.

## Recommended repository

Open or import the repository root in Open Design. Open the specific book directory in Print-MD.

```text
publication-project/
├── DESIGN.md                         # shared visual/publishing direction
├── design/
│   ├── notes/
│   │   ├── decisions.md
│   │   └── next-steps.md
│   ├── references/
│   └── open-design/
│       ├── skills/
│       └── plugins/
│           └── print-md-publishing/
├── shared/
│   ├── themes/
│   ├── styles/
│   ├── fonts/
│   ├── images/
│   ├── assets/
│   ├── plugins/                      # authored Print-MD plugins only
│   └── profiles/
├── books/
│   ├── core-book/
│   │   ├── manifest.yaml
│   │   ├── chapters/
│   │   ├── design/
│   │   │   └── DESIGN.md
│   │   ├── themes/
│   │   ├── styles/
│   │   ├── fonts/
│   │   ├── images/
│   │   ├── assets/
│   │   ├── plugins/
│   │   │   └── npm/                  # Print-MD-managed packages
│   │   ├── profiles/
│   │   └── design-guide/
│   └── supplement/
│       └── ...
├── .gitignore
└── .git/
```

Every directory is optional. A book repeats a shared category only when it needs local additions or intentional replacements.

## Use `design/`, not `.design/`

Open Design works directly in imported folders, but its imported-folder file API rejects hidden path segments and its project listings omit dot-directories. Store durable notes, references, skills, and plugin source in a visible `design/` directory.

Open Design stages active skill resources into `.od-skills/` during runs. That directory is generated staging, not source:

```gitignore
.od-skills/
**/dist/
design/tmp/
```

Do not ignore Print-MD's managed `plugins/npm/` tree when the team relies on reproducible offline builds.

## Keep control Markdown out of implicit manuscript discovery

If a book has no explicit `source.files`, Print-MD renders every top-level `.md` file in that book alphabetically.

Therefore:

- repository-level `DESIGN.md` is safe when books live below `books/`;
- book-specific guidance should live under `books/<book>/design/`; or
- the book should explicitly list manuscript files before placing `DESIGN.md` at its root.

## Keep the plugin systems separate

The repository can contain two unrelated plugin types.

### Print-MD plugins

- `shared/plugins/` and `books/<book>/plugins/` contain Markdown renderer plugins.
- Authored plugins are referenced directly from a book manifest.
- npm packages installed with `print-md plugin add` are managed beneath that book's `plugins/npm/` tree.

### Open Design plugins

- `design/open-design/plugins/` contains Open Design workflow packages.
- A package normally contains `SKILL.md`, `open-design.json`, and companion references or assets.
- Each contributor installs the tracked package into their own Open Design registry.

Never place either plugin type in `source.assets`.

## Compose shared and book-local publication assets

Print-MD flattens external parent paths to their basename and copies asset roots in listed order. Put shared roots first and local roots second:

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

After staging:

```text
../../shared/themes/publisher/theme.css → themes/publisher/theme.css
../../shared/styles/components.css      → styles/components.css
./styles/book.css                       → styles/book.css
```

A typical cascade is:

```yaml
styles:
  - themes/publisher/theme.css
  - styles/components.css
  - styles/book.css
```

Use one active theme. Extend it through ordinary styles, select a different local theme ID, or intentionally shadow a shared file at the same staged path. Later local assets win collisions.

Do not add the whole `../../shared` directory to `source.assets` when it contains notes, profiles, plugin source, or other non-publication material.

## Manage Print-MD plugins reproducibly

### Shared authored plugins

```yaml
plugins:
  - path: ../../shared/plugins/publisher-components.js
  - path: ./plugins/book-components.js
```

These are ordinary Git-tracked source files and can be shared across books.

### Registry-installed npm plugins

Install each package into the target book:

```bash
print-md plugin add markdown-it-highlightjs@4.3.0 ./books/core-book
```

For a named export:

```bash
print-md plugin add markdown-it-emoji@3.0.0 ./books/core-book --export full
```

Print-MD verifies the package graph and vendors exact runtime dependencies beneath `books/core-book/plugins/npm/`. Commit the manifest change and the managed tree. Do not replace this with a shared `node_modules`, a package-manager install, or a hand-copied vendor directory.

The public CLI currently exposes `plugin add`. Use the desktop plugin manager for broader inspection, toggling, importing, or removal.

## Share the Open Design plugin through Git

Keep the authoritative source under:

```text
design/open-design/plugins/print-md-publishing/
├── SKILL.md
├── open-design.json
├── README.md
├── LICENSE
└── references/
```

Each contributor validates and installs it:

```bash
od plugin validate ./design/open-design/plugins/print-md-publishing --no-daemon
od plugin install ./design/open-design/plugins/print-md-publishing
od plugin doctor print-md-publishing
```

Local installation copies the package into Open Design's daemon-managed registry. Editing or pulling the Git-tracked source does not mutate the installed copy. Reinstall after the package changes.

For a separately published plugin, contributors may install by registry name or `github:` source. The team repository remains authoritative only when it vendors the package source.

## What Print-MD Git captures

Print-MD detects when an opened book sits inside an enclosing repository. It records the book's `subPath`, but snapshots, history, restore, pull, and push operate on the whole repository root.

Commit everything required to reproduce the publication and continue design work:

- manifests and manuscript Markdown;
- shared and local themes, styles, fonts, images, and assets;
- authored Print-MD plugins and shared profiles;
- Print-MD-managed `plugins/npm/` dependency trees and receipts;
- repository and book design guidance;
- durable decisions and next steps;
- team-authored Open Design skills and plugins; and
- companion design guides.

Do not expect Git to capture Open Design conversation history, installed plugin copies, or application state. Move durable conclusions into tracked Markdown.

## Team workflow

1. Pull before editing.
2. Open/import the repository root in Open Design.
3. Open the target book in Print-MD.
4. Start the Print-MD preview and open its URL in an Open Design Browser tab.
5. Apply the Print-MD Publishing plugin and select the target book, edit scope, and shared/book ownership.
6. Integrate accepted changes into stable themes, styles, semantic Markdown, or authored plugins.
7. Record durable decisions in `DESIGN.md` or `design/notes/`.
8. Commit and sync the whole repository.
9. Reinstall the Open Design plugin when its tracked package version changes.

Avoid simultaneous edits to the same manifest or stylesheet. Use branches and pull requests for substantial shared-theme, shared-component, or plugin changes. Treat binary fonts and images as single-owner changes and prefer unique filenames.

## Print-MD changes required

No Open Design-specific Print-MD change is required for this Git model. Current Print-MD already supports:

- a book nested inside a larger Git repository;
- whole-repository version history and synchronization;
- external asset directories;
- ordered asset flattening with local-last precedence;
- local plugin paths outside the book folder; and
- book-vendored npm plugin dependency graphs.

The generic preview, theme-staging, plugin-CSS-order, and shared-overlay corrections in the technical plan make the editing loop more reliable, but Git collaboration uses the existing architecture.

## Research basis

- [Print-MD enclosing repository detection](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/project-source.ts)
- [Print-MD version-history provider](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/source-provider.ts)
- [Print-MD npm plugin vendoring](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/docs/adr/0007-npm-plugin-vendoring.md)
- [Print-MD asset resolution](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/assets.ts)
- [Open Design direct-folder import](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/import-export-routes.ts)
- [Open Design imported-folder file restrictions](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/projects.ts)
- [Open Design skill staging](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/docs/skills-protocol.md)
- [Open Design plugin installer](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/plugins/installer.ts)

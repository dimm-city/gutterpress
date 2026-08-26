# Git Collaboration with Gutterpress and Open Design

**Audience:** teams producing one or more Gutterpress books with Open Design  
**Goal:** keep publication source, reusable assets, design decisions, and Open Design workflows synchronized through Git with little or no Gutterpress change.  
**Verified against:** this Gutterpress branch on July 28, 2026, and Open Design
`main` at [`a7e2059`](https://github.com/nexu-io/open-design/commit/a7e205939d441d29d64e616d6f5ec89c53bb711a).

> **Revision note (2026-07-28).** The shared-asset section was rewritten: the
> `source.assets` staging pipeline it described was removed from Gutterpress,
> and shared design now composes by reference. The Git model itself is
> unchanged.

## Recommended repository

Open or import the repository root in Open Design. Open the specific book directory in Gutterpress.

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
│           └── gutterpress-publishing/
├── shared/
│   ├── themes/
│   ├── styles/
│   ├── fonts/                        # reached through shared CSS url()
│   ├── images/                       # reached through shared CSS url()
│   ├── plugins/                      # authored Gutterpress plugins only
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
│   │   ├── plugins/
│   │   │   └── npm/                  # Gutterpress-managed packages
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

Do not ignore Gutterpress's managed `plugins/npm/` tree when the team relies on reproducible offline builds.

## Keep control Markdown out of implicit manuscript discovery

If a book has no explicit `source.files`, Gutterpress renders every top-level `.md` file in that book alphabetically. Discovery is top-level only, so a `chapters/` directory always needs an explicit list.

Therefore:

- repository-level `DESIGN.md` is safe when books live below `books/`;
- book-specific guidance should live under `books/<book>/design/`; or
- the book should explicitly list manuscript files before placing `DESIGN.md` at its root.

## Keep the plugin systems separate

The repository can contain two unrelated plugin types.

### Gutterpress plugins

- `shared/plugins/` and `books/<book>/plugins/` contain Markdown renderer plugins.
- Authored plugins are referenced directly from a book manifest.
- npm packages installed with `gutterpress plugin add` are managed beneath that book's `plugins/npm/` tree.

### Open Design plugins

- `design/open-design/plugins/` contains Open Design workflow packages.
- A package normally contains `SKILL.md`, `open-design.json`, and companion references or assets.
- Each contributor installs the tracked package into their own Open Design registry.

The two never mix, and neither is a publication asset. A Gutterpress plugin is a
markdown-it module a book manifest names; an Open Design plugin is a workflow
package a contributor installs into their own Open Design registry.

## Compose shared and book-local design

Gutterpress copies no stylesheets. A `styles:` entry is a path it **reads**, and
its contents are inlined into `book.html` in listed order, so a book points
straight at the shared foundation:

```yaml
source:
  files:
    - chapters/01-introduction.md
    - chapters/02-rules.md
styles:
  - ../../shared/themes/publisher/theme.css
  - ../../shared/styles/components.css
  - styles/book.css
```

Each stylesheet's `url()` references resolve relative to **that stylesheet**, so
a shared theme's fonts and images travel with it automatically:

```text
shared/themes/publisher/theme.css → url("../../fonts/Publisher.woff2")
                                  → embedded as a data URI in the book
```

Fonts always embed. Images are copied beside `book.html` under a
content-addressed name. There is no asset list, no basename flattening, and no
collision rule to remember — to shadow a shared decision, list the book's own
stylesheet later and let the cascade settle it.

Use one active local theme. Its first application defaults to the front, while
replacement preserves the established cascade position. Keep intentional
extension styles later in the list, or copy a shared theme into the book
(`themes/<id>/`) when that book should own and diverge from it.

**One standing rule:** an image used in **Markdown prose** must live inside the
book folder — a `../` or absolute reference is a build error. Shared art
referenced from shared **CSS** is fine; shared art used in prose must be copied
into the book that uses it.

Manifests written for older releases may still carry `source.assets` or
`output`. Both were removed and now fail the build with a message naming the
field; delete them.

## Manage Gutterpress plugins reproducibly

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
gutterpress plugin add markdown-it-highlightjs@4.3.0 ./books/core-book
```

For a named export:

```bash
gutterpress plugin add markdown-it-emoji@3.0.0 ./books/core-book --export full
```

Gutterpress verifies the package graph and vendors exact runtime dependencies beneath `books/core-book/plugins/npm/`. Commit the manifest change and the managed tree. Do not replace this with a shared `node_modules`, a package-manager install, or a hand-copied vendor directory.

The public CLI currently exposes `plugin add`. Use the desktop plugin manager for broader inspection, toggling, importing, or removal.

## Share the Open Design plugin through Git

Keep the authoritative source under:

```text
design/open-design/plugins/gutterpress-publishing/
├── SKILL.md
├── open-design.json
├── README.md
├── LICENSE
└── references/
```

Each contributor validates and installs it:

```bash
od plugin validate ./design/open-design/plugins/gutterpress-publishing --no-daemon
od plugin install ./design/open-design/plugins/gutterpress-publishing
od plugin doctor gutterpress-publishing
```

Local installation copies the package into Open Design's daemon-managed registry. Editing or pulling the Git-tracked source does not mutate the installed copy. Reinstall after the package changes.

Version 0.2.0 is not yet in the marketplace. Keep the team-vendored package as
the source of truth and use trusted local installs. Open Design 0.16.1 cannot
persistently grant the explicit pipeline's derived `pipeline:*` capability to a
restricted direct-GitHub/URL install.

## What Gutterpress Git captures

Gutterpress detects when an opened book sits inside an enclosing repository. It records the book's `subPath`, but snapshots, history, restore, pull, and push operate on the whole repository root.

Commit everything required to reproduce the publication and continue design work:

- manifests and manuscript Markdown;
- shared and local themes, styles, fonts, and images;
- authored Gutterpress plugins and shared profiles;
- Gutterpress-managed `plugins/npm/` dependency trees and receipts;
- repository and book design guidance;
- durable decisions and next steps;
- team-authored Open Design skills and plugins; and
- companion design guides.

Do not expect Git to capture Open Design conversation history, installed plugin copies, or application state. Move durable conclusions into tracked Markdown.

## Team workflow

1. Pull before editing.
2. Open/import the repository root in Open Design.
3. Open the target book in Gutterpress.
4. Start the Gutterpress preview and open its URL in an Open Design Browser tab.
5. Apply the Gutterpress Publishing plugin and state the target book, goal, edit
   scope, and shared/book ownership in the message. Use `od plugin run` as
   documented in the user guide on Open Design 0.16.1.
6. Integrate accepted changes into stable themes, styles, semantic Markdown, or authored plugins.
7. Record durable decisions in `DESIGN.md` or `design/notes/`.
8. Commit and sync the whole repository.
9. Reinstall the Open Design plugin when its tracked package version changes.

Avoid simultaneous edits to the same manifest or stylesheet. Use branches and pull requests for substantial shared-theme, shared-component, or plugin changes. Treat binary fonts and images as single-owner changes and prefer unique filenames.

## Gutterpress changes required

No Open Design-specific Gutterpress change is required for this Git model. Current Gutterpress already supports:

- a book nested inside a larger Git repository;
- whole-repository version history and synchronization;
- stylesheets read from outside the book, with their fonts and images;
- ordered cascade composition with the book's own styles last;
- local plugin paths outside the book folder;
- watching declared shared stylesheets and plugins during preview; and
- book-vendored npm plugin dependency graphs.

The generic theme-cascade, plugin-CSS-order, repagination, and dependency-aware
watching corrections in the technical plan make the editing loop more reliable,
but Git collaboration uses the existing architecture.

## Research basis

- [Gutterpress enclosing repository detection](../../packages/cli/src/lib/project-source.ts)
- [Gutterpress version-history provider](../../packages/cli/src/lib/source-provider.ts)
- [Gutterpress CSS/font/image inlining](../../packages/cli/src/lib/asset-inline.ts)
- [Gutterpress preview file watching](../../packages/cli/src/preview/file-watcher.ts)
- [Open Design direct-folder import](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/daemon/src/import-export-routes.ts)
- [Open Design imported-folder file restrictions](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/daemon/src/projects.ts)
- [Open Design skill staging](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/docs/skills-protocol.md)
- [Open Design plugin installer](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/daemon/src/plugins/installer.ts)

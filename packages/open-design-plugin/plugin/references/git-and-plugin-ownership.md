# Git scope and plugin ownership

Who owns which file, what version control captures, and how this plugin's own
package is distributed. Verified against the Gutterpress source that ships this
package, 2026-07-28.

## Gutterpress's Git scope is the whole repository

When a book sits inside a larger repository, Gutterpress records the book's
subpath but every version operation — snapshot, history, restore, pull, push —
runs against the **enclosing repository root**. A snapshot taken while editing
`books/core-book` therefore includes the shared foundation and the sibling book.

That is what makes the multi-book layout work, and it is also why a
`changeScope: book-only` run must be disciplined: nothing in the tooling stops a
shared-file edit from being committed alongside the book's.

This plugin does not commit, branch, push, open pull requests, or resolve
conflicts. Leave the working tree in a reviewable state and let the user decide.

## Shared vs. book-local ownership

```text
shared/themes/publisher/theme.css        product-line decision
shared/styles/publisher-components.css   product-line decision
shared/fonts/  shared/images/            reached through shared CSS url()
shared/plugins/publisher-components.js   product-line rendering behavior
shared/profiles/                         product-line print configuration

books/core-book/themes/                  this book owns and may diverge
books/core-book/styles/book.css          this book, final say in the cascade
books/core-book/images/                  this book's prose art
books/core-book/plugins/                 this book's rendering behavior
books/core-book/plugins/npm/             machine-owned; never hand-edit
```

To change something for one book without touching the shared foundation, add
the rule to that book's own stylesheet — it is listed later in `styles:`, so the
cascade settles it.

## Use `design/`, never `.design/`

Open Design's imported-folder file API rejects hidden path segments and its
project listings omit dot-directories. Durable notes, references, team skills,
and vendored plugin source belong in a visible `design/` directory:

```text
design/
├── notes/
│   ├── decisions.md
│   └── next-steps.md
├── references/
└── open-design/
    ├── skills/
    └── plugins/
        └── gutterpress-publishing/
```

`.od-skills/` is where Open Design stages the active skill and its side files
for a run. It is generated state, never source, and belongs in `.gitignore`:

```gitignore
.od-skills/
**/dist/
design/tmp/
```

Do **not** ignore `plugins/npm/` — a team that expects the book to build offline
on another machine needs that vendored tree committed, receipts and all.

## Two unrelated plugin systems

- **Gutterpress plugins** are markdown-it modules a *book manifest* names, either
  by `path` (authored, Git-tracked source) or as a managed npm package vendored
  under that book's `plugins/npm/` by `gutterpress plugin add`.
- **Open Design plugins** are workflow packages a *contributor* installs into
  their own Open Design registry.

Neither is a publication asset. Do not confuse the directories, and never edit
anything under `plugins/npm/`.

## Local install is a copy — reinstall after every change

Installing a local package copies it into Open Design's own registry. Editing
the Git-tracked source, or pulling a teammate's change to it, does **not** update
the installed copy:

```bash
git pull
od plugin validate ./design/open-design/plugins/gutterpress-publishing --no-daemon
od plugin install  ./design/open-design/plugins/gutterpress-publishing
od plugin doctor   gutterpress-publishing
```

Reinstall after every package change during development, and after any pull that
touched the package. Bump the package version whenever the workflow contract,
inputs, capabilities, or ownership rules change, so a stale installed copy is
identifiable.

Version 0.2.0 is not published in the Open Design marketplace. Use a trusted
local install; do not assume `od plugin install gutterpress-publishing` resolves.
Open Design 0.16.1 also cannot persistently grant an explicit pipeline's derived
`pipeline:*` capability to a restricted direct-GitHub/URL install, so that is
not a supported team distribution path for this version.

## What Git will not capture

Commit everything needed to reproduce the publication and continue design work:
manifests and manuscript Markdown, shared and local themes/styles/fonts/images,
authored plugins and profiles, the managed `plugins/npm/` trees, design guidance
and decisions, team-authored Open Design packages, and companion design guides.

Git will not capture Open Design conversation history, installed plugin copies,
or application state. Anything worth keeping from a session must be written into
tracked Markdown — `DESIGN.md` or `design/notes/` — before the session ends.

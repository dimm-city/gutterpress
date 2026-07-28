# Print-MD Publishing — an Open Design plugin

Design and refine an **existing** Print-MD publication in place, without
converting it into a web application and without editing generated output.

Print-MD stays the renderer. Open Design edits the ordinary Markdown, CSS,
theme, manifest, and plugin files that Print-MD already understands, and the
running Print-MD preview is the authority for pagination.

## What it is

A static Open Design plugin — no JavaScript, no MCP server, no React surface,
no Print-MD API. The package is two contracts plus supporting reference
material:

```text
plugin/
├── SKILL.md            # the portable agent workflow contract
├── open-design.json    # Open Design metadata, inputs, pipeline, capabilities
├── README.md
├── LICENSE
├── CHANGELOG.md
└── references/
    ├── project-contract.md          # manifests, manuscript discovery, output
    ├── themes-styles-assets.md      # cascade, inlining, shared composition
    ├── semantic-layout.md           # markers, selectors that survive pagination
    ├── preview-and-source-maps.md   # the preview loop, data-source-line
    └── git-and-plugin-ownership.md  # repo scope, ownership, reinstall workflow
```

## Install

Published:

```bash
od plugin install print-md-publishing
```

From this repository (or a copy vendored into a publication repo under
`design/open-design/plugins/print-md-publishing/`):

```bash
od plugin validate ./packages/open-design-plugin/plugin --no-daemon
od plugin install  ./packages/open-design-plugin/plugin
od plugin doctor   print-md-publishing
```

A local install **copies** the package into Open Design's registry, so editing
this directory — or pulling a teammate's change to it — does not update the
installed copy. Reinstall after every package change.

## Inputs

| Input | Type | Default | Meaning |
|---|---|---|---|
| `bookPath` | string | `.` | The book, relative to the imported project root. `.` for a single book, `books/core-book` in a multi-book repo. |
| `goal` | text | — | The design change to make. |
| `editScope` | select | `theme` | `theme` · `layout` · `content` — how far the agent may reach. |
| `changeScope` | select | `book-only` | `book-only` · `shared-foundation` — who owns the change. |
| `previewUrl` | string | `http://localhost:3579/` | The running Print-MD preview. |

## Using it

1. Open (import) the **repository root** in Open Design; open the **target book**
   in Print-MD.
2. Start the preview — `print-md preview ./books/core-book` — and open its URL in
   an Open Design Browser tab.
3. Apply this plugin with the book path, goal, edit scope, and ownership.
4. Review the edits, confirm the preview finished repaginating, and commit.

The plugin never starts, stops, or supervises Print-MD, and never runs shell
commands, package managers, or Git.

## Capabilities

```text
prompt:inject
fs:read
fs:write
```

Nothing else — no shell, subprocess, network, MCP, connector, or custom
component access. Local installs are trusted by default; a remote or registry
install may stay restricted until the user grants file access.

## What it will never touch

```text
book.html            dist/**            other generated output
plugins/npm/**       .od-skills/**      .git/**
files outside the imported repository root
```

It also never introduces a tool-specific override stylesheet, token JSON, or
project-state file, and never re-adds the removed `source.assets` / `output`
manifest fields (both now fail a Print-MD build).

## Compatibility

- **Print-MD:** verified against `main` as of 2026-07-28 — reference-based
  shared composition, repagination on every stylesheet edit, and watching of
  declared shared dependencies.
- **Open Design:** built against the plugin contract described in
  [`docs/open-design/open-design-print-md-plugin-implementation-plan.md`](../../../docs/open-design/open-design-print-md-plugin-implementation-plan.md).
  A minimum tested Open Design release will be recorded here, and
  `od.engineRequirements.od` added, once that floor is deliberate and testable.

## Further reading

- [Using Open Design with Print-MD](../../../docs/open-design/using-open-design-with-print-md.md)
- [Git collaboration with Print-MD and Open Design](../../../docs/open-design/git-collaboration-print-md-open-design.md)
- [Print-MD compatibility with filesystem design tools](../../../docs/open-design/print-md-open-design-implementation-plan.md)

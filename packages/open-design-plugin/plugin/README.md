# Print-MD Publishing — an Open Design plugin

Design and refine an **existing** Print-MD publication in place, without
converting it into a web application and without editing generated output.

Print-MD stays the renderer. Open Design edits the ordinary Markdown, CSS,
theme, manifest, and plugin files that Print-MD already understands, and the
running Print-MD preview is the authority for pagination.

## What it is

A static Open Design plugin — no JavaScript, no MCP server, no React surface,
no Print-MD API. The package is two contracts plus optional supporting reference
material:

```text
plugin/
├── SKILL.md            # the portable agent workflow contract
├── open-design.json    # Open Design metadata, pipeline, and capabilities
├── README.md
├── LICENSE
├── CHANGELOG.md
├── evals/
│   └── evals.json                    # repeatable behavioral review cases
└── references/
    ├── project-contract.md          # manifests, manuscript discovery, output
    ├── themes-styles-assets.md      # cascade, inlining, shared composition
    ├── semantic-layout.md           # markers, selectors that survive pagination
    ├── preview-and-source-maps.md   # the preview loop, data-source-line
    └── git-and-plugin-ownership.md  # repo scope, ownership, reinstall workflow
```

## Install locally

The plugin is not yet listed in the Open Design marketplace. Install the
Git-tracked package as a trusted local plugin.

From a Print-MD checkout:

```bash
od plugin validate ./packages/open-design-plugin/plugin --no-daemon
od plugin install  ./packages/open-design-plugin/plugin
od plugin doctor   print-md-publishing
```

From a publication repository that vendors the package:

```bash
od plugin validate ./design/open-design/plugins/print-md-publishing --no-daemon
od plugin install  ./design/open-design/plugins/print-md-publishing
od plugin doctor   print-md-publishing
```

A local install **copies** the package into Open Design's registry. Editing the
tracked package or pulling a teammate's update does not change the installed
copy; reinstall after every package change.

On some Linux systems `/usr/bin/od` is the coreutils octal-dump command. If
`od plugin --help` does not show Open Design commands, use the absolute Open
Design CLI path shown by the desktop app's integration setup or add that path
ahead of `/usr/bin`.

`od plugin doctor` 0.16.1 may warn `Unknown skill ref: './SKILL.md'`. Its generic
registry-ref resolver produces that warning, while the separate local-skill
loader stages `SKILL.md`. The skill is self-contained and does not require a run
to locate its packaged reference files; the isolated run check for this release
verifies the active-skill path.

## Runtime brief

Open Design 0.16.1 does not render apply-time plugin input forms inside an
existing project's composer. This package therefore has no `od.inputs` block.
It resolves the working brief from the user's message, the imported repository,
and the active Browser tab:

| Value | Conservative behavior |
|---|---|
| Book path | Use the project root when it is a book, or the only obvious nested book; ask rather than guess between several books. |
| Goal | Use the concrete request; ask when no outcome was requested. |
| Edit scope | Default to `theme`; widen to `layout` or `content` only when the request requires it. |
| Change ownership | Default to `book-only`; use shared foundations only when explicitly requested. |
| Preview URL | Prefer the active loopback Print-MD Browser tab, then port 3579; verify `/api/status` before relying on it. |

When a safety-relevant value cannot be inferred, the agent emits one inline
`print-md-brief` question form containing only the unresolved fields and waits
for the answer before writing.

## Using it

1. Import the **repository root** into Open Design and open the **target book**
   in Print-MD.
2. Start `print-md preview ./books/core-book` and open its printed URL in an Open
   Design Browser tab.
3. Attach the plugin and describe the goal, book, and any non-default scope in
   the same message.
4. Review the source edits, wait for pagination, and run the normal Print-MD
   checks before committing.

Open Design 0.16.1 has a host-side limitation in its existing-project plugin
picker: it can show the plugin chip without persisting the applied snapshot onto
the subsequent run. Until that host issue is fixed, the reliable invocation is:

```bash
od project list
od plugin run print-md-publishing \
  --project <project-id> \
  --message "In books/core-book, tighten chapter opener spacing. Keep the change book-only and do not edit prose. The preview is http://localhost:3579/." \
  --follow
```

This CLI path does not attach an open Browser tab or collect an inline question
form interactively. Include the book path, goal, edit scope, ownership, and
preview URL in `--message` when they matter. If the agent still emits a
clarification form, that run stops without writing; answer from the project chat
or start a follow-up run with the resolved brief.

The package does not start or supervise Print-MD. Its workflow policy also
forbids Git, package-manager, and generated-output edits.

## Capabilities

```text
prompt:inject
fs:read
fs:write
```

Nothing else is declared: no shell, subprocess, network, MCP, connector, or
custom component access. The explicit workflow pipeline also has Open Design's
derived `pipeline:*` requirement.

This is the package's declared requirement set, not the effective trusted-local
grant set. Open Design 0.16.1 automatically grants trusted local plugins its
broader trusted defaults (`connector:*`, `mcp:*`, `genui:*`, and `pipeline:*` in
addition to the declared file/prompt capabilities). This package defines no
connector, MCP server, GenUI surface, shell action, or network action and does
not use those host-default grants.

Local installs are trusted by default and are the supported path for version
0.2.0. In Open Design 0.16.1, restricted direct-GitHub/URL installs cannot
persistently grant the derived `pipeline:*` capability, so they are not a stable
distribution path for this release. An official/trusted marketplace listing can
be added after publication review.

Capabilities gate plugin-owned facilities; they are not an operating-system
sandbox for the selected coding agent. The no-shell, no-Git, and path/ownership
rules in `SKILL.md` remain workflow policy and must still be reviewed.

## Protected paths

```text
book.html            dist/**            other generated output
plugins/npm/**       .od-skills/**      .git/**
files outside the imported repository root
```

The workflow forbids these paths. It also forbids tool-specific override CSS,
token JSON, project-state files, and the removed `source.assets` / `output`
manifest fields, both of which fail a current Print-MD build.

## Compatibility

- **Print-MD:** this release candidate requires the unreleased Print-MD source
  on this branch as of 2026-07-28. Published version 0.8.3 does not contain the
  required full-document preview reload and shared-dependency recovery fixes;
  record an exact release floor after those changes are tagged.
- **Open Design:** validated and packed with 0.16.1. The manifest declares
  `>=0.16.1`, but Open Design 0.16.1 parses rather than enforces that field, so
  verify the installed CLI version manually. Current upstream behavior was
  checked at
  [`a7e2059`](https://github.com/nexu-io/open-design/commit/a7e205939d441d29d64e616d6f5ec89c53bb711a).

## Included references

- [Project contract](./references/project-contract.md)
- [Themes, styles, and assets](./references/themes-styles-assets.md)
- [Semantic layout](./references/semantic-layout.md)
- [Preview and source metadata](./references/preview-and-source-maps.md)
- [Git scope and plugin ownership](./references/git-and-plugin-ownership.md)

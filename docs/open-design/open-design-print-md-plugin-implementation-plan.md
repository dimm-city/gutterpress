# Open Design Plugin for Print-MD

## Implementation and release plan

**Audience:** maintainers of the Print-MD Publishing Open Design plugin

**Status:** version 0.2.0 is implemented and locally testable; marketplace
publication is not complete.

**Verified against:** this Print-MD branch on July 28, 2026, Open Design 0.16.1
from local commit `4bf9b72`, and current Open Design `main` at
[`a7e2059`](https://github.com/nexu-io/open-design/commit/a7e205939d441d29d64e616d6f5ec89c53bb711a).

## 1. Decision

The integration is a normal static Open Design plugin. Print-MD contains no
Open Design runtime code.

```text
Print-MD Publishing plugin
    -> supplies a constrained agent workflow
    -> edits the imported repository directly
    -> treats Print-MD source as durable state
    -> verifies against the running paginated preview

Print-MD
    -> remains the renderer
    -> watches ordinary project dependencies
    -> owns pagination, validation, and output
```

The installable package consists of `SKILL.md`, `open-design.json`, reference
documents, behavioral evals, a README, changelog, and license. It has no
JavaScript runtime, custom UI, MCP server, or Print-MD API.

## 2. Goals

The plugin must:

1. Refine an existing Print-MD project in place.
2. Work for a single book or a book nested in a multi-book repository.
3. distinguish book-owned work from shared-foundation work.
4. Preserve manifest, manuscript, theme, cascade, asset, plugin, and Git
   conventions.
5. Keep Markdown semantic and generated HTML disposable.
6. Default to the narrowest safe edit and ownership scope.
7. Use a real completed Paged.js render for visual verification.
8. Remain portable as an Agent Skill while adding Open Design metadata.

The first release does not start Print-MD, execute Git, install packages, add a
remote write API, create tool-specific project state, or modify files beneath
`plugins/npm/`.

## 3. Current Open Design behavior

### Imported projects

An imported folder retains its real path as the project `baseDir`; Open Design
does not make a shadow copy. Project file operations are confined to that
imported root. Hidden path segments are unavailable through the project file
surface, so durable guidance belongs in `design/`, not `.design/`.

### Package shape

The package ships both portable and Open Design descriptors:

```text
SKILL.md
open-design.json
```

Open Design copies a local installation into its user registry. Reinstall after
the tracked package changes. The installer rejects symlinks and traversal and
limits a package to 50 MiB.

### Existing-project inputs

Open Design 0.16.1's existing-project composer does not render `od.inputs`.
`PluginsSection.applyById()` applies with an empty input map and only seeds
schema defaults into the brief. Required fields without defaults fail before a
run starts; defaults are frozen into the snapshot as authoritative values.

Version 0.2.0 therefore declares no apply-time inputs and has no unresolved
`{{placeholder}}` values. `SKILL.md` resolves five runtime values from the latest
message, submitted form answers, repository facts, and Browser context:

- target book;
- concrete goal;
- edit scope (`theme`, `layout`, or `content`);
- change ownership (`book-only` or `shared-foundation`); and
- preview URL.

Safe defaults are theme-only, book-only work. If a required value remains
ambiguous, the agent emits one inline
`<question-form id="print-md-brief">` containing only unresolved fields and
stops before writing. Inline question forms are the current host's supported
clarification path; answers return as the next user message.

### Pipeline

The manifest keeps a short explicit pipeline:

```text
inspect -> edit -> verify
```

It uses only `file-read`, `todo-write`, `file-edit`, and `file-write`. This is
intentional. Omitting the pipeline inherits Open Design's general
`tune-collab` scenario, including direction picking, `patch-edit`, repeated
critique theater, and handoff state that do not fit an in-place publication
edit.

Open Design's atom workers do not enforce the full workflow by themselves;
`SKILL.md` is the behavioral contract.

### Trust

The manifest declares only:

```text
prompt:inject
fs:read
fs:write
```

An explicit pipeline also derives `pipeline:*`. Trusted local installs receive
the required capabilities plus Open Design's broader trusted defaults
(`connector:*`, `mcp:*`, and `genui:*`). The package defines no facility that
uses those host-default grants. In Open Design 0.16.1, restricted
direct-GitHub/URL installs cannot persistently grant `pipeline:*`; a per-run
grant works, and an official/trusted marketplace install will work after
publication. Version 0.2.0 therefore supports trusted local installation and
does not advertise remote installation as stable.

Capabilities control plugin-owned facilities, not every operating-system tool
available to the selected coding agent. Path, shell, Git, ownership, and
generated-output restrictions remain explicit workflow policy.

### Browser context

Opening an external Print-MD preview tab automatically adds URL and title to the
run context. Open Design 0.16.1 does not expose arbitrary element annotation
controls for an external HTTP page or guarantee selector, opening HTML,
computed-style, or ancestor metadata. Browser Use automation is agent/backend
dependent.

The plugin therefore treats visual selection as best effort:

1. Use Browser automation only when the current run exposes it.
2. When DOM inspection is available, use `data-source-line`,
   `data-chapter-src`, stable IDs, and semantic classes as hints.
3. Confirm every hint against Markdown, the manifest, and active CSS.
4. Otherwise use the user's description or screenshot and ask one focused
   question when the target is still ambiguous.
5. Never persist preview DOM.

### Current host limitation

Open Design 0.16.1's existing-project plugin picker can display a plugin chip
without persisting a snapshot ID or sending a fallback `pluginId` on the next
run. A manifest cannot repair this transport bug. Until Open Design fixes it,
the reliable path is:

```bash
od plugin run print-md-publishing \
  --project <project-id> \
  --message "In books/core-book, refine chapter openers. Keep it theme-only and book-only. The preview is http://localhost:3579/." \
  --follow
```

## 4. Print-MD contract

The skill and references pin these current rules:

- Manifest lookup order is `manifest.yaml`, `manifest.yml`, then
  `print-md.yaml`.
- Non-empty `source.files` is authoritative. Otherwise only top-level `.md`
  files render, alphabetically.
- Root `DESIGN.md`, `README.md`, or `NOTES.md` is manuscript under implicit
  discovery; nested `design/` guidance is not.
- `styles:` entries are source paths to read in listed cascade order. They may
  point outside the book.
- A first local theme application defaults to the front of `styles`; replacing
  an active local theme preserves its existing index. Do not reorder a valid
  cascade merely to force the theme first.
- CSS `url()` resolves from the stylesheet containing it. Fonts embed; images
  embed or copy by size.
- Markdown images must resolve inside the book.
- `source.assets` and `output` were removed and now fail validation/build.
- Authored plugins are editable source only within the resolved scope. Managed
  npm plugin trees beneath `plugins/npm/` are never hand-edited.
- `book.html`, `dist/**`, preview temp files, `.od-skills/**`, and `.git/**` are
  never edited.

The preview rebuilds and full-reloads the complete document after every watched
source change. External stylesheet dependency closure and authored plugin entry
paths are watched. Manifest watch targets are synchronized before rendering, so
creation of a newly declared missing shared file can recover a failed preview.

The recursive in-book watcher remains conservative: unrelated non-dot files can
trigger a rebuild. Documentation must not claim `design/` or `dist/` is ignored.

## 5. Source layout

```text
packages/open-design-plugin/
├── package.json
├── plugin.test.ts
├── plugin/
│   ├── SKILL.md
│   ├── open-design.json
│   ├── README.md
│   ├── CHANGELOG.md
│   ├── LICENSE
│   ├── evals/evals.json
│   └── references/
│       ├── project-contract.md
│       ├── themes-styles-assets.md
│       ├── semantic-layout.md
│       ├── preview-and-source-maps.md
│       └── git-and-plugin-ownership.md
├── test-fixtures/
│   ├── simple-explicit/
│   ├── simple-implicit/
│   ├── themed-book/
│   └── multi-book-repo/
└── docs/release-checklist.md
```

`plugin/` is the only installable/packable directory. Fixtures, tests, and
release records stay outside it.

The canonical contracts are the files themselves:

- [`open-design.json`](../../packages/open-design-plugin/plugin/open-design.json)
- [`SKILL.md`](../../packages/open-design-plugin/plugin/SKILL.md)

Do not duplicate their full contents into this document; contract tests keep
the package metadata, references, evals, and fixture behavior aligned.

## 6. Test coverage

### Static package tests

`plugin.test.ts` verifies:

- plugin ID, spec and package versions;
- `refine` classification and Open Design engine floor;
- absence of unusable apply-time inputs and unresolved query placeholders;
- exact capabilities, pipeline stages, and atoms;
- local skill/reference reachability;
- no symlinks and package size below 50 MiB; and
- behavioral eval shape.

### Compatibility fixtures

- `simple-explicit`: explicit source list plus safe root `DESIGN.md`.
- `simple-implicit`: root `README.md` intentionally renders while nested
  `design/DESIGN.md` does not.
- `themed-book`: theme then book-local cascade.
- `multi-book-repo`: nested book, sibling isolation, shared theme/import/font,
  shared components, local override, and shared authored plugin entry.

The tests render the fixtures through Print-MD's actual manifest, manuscript,
CSS inlining, and external-watch resolvers.

### Behavioral evals

`plugin/evals/evals.json` covers:

- a focused single-book theme change;
- an ambiguous multi-book request that must ask before writing;
- a book-only override over a shared foundation; and
- implicit manuscript safety for durable design notes.

These evals are review contracts. A deterministic Open Design agent-eval runner
is not currently shipped in this repository.

### Open Design validation

Use the current Open Design CLI:

```bash
od plugin validate ./plugin --no-daemon --json
od plugin pack ./plugin --out /tmp/print-md-publishing-0.2.0.tgz --json
od plugin install ./plugin
od plugin info print-md-publishing --json
od plugin doctor print-md-publishing --json
```

On systems where `od` resolves to coreutils, invoke Open Design's CLI by its
absolute path. The local development checkout exposes
`node apps/daemon/bin/od.mjs`.

## 7. Release status

Version 0.2.0 is a trusted-local release candidate. It must not be described as
published until all of the following are true:

1. The canonical public source URL exists at a tagged revision.
2. Validation, pack, isolated install, info, apply, and doctor checks pass.
3. A real imported-project run completes against at least the explicit,
   implicit, themed, and multi-book fixtures.
4. Open Design's existing-project snapshot transport is fixed or the supported
   CLI-only limitation is accepted for that release.
5. Restricted pipeline capability handling is fixed, or the package is listed
   through an official/trusted marketplace.
6. Marketplace review merges and bare-name installation is verified.

Until then, do not document:

```bash
od plugin install print-md-publishing
```

The detailed gate is
[`packages/open-design-plugin/docs/release-checklist.md`](../../packages/open-design-plugin/docs/release-checklist.md).

## 8. Acceptance criteria

The plugin implementation is complete when:

- current Open Design validates and packs it;
- its package contract and all Print-MD fixtures pass in CI;
- attaching it never fails for missing apply-time inputs;
- the injected skill can execute safely without resolving companion-file paths;
- a clear request proceeds without redundant questions;
- an ambiguous target produces one structured form and no writes;
- edits stay within the resolved book, edit scope, and ownership;
- generated output and managed npm plugin files remain unchanged;
- every watched source change is judged only after complete pagination;
- Browser/source mapping claims remain conditional on context actually supplied
  to the run; and
- Print-MD has no Open Design-specific runtime behavior.

Marketplace publication is a separate release milestone and is not implied by
implementation completion.

## 9. Research basis

### Open Design

- [Compact plugin specification](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/plugins/spec/SPEC.md)
- [Manifest schema](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/packages/contracts/src/plugins/manifest.ts)
- [Apply implementation](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/daemon/src/plugins/apply.ts)
- [Snapshot resolver](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/daemon/src/plugins/resolve-snapshot.ts)
- [Trust model](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/daemon/src/plugins/trust.ts)
- [Existing-project plugin UI](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/apps/web/src/components/PluginsSection.tsx)
- [Question-form skill](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/plugins/_official/atoms/discovery-question-form/SKILL.md)
- [Registry publishing](https://github.com/nexu-io/open-design/blob/a7e205939d441d29d64e616d6f5ec89c53bb711a/plugins/spec/PUBLISHING-REGISTRIES.md)

The canonical `$schema` URL currently returns 404 even though official templates
use it. Keep the canonical URI in `open-design.json`; validate against the
runtime schema until the hosted URL is repaired.

### Print-MD

- [Manifest resolver](../../packages/cli/src/lib/manifest.ts)
- [Manuscript resolver](../../packages/cli/src/lib/markdown/index.ts)
- [Book assembler](../../packages/cli/src/lib/markdown/assemble.ts)
- [Theme manager](../../packages/cli/src/lib/theme-manager.ts)
- [CSS dependency collector](../../packages/cli/src/lib/asset-inline.ts)
- [Preview watcher](../../packages/cli/src/preview/file-watcher.ts)
- [Preview shell](../../packages/cli/src/assets/preview/scripts/preview-shell.js)

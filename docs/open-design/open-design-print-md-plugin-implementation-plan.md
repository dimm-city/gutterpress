# Open Design Plugin for Print-MD

## Complete implementation plan

**Audience:** developers building and maintaining the Open Design workflow plugin  
**Purpose:** provide the files, contracts, workflow rules, test fixtures, and release steps needed to build an Open Design plugin that safely edits existing Print-MD publications.  
**Verified against:** Print-MD `main` at [`719173c`](https://github.com/dimm-city/print-md/commit/719173c1ce68d7acd91494f477eb8e74533171a0) and Open Design `main` at [`fac1013`](https://github.com/nexu-io/open-design/commit/fac10139c0138a5700c128079e23c3e7a622516c), July 27, 2026.

## 1. Architectural decision

Build a normal Open Design agent-workflow plugin. Do not add integration code to Print-MD.

```text
Print-MD Publishing plugin
    ├── supplies inputs and workflow instructions to Open Design
    ├── uses Open Design's existing project file tools
    ├── edits the imported Git repository directly
    ├── treats the running Print-MD preview as authoritative
    └── stores no Open Design-specific state in the book

Print-MD
    ├── remains unaware of Open Design
    ├── renders ordinary Markdown, CSS, themes, assets, and plugins
    └── owns pagination, preview, validation, and final output
```

An Open Design v1 plugin is not a long-running UI extension. It is a static package. `SKILL.md` is the portable agent contract; `open-design.json` adds Open Design metadata, inputs, capabilities, context, and pipeline stages. Open Design applies that package to an agent run, and the agent performs the file edits.

The minimum viable plugin therefore needs no custom JavaScript, React surface, MCP server, or Print-MD API.

## 2. Goals

The plugin must:

1. Work on a local folder imported into Open Design without copying or converting the publication.
2. Detect all current Print-MD manifest names.
3. Support a book opened directly or a book nested inside a multi-book repository.
4. Distinguish shared changes from book-local changes.
5. Preserve Print-MD's existing `themes/`, `styles/`, asset, plugin, and manifest behavior.
6. Keep Markdown semantic and avoid generated HTML as source.
7. Use the running Print-MD preview for visual verification.
8. Reuse Print-MD's existing source-line and chapter metadata.
9. Respect theme, layout, and content edit scopes.
10. Avoid Print-MD-managed npm plugin files.
11. Support team distribution through Git, GitHub, and the Open Design registry.
12. Require no Open Design-specific change to Print-MD.

## 3. Non-goals for the first release

Do not:

- start, stop, or supervise the Print-MD preview process;
- add a Print-MD MCP server;
- add custom React or GenUI components;
- save serialized HTTP-preview DOM back into the repository;
- create token JSON, tool-specific CSS, or project state files;
- install or update Print-MD;
- modify Print-MD-managed files beneath `plugins/npm/`;
- commit, branch, push, open pull requests, or resolve Git conflicts;
- request shell, subprocess, network, MCP, or connector capabilities; or
- introduce another source-map format.

These boundaries keep the plugin portable, reviewable, and within Open Design's stable static-plugin contract.

## 4. Current platform behavior to design around

### 4.1 Open Design project folders

When an existing local folder is imported, Open Design stores the real folder as `metadata.baseDir` and reads and writes it directly. It does not create a shadow copy of the project.

For imported folders:

- hidden path segments are rejected by the project file API;
- dot-directories are omitted from project listings;
- paths are confined to the imported root; and
- the user remains responsible for Git/version control.

Use a visible repository directory such as `design/`, not `.design/`, for durable notes and plugin source.

### 4.2 Open Design plugin packaging

A plugin package is accepted when it contains a supported descriptor. This implementation deliberately ships both canonical files:

```text
SKILL.md
open-design.json
```

`SKILL.md` remains usable by other Agent Skills consumers. `open-design.json` is additive and Open Design-specific.

The current installer supports:

```text
./local/folder
/absolute/local/folder
github:owner/repo[@ref][/subpath]
https://...tar.gz
https://...tgz
```

The installer:

- copies local packages into Open Design's user plugin registry;
- rejects symlinks and path traversal;
- limits the copied tree to 50 MiB by default; and
- replaces an existing installation of the same plugin ID by default.

Because local installation is a copy, editing the Git-tracked package does not update the installed copy. Reinstall during development and after pulling a changed team package.

### 4.3 Open Design trust and capabilities

Local plugin installs default to trusted. Non-local sources may begin restricted. Restricted plugins receive only prompt injection until the user grants additional capabilities.

This plugin requires:

```text
prompt:inject
fs:read
fs:write
```

Declaring a pipeline also causes Open Design to account for pipeline capability internally. Do not request broader capabilities in the first release.

### 4.4 Skills and staged references

The plugin must declare its local `SKILL.md` through both:

```text
compat.agentSkills
od.context.skills
```

The first preserves Agent Skills compatibility. The second activates Open Design's current local-skill loader.

Open Design stages the active skill directory and its side files under `.od-skills/` for the run. The skill should read its bundled `references/` from the staged skill location advertised by Open Design. `.od-skills/` is generated state and must never become the source of truth.

### 4.5 Inputs and query templates

Open Design currently supports input fields of type:

```text
string
text
select
number
boolean
file
```

`od.useCase.query` may contain `{{inputName}}` placeholders. Open Design hydrates those from input defaults and user values in its plugin workflow.

### 4.6 Pipelines and atoms

A pipeline consists of ordered stages with atom IDs. This plugin uses existing first-party atoms only:

```text
file-read
todo-write
file-edit
file-write
```

A short explicit pipeline is preferable to inheriting Open Design's broader default `tune-collab` flow. The plugin needs inspection, constrained source editing, and verification—not a generic design-generation or critique theater.

### 4.7 Browser behavior

Open Design's Browser can open a Print-MD preview URL, inspect rendered elements, collect selector/text/HTML/computed-style context, and attach comments to the agent run.

Direct DOM tuning is durable only for eligible local project HTML. A Print-MD preview is an HTTP page generated from Markdown and CSS, so DOM edits are temporary. The plugin must always persist changes in Print-MD source files.

### 4.8 Current Print-MD behavior

The plugin must understand these current contracts:

- manifests: `manifest.yaml`, `manifest.yml`, `print-md.yaml`;
- explicit `source.files`, otherwise alphabetically sorted top-level `.md` files;
- one active `themes/<id>/theme.css` entry;
- ordered `manifest.styles`;
- external `source.assets` flattened to their basename, with later collisions winning;
- authored local plugins resolved relative to the manifest;
- npm plugins managed beneath the book's `plugins/npm/` tree by `print-md plugin add`;
- source metadata emitted as `data-source-line` and `data-chapter-src`; and
- current CSS hot-swap does not rerun Paged.js, so a full Browser reload is required after pagination-affecting CSS until the generic Print-MD fix ships.

## 5. Plugin repository and package layout

Maintain the canonical plugin separately from Print-MD application packages.

```text
packages/open-design-plugin/
├── plugin/
│   ├── SKILL.md
│   ├── open-design.json
│   ├── README.md
│   ├── LICENSE
│   ├── CHANGELOG.md
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
└── docs/
    └── release-checklist.md
```

During development:

```bash
od plugin install ./plugin
```

A publication team may vendor only the installable package at:

```text
design/open-design/plugins/print-md-publishing/
```

Do not put test fixtures, PDFs, large fonts, or publication images inside the installable package. Keep it well below the 50 MiB installer cap.

## 6. Exact `open-design.json`

Use this initial manifest:

```json
{
  "$schema": "https://open-design.ai/schemas/plugin.v1.json",
  "specVersion": "1.0.0",
  "name": "print-md-publishing",
  "title": "Print-MD Publishing",
  "version": "0.1.0",
  "description": "Design and refine an existing Print-MD publication in place while preserving its paged-media, theme, asset, plugin, and Git conventions.",
  "license": "MIT",
  "author": {
    "name": "Dimm City"
  },
  "tags": [
    "publishing",
    "print",
    "markdown",
    "paged-media",
    "tune-collab"
  ],
  "compat": {
    "agentSkills": [
      {
        "path": "./SKILL.md"
      }
    ]
  },
  "od": {
    "kind": "skill",
    "taskKind": "tune-collab",
    "scenario": "publishing",
    "useCase": {
      "query": "Refine the Print-MD publication at {{bookPath}}. Goal: {{goal}}. Edit scope: {{editScope}}. Change ownership: {{changeScope}}. Treat {{previewUrl}} as the authoritative paginated preview."
    },
    "context": {
      "skills": [
        {
          "path": "./SKILL.md"
        }
      ],
      "atoms": [
        "file-read",
        "todo-write",
        "file-edit",
        "file-write"
      ]
    },
    "pipeline": {
      "stages": [
        {
          "id": "inspect",
          "atoms": [
            "file-read",
            "todo-write"
          ]
        },
        {
          "id": "edit",
          "atoms": [
            "file-edit",
            "file-write"
          ]
        },
        {
          "id": "verify",
          "atoms": [
            "file-read"
          ]
        }
      ]
    },
    "inputs": [
      {
        "name": "bookPath",
        "label": "Book path",
        "type": "string",
        "required": true,
        "default": ".",
        "placeholder": "books/core-book"
      },
      {
        "name": "goal",
        "label": "What should change?",
        "type": "text",
        "required": true,
        "placeholder": "Refine chapter openers and reduce their page-space cost."
      },
      {
        "name": "editScope",
        "label": "Edit scope",
        "type": "select",
        "required": true,
        "default": "theme",
        "options": [
          "theme",
          "layout",
          "content"
        ]
      },
      {
        "name": "changeScope",
        "label": "Change ownership",
        "type": "select",
        "required": true,
        "default": "book-only",
        "options": [
          "book-only",
          "shared-foundation"
        ]
      },
      {
        "name": "previewUrl",
        "label": "Print-MD preview URL",
        "type": "string",
        "required": false,
        "default": "http://localhost:3579/",
        "placeholder": "http://localhost:3579/"
      }
    ],
    "capabilities": [
      "prompt:inject",
      "fs:read",
      "fs:write"
    ]
  }
}
```

### Manifest rationale

- `od.kind: skill` identifies a reusable workflow rather than a built-in Open Design core scenario.
- `taskKind: tune-collab` matches editing an existing publication.
- No `mode` is declared, avoiding prototype, deck, or generated-document assumptions.
- The plugin declares a short pipeline instead of inheriting a heavier default collaboration pipeline.
- The pipeline uses only implemented first-party file/planning atoms.
- No MCP, connector, network, shell, custom component, or media capability is requested.
- `compat.agentSkills` and `od.context.skills` intentionally point to the same file, matching Open Design's current template pattern.

## 7. Exact `SKILL.md`

Use the following as the initial workflow contract:

```markdown
---
name: print-md-publishing
description: Design and refine an existing Print-MD paged publication without converting it into a web application or editing generated output.
triggers:
  - print-md
  - paged publication
  - book theme
  - print layout
  - markdown to PDF
---

# Print-MD Publishing

You are editing an existing Print-MD publication in place. Print-MD remains the
renderer. The running Print-MD preview is the visual and pagination authority.

Use the plugin inputs as authoritative. Do not ask the user to repeat them.
Read the companion files in the staged skill's `references/` directory before
changing the project.

## Non-negotiable rules

- Do not create a new web application, `index.html`, React project, or replacement renderer.
- Do not edit generated `book.html`, `dist/`, preview temp files, or `.od-skills/`.
- Do not create Open Design-specific CSS, token JSON, manifest fields, or state files.
- Do not edit Print-MD-managed files beneath `plugins/npm/`.
- Preserve semantic Markdown and existing Print-MD layout markers.
- Prefer the smallest stable change in an existing theme, stylesheet, component, manifest, or authored local plugin.
- Use one active `themes/<id>/theme.css`; extend it through later ordinary styles.
- Treat direct DOM tuning on the HTTP preview as temporary context, never as the durable edit.
- Reject a `bookPath` that is absolute or escapes the imported project root.

## Workflow

### 1. Resolve the target book

1. Resolve `bookPath` beneath the imported Open Design project root.
2. Find the first existing manifest in this order: `manifest.yaml`, `manifest.yml`, `print-md.yaml`.
3. Stop without writing when no manifest exists at the exact target path.
4. Read the manifest before scanning or editing project files.
5. If `source.files` is absent or empty, remember that every top-level `.md` file in the book is manuscript content.

### 2. Inspect the publication contract

Read and summarize:

- explicit or implicit manuscript files;
- `styles` and the active `themes/<id>/theme.css` entry;
- ordered `source.assets` roots;
- page, preset, PDF/X, and validation constraints relevant to the request;
- authored local plugins and Print-MD-managed npm plugins;
- repository-level and book-level design guidance; and
- shared versus local sources that feed each staged publication path.

For a staged asset path, inspect matching source roots in manifest order and
select the last existing source. Do not assume `styles/foo.css` physically lives
inside the book when it may be supplied by `../../shared/styles/foo.css`.

### 3. Enforce ownership and edit scope

Follow `changeScope`:

- `shared-foundation`: edit a shared source only when the treatment is intended for multiple books.
- `book-only`: edit only files owned by the target book. Do not modify shared foundations.

Follow `editScope`:

- `theme`: CSS, theme-owned fonts/images, and design guidance only.
- `layout`: theme scope plus semantic layout markers, manifest style/asset configuration, and authored local plugin source when necessary.
- `content`: layout scope plus manuscript prose and structure.

Never broaden either scope silently.

### 4. Implement the smallest stable change

Use this preference order:

1. Existing CSS custom property in the owning stylesheet.
2. Existing reusable component rule.
3. New reusable semantic component rule in an existing stable stylesheet.
4. Stable book-specific rule in the existing local stylesheet.
5. Semantic Markdown marker/class change when layout scope permits it.
6. Authored Print-MD plugin change only when the behavior cannot be expressed in CSS or semantic Markdown.

Do not add a tool-specific override stylesheet. Integrate the accepted result
into the file that should own it permanently.

### 5. Verify

- Re-read every changed source file.
- Confirm no generated output or managed npm plugin file changed.
- Inspect the Print-MD preview at `previewUrl` when one was provided.
- Use existing `data-source-line`, `data-chapter-src`, IDs, classes, and semantic structure to relate preview elements to source.
- After typography, page geometry, columns, spacing, font, image-size, or break-rule changes, ensure a complete Paged.js pagination occurred. On Print-MD versions that only hot-swap CSS, reload the Browser preview.
- Report the files changed, their shared or book-local ownership, and any remaining preview limitation.
```

## 8. Companion reference files

Keep these files concise. They are durable domain guidance, not copies of the Print-MD source tree.

### `references/project-contract.md`

Include:

- recognized manifest names and path base;
- explicit versus implicit `source.files` behavior;
- the risk of root control Markdown under implicit discovery;
- fixed generated `book.html` ownership;
- stylesheet fallback order when `styles` is omitted;
- CSS `@page` as actual page geometry versus manifest page values as validation expectations;
- output directories that must never be edited; and
- the rule that the exact target `bookPath` is authoritative.

### `references/themes-styles-assets.md`

Include:

- `themes/<id>/theme.css` and optional `theme.json`;
- one-active-theme behavior;
- `styles/book.css` and the absence of required special CSS filenames;
- ordered manifest stylesheet cascade;
- shared-first/local-second asset flattening;
- later-entry collision precedence;
- CSS URL resolution from staged output paths;
- direct plugin/profile paths; and
- authored local plugins versus managed `plugins/npm/` packages.

### `references/semantic-layout.md`

Include the stable Print-MD authoring surface:

- `@chapter`, `@page`, `@section`, `@continue`, `@spread`, page breaks, and column breaks;
- semantic section components;
- chapter/page/section selector ownership;
- CSS custom properties for reusable variants;
- Contextual Cascade guidance;
- raw presentational HTML as a last resort rather than the default; and
- prohibition on selectors tied to generated `.pagedjs_*` structure or page ordinal.

### `references/preview-and-source-maps.md`

Include:

- default preview port and user-supplied ports;
- Print-MD preview as pagination authority;
- `data-source-line` and `data-chapter-src` reuse;
- nearest source-bearing ancestor inspection;
- why an HTTP-preview DOM edit is transient;
- current CSS hot-swap repagination limitation; and
- full reload behavior until the generic Print-MD fix ships.

### `references/git-and-plugin-ownership.md`

Include:

- whole-repository Git scope for nested books;
- shared versus book-local ownership;
- visible `design/` storage;
- `.od-skills/` as ignored staging;
- local Open Design install-copy behavior;
- reinstall-after-pull workflow;
- committing Print-MD-managed npm plugin closures; and
- no expectation that Git captures Open Design conversation history.

## 9. Project discovery algorithm

The first release implements discovery through agent instructions rather than executable plugin code.

```text
repoRoot = Open Design imported-folder root
bookRoot = normalize(repoRoot + input.bookPath)

reject when:
  bookRoot is outside repoRoot
  input.bookPath is absolute

manifest = first existing of:
  bookRoot/manifest.yaml
  bookRoot/manifest.yml
  bookRoot/print-md.yaml

if manifest missing:
  fail without writing

parse manifest

manuscriptFiles =
  source.files when non-empty
  otherwise top-level *.md under bookRoot sorted alphabetically

activeStyles =
  manifest.styles when non-empty
  otherwise Print-MD fallback discovery

for each staged style or asset path:
  candidate sources are matching ordered source.assets roots
  plus the direct bookRoot-relative path when applicable
  winning source is the last existing candidate in staging order
```

Do not recursively search the repository and guess among multiple books when `bookPath` is supplied. Inputs are authoritative. A later UI enhancement may list candidate books before application, but it is not required for the plugin.

## 10. File ownership rules

### Theme scope may write

```text
bookRoot/themes/**
bookRoot/styles/**
bookRoot/fonts/**
bookRoot/images/**
bookRoot/assets/**
bookRoot/design/**
shared equivalents when changeScope = shared-foundation
```

It may update a manifest only when necessary to reference an existing/new stylesheet, theme asset, font, or image and the change remains design-only.

### Layout scope additionally may write

```text
manuscript Markdown layout markers/classes
manifest styles/source.assets/page-related configuration
authored local Print-MD plugin source
```

### Content scope additionally may write

```text
manuscript prose and document structure
```

### Never write

```text
book.html
dist/**
other generated output
.od-skills/**
plugins/npm/**
.git/**
Open Design application data
files outside the imported repository root
```

## 11. Visual selection workflow

1. The user opens `previewUrl` in an Open Design Browser tab.
2. The user selects or comments on the rendered element.
3. Open Design supplies selector, text, opening HTML, computed style, and comment context.
4. The agent inspects the selected node and nearest source-bearing ancestors.
5. It uses `data-source-line`, `data-chapter-src`, semantic IDs/classes, the manifest, and active CSS to identify likely ownership.
6. It edits Print-MD source files, never the serialized preview DOM.
7. It waits for or forces a complete Print-MD pagination before judging layout.

Do not create a plugin-specific source database. A useful future Open Design contribution would add nearest existing `data-source-line` and `data-chapter-src` values directly to Browser selection attachments. That enhancement requires no Print-MD protocol change.

## 12. Security and trust

The declared capabilities are intentionally narrow:

```text
prompt:inject
fs:read
fs:write
pipeline:*   # derived because a pipeline is declared
```

Local installations default to trusted and receive the plugin's required capabilities. Remote or registry installations may remain restricted until the user grants file access.

Do not request:

```text
bash
subprocess
network
mcp:*
connector:*
genui:custom-component
```

The plugin should not silently execute Print-MD, project scripts, Git commands, package managers, or network requests.

## 13. Development workflow

### Scaffold

```bash
od plugin scaffold \
  --id print-md-publishing \
  --title "Print-MD Publishing" \
  --out ./plugin-work
```

Move or adapt the generated package into `plugin/` and replace the starter files with the contracts above.

### Validate without the daemon

```bash
od plugin validate ./plugin --no-daemon
```

This checks package shape, descriptors, paths, and schema without depending on a running Open Design daemon.

### Validate with the daemon

```bash
od plugin validate ./plugin
```

Use this during integration testing so current registry-bound atom and reference checks also run.

### Install and inspect

```bash
od plugin install ./plugin
od plugin info print-md-publishing --json
od plugin doctor print-md-publishing
```

Reinstall after every package change because local install copies the package.

### Pack

```bash
od plugin pack ./plugin
```

The resulting archive must contain the package-root files directly, contain no symlinks, and remain below the installer size limit.

## 14. Test fixtures

### `simple-explicit/`

A small book with explicit `source.files`, root-level `DESIGN.md`, `styles/book.css`, and no theme. Verify the plugin does not invent additional CSS layers.

### `simple-implicit/`

A book with implicit manuscript discovery and `design/DESIGN.md`. Add a fixture-only root `README.md` to prove the plugin detects the top-level Markdown risk rather than creating another root control file.

### `themed-book/`

A project-local theme package plus later `styles/book.css`. Verify one active theme remains and local stable styles retain final authority.

### `multi-book-repo/`

A repository with:

```text
shared/themes
shared/styles
shared/fonts
shared/images
shared/plugins
books/core-book
books/supplement
```

Verify `bookPath`, shared/book ownership, asset flattening, and sibling-book isolation.

## 15. Test matrix

### Static package tests

- `open-design.json` parses as JSON and against the current plugin schema.
- Plugin ID and version are valid.
- Every declared input type is supported.
- Every declared atom exists.
- `SKILL.md` is reachable through `od.context.skills`.
- All reference files are included.
- No unsupported capability is declared.
- Pack/unpack and local install succeed.
- Package contains no symlink and is below 50 MiB.

### Print-MD compatibility tests

1. `manifest.yaml`
2. `manifest.yml`
3. `print-md.yaml`
4. explicit manuscript source list
5. implicit top-level manuscript discovery
6. styles-only book
7. project-local theme
8. shared theme and local style extension
9. local asset shadowing shared staged path
10. authored shared Print-MD plugin
11. authored local Print-MD plugin
12. managed npm Print-MD plugin tree
13. companion design guide
14. Windows-style source path entries
15. custom preview port

### Behavioral assertions

For every agent-run fixture, assert:

- no generated `book.html` changed;
- no Open Design-specific stylesheet/state file was created;
- no `plugins/npm/` file changed;
- only files allowed by `editScope` changed;
- only ownership allowed by `changeScope` changed;
- manuscript source membership did not accidentally expand;
- one active theme remained;
- shared/local precedence was respected;
- the final preview reflected the source edit after complete pagination; and
- the final response named every changed file and its owner.

### Trust tests

- Local install can read/write after normal trusted installation.
- GitHub/registry install remains unable to write while restricted.
- Granting the declared file capabilities enables the same workflow.
- The plugin never requests shell, subprocess, network, MCP, or connector access.

### Browser/source tests

- Select a heading carrying `data-source-line`.
- Select content cloned or split by Paged.js.
- Select a component with a stable semantic class.
- Confirm the agent edits the source file rather than preview HTML.
- Confirm a pagination-affecting CSS change is evaluated only after complete pagination.

## 16. Suggested automated test harness

The plugin itself contains no executable runtime, so test behavior at three layers:

1. **Schema/package layer** — run `od plugin validate`, `od plugin pack`, and install/doctor commands in CI.
2. **Prompt contract layer** — run representative agent sessions against copied fixtures with a fake or deterministic model and compare allowed file diffs.
3. **End-to-end layer** — run Print-MD preview on fixture books, open the URL through Open Design's Browser test harness, attach a selection/comment, execute the plugin, and verify source and rendered output.

Keep fixture repositories outside the installable `plugin/` directory.

## 17. Versioning

- Start at `0.1.0` while validating against current main branches.
- Record the minimum tested Open Design release in `README.md` once a released version boundary is known.
- Add `od.engineRequirements.od` only when that release floor is deliberate and testable.
- Bump the plugin version whenever the package contents or workflow contract change.
- Treat changes to inputs, capabilities, edit scopes, or ownership rules as user-visible compatibility changes.
- Keep the team-vendored package and published package version aligned when both are distributed.

## 18. Distribution options

### Team-local Git package

Store the package under `design/open-design/plugins/` and install it locally. This is simplest for private teams and local installs default to trusted.

### GitHub source

Publish the canonical repository and install a tagged package subpath:

```bash
od plugin install github:dimm-city/print-md-publishing-plugin@v0.1.0/plugin
```

Remote installs retain provenance and may require explicit trust before file writes.

### Open Design registry

Validate, pack, authenticate, and publish:

```bash
od plugin validate ./plugin --no-daemon
od plugin pack ./plugin
od plugin login
od plugin whoami --json
od plugin publish print-md-publishing \
  --to open-design \
  --repo https://github.com/dimm-city/print-md-publishing-plugin
```

After registry review:

```bash
od marketplace refresh official
od plugin install print-md-publishing
od plugin info print-md-publishing --json
```

## 19. Implementation phases

### Phase 1 — minimum usable package

1. Scaffold the package.
2. Add the exact manifest and skill above.
3. Add the five concise reference files.
4. Validate, install, doctor, and pack locally.
5. Test against `simple-explicit`, `simple-implicit`, and `themed-book`.
6. Document manual Print-MD preview startup and the current hard-reload requirement.

### Phase 2 — repository/team coverage

1. Add shared/local overlay guidance and the multi-book fixture.
2. Test repository-root Open Design projects with nested `bookPath` values.
3. Add authored-plugin and managed-npm-plugin protections.
4. Add install-copy/reinstall documentation and CI.

### Phase 3 — visual-selection hardening

1. Test Browser selections against real Paged.js output.
2. Refine nearest-source instructions for cloned and split fragments.
3. Contribute an optional Open Design Browser improvement that includes nearest existing source metadata in selection attachments.
4. Do not change Print-MD's source-map format.

### Phase 4 — release

1. Add marketplace copy and an optional static poster/preview.
2. Run the full fixture and trust matrix.
3. Pack and integrity-check the package.
4. Publish the canonical GitHub repository.
5. Submit to the Open Design registry.

## 20. Acceptance criteria

The plugin is complete when:

- it validates, installs, and doctors through current Open Design tooling;
- it edits an imported Print-MD repository directly;
- it supports all current Print-MD manifest names;
- it safely handles explicit and implicit manuscript discovery;
- it edits existing stable themes, styles, components, Markdown, and authored plugins rather than creating tool-specific overrides;
- it respects shared versus book-local ownership;
- it never edits generated output or Print-MD-managed npm plugin files;
- it uses the running Print-MD preview as pagination authority;
- it reuses existing source metadata for visual selection;
- it works in a multi-book Git repository;
- its Git-tracked source can be reinstalled reproducibly by every contributor; and
- Print-MD contains no Open Design-specific application code.

## 21. Research basis

### Open Design

- [Plugin specification](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/docs/plugins-spec.md)
- [Plugin manifest schema](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/packages/contracts/src/plugins/manifest.ts)
- [Plugin template](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/plugins/spec/templates/open-design.template.json)
- [Plugin apply implementation](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/plugins/apply.ts)
- [Plugin trust and capability model](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/plugins/trust.ts)
- [Plugin installer and source syntax](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/plugins/installer.ts)
- [Skill protocol and resource staging](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/docs/skills-protocol.md)
- [First-party atom catalog](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/docs/atoms.md)
- [Plugin publishing workflow](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/docs/publishing-a-plugin.md)
- [Direct-folder import](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/import-export-routes.ts)
- [Imported-folder file handling](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/daemon/src/projects.ts)
- [Browser inspection behavior](https://github.com/nexu-io/open-design/blob/fac10139c0138a5700c128079e23c3e7a622516c/apps/web/src/components/DesignBrowserPanel.tsx)

### Print-MD

- [Current CLI and manifest behavior](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/README.md)
- [Manifest resolver](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/manifest.ts)
- [Theme manager](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/theme-manager.ts)
- [Asset resolver](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/assets.ts)
- [Plugin command](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/commands/plugin.ts)
- [npm plugin vendoring](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/docs/adr/0007-npm-plugin-vendoring.md)
- [Preview watcher](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/preview/file-watcher.ts)
- [Git repository detection](https://github.com/dimm-city/print-md/blob/719173c1ce68d7acd91494f477eb8e74533171a0/packages/cli/src/lib/project-source.ts)

# Issue #25 — New project wizard / starter template for first-time writers

> **Status:** design + compile-clean type stubs only. No behaviour is
> implemented in this pass. Milestone 0.4.0. Builds on the platform abstraction
> (#41), the project-source classification (#12, already landed in
> `lib/project-source.ts`), local version history (#13), and the embedded-asset
> pattern (`lib/embedded-assets.ts`).

## 1. Problem

A brand-new writer launches the viewer, sees the empty-state hero, and is asked
to **"Open Your Book Folder"** — but they have no folder yet, and there is no
path to create one. For the target non-technical audience this is a hard
drop-off. The CLI has the same gap: there is no `print-md new`.

## 2. Desired behaviour (issue acceptance criteria)

- **MVP**: the empty-state hero gains, at minimum, a **"Download starter
  template →"** link that opens the official setup guide via the existing
  `openExternal(url)` host service (already on `HostServices`).
- **Full wizard**: a guided "Create New Project" flow that
  1. asks for a project **name** and **author**,
  2. lets the writer choose a **save location** (folder picker),
  3. creates the folder structure (`print-md.yaml` + `chapter-01.md` +
     `assets/`),
  4. **opens the new project automatically** in the viewer.
- All wizard copy is writer-friendly: **no** YAML / Markdown / config jargon in
  any label or instruction.

## 3. Architecture

### 3.1 The scaffold logic lives in the lib (single implementation)

Per the issue's 2026-06-06 clarification, the "create a project" logic lives in
`@dimm-city/print-md-lib`, **not** the viewer. The viewer wizard and a new CLI
command (`print-md new`) are both **thin front-ends** over one lib function:

```
scaffoldProject(options: CreateProjectOptions): Promise<CreateProjectResult>
```

declared (types-only, this pass) in
`packages/lib/src/lib/project-scaffold.ts`. This avoids the
viewer-only "Files (full wizard)" plan in the original issue body, which it
explicitly supersedes.

**Scaffolding model** (issue):

1. **Copy** an embedded template directory to the chosen location (a plain
   directory copy).
2. **Fill in** the copied files — substitute `title` / `authors` / output
   filename into `print-md.yaml`, the sample chapter heading, etc.
3. **Optionally** initialise local version history (§3.4).

`scaffoldProject` is pure Node (`fs/promises` + the embedded template), no
subprocess. It is fail-fast and **NEVER** overwrites or deletes an existing
path: if the target already exists it throws `CreateProjectError` with code
`target-exists` (consistent with the global never-delete-user-data rule).

### 3.2 Templates ship as embedded assets in the lib

Templates are baked into both the compiled CLI binary AND the packaged viewer
using the existing pattern (`embedded-assets.ts`, `with { type: "file" }`).

A new template tree is added under `packages/lib/src/assets/templates/book/`:

```
templates/book/
  print-md.yaml          (with {{TITLE}}, {{AUTHOR}}, {{OUTPUT_PDF}} placeholders)
  chapter-01.md          (one heading + a few paragraphs of placeholder prose)
  assets/.gitkeep        (so the empty assets/ dir survives the copy)
```

Each template file is registered in `embedded-assets.ts`'s
`EMBEDDED_ASSETS` map (one `with { type: "file" }` import + one map entry per
file), exactly as the existing preview assets are. `scaffoldProject` resolves
the extracted template dir via `getAssetsDir()` / `getAssetPath()`, copies it to
`join(parentDir, folderName)`, then rewrites the placeholders.

> **Why placeholders, not a YAML serializer:** the issue calls for a *minimal*
> manifest (`title`, `authors`, `source.files`, `output`). A string-substitution
> template keeps the generated file human-readable and comment-friendly, and
> avoids pulling a YAML *writer* into the bundle (the lib only needs a YAML
> *reader* today). Substitution values are escaped for YAML scalars.

The generated manifest is intentionally minimal (matches the issue):

```yaml
title: "{{TITLE}}"
authors:
  - "{{AUTHOR}}"
source:
  files:
    - chapter-01.md
output:
  filename: "{{OUTPUT_PDF}}"
```

`{{OUTPUT_PDF}}` and the default `folderName` derive from a slug of `name`.
`{{AUTHOR}}` falls back to a friendly default when the author field is blank
(the `authors` array is kept so the manifest is schema-valid).

### 3.3 The `CreateProjectOptions` / `CreateProjectResult` surface

(Declared in `project-scaffold.ts`, exported type-only from
`api/index.ts`.)

- `name` (required) — human title; drives manifest `title`, default
  `folderName` (slug), and `{{OUTPUT_PDF}}`.
- `author?` — manifest `authors: [author]`.
- `parentDir` (required) — absolute parent dir from the folder picker.
- `folderName?` — defaults to `slug(name)`; must not already exist.
- `template?: ProjectTemplateId` — `"book"` only in v1 (union is
  forward-compatible).
- `versionHistory?: ProjectVersionHistoryMode` — `"local-git"` (default) or
  `"none"` (§3.4).

`CreateProjectResult` returns `projectDir`, `manifestPath`, and **`openFile`**
(the sample chapter the viewer opens first, so the author immediately sees a
rendered document — an explicit acceptance criterion), plus the *actual*
`versionHistory` outcome (which may downgrade to `"none"` — §3.4).

Failures are a discriminated `CreateProjectErrorCode`:
`parent-not-writable | target-exists | invalid-name | scaffold-io`.

### 3.4 Default to local version history — Node-native, no system Git

New projects **default** to initialising a local Git repo so non-technical
authors get undo/snapshots with no credentials and no remote (issue: "Default to
Git version history"; #12). An **escape hatch** (`versionHistory: "none"`) keeps
the project a plain `local-folder` when Git can't or shouldn't be used; if
`"local-git"` init *fails*, the scaffold downgrades to `"none"` and reports
`versionHistoryError` rather than failing the whole create.

> **CLAUDE.md §7 — NON-NEGOTIABLE.** Git operations use a **Node-native, pure-JS
> implementation (`isomorphic-git`)** — NOT the system `git` binary, NOT the
> GitHub CLI (`gh`), with **no expectation the user has Git installed** (we do
> not bundle it). This keeps the `bun build --compile` binary and the packaged
> viewer self-contained. `isomorphic-git` is added as a lib dependency **only
> when this phase is implemented** (Phase 3), not in this types-only pass.

The version-control *operations* (init / snapshot / list history / restore) are
declared as a single `SourceProvider` interface
(`packages/lib/src/lib/source-provider.ts`), keyed off the existing
`ProjectSource` classification:

- `LocalFolderSourceProvider` — no history; `initVersionHistory` is the one op
  that "upgrades" a `local-folder` to a `local-git-folder`.
- `LocalGitSourceProvider` — entirely `isomorphic-git` against `.git`.
- `ManagedGithubSourceProvider` — #15/#16, REST API only, no `gh`.

Capability gating stays owned by `capabilitiesFor` (`project-source.ts`); the
provider methods are the verbs the UI invokes once a capability is true. This
keeps #25's "init on create" and #13's "snapshot/history/restore" on one seam.

### 3.5 Platform-adapter surface this needs (viewer)

A single new host RPC is added **end-to-end** following the #41 pattern
(`ipcMain.handle` → preload `contextBridge` → `ElectronBridge`/`Window` shape →
`ElectronAdapter` delegate → `WebAdapter` stub → `HostServices` interface →
`getPlatform()`):

```ts
// HostServices (viewer contract.ts)
createProject(options: CreateProjectOptions): Promise<CreateProjectResult>;
```

- **main.ts** adds `ipcMain.handle("app:createProject", ...)` whose body is a
  **thin pass-through** that dynamic-imports the lib and calls
  `scaffoldProject(options)`. The scaffolding logic does NOT live in the IPC
  handler (issue requirement).
- **preload.ts** exposes `createProject` on the bridge; **types.d.ts** +
  **src/app.d.ts** (`ElectronBridge`) carry the shape.
- **ElectronAdapter** delegates 1:1; **WebAdapter** rejects with the standard
  `NOT_IMPL` message (the wizard is desktop-only in 0.4.0, mirroring the editor
  guards).
- **No `PlatformAdapter` change** — the existing `openFolder()` primitive
  already provides the folder picker the wizard needs for `parentDir`.

`openExternal(url)` (for the MVP "Download starter template" link) **already
exists** on `HostServices` — the MVP needs no new IPC at all.

**`DESKTOP_API` bump:** adding `app:createProject` to the IPC surface the SPA
calls bumps `DESKTOP_API` 1 → 2 in `electron/updater/contract.ts`, and
`scripts/build-web-ui-manifest.mjs`'s `requiresDesktopApi` to match — done in
the phase that wires the IPC (Phase 4), not before. (If #44 lands first and
already bumped to 2, this rides that bump; the contract is "bump when the SPA's
IPC surface changes," tracked per-release.)

### 3.6 Viewer UI

- **`NewProjectWizard.svelte`** (new, Svelte 5 runes — `$state`/`$derived`/
  `$props`): a small multi-step dialog (Name → Author → Location) that collects
  inputs, calls `getPlatform().openFolder()` for the save location, then
  `getPlatform().createProject(opts)`, and on success calls the existing
  open-project flow with `result.projectDir` (auto-open). All copy is
  writer-friendly. Dark-mode styling via the existing CSS custom properties /
  `data-theme` layer — no per-component colour overrides.
- **`+page.svelte`** empty-state hero gains a **"Create New Project"** button
  that opens the wizard, and the MVP **"Download starter template →"** link
  wired to `openExternal(SETUP_GUIDE_URL)`.

### 3.7 CLI surface

A new `print-md new` subcommand (`packages/cli/src/commands/new.ts`,
registered lazily in `cli.ts`'s `SUBCOMMANDS`) is a thin `citty` front-end:

```
print-md new "My First Book" --author "Jane" --dir ~/Books [--template book] [--no-git]
```

It maps flags to `CreateProjectOptions`, calls `scaffoldProject`, and prints the
created `projectDir`. It works headless — no viewer required — and obeys the
no-bundler / self-contained rules (no new bundler deps; `isomorphic-git` is pure
JS and bundles cleanly under `bun build --compile`).

## 4. Phased delivery

**Phase 0 — types only (this pass).** Add `project-scaffold.ts` +
`source-provider.ts` (declarations only) and export their **types** from
`api/index.ts`. Functions are `declare`d (bodiless) and NOT re-exported, so no
caller can import a function with no body. Compile-clean: lib `tsc --noEmit`,
viewer `typecheck` + `check` all green. No dependency added.

**Phase 1 — MVP link.** Wire the empty-state hero's "Download starter template
→" link to `openExternal(SETUP_GUIDE_URL)`. Pure renderer; uses an existing host
service; no new IPC, no `DESKTOP_API` change. (Satisfies the issue's minimum
acceptance criterion.)

**Phase 2 — lib scaffold (no Git).** Implement `scaffoldProject` for
`versionHistory: "none"`: add the embedded `templates/book/` tree, register it
in `embedded-assets.ts`, implement copy + placeholder fill + slug/escape
helpers, and the `CreateProjectError` precondition checks. Add `print-md new`
(defaulting to `--no-git` until Phase 3). Unit-test the slug/escape/manifest
output and the `target-exists` refusal. No viewer change yet.

**Phase 3 — local version history.** Add `isomorphic-git` (lib dep), implement
`LocalGitSourceProvider` + `providerFor`, make `scaffoldProject` default
`versionHistory: "local-git"` with the downgrade-on-failure escape hatch. Verify
the compiled CLI binary still works (`bun build --compile`) since this is the
first new runtime dep. (Shared with #13.)

**Phase 4 — viewer wizard.** Add the `app:createProject` IPC end-to-end (§3.5),
`NewProjectWizard.svelte`, and the empty-state "Create New Project" button with
auto-open. Bump `DESKTOP_API` (+manifest) if not already bumped this release.
(Satisfies the full-wizard acceptance criteria.)

Each phase is independently verifiable; only Phase 4 touches the IPC surface /
`DESKTOP_API`. Phases 2–3 are CLI-testable without the viewer.

## 5. Verification gate (every phase)

From `packages/viewer`:

- `npm run typecheck`
- `npm run check` (0 errors)
- `npm run electron:build`
- `npm test`

If `packages/lib/src` changed (all phases except Phase 1):

- `(cd packages/lib && bun run build && bun test && bunx tsc --noEmit)`

Phase-specific behavioural checks:

- P1: click "Download starter template →" → setup guide opens in the system
  browser.
- P2: `print-md new "Test Book" --dir /tmp --no-git` → creates
  `/tmp/test-book/` with a valid `print-md.yaml` + `chapter-01.md` + `assets/`;
  re-running refuses with `target-exists`.
- P3: same, with Git default → `.git` present, one initial snapshot;
  `detectProjectSource` classifies it `local-git-folder`; on a host where init
  fails, the project is still created and `versionHistory === "none"`.
- P4: empty-state "Create New Project" → wizard → pick a folder → project is
  created and **opens automatically** showing the rendered sample chapter; all
  labels are jargon-free.

## 6. Files touched (projected, full feature)

- `packages/lib/src/lib/project-scaffold.ts` — `CreateProject*` types +
  `scaffoldProject` (Phase 0 types; Phase 2 impl).
- `packages/lib/src/lib/source-provider.ts` — `SourceProvider` + snapshot types
  (Phase 0 types; Phase 3 impl + `providerFor`).
- `packages/lib/src/api/index.ts` — type-only re-exports (Phase 0); function
  re-exports added when bodies land.
- `packages/lib/src/assets/templates/book/**` — embedded template tree
  (Phase 2).
- `packages/lib/src/lib/embedded-assets.ts` — register the template files
  (Phase 2).
- `packages/lib/package.json` — add `isomorphic-git` (Phase 3).
- `packages/cli/src/commands/new.ts` + `packages/cli/src/cli.ts` — `print-md
  new` (Phase 2/3).
- `packages/viewer/electron/main.ts` — `app:createProject` pass-through IPC
  (Phase 4).
- `packages/viewer/electron/preload.ts` + `types.d.ts` + `src/app.d.ts` —
  bridge surface (Phase 4).
- `packages/viewer/src/lib/platform/contract.ts` — `createProject` on
  `HostServices` + `ElectronBridge` (Phase 4).
- `packages/viewer/src/lib/platform/electron-adapter.ts` /
  `web-adapter.ts` — delegate / stub (Phase 4).
- `packages/viewer/src/lib/components/NewProjectWizard.svelte` — new (Phase 4).
- `packages/viewer/src/routes/+page.svelte` — empty-state buttons + auto-open
  (Phases 1 + 4).
- `packages/viewer/electron/updater/contract.ts` +
  `scripts/build-web-ui-manifest.mjs` — `DESKTOP_API` bump if needed (Phase 4).

# Gutterpress Source-First Rich Editor and Enterprise Architecture Simplification — Orchestrated Implementation Plan

> **Purpose:** Execute a staged editor replacement and architectural simplification that gives Gutterpress one authoritative Markdown document model, a reusable source-first rich editor, a maintainable VS Code extension path, and a materially smaller desktop architecture.
>
> This plan is ready for execution. It contains no unresolved design decisions. Any later change to a binding decision requires an explicit decision-record commit before implementation continues.

---

## Template conventions

- `P0`, `P1a`, `P1b`, and similar labels identify execution runs or phases. Keep each run small enough to review as one coherent change.
- `D1`, `D2`, and similar labels identify **binding design decisions**. Implementers apply them; they do not re-derive them.
- **CONFIRMED** findings block completion and require a fix. **ADVISORY** findings are recorded but do not block unless promoted by the plan owner.
- A **lane** is a parallel workstream with disjoint write ownership. A lane may read any relevant file but may modify only its assigned files.
- An **integrator** is the only actor allowed to combine lane work, resolve overlap, commit, and push.
- A **gate** is report-only verification. A gate never silently repairs code.
- A **checkpoint** pauses execution for stakeholder review only when this plan explicitly requires a pause.
- The plan describes observable behavior, contracts, boundaries, evidence, sequencing, and deletion points. It avoids prescribing low-value implementation trivia unless that detail protects an invariant.
- Paths introduced by this plan are normative unless the run specification proves that a smaller equivalent placement already exists in the current tree.

---

## Context

Gutterpress needs a primary rich Markdown authoring experience for non-technical authors without sacrificing exact Markdown source, project-specific syntax, print fidelity, or maintainability. The previous rich-editor effort in PR 158 proved several hard product and rendering requirements, but its ProseMirror document model, Markdown serializer, normalization workflow, and broad branch divergence are no longer the correct foundation.

This plan assumes `0.10.2` has been merged to `main` and released before implementation begins. The execution baseline is therefore the post-release `main` branch, and `release/0.11.0` is already synchronized with that same commit. That baseline treats Markdown source as authoritative, includes a browser-safe `gutterpress/render` boundary, has a working CodeMirror source editor, and contains source-range infrastructure. It also contains architectural complexity that can now be removed: paginated-preview editing, a dormant in-desktop PWA implementation, a broad platform service locator, and two host transports inside Electron.

This effort therefore combines one new capability with a deletion-led architecture refinement:

1. Add a source-first rich editor based on `@vscode/markdown-editor`.
2. Reuse that same editor implementation in the desktop app and a VS Code extension.
3. Keep exact Markdown source as the only authoritative document.
4. Keep the paginated preview as the read-only print and layout authority.
5. Delete editing, platform, transport, and compatibility complexity made redundant by the new design.
6. Enforce the resulting package and dependency boundaries in CI.

### Objective

Deliver Gutterpress `0.11.0` with a lean, source-first rich editor shared by Electron and VS Code; preserve exact Markdown bytes outside explicit edits; support Gutterpress layout and project-plugin projections without introducing a second full document model; retain CodeMirror for source and code-oriented files; make the paginated preview read-only; remove dormant PWA scaffolding from the desktop package; converge Electron on typed IPC instead of local HTTP plus IPC; replace the broad `Platform` service locator with narrow feature-owned capabilities; and leave an auditable net reduction in runtime concepts, branches, modules, and lines of code.

### Current state

- Repository: `dimm-city/gutterpress`
- Work branch: `feature/source-first-rich-editor-architecture`
- Branch origin: post-release `main`
- Baseline branch: `main`
- Baseline commit: captured in P0a from `origin/main` after the `0.10.2` release; it is intentionally not hard-coded in this plan
- Released baseline version: `0.10.2`
- Target integration branch: `release/0.11.0`
- Execution precondition: `origin/release/0.11.0` resolves to the same commit as `origin/main` before the work branch is created
- Target release: `0.11.0`
- Versioning constraint:
  - Internal desktop and editor architecture may break during `0.11.0`.
  - Existing Gutterpress project Markdown, manifest, CLI, build, preview, and published package behavior remain compatible unless a run explicitly proves and documents a required correction.
  - `@dimm-city/gutterpress-editor` and the initial VS Code extension are **Experimental** for `0.11.0`.
  - No user-data migration is introduced by this plan.
- Changelog destination: `CHANGELOG.md` under the `0.11.0` section
- Implementation plan destination: `docs/plans/source-first-editor-enterprise-refactor.md`
- Run specifications: `docs/plans/source-first-editor/runs/`
- Review and acceptance log: `docs/plans/source-first-editor/acceptance.md`
- Deletion ledger: `docs/plans/source-first-editor/deletion-ledger.md`
- Merge authority: repository owner or explicitly delegated maintainer
- Release authority: repository owner after final acceptance and release gates

### Source evidence inspected at plan authoring

- Execution baseline: <https://github.com/dimm-city/gutterpress/tree/main>
- Reviewed `0.10.2` implementation line: <https://github.com/dimm-city/gutterpress/tree/release/0.10.2>
- Target integration branch: <https://github.com/dimm-city/gutterpress/tree/release/0.11.0>
- Superseded rich-editor research branch: <https://github.com/dimm-city/gutterpress/pull/158>
- Root workspace scripts: `package.json`
- Desktop dependencies and scripts: `packages/desktop/package.json`
- CLI and public exports: `packages/cli/package.json`
- Broad platform contract: `packages/desktop/src/lib/platform/contract.ts`
- Dormant PWA implementation: `packages/desktop/src/lib/platform/web-adapter.ts`, `web-fs.ts`, and `web-store.ts`
- Preview editing: `packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts`
- Preview mutation commit path: `packages/desktop/src/lib/editor/commit-engine.ts`
- Typed HTTP API client: `packages/desktop/src/lib/api.ts`
- Adapter-node desktop build: `packages/desktop/svelte.config.js`
- Electron local SvelteKit server: `packages/desktop/electron/sveltekit-host.ts`
- Existing IPC bridge: `packages/desktop/electron/preload.ts`

### Scope authority and conflict resolution

When sources disagree, use this order of authority:

1. Explicit stakeholder decisions recorded in this plan.
2. Binding design decisions `D1–D15` below.
3. Approved per-run specifications.
4. Accepted architecture decision records and public compatibility contracts.
5. Current `main` behavior and documentation at the recorded post-`0.10.2` execution baseline.
6. PR 158 as research evidence only.
7. Individual implementer or reviewer preference.

This plan may intentionally undo, replace, or decline to reuse unmerged work from PR 158. No compatibility is required with PR 158’s ProseMirror schema, serializer, normalization output, internal APIs, branch structure, or UI implementation. Compatibility with the released `0.10.2` project, Markdown, manifest, CLI, build, preview, and publish contracts remains required.

### In scope

- Create the work branch from post-release `main` after confirming `release/0.11.0` is already synchronized with the same baseline commit.
- Add `packages/editor` as a framework-free, browser-safe shared editor package.
- Add `packages/vscode-extension` early enough to continuously prove host portability.
- Integrate an exact-pinned `@vscode/markdown-editor` implementation behind one adapter.
- Add a deterministic direct-package-versus-minimal-fork decision gate.
- Define one versioned source-edit contract based on exact Markdown source and UTF-16 offsets.
- Extract a pure document/session core from desktop persistence and Svelte state.
- Implement a sparse Gutterpress projection for layout markers, plugin regions, generated views, raw HTML, attributes, and source mappings.
- Add selection-aware inactive and active views for Gutterpress-specific content.
- Integrate rich/source mode over the same desktop document session.
- Add a VS Code custom text editor that uses the same shared editor mount.
- Implement workspace-trust behavior for project plugins and author HTML.
- Reach product parity for ordinary authoring, images, links, tables, block movement, layout markers, plugin regions, paste, undo, external edits, and source fallback.
- Retire in-flow paginated-preview editing after rich-editor parity.
- Remove preview-specific source mutation, commit, and rewrite infrastructure after its final caller is deleted.
- Remove dormant PWA implementation from the desktop package.
- Replace broad `Platform` consumption with narrow feature-owned capabilities.
- Migrate Electron request/reply operations from SvelteKit HTTP routes to typed IPC in bounded runs.
- Convert the packaged desktop renderer to a static Svelte build after the final server route is removed.
- Delete the Electron-local SvelteKit server and proxy/authentication machinery.
- Reduce `+page.svelte` and Electron `main.ts` to composition responsibilities.
- Tighten public package subpath exports.
- Remove tracked generated output, stale architecture references, dead exemptions, and duplicate bundled assets.
- Add CI architecture fitness functions, dead-code enforcement, packaging checks, interaction tests, and a net-complexity acceptance ledger.

### Out of scope

- Changing the Gutterpress project Markdown syntax or manifest format.
- Replacing Markdown-it as the Gutterpress dialect and rendering authority.
- Rewriting the print, PDF, PDF/X, pagination, or native Chromium engine.
- Removing the standalone `gutterpress preview` CLI capability.
- Replacing CodeMirror for source Markdown, CSS, YAML, JavaScript, plugin, or manifest editing.
- Shipping a browser PWA in `0.11.0`.
- Building a pixel-identical paginated rich editor; exact page layout remains the preview’s responsibility.
- Taking over all VS Code Markdown files by default.
- Introducing a language server unless current extension features prove that a shared language-service package is necessary.
- Splitting every Gutterpress subsystem into a separate npm package.
- Renaming `packages/cli` solely for aesthetic reasons.
- Migrating existing user files to a canonical Markdown style.

### Non-goals

- No ProseMirror, Tiptap, Milkdown, or second rich-text engine.
- No full custom Gutterpress AST unless a later accepted decision record proves the sparse projection insufficient.
- No whole-document Markdown serializer in the ordinary edit path.
- No source normalization prerequisite for rich editing.
- No generic dependency-injection container, registry, event bus, or cross-platform service framework.
- No retained PWA abstraction “for later.” A future web product gets a dedicated host package.
- No cross-mode undo promise in `0.11.0`; switching between source and rich modes establishes a documented undo boundary.
- No arbitrary extension API for third-party rich-editor plugins in `0.11.0`.
- No compatibility adapter without an explicit owner and deletion phase.

---

## Exploration-verified review verdict

### Confirmed findings

- **CONFIRMED:** The `release/0.10.2` implementation reviewed for this plan is the correct code foundation. Execution is intentionally deferred until `0.10.2` is merged to `main` and released; P0a records and re-verifies the exact post-release `main` SHA.
- **CONFIRMED:** Current `release/0.10.2` has CodeMirror but no ProseMirror dependencies in `packages/desktop/package.json`. ProseMirror exists only in the superseded PR 158 effort and must not be introduced.
- **CONFIRMED:** The current architecture already contains a browser-safe `gutterpress/render` public subpath. This is the correct renderer dependency for the shared web editor and VS Code webview.
- **CONFIRMED:** Preview editing is a separate mutation subsystem. `InlineEditController` captures authoritative source and preview generation state, while `CommitEngine` validates chapter identity, generation, clean-buffer state, line-to-character ranges, and expected source before writing.
- **CONFIRMED:** The desktop currently uses two host transports. `api.ts` drives many `+server.ts` routes over fetch, while `preload.ts` exposes IPC for push events and selected operations.
- **CONFIRMED:** The packaged desktop uses `@sveltejs/adapter-node`; Electron starts a loopback HTTP server and proxies `app://` requests through token-authenticated fetches.
- **CONFIRMED:** `Platform` is a broad service locator combining `PlatformAdapter` and `HostServices`, and `getPlatform()` selects an Electron or Web adapter.
- **CONFIRMED:** `WebAdapter` is intentionally dormant PWA scaffolding inside the desktop package. It includes browser filesystem, IndexedDB, preview, settings, and capability code that is not the correct host abstraction for the future VS Code extension.
- **CONFIRMED:** The workspace currently has `cli`, `desktop`, and `open-design-plugin`; the editor and VS Code extension packages do not exist.
- **CONFIRMED:** Root scripts already expose workspace-wide tests, typechecking, and Knip, providing a base for new architecture gates.

### Corrections absorbed into this plan

- The implementation does **not** continue or rebase PR 158. It starts from a fresh feature branch created from post-release `main`; synchronization of `release/0.11.0` with `main` is a release-management precondition, not a feature-development run.
- PR 158 is an evidence and fixture source, not a code integration source. No initial cherry-picks are allowed.
- ProseMirror is removed from the architecture entirely; because it is absent from the reviewed `0.10.2` implementation and the post-release `main` baseline, the plan prevents introduction rather than scheduling a runtime removal.
- A complete Gutterpress editor AST is not the starting design. The shared editor uses the VS Code editor’s source model plus a sparse Gutterpress projection.
- The rich editor does not recreate PR 158’s paginated page-sheet simulation. The existing paginated preview remains the visual authority.
- The future VS Code extension is not deferred until desktop completion. A minimal extension host is created during foundation work to continuously enforce portability.
- The dormant PWA implementation is deleted rather than retained as a false cross-platform abstraction.
- The desktop local HTTP server is removed only after a bounded route-by-route IPC migration, not through a big-bang rewrite.
- Preview editing is removed only after the rich editor meets its explicit parity gate; deletion is nevertheless a required deliverable, not an optional follow-up.

### Unknowns resolved during exploration

- **Which branch is authoritative for execution?** → Post-release `main`, after `0.10.2` has been merged and released.
- **Does this plan perform release-branch alignment?** → No. `release/0.11.0` must already match the recorded `main` baseline before the work branch is created; otherwise execution stops until release management resolves it.
- **Is ProseMirror required?** → No.
- **Should PR 158 be merged, rebased, or cherry-picked broadly?** → No; use it only as research evidence and manually port selected fixtures after the new core exists.
- **Should the desktop PWA code remain for VS Code reuse?** → No; VS Code requires a different host adapter. A future PWA gets a separate package.
- **Should preview editing coexist permanently with the rich editor?** → No; preview becomes read-only after parity.
- **Should Electron retain HTTP and IPC?** → No; request/reply operations converge on typed IPC.
- **Should the initial rich editor fork the VS Code package immediately?** → No; direct exact-pin first. A minimal fork is permitted only when the package compatibility gate proves a required generic extension seam is absent.
- **Is cross-mode undo required for `0.11.0`?** → No; mode switching creates a clear undo boundary. Exact source and persistence remain continuous.

### Remaining uncertainties

None. Package compatibility is resolved by the binding decision and pass/fail gate in P1b rather than by stakeholder interpretation.

---

## Stakeholder decisions

- **Pacing:** Continuous execution through each checkpoint group. Pause only on a stop/re-plan condition or when the plan owner explicitly requests a checkpoint pause.
- **Compatibility:** Internal editor and desktop architecture may break in `0.11.0`. Released project, Markdown, manifest, CLI, build, preview, and publish contracts remain compatible.
- **Public surface:** `@dimm-city/gutterpress-editor` and the VS Code extension may be introduced as Experimental. Existing stable public package entry points remain supported.
- **Push policy:** Push after every integrator commit that passes the fast check. Do not leave reviewed milestones only in a local workspace.
- **Review policy:** One senior adversarial reviewer per run; maximum three confirmed-finding repair rounds. Exceeding three requires splitting or redesigning the run.
- **Deletion policy:** Superseded capability is removed in the phase that proves its replacement. Compatibility code may not survive past its named deletion run.
- **Release policy:** Repository owner reviews the final acceptance report, remaining advisories, net-complexity ledger, packaged desktop smoke, extension smoke, and release checks before merging to `release/0.11.0`.
- **PR 158 policy:** Close as superseded after the new branch and decision record exist. Preserve the branch or tag for history; do not merge its implementation.

---

## Binding design decisions

> These decisions are pasted into every run specification. Implementers and reviewers apply them as constraints rather than redesign them. Any change requires an explicit amendment and decision-record commit.

### D1 — Baseline, versions, and vocabulary

- Begin only after `0.10.2` has been merged to `main` and released.
- Verify `origin/release/0.11.0` resolves to the same commit as `origin/main`.
- Create `feature/source-first-rich-editor-architecture` directly from that recorded `origin/main` commit.
- Initial shared package: `@dimm-city/gutterpress-editor`.
- Initial extension package: `@dimm-city/gutterpress-vscode`.
- Editor protocol version: `1`.
- Projection schema version: `1`.
- Source offsets are JavaScript/VS Code UTF-16 code-unit offsets.
- Initial dependency candidate: exact `@vscode/markdown-editor@0.0.2-84`; no caret or tilde range.
- Terms have one meaning:
  - **source**: exact Markdown string.
  - **snapshot**: source plus monotonic document version.
  - **source edit**: explicit `[from, to)` replacement against an expected version.
  - **projection**: derived Gutterpress-specific source ranges and view metadata.
  - **generated view**: rendered content with an anchor but no authored source range.
  - **host**: desktop, VS Code, or test implementation of document/project boundaries.
  - **preview**: read-only paginated rendering authority.
- Do not use “rich document,” “canonicalized source,” or “normalized editor document” to describe authoritative state.

### D2 — Canonical document model and lifecycle

- Exact Markdown source is the only authoritative document.
- CodeMirror source view, VS Code rich view, Gutterpress projection, preview DOM, outline, and diagnostics are derived projections.
- No ProseMirror document model is introduced.
- No ordinary edit serializes a semantic tree back into Markdown.
- Opening and closing a document without an explicit edit changes zero bytes.
- An editor action may change only the source range returned by its explicit source-edit command.
- External changes replace or patch the authoritative snapshot, then update mounted views.
- Generated output can never enter source unless an explicit insert command includes those bytes.
- Source mode remains available for every document, including unsupported rich projections.

### D3 — Source-edit and binding contract

Use the following logical contract, with exact TypeScript finalized in P1a:

```ts
interface DocumentSnapshot {
  readonly text: string;
  readonly version: number;
}

interface SourceEdit {
  readonly from: number;
  readonly to: number;
  readonly insert: string;
  readonly expectedVersion: number;
}

type ApplyEditResult =
  | { readonly ok: true; readonly snapshot: DocumentSnapshot }
  | {
      readonly ok: false;
      readonly reason: "stale" | "readonly" | "invalid-range";
      readonly snapshot: DocumentSnapshot;
    };
```

Rules:

- `0 <= from <= to <= snapshot.text.length`.
- `expectedVersion` must equal the host’s current version.
- A stale or invalid edit changes nothing and returns the current snapshot.
- A command requiring multiple source changes must return one replacement spanning the smallest safe common source range. Do not add an edit-batch protocol until a real command cannot be represented safely this way.
- Hosts increment the version exactly once per accepted edit or authoritative external replacement.
- All protocol messages are runtime validated at process/webview boundaries.
- Host-originated replacements include the complete authoritative snapshot.
- No editor component writes files directly.

### D4 — Module and ownership map

Target package ownership:

```text
packages/cli
  Node-capable Gutterpress library, CLI, build, preview, plugins, publishing, VCS
  browser-safe public subpath: gutterpress/render

packages/editor
  framework-free shared source editor contracts and web implementation
  imports @vscode/markdown-editor and gutterpress/render
  no Svelte, Electron, vscode, node:fs, or desktop imports

packages/desktop
  Svelte/Electron product shell
  desktop document/project adapters
  CodeMirror source editor
  rich-editor wrapper around packages/editor
  native OS integration through typed IPC

packages/vscode-extension
  VS Code extension host
  custom text editor provider
  workspace/project integration
  webview bootstrapping using packages/editor

packages/open-design-plugin
  unchanged independent plugin package
```

Rules:

- No service locator in new code.
- No barrel that re-exports unrelated infrastructure.
- Consumer-shaped interfaces live with the consuming domain, not in a global contracts file.
- Shared mutable registries are prohibited.
- Svelte components do not define core editor command or protocol types.
- The same web editor mount is used by desktop and VS Code.

### D5 — VS Code package adoption and fork gate

- P1b first consumes exact `@vscode/markdown-editor@0.0.2-84` through one adapter file.
- No application code outside `packages/editor/src/vscode-adapter/` may import package internals.
- Direct package use remains the final implementation only if all mandatory compatibility cases pass:
  1. exact source edits;
  2. external authoritative replacement;
  3. host-delegated undo/redo;
  4. custom inactive Gutterpress block rendering;
  5. active/source-aware rendering for a projected block;
  6. selection mapping through projected content;
  7. custom CSS and isolated document mounting;
  8. clipboard, IME, accessibility, and disposal behavior.
- If and only if a generic custom-block/view hook is absent, create `packages/vscode-markdown-editor` as a minimal internal fork.
- The fork must:
  - record upstream package version and source commit;
  - retain MIT notices;
  - contain only generic extension seams, not Gutterpress-specific syntax;
  - include an upstream-diff document and contract tests;
  - remain an internal package, not a public Gutterpress API;
  - avoid unrelated formatting or refactoring of upstream code.
- Failure of unrelated optional styling does not justify a fork.

### D6 — Gutterpress sparse projection

The editor projection is not a second complete Markdown AST. It contains only Gutterpress-specific information the base editor cannot derive:

```ts
interface GutterpressProjection {
  readonly schemaVersion: 1;
  readonly sourceVersion: number;
  readonly blocks: readonly ProjectedBlock[];
  readonly generated: readonly GeneratedView[];
  readonly diagnostics: readonly ProjectionDiagnostic[];
}
```

Required projected kinds:

- `chapter`
- `page`
- `spread`
- `section`
- `page-break`
- `column-break`
- `plugin-region`
- `raw-html`

Projection rules:

- Every authored projected block has a valid source range.
- Every generated view has an anchor and no writable source range.
- Source ranges come from the configured Gutterpress Markdown-it pipeline, existing token maps, marker metadata, exact source metadata, or proven transform origin.
- Do not infer source from rendered DOM, tag gaps, text equality, or best-effort reverse conversion.
- Ambiguous origin produces a typed projection diagnostic and source-mode fallback.
- Inactive plugin regions may use the plugin’s own rendered HTML.
- Active editable plugin regions expose source-aware editable content while retaining the plugin wrapper’s safe view attributes.
- Generated views are read-only.
- Projection output is derived and may be discarded and rebuilt at any time.

### D7 — Document hosts, persistence, and undo

- `EditorDocumentHost` owns the authoritative snapshot, accepted edits, external replacements, and persistence integration.
- `EditorProjectHost` owns project resolution, CSS, assets, plugin trust, and projection creation.
- Desktop uses the current document session/buffer persistence semantics through a narrow adapter.
- VS Code uses `TextDocument`, `WorkspaceEdit`, and native undo/redo.
- Only one editing surface is mounted for a document at a time.
- Source and rich modes share source and persistence but not an undo stack in `0.11.0`.
- Switching modes establishes an explicit undo epoch and must warn only if an operation would otherwise be lost; it must never alter source.
- File switches and external full replacements are not undoable into the prior file.
- Autosave, recovery, and filesystem conflicts remain host responsibilities, outside `packages/editor`.

### D8 — Product surfaces and preview authority

The desktop has exactly three document surfaces:

1. **Source editor:** CodeMirror.
2. **Rich editor:** shared `@dimm-city/gutterpress-editor`.
3. **Preview:** read-only paginated Gutterpress renderer.

Rules:

- Preview owns exact pagination, print CSS, margin boxes, page furniture, and PDF parity.
- Rich editor optimizes writing and structural editing; it is not required to reproduce physical pagination.
- After P3 parity, preview supports navigation, selection/copy, open link/image, diagnostics, page controls, and source reveal only.
- In-flow `contenteditable`, preview block-edit requests, preview source mutation, and preview-specific Markdown rewriting are deleted in P4.
- Context-menu actions that change source move to rich/source editor commands or disappear.

### D9 — VS Code extension host

- Register an optional custom text editor, initially `gutterpress.markdownEditor`.
- Do not make it the default for all Markdown.
- Use the same framework-free editor mount as desktop.
- VS Code host owns:
  - `TextDocument`;
  - `WorkspaceEdit`;
  - undo/redo;
  - file and workspace events;
  - project discovery;
  - trusted plugin loading;
  - build/preview/export commands;
  - diagnostics and navigation integration.
- Webview owns:
  - editor model/view/controller;
  - selection;
  - local view state;
  - toolbar/chrome;
  - no filesystem or Node access.
- In untrusted workspaces:
  - standard Markdown rich editing remains available;
  - project plugins do not execute;
  - unsafe raw HTML is not executed;
  - plugin regions render as source or safe placeholders with a trust explanation.
- The extension must operate when no Gutterpress manifest is present.

### D10 — Desktop platform and transport simplification

- A future browser product is not implemented inside `packages/desktop`.
- Delete `WebAdapter`, `web-fs`, `web-store`, PWA-only service-worker code, PWA-only tests, and dead-code exemptions in P5a.
- Replace broad `Platform` consumption with narrow feature-owned capabilities.
- Electron request/reply operations migrate from SvelteKit HTTP routes to typed IPC in bounded context groups.
- Push streams remain IPC.
- Runtime validation is required at every IPC request boundary.
- After the last route migration:
  - use a static Svelte renderer;
  - remove `@sveltejs/adapter-node`;
  - delete `src/routes/api/**`;
  - delete `src/lib/api.ts`;
  - delete the local SvelteKit server, token authentication, proxy, and host error page;
  - remove route-only DTO duplication.
- The standalone CLI preview server remains unchanged.
- No new HTTP route may be added during the migration without a decision-record exception.

### D11 — Public compatibility and package exports

- Existing `gutterpress`, `gutterpress/api`, and `gutterpress/render` exports remain supported through `0.11.0`.
- Add narrower subpath exports only where current consumers justify them:
  - `gutterpress/project`
  - `gutterpress/build`
  - `gutterpress/preview`
  - `gutterpress/plugins`
  - `gutterpress/publish`
  - `gutterpress/vcs`
- Do not create separate npm packages for these subpaths.
- `@dimm-city/gutterpress-editor` is Experimental in `0.11.0`.
- VS Code extension identifiers and settings are Experimental in `0.11.0`.
- No project source migration is needed.
- No runtime compatibility with PR 158 internal types or serialized output is provided.

### D12 — Security, trust, and secrets

- Project plugins execute only in trusted desktop projects or trusted VS Code workspaces.
- Project plugin code executes in the host, not the editor webview.
- Webview/iframe content uses a restrictive CSP.
- Author HTML never grants script execution in the editor.
- Generated/plugin HTML is sanitized or rendered under a CSP that makes scripts inert; the run specification must name the chosen mechanism and prove it.
- The host supplies the first effective base URI; author HTML cannot replace it.
- Source ranges, document IDs, file paths, URLs, and IPC payloads are untrusted at boundaries and runtime validated.
- Filesystem operations remain root-scoped and path-traversal protected.
- Tokens, credentials, and remote secrets never cross into the editor webview, projection, logs, snapshots, diagnostics, or acceptance artifacts.
- Security protections are not deleted merely because the surrounding transport changes; equivalent or stronger protection must exist at the new boundary.

### D13 — Resource and performance limits

- Rich mode supports files up to 2 MiB. Larger files open in source mode with a specific diagnostic.
- Projection creation must cap:
  - projected block count at 10,000;
  - individual rendered inactive HTML payload at 1 MiB;
  - aggregate generated/plugin view HTML at 8 MiB per document.
- Exceeding a cap fails closed to source mode or a safe placeholder; source remains editable.
- No parser or projection path may recurse without an existing parser bound or explicit depth guard.
- P3 performance gates include 25 KiB, 100 KiB, 250 KiB, and 1 MiB files.
- On the project’s CI reference runner, repeated ordinary typing in a 250 KiB document must maintain p95 edit-to-paint below 100 ms after warm-up.
- Performance failures are not fixed by skipping source validation or weakening safety.

### D14 — Diagnostics and failure taxonomy

Required stable diagnostic categories:

- `EDITOR_STALE_EDIT`
- `EDITOR_INVALID_RANGE`
- `EDITOR_READONLY`
- `EDITOR_FILE_TOO_LARGE`
- `EDITOR_UNSUPPORTED_PROJECTION`
- `EDITOR_PROJECTION_LIMIT`
- `EDITOR_PLUGIN_UNTRUSTED`
- `EDITOR_PLUGIN_LOAD_FAILED`
- `EDITOR_CUSTOM_VIEW_UNAVAILABLE`
- `EDITOR_HOST_DISCONNECTED`
- `EDITOR_EXTERNAL_REPLACEMENT`

Rules:

- User-facing messages state the safe next action.
- Unsupported rich behavior falls back to source mode rather than silently degrading source.
- Internal errors retain causes.
- Generic “failed” errors at a boundary are a confirmed review finding unless no more specific classification is possible.
- Diagnostics contain document-relative identifiers, not secrets or unrestricted absolute paths in user-visible output.

### D15 — Observability and acceptance evidence

- Each editor session has a host-local correlation ID and document version.
- Development logs may record:
  - mount/dispose;
  - source version;
  - accepted/rejected edit reason;
  - projection fallback reason;
  - plugin trust/load state;
  - package/fork version.
- Do not log document text by default.
- Metrics are local diagnostic counters unless a separate telemetry decision is approved.
- Every deletion claim requires search proof, dependency proof, and passing behavior tests.
- Every run records exact commands, exit codes, test counts, base SHA, head SHA, confirmed findings, and advisories.

---

## Success criteria

The implementation is complete only when all applicable criteria are satisfied and evidenced.

1. The work branch is created from the recorded post-`0.10.2` `main` baseline, and `release/0.11.0` was already synchronized with that baseline before feature commits.
2. The current tree contains no ProseMirror, Tiptap, or Milkdown dependency or production import.
3. Opening and closing supported Markdown in source or rich mode changes zero bytes.
4. An accepted rich-editor edit changes only its explicit source range.
5. Stale, invalid, untrusted, oversized, or ambiguous rich edits fail closed without changing source.
6. Desktop and VS Code use the same framework-free editor mount and source-edit contract.
7. Gutterpress layout markers, attributes, images, links, tables, raw HTML, generated views, and representative plugin regions have tested rich/source behavior.
8. Generated content is visible where required but has no path into source.
9. Desktop source and rich modes share one document session and persistence state.
10. VS Code custom editor uses `TextDocument`, `WorkspaceEdit`, and native undo/redo, and respects workspace trust.
11. CodeMirror remains the source/code editor and continues to support existing source workflows.
12. Paginated preview is read-only and remains the print/layout authority.
13. Preview editing protocol, `InlineEditController`, source mutation bridge, and `CommitEngine` are removed after parity.
14. Dormant desktop PWA implementation and its dead-code exemptions are removed.
15. Broad platform access is replaced by narrow capabilities at feature boundaries.
16. Electron request/reply operations use typed IPC only; the local adapter-node server, API route tree, and typed fetch client are removed.
17. Desktop renderer builds statically and packaged Electron smoke passes.
18. `+page.svelte` and Electron `main.ts` are composition roots rather than domain workflow owners.
19. Public Gutterpress project, CLI, build, preview, and publish behavior remains compatible.
20. CI enforces layer imports, generated-file hygiene, dead code, package exports, render purity, and required interaction tests.
21. Architecture, ADRs, extension documentation, contributor guidance, changelog, and release notes match the final code.
22. The deletion ledger proves a net reduction in runtime concepts and modules and a non-positive net production LOC result for the combined simplification phases P4–P6.
23. Real Gutterpress books still build and preview with no unapproved semantic or visual regression.
24. Final acceptance contains no unevidenced PASS result.

### Acceptance evidence matrix

| ID | Acceptance criterion | Owning phase | Required evidence | Final status |
|---|---|---:|---|---|
| AC-01 | Post-release branch baseline verified | P0a | Recorded `main` SHA, `release/0.11.0` equality check, and work-branch ancestry proof | Pending |
| AC-02 | No ProseMirror-family dependency | P0/P7 | Lockfile/package/import search | Pending |
| AC-03 | Exact no-edit byte identity | P2/P3 | Corpus and real-book byte tests | Pending |
| AC-04 | Explicit edit locality | P2/P3 | Source diff tests and randomized range cases | Pending |
| AC-05 | Stale/invalid edits fail closed | P1/P3 | Host contract tests | Pending |
| AC-06 | Shared desktop/VS Code editor mount | P3 | Package import graph and integration tests | Pending |
| AC-07 | Gutterpress projection coverage | P2 | Fixture matrix and diagnostics | Pending |
| AC-08 | Generated content cannot serialize | P2 | Negative source-path tests | Pending |
| AC-09 | Desktop document-session integration | P3a | Source/rich switch and persistence tests | Pending |
| AC-10 | VS Code host integration and trust | P3c | Extension-host/webview tests | Pending |
| AC-11 | Authoring interaction parity | P3b/P3d | Packaged interaction suite | Pending |
| AC-12 | Preview remains print authority | P3/P4 | Preview/PDF and navigation tests | Pending |
| AC-13 | Preview editing deleted | P4 | Search proof and removed tests/protocol | Pending |
| AC-14 | Dormant PWA deleted | P5a | File/dependency/search proof | Pending |
| AC-15 | Narrow capabilities replace Platform | P5b | Consumer inventory and import proof | Pending |
| AC-16 | HTTP transport deleted | P5c/P5d | Route/client/server search and packaged smoke | Pending |
| AC-17 | Composition roots reduced | P6 | Responsibility review and module tests | Pending |
| AC-18 | Public compatibility preserved | All | CLI/API/build/preview/publish gates | Pending |
| AC-19 | Architecture CI active | P0b/P6 | CI workflow and deliberate-failure proof | Pending |
| AC-20 | Net complexity reduced | P7 | Final deletion ledger and measured diff | Pending |
| AC-21 | Real-book regression gate green | P3/P7 | User guide, advanced book, field guide evidence | Pending |
| AC-22 | Documentation complete | P7 | Doc link and example lint | Pending |
| AC-23 | Security boundaries preserved | P2/P3/P5 | CSP, trust, IPC validation, secret scan tests | Pending |
| AC-24 | Performance budgets met | P3d | Recorded benchmark results | Pending |

---

## Orchestration

### Execution model

Use a repeated, bounded implementation cycle for each run:

```text
SPECIFICATION
  Senior design agent or lead writes the run specification and behavior table.
  The specification includes relevant binding decisions and lane ownership.
  Integrator commits the specification.

TEST AUTHORING
  Implementation agents fan out across disjoint test lanes.
  Tests characterize current behavior or fail for the intended missing behavior.
  Lane agents do not commit.
  Integrator combines and commits the tests.

INDEPENDENT TEST REVIEW
  A reviewer verifies that tests assert the intended contract.
  For behavior-change tests, a null implementation must not pass.
  For characterization tests, an unintended later change must trip a pinned assertion.
  Blocking defects abort the run before implementation.

IMPLEMENTATION
  Implementation agents fan out across disjoint production-code lanes.
  They may not weaken, delete, or rewrite approved tests.
  The implementation base SHA is recorded before work begins.
  Integrator combines lanes and commits a pre-review milestone.

ADVERSARIAL CODE REVIEW
  A senior reviewer examines `base..HEAD`, not isolated files.
  Findings are classified as CONFIRMED or ADVISORY.
  Each confirmed-finding repair round receives its own fix commit.
  Review is bounded to three rounds.

GATE
  A report-only agent or integrator runs the full required verification suite.
  The gate records exact commands, exit status, counts, timeouts, and failures.
  The gate does not edit files.

CLOSE-OUT
  Integrator updates the review log, changelog, decision records,
  acceptance evidence, and deletion ledger.
  Integrator commits and pushes according to the push policy.
```

### Roles

| Role | Responsibility | May edit tests? | May commit? |
|---|---|---:|---:|
| Plan owner/orchestrator | Owns sequence, resolves blocks, approves re-plans, reports checkpoints | No routine edits | No, unless also integrator |
| Specification agent | Writes run specification, behavior table, and lane map | Spec artifacts only | No |
| Test lane agent | Adds characterization or contract tests in assigned files | Yes, assigned files only | No |
| Test reviewer | Reviews test strength and false-positive risk | No | No |
| Implementation lane agent | Implements assigned production changes | No | No |
| Code reviewer | Reviews complete run diff adversarially | No | No |
| Integrator | Combines lanes, resolves conflicts, formats, validates, commits, pushes | Only approved review fixes | Yes |
| Gate agent | Runs and reports verification | No | No |
| Security reviewer | Reviews CSP, trust, IPC, path, and secret boundaries where assigned | No | No |
| Accessibility reviewer | Reviews keyboard, screen reader, IME, focus, and pointer behavior in P3d | No | No |

### Structured run result

Every run returns a consistently structured result:

```json
{
  "status": "complete | blocked | gate-failed",
  "baseSha": "recorded implementation base",
  "headSha": "integrated head",
  "history": [],
  "confirmedFindings": [],
  "advisories": [],
  "gate": {
    "commands": [],
    "passed": false
  },
  "acceptanceUpdates": [],
  "deletionLedgerUpdates": [],
  "checkpointSummary": ""
}
```

### Lane rules

- Lanes may read any relevant file but write only explicitly assigned paths.
- Shared hot files are assigned to one lane or handled sequentially in a separate run.
- A signature change and all production callers land in the same commit.
- A public contract change lands with types, runtime validation, tests, documentation, and compatibility notes.
- Mechanical file moves and fixture sweeps are isolated from semantic changes.
- Test and implementation lanes do not edit the same files concurrently.
- Only the integrator resolves conflicts or broadens write ownership.
- No lane may create a framework, compatibility path, public feature, or dependency not named in the run specification.
- No lane may add a new desktop HTTP route during P5.
- No lane may introduce ProseMirror-family dependencies.
- Deletion runs may not delete safety tests until replacement behavior tests are already green.

### Commit protocol

Use conventional commits with a phase scope. Do not mention agent or model names.

Typical sequence:

1. `docs(pN): specify <run purpose>`
2. `test(pN): pin <behavior or contract>`
3. `refactor(pN): establish <boundary>` for mechanical extraction
4. `feat(pN): implement <capability>` or `fix(pN): correct <defect>`
5. `fix(pN): address review findings` for each review round
6. `docs(pN): close out <run>`

Rules:

- Record the implementation base SHA before production edits.
- Commit before review so the reviewer has a stable milestone diff.
- Commit after each review-and-fix cycle.
- Run the fast check before every commit-producing integration step.
- Push every integrator commit after the fast check passes.
- Do not squash away implementation and review-fix distinctions before stakeholder review.
- One deletion family per commit unless inseparable by compilation.
- Commit bodies for deletion runs record files, production LOC, test LOC, dependency changes, and test-floor rationale.

### Review protocol

The independent code review must examine:

- Full run diff from the recorded base SHA.
- Whether behavior matches the specification and binding decisions.
- Hidden alternate paths that bypass source-version validation or fail-open behavior.
- All callers and consumers of changed contracts.
- Cross-host substitutability of desktop and VS Code adapters.
- Webview and IPC trust boundaries.
- External edits, file switches, disposal, cancellation, and race windows.
- Public compatibility and diagnostic contracts.
- Whether complexity was added without current capability value.
- Whether tests can pass without the intended implementation.
- Whether deletion claims are proven by search, dependency analysis, and test results.
- Whether source bytes can change outside an explicit edit.
- Whether generated or rendered HTML can reach source.
- Whether package import direction matches D4.

Review outcome rules:

- **CONFIRMED:** Must be fixed before the gate.
- **ADVISORY:** Recorded in the run review log; may be deferred with rationale.
- More than three repair rounds means the run is too broad or the design is unstable. Stop and re-plan.

### Checkpoint protocol

Checkpoints occur after:

1. **Checkpoint A:** P0 through P1c — baseline, guards, contracts, package decision, document session.
2. **Checkpoint B:** P2 through P3d — shared editor, projection, desktop, extension, interaction parity.
3. **Checkpoint C:** P4 through P5d — preview/PWA/transport deletion.
4. **Checkpoint D:** P6 — composition and package consolidation.
5. **Final:** P7 acceptance and release readiness.

At each checkpoint, report:

- Completed runs and commit SHAs.
- User-visible or contract-level behavior now present.
- Confirmed findings fixed during review.
- Remaining advisories and explicit deferrals.
- Gate commands, exit status, and test counts.
- Acceptance matrix changes.
- Deletion ledger changes and current net effect.
- Any deviation from the original plan.
- Next run group and any stop condition.

Pause only if the stakeholder has requested a pause. Otherwise continue.

### Stop and re-plan conditions

Stop immediately when:

- A run returns `blocked` or `gate-failed`.
- Review exceeds three repair rounds.
- Exploration proves a binding decision false or impossible.
- `@vscode/markdown-editor` cannot be adapted even with the permitted minimal generic fork.
- A source edit can change bytes outside its explicit range.
- A required plugin projection cannot be mapped safely and no source fallback exists.
- A migration cannot preserve equivalent boundary validation.
- Public project or CLI compatibility exceeds approved scope.
- Two lanes require overlapping edits to a hot file that cannot be sequenced.
- A broad regression invalidates the run decomposition.
- P4 deletion is attempted before P3 parity is green.
- P5 transport deletion is attempted before all corresponding route callers are migrated.
- Net production complexity grows through P4–P6 without an accepted, evidenced reason.

Do not repeat the same failing work plan unchanged. Narrow the run, split a lane, amend a decision, or redesign the boundary.

---

## Run decomposition

### P0 — Characterize the post-release baseline and install architectural guardrails

#### P0a — Execution baseline verification and record

**Purpose:** Record the exact post-release execution base and reproducible current behavior before feature or deletion work. Branch synchronization is a precondition, not implementation work.

**Lane A — Baseline and repository inventory**

- Verify `0.10.2` has been released from `main`.
- Record the exact `origin/main` baseline SHA.
- Verify `origin/release/0.11.0` resolves to that same SHA.
- Verify `feature/source-first-rich-editor-architecture` was created from that `origin/main` baseline.
- Record package graph, scripts, route count, IPC handler count, tracked generated files, production LOC, test LOC, and dependency inventory.
- Write only: `docs/plans/source-first-editor/baseline.md`.

**Lane B — Editor and mutation characterization**

- Characterize CodeMirror source behavior, `EditorBuffer`, external changes, autosave, recovery, source ranges, inline preview editing, context-menu mutations, and `CommitEngine`.
- Record every preview mutation caller and protocol message.
- Write only: `packages/desktop/tests/editor/**`, `packages/desktop/tests/preview-*`, and baseline docs.

**Lane C — Platform and transport characterization**

- Inventory `Platform` consumers, WebAdapter/PWA files, API routes, `api.ts` methods, preload methods, IPC handlers, adapter-node server responsibilities, and duplicate DTOs.
- Write only: tests and `docs/plans/source-first-editor/platform-inventory.md`.

**Expected commits**

- `docs(p0): record post-release execution baseline`
- `test(p0): characterize editor mutation paths`
- `docs(p0): inventory platform and transport boundaries`

**Review dimensions**

- Is every count generated from the recorded post-release `main` baseline?
- Are feature callers distinguished from dead or test-only callers?
- Does the baseline record include exact commands?
- Can later deletion prove that every inventoried caller moved or disappeared?

**Gate additions**

```bash
BASE_SHA="$(git rev-parse origin/main)"
test "$(git rev-parse origin/release/0.11.0)" = "$BASE_SHA"
git merge-base --is-ancestor "$BASE_SHA" HEAD
bun run typecheck
bun run test
```

**Exit criteria**

- [ ] The post-release `main` baseline is recorded and work-branch ancestry is proven.
- [ ] `release/0.11.0` matches the recorded baseline before feature work.
- [ ] Baseline behavior is reproducible.
- [ ] Mutation caller inventory is complete.
- [ ] Platform and transport inventories are complete.
- [ ] Initial deletion ledger has measured counts.

#### P0b — Hygiene and architecture fitness functions

**Purpose:** Prevent new violations while the architecture changes.

**Lane A — Generated and stale artifact hygiene**

- Remove tracked `.svelte-kit`, `build`, `out`, or other generated artifacts found by inventory.
- Correct `.gitignore`.
- Add a generated-file CI check.
- Write only: ignore files, generated-file check, CI wiring.

**Lane B — Dependency boundary checks**

- Add import checks for D4 boundaries.
- Add a ProseMirror-family dependency/import ban.
- Add a “no new desktop HTTP route during P5” ratchet.
- Add public export and browser-purity checks.
- Write only: `tools/check-architecture*.mjs`, package scripts, CI.

**Lane C — Dead-code enforcement**

- Tighten Knip configuration.
- Remove obsolete exemptions that can be removed without P5.
- Add a deliberate-failure proof for each new architecture check.
- Write only: `knip.jsonc`, test fixtures for tools, CI docs.

**Expected commits**

- `chore(p0): remove tracked generated output`
- `test(p0): enforce architecture boundaries`
- `chore(p0): ratchet dead-code checks`

**Checkpoint A status:** Continue through P1 before reporting.

---

### P1 — Establish the shared source-edit foundation

#### P1a — Shared editor contracts and package skeleton

**Purpose:** Create the smallest portable core used by desktop, VS Code, and tests.

**Lane A — Package and protocol**

- Create `packages/editor`.
- Add `DocumentSnapshot`, `SourceEdit`, `ApplyEditResult`, diagnostics, `EditorDocumentHost`, and `EditorProjectHost`.
- Add runtime validators for cross-process/webview messages.
- Write only: `packages/editor/src/core/**`, package config, tests.

**Lane B — Framework-free web mount shell**

- Add a minimal mount/dispose API with no Svelte, Electron, VS Code, or Node dependency.
- Add memory-host integration tests.
- Do not implement Gutterpress projections yet.
- Write only: `packages/editor/src/web/**`, tests.

**Lane C — VS Code extension skeleton**

- Create `packages/vscode-extension`.
- Register a no-op/standard-Markdown custom text editor using the shared protocol.
- Add extension build and test harness.
- Write only: `packages/vscode-extension/**`.

**Review dimensions**

- Is every interface at a real host boundary?
- Is any abstraction speculative?
- Does the shared package remain browser-safe?
- Can the memory host prove stale, readonly, invalid-range, and external-replacement behavior?

#### P1b — `@vscode/markdown-editor` compatibility and fork gate

**Purpose:** Prove the package can serve as the rich editor core or create the permitted minimal generic fork.

**Sequential ownership:** One implementation lane owns the adapter hot files.

**Lane A — Direct package adapter**

- Exact-pin `@vscode/markdown-editor@0.0.2-84`.
- Implement the sole package adapter.
- Prove standard Markdown source editing, external replacement, disposal, host callbacks, and undo/redo delegation.
- Write only: `packages/editor/src/vscode-adapter/**`, package manifest, tests.

**Lane B — Input and accessibility spike**

- Test keyboard navigation, clipboard, selection, IME/composition, screen-reader semantics, pointer selection, and iframe/webview mounting.
- Write only: browser integration tests and fixtures.

**Lane C — Custom-view capability spike**

- Implement one synthetic projected block with inactive HTML and active source-aware editing.
- Test selection crossing, focus entry/exit, and source locality.
- Write only: test-only custom block provider and integration tests.

**Decision gate**

- If every mandatory case in D5 passes, direct package consumption is locked.
- If a generic custom-block/view hook is the only blocker, create the minimal internal fork and repeat the exact suite.
- If the fork requires Gutterpress-specific syntax or broad upstream rewrites, stop and re-plan.

**Expected commits**

- `test(p1): define vscode editor compatibility contract`
- `feat(p1): adapt vscode markdown editor`
- or, when gate requires it:
- `chore(p1): vendor minimal vscode markdown editor fork`
- `docs(p1): record package adoption decision`

#### P1c — Pure document session and desktop host adapter

**Purpose:** Separate authoritative source lifecycle from Svelte presentation and filesystem infrastructure.

**Lane A — Pure document session**

- Extract a TypeScript state machine for snapshot version, dirty/clean/saving/error state, external replacement, accepted edit, flush intent, and file switch.
- Preserve existing autosave, recovery, and external-conflict behavior.
- Write only: `packages/desktop/src/lib/document-session/**`, unit tests.

**Lane B — Desktop document host**

- Adapt the pure session to `EditorDocumentHost`.
- Keep filesystem, recovery, autosave, and host APIs outside `packages/editor`.
- Write only: `packages/desktop/src/lib/editor-host/**`, tests.

**Lane C — Svelte adapter and CodeMirror bridge**

- Make current Svelte buffer state a thin reactive adapter.
- Move editor command types out of Svelte components into `packages/editor/core`.
- Preserve CodeMirror behavior.
- Write only: buffer/store adapter, CodeMirror wrapper, component type imports.

**Review dimensions**

- Is the state machine independent of Svelte and I/O?
- Are existing conflict and recovery semantics pinned?
- Did source remain byte-identical?
- Are mode-switch undo boundaries explicit?

**Checkpoint A**

Report P0–P1 results, direct-versus-fork decision, baseline gates, and new package graph.

---

### P2 — Implement Gutterpress-aware rich editing

#### P2a — Standard Markdown rich editor

**Purpose:** Deliver a complete source-first rich editor for standard Markdown before custom dialect work.

**Lane A — Model/view/controller integration**

- Implement headings, paragraphs, lists, blockquotes, emphasis, strong, strike, links, images, code, tables, thematic breaks, copy, cut, paste, and selection.
- All commands emit source edits.
- Write only: `packages/editor/src/web/standard/**`.

**Lane B — Command model and toolbar integration**

- Define shared editor command union.
- Add command capability queries and diagnostics.
- Add source-editor command adapter where current CodeMirror toolbar actions exist.
- Write only: `packages/editor/src/core/commands.ts`, desktop command adapters, tests.

**Lane C — Corpus and locality tests**

- Add byte-identity and explicit-range locality tests across standard Markdown variants, including non-normalized valid Markdown.
- Add randomized edit-range tests.
- Write only: editor fixtures and tests.

**Exit criteria**

- [ ] No-edit byte identity is green.
- [ ] Standard edit locality is green.
- [ ] No serializer or normalizer is in the edit path.
- [ ] Unsupported cases fall back safely.

#### P2b — Sparse Gutterpress projection

**Purpose:** Add Gutterpress syntax awareness without introducing a second full Markdown model.

**Lane A — Browser-safe projection builder**

- Add `createEditorProjection()` under the browser-safe render boundary or a narrowly exported sibling that remains Node-free.
- Cover core layout markers, attributes, raw HTML, generated content, and source ranges.
- Write only: `packages/cli/src/lib/markdown/**`, `packages/cli/src/render.ts`, focused tests.

**Lane B — Projection consumers**

- Map projected blocks and generated views into editor view data.
- Add inactive and active state behavior.
- Generated views remain read-only.
- Write only: `packages/editor/src/gutterpress/**`.

**Lane C — Diagnostics and limits**

- Implement D13 caps and D14 diagnostics.
- Add malformed, ambiguous, oversized, and limit fixtures.
- Write only: projection diagnostics, tests, docs.

**Review dimensions**

- Is every writable projected block backed by exact source?
- Is source origin inferred anywhere?
- Can generated HTML reach source?
- Does the projection duplicate standard Markdown structure unnecessarily?

#### P2c — Project plugins, origin, and trusted rendering

**Purpose:** Support representative project-plugin regions safely and port the useful lessons from PR 158.

**Lane A — Host-side project plugin loading**

- Resolve project config and plugins through existing trusted host APIs.
- Produce projection input without executing plugin code in the webview.
- Write only: CLI/project host services and adapters.

**Lane B — Transform-origin mapping**

- Implement the smallest origin mechanism required to map consumed-and-generated plugin regions to authored source.
- Port selected PR 158 adversarial fixtures manually.
- Ambiguity produces a refusal, not inferred source.
- Write only: origin module, focused fixtures, tests.

**Lane C — Inactive/active plugin views**

- Inactive state renders safe plugin-produced HTML and view attributes.
- Active state edits proven source-aware interiors.
- Unsupported interiors show source-mode action.
- Write only: editor custom views and integration tests.

**Security review required**

- Plugin execution boundary.
- CSP and sanitization.
- Base URI behavior.
- Raw HTML handling.
- Secret isolation.

**Checkpoint:** Continue to P3 before stakeholder report.

---

### P3 — Integrate desktop and VS Code, then reach product parity

#### P3a — Desktop source/rich mode integration

**Purpose:** Put the shared editor into the desktop over the existing authoritative document session.

**Lane A — Rich editor Svelte shell**

- Add a thin Svelte wrapper around the framework-free mount.
- Host owns iframe/document creation, CSP, base URI, and project CSS injection.
- Write only: new rich editor component and desktop adapter.

**Lane B — Workspace mode and persistence**

- Add source/rich mode selection.
- Mount only one editing surface at a time.
- Preserve source, dirty state, autosave, recovery, file switching, external changes, and focus.
- Write only: editor workspace controller and tests.

**Lane C — Dynamic loading and bundle hygiene**

- Dynamically load rich editor code.
- Keep CodeMirror/source paths unaffected when rich mode is unused.
- Add bundle-size and render-purity gates.
- Write only: build config, lazy loader, tests.

#### P3b — Authoring parity and interaction design

**Purpose:** Make rich mode a credible primary authoring surface before deleting preview editing.

Required capabilities:

- keyboard and toolbar formatting;
- slash command insertion;
- headings, lists, blockquotes, code, rules, tables;
- image insertion, selection, alt text, source, sizing, position, and Gutterpress classes;
- link insertion and editing;
- layout marker insertion and manipulation;
- block movement by keyboard and pointer;
- plugin-region activation and source fallback;
- selected-text commands and snippets;
- source reveal;
- clear unsupported-state messaging;
- mouse, keyboard-only, and screen-reader paths.

**Lane A — Commands and chrome**

- Shared toolbar/slash/bubble command UI.
- No Svelte-defined core command types.
- Write only: editor web UI and desktop wrapper.

**Lane B — Images, links, and assets**

- Reuse one image/link vocabulary implementation.
- Resolve assets through `EditorProjectHost`.
- Write only: shared editor asset modules and host adapters.

**Lane C — Structural manipulation**

- Implement block movement as explicit source-range replacement.
- Preserve marker and plugin boundaries.
- Write only: source commands and tests.

#### P3c — VS Code extension implementation

**Purpose:** Prove the same editor core works as a maintained VS Code custom text editor.

**Lane A — Custom text editor provider**

- Register `gutterpress.markdownEditor`.
- Use `TextDocument`, `WorkspaceEdit`, native undo/redo, dirty state, and external-change notifications.
- Write only: extension host provider and tests.

**Lane B — Project integration**

- Detect Gutterpress projects.
- Resolve manifest, CSS, assets, and plugins under workspace trust.
- Add build, preview, and open-source commands.
- Write only: extension project services and command registration.

**Lane C — Webview**

- Bundle the same shared editor mount.
- No Node or filesystem imports.
- Add CSP, nonce, asset URI, message validation, and disposal tests.
- Write only: webview entry and integration tests.

#### P3d — Packaged interaction, accessibility, performance, and resilience

**Purpose:** Prove the product bar through real interaction, not only parser and model tests.

Required packaged/E2E scenarios:

- type ordinary text;
- format selection;
- insert and modify image;
- create/edit table;
- use slash menu;
- move block by keyboard and pointer;
- activate/deactivate plugin region;
- edit near generated content;
- paste rich/plain text;
- IME composition;
- screen-reader landmarks and labels;
- external file change while active;
- stale source edit rejection;
- source/rich mode switch;
- file switch;
- undo/redo within current mode;
- oversized file source fallback;
- untrusted VS Code workspace fallback;
- dispose/remount without leaked listeners;
- 25 KiB, 100 KiB, 250 KiB, and 1 MiB performance runs.

**Parity gate before P4**

The following must be green:

1. All common authoring actions formerly reachable through preview mutation are available in source or rich mode.
2. Image/link/layout context-menu source changes have replacement editor commands.
3. Real user-guide and plugin-book chapters can be edited without byte drift.
4. Preview navigation still works.
5. No stakeholder-designated blocker remains.

**Checkpoint B**

Report editor/fork decision, desktop and VS Code behavior, parity evidence, security review, accessibility review, performance results, and explicit approval to enter deletion phases.

---

### P4 — Delete redundant preview editing and mutation complexity

#### P4a — Remove in-flow preview editing

**Purpose:** Make paginated preview read-only.

**Lane A — Preview runtime deletion**

- Remove in-flow `contenteditable`, begin/end block-edit commands, block-edit protocol messages, and preview edit lifecycle.
- Preserve click-to-reveal, source navigation, copy, link/image opening, diagnostics, and page controls.
- Write only: preview viewer/shell/client code and tests.

**Lane B — SPA controller deletion**

- Delete `InlineEditController` and its wiring.
- Remove preview edit state and UI affordances.
- Write only: desktop route/controller/component code and tests.

**Lane C — Documentation and behavior matrix**

- Update preview contracts and docs.
- Replace preview-edit tests with read-only and navigation tests.
- Write only: docs and tests.

#### P4b — Remove preview mutation commit and rewrite paths

**Purpose:** Delete source-mutation infrastructure that has no callers after P4a.

**Lane A — Commit engine deletion**

- Delete `CommitEngine`, commit patch types, generation counter, clean-buffer gates, and dedicated tests.
- Preserve any generic source-range utilities still used by navigation or diagnostics.
- Write only: editor mutation files and tests.

**Lane B — Context-menu mutation deletion**

- Remove preview-specific image/link Markdown scanners and source rewrite actions.
- Keep read-only actions.
- Ensure equivalent editor commands are already covered.
- Write only: context-menu controller/action files and tests.

**Lane C — Protocol and source-metadata simplification**

- Remove source metadata emitted only for preview mutation.
- Retain the minimum for navigation, diagnostics, and source reveal.
- Regenerate bundles and update protocol versions.
- Write only: renderer metadata, protocol types, generated bundles, tests.

**Required search proofs**

- `InlineEditController` → zero occurrences.
- `blockEditRequested` and `blockEditFinished` → zero occurrences.
- `beginBlockEdit` and `endBlockEdit` → zero occurrences.
- `CommitEngine` and `commitRangePatch` → zero occurrences.
- Preview mutation commands → zero occurrences.
- Preview `contenteditable` authoring path → zero occurrences.

#### P4c — Superseded editor history closure

- Close PR 158 as superseded with links to the new plan and implementation branch.
- Preserve its branch/tag as research history.
- Record which fixtures and lessons were manually ported.
- Confirm zero ProseMirror-family dependency or import.
- Resolve obsolete rich-editor proposal documents as `SUPERSEDED`.

**Checkpoint:** Continue to P5 after P4 gate is green.

---

### P5 — Remove dormant platform and duplicate transport architecture

#### P5a — Delete dormant PWA implementation

**Purpose:** Remove an inactive product host from the Electron package.

**Lane A — Web platform deletion**

- Delete `web-adapter.ts`, `web-fs.ts`, `web-store.ts`, PWA-only service worker code, browser-only stores, and tests.
- Remove `WebAdapter` fallback from platform selection.
- `vite dev` without Electron must fail clearly or run an explicitly named mock host; it must not silently select a partial product.
- Write only: platform web files, platform index, tests.

**Lane B — Build and dependency cleanup**

- Remove PWA-only dependencies, static viewer fallback, duplicate viewer bundle, dead-code exemptions, and PWA build comments.
- Write only: manifests, build scripts, static assets, Knip config.

**Lane C — Documentation**

- Replace “future PWA inside desktop” guidance with “future web host is a separate package consuming editor and render.”
- Write only: architecture docs and ADRs.

**Required search proofs**

- `WebAdapter` → zero runtime occurrences.
- `web-fs` and `web-store` → zero occurrences.
- PWA-only service worker registration → zero occurrences.
- duplicate static viewer bundle path → zero generated copy unless required by another proven host.

#### P5b — Replace broad `Platform` with narrow capabilities

**Purpose:** Remove the service locator and make dependencies explicit.

**Lane A — Consumer inventory and interfaces**

- Group current `Platform` methods by bounded context.
- Define narrow capabilities only where multiple current consumers or a real I/O boundary justify them.
- Write only: feature-owned contracts and inventory docs.

**Lane B — Renderer feature migration**

- Move feature controllers from `getPlatform()` to injected capabilities.
- No global platform instance in new code.
- Write only: feature controller/service files in assigned contexts.

**Lane C — Contract deletion**

- Shrink and ultimately delete broad `Platform`, `HostServices`, and seam re-export patterns after final caller migration.
- Keep shared IPC DTOs only where truly cross-process.
- Write only: platform contract/index/shared type files and tests.

**Review dimensions**

- Does each interface have a real boundary and current consumer?
- Did the change reduce navigation and fake size?
- Are DTOs located with their owning capability?
- Did any generic “manager/provider” layer merely forward calls?

#### P5c — Migrate desktop HTTP APIs to typed IPC

This work is sequential by bounded context. Each subrun moves all callers, handlers, runtime validation, tests, and error semantics for one group, then deletes the corresponding routes and client methods.

##### P5c1 — Files, dialogs, shell, logs, settings

- Migrate simple request/reply operations to typed IPC.
- Reuse current root/path validation.
- Delete corresponding `+server.ts` routes and `api.ts` methods.

##### P5c2 — Project configuration, templates, snippets, media, plugins, themes, history

- Migrate project-local request/reply operations.
- Keep project plugin execution in the host.
- Delete corresponding routes and DTO duplication.

##### P5c3 — Remote, synchronization, publishing, and credentials

- Migrate request/reply operations while preserving push streams and secret isolation.
- Keep tokens in host storage.
- Preserve checkout journals and recovery semantics.
- Delete corresponding routes.

##### P5c4 — Build, preview, updater, recovery, and remaining routes

- Consolidate remaining operations behind IPC.
- Preserve existing build/preview progress and cancellation channels.
- Remove final route consumers.

For every subrun:

- Runtime validate request and response payloads.
- Preserve typed diagnostic categories.
- Test unauthorized/path-invalid/host-disconnected cases.
- Delete route and client code in the same run.
- Update `DESKTOP_API` exactly once per subrun only when bridge surface changes.

#### P5d — Static desktop renderer and local server deletion

**Purpose:** Remove adapter-node and the internal HTTP application server after route count reaches zero.

**Carried over from the P5c3+P5c4 repair round (round 1):** these four
still-accurate descriptions of the local server this phase deletes were
explicitly left untouched by that repair (route count reaching zero does not
make them wrong yet — the server they describe is still running) but flagged
so this phase's own sweep does not miss them:
`packages/desktop/electron/sveltekit-host.ts` (module header — the file
itself is Lane B's explicit deletion target, already named below),
`packages/desktop/vite.config.ts` (header comment describing the
adapter-node `fetch("/api/...")` architecture), `packages/desktop/electron/
server-bridge/fs-guard.ts` (header's `/api/fs/*` route-path framing —
Lane C's route-tree deletion should confirm whether this module's containment
logic is still consumed by the migrated `fs:*` IPC handlers, and reword or
fold the header accordingly), and `packages/desktop/README.md` (its
architecture diagram lines describing `fetch("/api/…")` as "the bulk" of the
renderer↔host surface, plus the neighboring `api.*` wrapper/`electron-adapter.ts`
description — both now historical once this phase's Lane C deletes `api.ts`).

**Lane A — Static build**

- Switch SvelteKit adapter to the smallest compatible static output.
- Preserve `app://` asset loading and Electron development workflow.
- Write only: Svelte config, Vite/Electron build config, package scripts.

**Lane B — Electron server deletion**

- Delete `sveltekit-host.ts`, loopback server startup, bearer token, proxy request builder, app-host validation tied only to the proxy, and server error page.
- Replace app loading with static `app://` resource serving.
- Write only: Electron host/protocol files and tests.

**Lane C — API client and route tree deletion**

- Delete `src/lib/api.ts`.
- Delete empty `src/routes/api/**`.
- Remove adapter-node dependency and route-only DTOs.
- Update packaged file list.
- Write only: client, routes, manifests, packaging.

**Required search proofs**

- `@sveltejs/adapter-node` → zero occurrences.
- `startSvelteKitServer` and `sveltekit-host` → zero occurrences.
- `/api/` desktop fetch calls → zero occurrences.
- `src/routes/api` → directory absent.
- `api.ts` typed fetch client → absent.
- loopback bearer token and proxy code → zero occurrences.
- packaged desktop still starts, edits, builds, previews, publishes, and updates.

**Checkpoint C**

Report deleted modules, route and IPC counts before/after, security equivalence, packaged smoke results, and net production LOC.

---

### P6 — Consolidate feature ownership and public architecture

#### P6a — Slim the desktop renderer composition root

**Purpose:** Make `+page.svelte` compose features instead of owning workflows.

Feature boundaries:

- project
- document/editor
- preview
- build/export
- media/assets
- publishing
- remote/sync
- settings/update
- diagnostics/problems

Rules:

- Each feature owns state, commands, narrow dependencies, UI, and tests.
- Cross-feature coordination goes through explicit orchestration in the composition root, not a global event bus.
- Do not create one class per file or generic controllers without cohesive policy.
- Extract only when the responsibility and owner are clear.

**Expected result**

- `+page.svelte` primarily instantiates services, coordinates top-level selection, and renders feature shells.
- Source mutation policy remains in document/editor feature.
- Build policy remains in build feature.
- Sync policy remains in remote/sync feature.

#### P6b — Slim Electron `main.ts`

**Purpose:** Restrict Electron main to lifecycle, windows, OS integration, security policy, and service composition.

- Extract application services by bounded context.
- Register typed IPC handlers from explicit modules.
- Keep process lifecycle and window ownership in `main.ts`.
- Preserve flush-before-close, second-instance, file-launch, update, and security behavior.
- No dependency-injection framework.

#### P6c — Public exports, architecture records, and contributor boundaries

- Add justified Gutterpress subpath exports.
- Add package export tests and tar/package-content checks.
- Update `docs/ARCHITECTURE.md`.
- Add or resolve ADRs:
  1. Source-first editor and sparse projection.
  2. Preview is read-only.
  3. Shared desktop/VS Code editor package.
  4. Future web product separation.
  5. Electron single-IPC transport.
  6. Narrow feature-owned capabilities.
- Add CODEOWNERS or documented ownership for editor, extension, renderer, and Electron boundaries.
- Remove stale ADR references or restore missing records when still authoritative.
- Move long historical comments to ADRs; retain concise code invariants.

**Checkpoint D**

Report module graph, composition-root reductions, public exports, architecture checks, and final pre-acceptance advisories.

---

### P7 — Decision-record close-out and final acceptance sweep

**Purpose:** Prove the agreed scope is complete and leave an auditable release-ready state.

### Close-out work

- Verify zero remnants of deleted editor, PWA, platform, HTTP, and proxy protocols.
- Resolve proposal records as `ACCEPTED`, `RESOLVED`, or `SUPERSEDED`.
- Cross-reference final ADRs.
- Complete the deletion ledger with measured before/after:
  - production LOC;
  - test LOC;
  - module/file count;
  - dependency count;
  - platform method count;
  - desktop HTTP route count;
  - IPC handler count;
  - preview protocol message count;
  - architecture-check count.
- Update acceptance matrix with implementation location and evidence.
- Update changelog and release notes.
- Run real-book and packaged-product sweeps.
- Record final commit SHAs.

### Final acceptance sweep

A report-only reviewer walks every criterion and records:

- criterion ID;
- implementation location;
- test or fixture evidence;
- search evidence where absence matters;
- gate command evidence;
- security evidence;
- performance evidence;
- final status: PASS, FAIL, or NOT APPLICABLE with rationale.

A criterion without evidence is not complete.

### Final outputs

- `docs/plans/source-first-editor/acceptance.md`
- `docs/plans/source-first-editor/deletion-ledger.md`
- `docs/architecture/source-first-editor.md`
- Accepted ADRs under `docs/adr/`
- `docs/vscode-extension.md`
- `CHANGELOG.md`
- `docs/releases/0.11.0.md`
- Final stakeholder wrap-up using the template at the end of this plan

---

## Per-run specification template

Create one specification at `docs/plans/source-first-editor/runs/<RUN-ID>.md` for every run.

```markdown
# <RUN ID> — <RUN NAME>

## Objective
One observable outcome.

## Allowed behavior changes
- Explicitly approved change.

## Behavior that must remain unchanged
- Source, public, security, or product invariant.

## Binding decisions
- D# — relevant excerpt.
- D# — relevant excerpt.

## Behavior table
| Case | Baseline | Required result | Diagnostic/state | Test owner |
|---|---|---|---|---|
| Case | Current result | Required result | Typed diagnostic or state | Lane |

## Lane ownership
| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | Paths | Other lane paths | Outcome |
| B | Paths | Other lane paths | Outcome |
| C | Paths | Other lane paths | Outcome |

## Caller and consumer inventory
- Caller or consumer and required co-update.

## Persistence and compatibility
- Source, storage, migration, or compatibility behavior.

## Security and trust
- Boundary, validation, CSP, plugin, path, and secret behavior.

## Determinism and resource limits
- Source versions, projection limits, file-size behavior, and performance budget.

## Test plan
- Characterization or failing contract test.
- Integration test.
- Interaction or race test.
- Negative/fail-closed test.

## Review dimensions
- Specific adversarial question.

## Gate
- `command`

## Review log
<!-- Append every review round, finding classification, disposition, and commit. -->
```

---

## Verification

### Every run

The integrator runs the fast check before each commit-producing step:

```bash
bun run typecheck
```

Add targeted tests for the owned package or files before committing.

The report-only full gate runs, as applicable:

```bash
bun run typecheck
bun run test
bun run knip

bun --cwd packages/cli run typecheck
bun --cwd packages/cli run typecheck:engine-browser
bun --cwd packages/cli run test
bun --cwd packages/cli run build
bun --cwd packages/cli run parity:gate

bun --cwd packages/desktop run check
bun --cwd packages/desktop run lint
bun --cwd packages/desktop run test
bun --cwd packages/desktop run build
bun --cwd packages/desktop run electron:build
bun --cwd packages/desktop run test:ui
```

New package gates added in P1:

```bash
bun --cwd packages/editor run typecheck
bun --cwd packages/editor run test
bun --cwd packages/editor run test:browser
bun --cwd packages/editor run check:browser-purity

bun --cwd packages/vscode-extension run typecheck
bun --cwd packages/vscode-extension run test
bun --cwd packages/vscode-extension run package
```

New packaged interaction gates added in P3:

```bash
bun --cwd packages/desktop run test:rich:packaged
bun --cwd packages/desktop run test:editor:interaction
bun --cwd packages/desktop run test:editor:accessibility
bun --cwd packages/desktop run perf:editor

bun --cwd packages/vscode-extension run test:integration
bun --cwd packages/vscode-extension run test:untrusted
```

Architecture and deletion gates:

```bash
bun run check:architecture
bun run check:generated-files
bun run check:package-exports
bun run check:no-prosemirror
bun run check:no-preview-editing
bun run check:no-desktop-pwa
bun run check:no-desktop-http
```

Release checks:

```bash
bun --cwd packages/desktop run dist:linux
bun --cwd packages/desktop run dist:win
bun --cwd packages/desktop run dist:mac
npm pack --dry-run --workspace packages/cli
```

Platform-specific distribution jobs may run in CI rather than one local machine. Record which runner produced each result.

Record exact commands, timeouts, sharding, test counts, and exit codes. Do not summarize a partially run gate as green.

### Contract co-updates

When a run changes a public or cross-process contract, update in the same run:

- Type/model/constants.
- Runtime validator.
- Producer and every consumer.
- Protocol or IPC version.
- Diagnostic contract.
- Contract tests.
- Public exports.
- Documentation examples.
- Changelog and release notes.
- Packaging manifest or required files.
- Stability declaration.

There is no parser/serializer co-update requirement for ordinary editor edits because D2 prohibits a semantic Markdown serializer in the edit path.

### Fixture families

| Fixture family | Added/updated in | Purpose |
|---|---:|---|
| Current editor/mutation baseline | P0 | Characterize current behavior and callers |
| Standard Markdown byte corpus | P2a | Exact no-edit identity and edit locality |
| Gutterpress layout fixtures | P2b | Marker, attribute, raw HTML, and generated views |
| Plugin-origin fixtures | P2c | Safe mapping and fail-closed ambiguity |
| Desktop session fixtures | P1c/P3a | Autosave, recovery, conflict, external change, mode switch |
| VS Code host fixtures | P3c | Workspace edits, trust, webview lifecycle |
| Interaction books | P3d | Human authoring behavior |
| Deletion search fixtures | P4/P5 | Ensure removed protocols cannot return |
| Transport contract fixtures | P5c | IPC validation and error parity |
| Real user guide/advanced book/field guide | P3/P7 | Product and render regression proof |

### Test floors

- Test floors may decrease only in the phase that deletes corresponding production capability or duplicate tests.
- Every reduction records exact count delta and deletion rationale.
- A lower floor without matching code/capability deletion is a confirmed finding.
- Mechanical fixture conversion must not silently reduce coverage.
- P4 removes preview-edit tests only after equivalent rich/source behavior tests are green.
- P5 removes HTTP route tests only after equivalent IPC contract tests are green.

### End-to-end scenario

The final acceptance sweep exercises:

1. Open a current Gutterpress project without changing any file.
2. Open a chapter in source mode and verify exact bytes.
3. Switch to rich mode and verify no byte change.
4. Edit ordinary text, formatting, a list, a table, a link, and an image.
5. Insert and edit Gutterpress layout markers.
6. Edit a supported plugin region and safely fall back for an unsupported region.
7. Verify generated content is visible but absent from source.
8. Trigger a stale edit and confirm refusal.
9. Trigger an external file change and confirm safe replacement/conflict behavior.
10. Switch files and modes without cross-file undo or source drift.
11. Build and preview the project; compare expected rendered output.
12. Confirm preview is read-only but source navigation works.
13. Open the same chapter through the VS Code extension.
14. Edit and undo through `WorkspaceEdit`.
15. Repeat in an untrusted workspace and verify plugins do not execute.
16. Package the desktop and VS Code extension.
17. Run the real-book regression set.
18. Confirm deleted protocols, PWA code, routes, and server are absent.

### Release/user actions before merge

- Run gated CI on Linux, Windows, and macOS.
- Run final packaged desktop smoke.
- Install the VS Code extension package into a clean VS Code profile.
- Review final advisories and deferred work.
- Review net-complexity ledger.
- Make explicit merge decision for `release/0.11.0`.

---

## Clean code and SOLID architecture guidance

### Clean code and domain design

- Prefer the smallest design that fully satisfies verified requirements.
- Apply Occam’s razor: choose fewer concepts, states, indirections, and failure modes.
- Apply YAGNI: do not add extension points, registries, factories, or compatibility layers for hypothetical future use.
- Apply DRY to duplicated knowledge and invariants, not merely similar-looking lines.
- Use the Rule of Three unless a real package or I/O boundary already justifies extraction.
- Prefer limited local duplication over a false shared abstraction.
- Make invalid states unrepresentable with precise tagged unions and explicit transitions.
- Use source, snapshot, edit, projection, host, and preview consistently.
- Keep pure computation separate from I/O.
- Pass required context explicitly.
- Fail closed at trust, source-mapping, IPC, and plugin boundaries.
- Validate at the earliest boundary with enough information and again at process boundaries.
- Do not normalize or serialize untouched author source.
- Make retries and external replacements deterministic.
- Bound size, depth, payload, and runtime cost.
- Prefer composition over inheritance.
- Prefer explicit state machines over scattered booleans.
- Keep modules cohesive with one primary reason to change.
- Keep public APIs smaller than internal APIs.
- Use specific diagnostics and preserve causes.
- Comments explain why, invariants, and non-obvious constraints.
- Move long history into ADRs.
- Delete dead code and compatibility branches as soon as replacement is proven.
- Optimize for debugging through document versions, typed errors, and explicit host boundaries.
- Test observable behavior and contracts.
- Keep fixtures minimal and named.
- Keep secrets out of logs, messages, snapshots, projections, and diagnostics.

### SOLID guidance

- **Single Responsibility:** parsing/render projection, editing, persistence, process transport, and presentation remain separate.
- **Open/Closed:** add a stable custom-view hook only because Gutterpress and standard Markdown are already two active variants; do not create a general plugin framework.
- **Liskov Substitution:** desktop, VS Code, and memory document hosts preserve edit preconditions, rejection reasons, version semantics, and replacement behavior.
- **Interface Segregation:** editor consumers depend only on document and project operations they use.
- **Dependency Inversion:** editor policy depends on narrow host contracts; host infrastructure depends inward on those contracts.

### Preferred patterns

- Functional core with imperative host shells.
- Ports and adapters at desktop, VS Code, filesystem, process, and webview boundaries.
- Tagged unions and exhaustive matching for diagnostics, projection kinds, and edit outcomes.
- Explicit orchestration for local workflows.
- Decision records for rejected ProseMirror, preview editing, PWA-in-desktop, and dual-transport designs.
- Modular monolith package structure.
- Source-derived projections that can be discarded and rebuilt.
- Contract tests shared by all host implementations.

### Patterns to avoid

- Generic manager, provider, strategy, or factory layers that only forward calls.
- Interfaces with one implementation and no real boundary.
- Service locators or global platform instances.
- Mode flags combining divergent hosts in one class.
- Generic ASTs that erase source and domain distinctions.
- Event buses for local linear workflows.
- Shared helpers that branch on caller identity.
- Compatibility shims without deletion phases.
- Exception swallowing and silent fallbacks.
- Mutable globals and ambient process state.
- Future-proof fields with no current consumer.
- A second parser or serializer that can rewrite source.
- UI-component-defined domain types.
- Multiple editing engines.

---

## Abstraction-versus-overengineering rubric

Before introducing a shared abstraction, interface, framework, registry, base class, or generalized configuration model:

### Hard veto

Do not introduce it when:

- There is one concrete use and no external boundary.
- Similarity is syntactic rather than semantic.
- It cannot be named in domain language.
- Callers still branch by implementation.
- It requires many flags or optional methods.
- No contract test describes substitutability.
- It anticipates an unapproved future feature.
- It increases concepts without reducing coupling or failure modes.

### Evidence scorecard

Score `0–2`:

| Factor | 0 | 1 | 2 |
|---|---|---|---|
| Repetition evidence | One use | Two uses | Three independently evolved uses |
| Semantic identity | Superficial | Partial | Same invariant and reason to change |
| Stable variation | Unknown | Plausible | Already exercised |
| Coupling reduction | Adds | Neutral | Removes coupling |
| Boundary fit | Arbitrary | Local seam | Real domain/I/O boundary |
| Testability | Harder | Neutral | Enables contract tests |
| Substitution need | None | Approved soon | Multiple active hosts |
| Lifecycle alignment | Different | Mixed | Same owner/release |

Penalties:

- speculation: `-2`
- indirection: `-1` to `-2`
- framework tax: `-2`
- domain erosion: `-2`
- migration burden: `-1` to `-2`
- operational burden: `-1` to `-2`

Decision:

- `12–16`, no veto: narrow shared abstraction may be warranted.
- `8–11`: use a cohesive module or pure function, not a framework.
- `4–7`: keep concrete.
- `0–3`: remove or avoid.

The document host and project host pass this rubric because memory, desktop, and VS Code are active implementations at real boundaries. A generic application-wide service container does not.

---

## Risks and sequencing constraints

1. **Unstable VS Code package API.** Mitigation: exact pin, one adapter, compatibility suite, permitted minimal fork. Owner: P1b.
2. **Fork maintenance burden.** Mitigation: generic seams only, upstream diff, no Gutterpress syntax in fork. Owner: P1b.
3. **Source corruption through stale offsets.** Mitigation: expected document version and range validation; fail closed. Owner: P1/P3.
4. **Plugin transform origin ambiguity.** Mitigation: ground-truth origin or refusal; source fallback. Owner: P2c.
5. **Generated HTML entering source.** Mitigation: generated views have no writable range; negative tests. Owner: P2.
6. **Plugin or HTML security.** Mitigation: host-side trusted execution, CSP/sanitization, no secrets, trust tests. Owner: P2c/P3c.
7. **IME and accessibility regressions.** Mitigation: browser/package spike and packaged interaction review. Owner: P1b/P3d.
8. **Large-document latency.** Mitigation: D13 budgets, representative benchmarks, source fallback. Owner: P3d.
9. **Mode-switch undo surprise.** Mitigation: explicit undo epoch, mounted-view ownership, tests and docs. Owner: P1c/P3a.
10. **Deleting preview editing too early.** Mitigation: P3 parity gate blocks P4. Owner: P3/P4.
11. **Losing read-only preview actions.** Mitigation: behavior matrix and replacement tests. Owner: P4.
12. **PWA deletion removes an active path.** Mitigation: P0 caller inventory and packaged/dev tests. Owner: P5a.
13. **Broad Platform split creates interface sprawl.** Mitigation: rubric, feature ownership, no interface without boundary. Owner: P5b.
14. **HTTP-to-IPC migration weakens security.** Mitigation: runtime schemas, root/path checks, secrets review, one bounded context at a time. Owner: P5c.
15. **Transport migration blocks ongoing release work.** Mitigation: independent subruns with all callers moved in each commit. Owner: P5c.
16. **Static renderer packaging regressions.** Mitigation: packaged builds on all platforms before server deletion close-out. Owner: P5d.
17. **Hot composition files cause conflicts.** Mitigation: sequential ownership of `+page.svelte`, `main.ts`, preload, and manifests. Owner: P3/P5/P6.
18. **Public API drift.** Mitigation: export tests and existing CLI/API gates. Owner: all phases.
19. **Test suite growth becomes unmanageable.** Mitigation: delete superseded tests with capabilities and maintain focused fixtures. Owner: P4–P7.
20. **Net complexity does not decrease.** Mitigation: measured ledger and non-positive production LOC requirement across P4–P6. Owner: P7.
21. **PR 158 assumptions leak into new design.** Mitigation: no initial cherry-picks; manual fixture ports only. Owner: P0–P2.
22. **Real-book regressions missed by unit tests.** Mitigation: packaged interaction and real-book gates. Owner: P3/P7.

Critical hot files requiring sequential ownership:

- `package.json`
- `bun.lock`
- `packages/desktop/package.json`
- `packages/cli/package.json`
- `packages/desktop/src/routes/+page.svelte`
- `packages/desktop/electron/main.ts`
- `packages/desktop/electron/preload.ts`
- `packages/desktop/src/lib/platform/contract.ts`
- `packages/desktop/src/lib/api.ts`
- `packages/desktop/svelte.config.js`
- viewer bundle build scripts and generated outputs

---

## Deletion and simplification ledger

Track complexity removed as a first-class deliverable. P0 records exact baseline counts; each deletion run updates them.

| Item | Why it exists today | Replacement or reason unsupported | Delete phase | Proof of removal | Net effect |
|---|---|---|---:|---|---|
| ProseMirror architecture from PR 158 | Prior rich editor model | Not merged; VS Code source-first editor | P1/P4c | dependency/import search | Prevents new engine, schema, serializer |
| Preview in-flow editor | Direct page editing | Shared rich/source editors | P4a | protocol and symbol search | Deletes third editor surface |
| `InlineEditController` | Preview edit lifecycle | No preview mutation | P4a | file/symbol absent | Deletes generation/pending-render state |
| `CommitEngine` | Safely mutate source from stale preview | Editor commands operate on live snapshot | P4b | file/symbol absent | Deletes duplicate write policy |
| Preview image/link rewrite scanners | Context-menu source mutations | Shared editor commands | P4b | command/scanner search | One mutation vocabulary |
| Preview edit protocol messages | Cross-frame editing | Read-only preview | P4a | protocol search | Smaller bridge |
| Mutation-only source metadata | Support preview writes | Navigation-only metadata | P4b | output/fixture diff | Smaller DOM/protocol |
| `WebAdapter` | Dormant future PWA | Future web host is separate package | P5a | file/import search | Deletes false host implementation |
| `web-fs` / `web-store` | Browser filesystem and persistence | Unsupported in desktop | P5a | file/import search | Deletes dormant stores |
| PWA service-worker path | Future browser app | Out of scope | P5a | build/search proof | Smaller desktop build |
| Duplicate static viewer bundle | PWA fallback | Shared render asset ownership | P5a | generated file proof | One bundle output |
| Broad `Platform` service locator | Electron/PWA abstraction | Narrow feature capabilities | P5b | consumer/import search | Explicit dependencies |
| Desktop typed HTTP `api.ts` | Route client | Typed IPC | P5d | file absent | One transport |
| `src/routes/api/**` | Electron request/reply host | Typed IPC | P5c/P5d | route count zero | One transport |
| Adapter-node desktop server | Execute SvelteKit routes | Static renderer + IPC | P5d | dependency/server search | Deletes loopback service |
| Loopback bearer token/proxy | Secure local server | Server absent | P5d | symbol search | Removes attack/failure mode |
| Route-only DTO duplication | HTTP transport shapes | Capability/IPC contracts | P5c/P5d | type search | Fewer models |
| Tracked generated directories | Build output in source | CI-generated only | P0b | git ls-files proof | Cleaner repository |
| Stale ADR references/comments | Historical architecture drift | Current ADRs | P6c/P7 | doc link check | Discoverable rationale |
| Workflow logic in `+page.svelte` | Organic composition growth | Feature-owned controllers | P6a | responsibility review | Smaller composition root |
| Workflow logic in Electron `main.ts` | Organic host growth | Bounded services | P6b | responsibility review | Smaller composition root |

The final ledger must show reduction in runtime branches, concepts, modules, and production LOC—not merely file movement.

---

## Documentation and decision records

Required artifacts:

- `docs/plans/source-first-editor-enterprise-refactor.md`
- `docs/plans/source-first-editor/runs/`
- `docs/plans/source-first-editor/acceptance.md`
- `docs/plans/source-first-editor/deletion-ledger.md`
- `docs/architecture/source-first-editor.md`
- `docs/ARCHITECTURE.md`
- `docs/vscode-extension.md`
- ADRs under `docs/adr/`
- Contributor/package boundary guide
- `CHANGELOG.md`
- `docs/releases/0.11.0.md`

Documentation rules:

- Public examples are executable or linted.
- Stability labels match tests and package metadata.
- Long rationale belongs in ADRs.
- Code retains concise invariant comments with ADR links.
- Deleted behavior is removed from user and contributor docs in the same run.
- The final plan and acceptance file contain commit references.
- PR 158 is linked as superseded research, not active architecture.
- No documentation claims PWA support in the desktop package after P5a.
- No documentation claims preview editing after P4.
- No documentation describes desktop HTTP routes after P5d.

---

## Execution start

On approval:

1. Confirm `0.10.2` has been merged to `main` and released, then fetch the latest remote branches.
2. Confirm `origin/release/0.11.0` resolves to the same commit as `origin/main`. If it does not, stop; release management must synchronize the branches outside this implementation plan.
3. Create `feature/source-first-rich-editor-architecture` directly from `origin/main`, or verify the existing work branch has that commit as its merge base.
4. Record the exact baseline SHA in `docs/plans/source-first-editor/baseline.md`.
5. Commit this plan at `docs/plans/source-first-editor-enterprise-refactor.md`.
6. Execute P0 and P1 without pausing unless a stop condition occurs.
7. Post Checkpoint A.
8. Continue through P2 and P3.
9. Do not enter P4 without the parity gate.
10. Execute deletion and transport runs in order.
11. Execute P7 and the final acceptance sweep.
12. Report final commits, gates, advisories, deferred items, release actions, and the explicit merge decision owned by the repository owner.

### Immediate preflight checklist

- [ ] Plan file contains no template placeholders.
- [ ] The `0.10.2` release is complete and `origin/main` contains the released baseline.
- [ ] The exact `origin/main` baseline SHA is recorded immediately before execution.
- [ ] `origin/release/0.11.0` resolves to the same baseline SHA.
- [ ] The work branch is created directly from the recorded `origin/main` baseline.
- [ ] PR 158 remains unmerged.
- [ ] Binding decisions are complete and internally consistent.
- [ ] Every run has disjoint write lanes.
- [ ] Shared hot files are sequenced.
- [ ] Gate commands are runnable.
- [ ] Package compatibility gate is understood.
- [ ] Public contract co-updates are assigned.
- [ ] Security and trust reviews are assigned.
- [ ] Deletion prerequisites are explicit.
- [ ] Checkpoint and push cadence is explicit.
- [ ] Stop/re-plan conditions are accepted.
- [ ] Final acceptance criteria have evidence owners.

---

## Final wrap-up template

```markdown
# Gutterpress Source-First Rich Editor and Enterprise Architecture Simplification — Implementation Wrap-Up

## Result
Complete, blocked, or partially complete, with exact scope.

## Commit range
- Base: `<BASE SHA>`
- Head: `<HEAD SHA>`
- Branch: `feature/source-first-rich-editor-architecture`

## Completed phases
- Phase and one-line result.

## User-visible changes
- Change.

## Architecture changes
- Boundary, model, host, or transport change.

## Deleted complexity
- Deletion, measured effect, and proof.

## Gate results
- `command` — PASS or FAIL.

## Review disposition
- Confirmed findings fixed: count.
- Open advisories: count and links.
- Deferred items: explicitly out-of-scope items.

## Acceptance sweep
- Passed: count.
- Failed: count.
- Not applicable: count.

## Net complexity
- Production LOC before/after.
- Modules before/after.
- Dependencies before/after.
- Desktop routes before/after.
- Preview mutation protocol before/after.

## Remaining stakeholder actions
- Gated CI, release check, merge decision, rollout, marketplace publication, or release action.
```

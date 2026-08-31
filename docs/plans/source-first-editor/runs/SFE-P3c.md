# SFE-P3c — VS Code extension implementation

## Objective

Turn the P1a skeleton into a real, maintained VS Code custom text editor that
runs **the same shared editor mount** the desktop runs (D9/AC-06): the
extension host owns `TextDocument`, `WorkspaceEdit`, native undo/redo, file and
workspace events, project discovery and trusted plugin loading; the webview
owns only the editor model/view/controller and has no Node or filesystem
access; and every message between them is versioned, runtime-validated, and
fail-closed.

This run also gives the package the build step P1a explicitly deferred, so
`main` (`./dist/extension.js`) is a file something can actually load.

## Allowed behavior changes

- `packages/vscode-extension` gains a host↔webview protocol, a
  `TextDocument`/`WorkspaceEdit` document gateway, a webview-side proxy
  document host, project/trust services, three commands, a real webview entry
  that mounts `@dimm-city/gutterpress-editor`, and a build step.
- `packages/editor/package.json` gains a `./test-harness` subpath export so
  the extension's browser proofs reuse the existing real-Chromium harness
  instead of cloning it.
- `tools/check-architecture.mjs` gains a webview-purity sub-rule.
- New `dist/` output (gitignored) and, if the environment allows it,
  `@vscode/test-electron`.

## Behavior that must remain unchanged

- `packages/editor/src/**` — no source change. This run PROVES the shared
  mount is host-agnostic; changing it to accommodate VS Code would defeat the
  proof. A genuinely necessary editor-package change is a **blocking report**,
  not a lane edit.
- `packages/desktop` and `packages/cli` — untouched.
- Rendered book/preview/PDF output byte-identical.
- Every existing suite and fitness check.

## Binding decisions

- **D2/D3** — exact Markdown source is the only authoritative document.
  Offsets are UTF-16 code units on both sides of the boundary; VS Code
  `Position`↔offset conversion goes through `document.positionAt`/`offsetAt`,
  never through hand-rolled line arithmetic.
- **D9** — the custom editor is registered but **never** the default `*.md`
  handler (`priority: "option"` — already asserted by `manifest.test.ts`,
  which must keep passing). The host owns `TextDocument`, `WorkspaceEdit`,
  undo/redo, file/workspace events, project discovery, trusted plugin loading,
  and the commands; the webview owns model/view/controller, selection, local
  view state and chrome, with **no filesystem or Node access**.
- **D9 (untrusted workspaces)** — standard Markdown rich editing remains
  available; project plugins do not execute; unsafe raw HTML is not executed;
  plugin regions render as source or safe placeholders **with a trust
  explanation**. The extension must operate with **no Gutterpress manifest
  present**.
- **D12** — restrictive CSP with a per-render nonce; author HTML never grants
  script execution; the host supplies the first effective base URI and author
  HTML cannot replace it; every message payload is untrusted and runtime
  validated; no tokens, credentials, absolute paths or remote secrets cross
  into the webview, its logs, or any diagnostic.
- **D13** — rich mode supports files up to 2 MiB; larger opens in source mode
  with `EDITOR_FILE_TOO_LARGE`. The P2b/P2c projection caps apply unchanged.
- **D14** — every boundary failure carries one of the named categories.
  `EDITOR_HOST_DISCONNECTED` gets its first real producer in this run. A
  generic "failed" at a boundary is a confirmed review finding.
- **D15** — one host-local correlation ID per editor session; never log
  document text by default.
- **G-05** — nothing infers source origin from presentation. The convergence
  check in the reconciliation design below compares the webview's own mirror
  text against the host's authoritative text; it is a *state* comparison, not
  an origin inference, and it must never be widened into one.
- **AP-21** — every fixture proves the thing under test actually ran before
  asserting on it. A webview test that would pass against a webview that
  mounted nothing is a failure.
- **G-12/AP-20** — every new gate, mock and harness must be proven able to
  fail (a sabotage case), and must fail loudly rather than skip.

## Authority and reconciliation model — the binding constraint

`EditorDocumentHost.applyEdit` is **synchronous** (`packages/editor/src/core/hosts.ts`)
and the authoritative `TextDocument` lives in a different process. The
sanctioned resolution — and the only one a lane may ship without an amendment:

1. **The extension host is the sole authority.** It never asks the webview
   what the document says.
2. **The webview runs a mirror.** `ProxyDocumentHost` implements
   `EditorDocumentHost` against a local mirror snapshot: `applyEdit` performs
   the D3 checks (readonly → stale → invalid-range) against the mirror,
   applies optimistically, bumps the mirror version exactly once, notifies
   subscribers, and posts the edit to the host. The mirror's version counter
   is LOCAL and monotonic; the host's `TextDocument.version` is never exposed
   to the editor and the two are never conflated.
3. **Every host-side apply produces exactly one authoritative reply.** Success
   or failure — a rejected `workspace.applyEdit`, a closed document, a
   concurrent external change — replies with the host's full authoritative
   text. Silence on any path is a confirmed finding.
4. **The proxy converges by replacement.** On an authoritative message whose
   text differs from the mirror, the proxy calls `replaceExternal` (one
   version bump, `EDITOR_EXTERNAL_REPLACEMENT`); when it matches, it does
   nothing. This is what suppresses the host's echo of our own accepted edit
   without any origin bookkeeping.
5. **External changes are authoritative messages too** — `onDidChangeTextDocument`
   for this document, from any source, goes through the same channel and the
   same convergence rule.
6. **A lane that finds this model unsound narrows and reports**; it does not
   widen it into optimistic reconciliation heuristics.

A lane may replace step 4's whole-text convergence with something cheaper
**only** if it proves the replacement equivalent under D13's 2 MiB ceiling and
records the proof.

## Behavior table

| Case | Required result | Owner |
|---|---|---|
| Protocol shape | Every host↔webview message is versioned against `EDITOR_PROTOCOL_VERSION`, runtime-validated on BOTH sides, and rejected by a named diagnostic — never coerced, never partially applied | A |
| Malformed/hostile messages | A wrong version, unknown type, missing field, wrong type, non-finite or negative offset, or oversized payload is rejected with the specific D14 category; a fixture proves each shape and proves a valid control still passes | A |
| Document gateway | `SourceEdit` → `WorkspaceEdit` via `positionAt`/`offsetAt`; applied through `workspace.applyEdit`; native undo/redo owns the result; dirty state is VS Code's | A |
| Contract substitutability | The shared `runDocumentHostContractTests` suite passes against `ProxyDocumentHost` wired to a simulated host with latency and out-of-order replies, exactly as it passes for `MemoryDocumentHost` and `DesktopDocumentHost` | A |
| Convergence | Accepted edit → no spurious external replacement; rejected edit → mirror converges to the host's text in one replacement; external file change while active → one replacement; interleaved local edit + external change → mirror ends byte-identical to the host, asserted | A |
| Undo/redo | Undo in the webview is VS Code's own undo of the `WorkspaceEdit`; the editor package maintains no independent undo stack that can desync — proven, not asserted in prose | A |
| Host disconnection | A disposed panel, a closed document, or a reply that never arrives surfaces `EDITOR_HOST_DISCONNECTED` and puts the webview in a read-only state; it never silently accepts further edits | A |
| Build | `bun run build` emits a loadable CommonJS `dist/extension.js` (with `vscode` external) and a browser-target webview bundle; `dist/` stays gitignored and untracked | A |
| Project detection | A Gutterpress manifest is found from the document's workspace folder; absence is a supported, non-error state (D9) | B |
| Trust gate | In an untrusted workspace, plugins are not loaded, raw HTML is not executed, plugin regions degrade to source/placeholder **with a trust explanation**, and standard rich editing still works. Trust granted mid-session re-resolves; trust is never inferred from a setting the workspace itself can write | B |
| Manifest/CSS/asset resolution | CSS and asset resolution happen host-side and reach the webview as data or `asWebviewUri` URIs; every filesystem read is workspace-root-scoped and traversal-protected; a `../` escape attempt is refused by a fixture | B |
| Commands | Build, preview, and "open source" are registered, appear under the manifest's `contributes.commands`, and fail with a specific diagnostic (never a generic "failed") when their preconditions are absent | B |
| Webview purity | Nothing under `src/webview/**` (or the shared protocol module) imports `vscode`, a Node builtin, or the desktop package — enforced by a fitness rule with a sabotage self-test, not by review | A |
| Webview mount | The webview mounts `mountGutterpressEditor` over `ProxyDocumentHost`, renders, accepts typed input, and emits source edits that reach the fake host byte-exactly — asserted in real Chromium | C |
| CSP and inertness | The rendered webview document sets `default-src 'none'` with a per-render nonce and an explicit `base` the page cannot override; a script payload in the author's Markdown does not execute; a script payload in plugin/generated HTML does not execute | C |
| Oversized file | A document over 2 MiB mounts the source fallback with `EDITOR_FILE_TOO_LARGE` and stays editable; the boundary case (just under) mounts rich | C |
| Disposal | Disposing the panel removes every listener, timer and subscription on both sides; a remount in the same session works; a leak fixture proves the assertion can fail | C |

## Lane ownership (Lane A FIRST and alone; then B and C in parallel)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/vscode-extension/src/protocol/**`, `src/host/**`, `src/webview-host/**`, `src/provider.ts`, `src/extension.ts`, `packages/vscode-extension/package.json`, `tsconfig*.json`, `scripts/build.mjs`, `tests/{protocol,host,webview-host}/**`, `tests/support/**`, `tools/check-architecture.mjs` + `tools/check-architecture.test.mjs`, `knip.json` (a `packages/vscode-extension` workspace entry, if needed) | `packages/editor/src/**`, `packages/desktop`, `packages/cli`, `src/project/**` (beyond the one stub named below), `src/webview/**` | Protocol + gateway + proxy host + provider wiring + build + webview-purity rule |
| B | `packages/vscode-extension/src/project/**`, `src/commands/**`, `tests/{project,commands}/**`, `packages/vscode-extension/package.json` (`contributes` block only, after Lane A lands) | Lane A's modules, `src/webview/**`, other packages | Project discovery, trust, workspace-scoped resolution, three commands |
| C | `packages/vscode-extension/src/webview/**`, `tests/webview/**`, `packages/editor/package.json` (the `./test-harness` export only) | `packages/editor/src/**`, Lane A's and B's modules | Webview entry, CSP/nonce/base URI, real-Chromium proofs, disposal |
| Integrator | `bun.lock`, wiring, commits | — | Install, verification, commits |

Lane A creates `src/project/register.ts` as a **typed stub** so `extension.ts`
typechecks; Lane B owns that file from the moment Lane A's work is committed.
No two lanes write it concurrently.

`packages/vscode-extension/package.json` is Lane A's during phase 1 and Lane
B's during phase 2 — again sequential, never concurrent. Lane C never touches
it.

## Host-fidelity requirement (`@vscode/test-electron`)

P1a recorded a gap: no real VS Code host, only a `mock.module("vscode", …)`
namespace. Lane A must make **one bounded attempt** to add
`@vscode/test-electron` and run a single smoke test (activate the extension,
open a fixture `.md` with the custom editor, assert the webview resolved).

- If it works, that smoke test is the run's host-fidelity evidence and the
  mock stays only for fast unit suites.
- If the download, the sandbox, or the display server makes it impossible, the
  lane records **the exact command and its exact failure output** as a
  deviation and instead delivers a **fidelity mock**: a `TextDocument`
  implementation with real `offsetAt`/`positionAt`/`getText`/`version`
  semantics, a `WorkspaceEdit` that actually applies, real event emitters, and
  a `workspace.isTrusted`/`onDidGrantWorkspaceTrust` surface. That mock must
  carry a **fidelity checklist** naming, per member, what real behavior it
  reproduces and what it does not — and at least one sabotage case proving the
  mock can fail a wrong implementation.

Guessing at VS Code semantics with no citation is a confirmed finding either
way; where the lane cannot verify a behavior against the real API or its
published `.d.ts`, it says so in the checklist.

## Security review (required for this run)

The review stage must explicitly cover: the CSP and its nonce (including
whether the nonce is per-render and unguessable), base-URI control,
`localResourceRoots` scoping, `asWebviewUri` usage, message-origin and shape
validation on both sides, path-traversal protection on every host-side read,
plugin execution staying host-side under trust, and the absence of secrets,
tokens, and absolute paths in messages, diagnostics, logs and acceptance
artifacts.

## Review dimensions

- Can any message shape reach a handler without passing validation? Construct
  one.
- Can the mirror and the `TextDocument` diverge and stay diverged? Construct a
  sequence.
- Does any rejection path leave the webview writable against a stale mirror?
- Is undo genuinely VS Code's, or is there a second stack?
- Does the webview bundle contain `vscode`, Node, or desktop code? Scan the
  built output, not the import syntax.
- Does the trust gate fail open anywhere — including before trust is resolved?
- Is the fidelity mock (if used) faithful, or does it encode the
  implementation's own assumptions back at it?
- Are the disposal assertions capable of failing?

## Test plan

- `bun test` unit suites for protocol validation, the gateway, the proxy host
  (including the shared contract suite), project/trust services and commands.
- Real-Chromium `*.btest.ts` proofs for the webview, reusing
  `packages/editor`'s harness through its new `./test-harness` export.
- Liveness before behavior everywhere (AP-21).
- Sabotage proof for every new gate, mock and harness (G-12/AP-20).

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/vscode-extension && bun run test && bun run test:browser && bun run build`
- `cd packages/editor && bun run test && bun run test:browser && bun run check:browser-purity`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `bun run check:architecture && bun run check:generated-files && bun run check:vendored && bun run knip`

## Review log

<!-- Appended by the review stage. -->

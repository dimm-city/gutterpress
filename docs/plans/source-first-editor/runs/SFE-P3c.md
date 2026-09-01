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

## Amendment — reconciliation addendum and integration lane D (added after phases 1–2 reported; spec amended before lane D runs)

Phase 2 surfaced a confirmed defect the original authority model under-specified,
plus a message-drift seam between the two parallel lanes:

1. **Version spaces.** `ProxyDocumentHost` forwarded its LOCAL mirror version
   verbatim as the edit's `expectedVersion`, and the gateway compared it
   against its OWN independent counter — after the always-occurring initial
   convergence, every real edit was silently rejected as stale, and the
   rejection reply was itself dropped by the mirror's de-dup guard (a red
   regression test is committed). The model's point 2 said the two counters
   are "never conflated" but gave the wire no third thing to agree on.
   **Addendum (binding):** every authoritative host→webview snapshot carries a
   **host-assigned base stamp**; the proxy records the stamp of the state its
   mirror last converged to and sends it as each edit's base; the gateway
   applies only when the stamp matches its current one, else replies
   authoritatively (normal convergence). To keep burst typing sound with no
   rebasing, the proxy holds **at most one apply-edit in flight** — later
   local edits queue (already applied optimistically to the mirror) and each
   is sent only after the previous authoritative reply, with the stamp that
   reply carried. An authoritative reply whose text diverges from the mirror
   discards the queue along with the replacement (D3 fail-closed). Replies
   remain uncorrelated; convergence stays text-comparison; this adds a stamp
   and a send queue, not per-edit correlation.
2. **One presentation concern, one message.** `presentation-input` (mode) and
   `projection` (payload) are merged: `presentation-input` gains optional
   `projection`/`pluginCss`/`pluginErrors`, and the separate `projection`
   message type is deleted. A mode decision with no projection (oversized →
   source) stays valid by omission.

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| D | `packages/vscode-extension/**` (all of it — the lanes are finished and committed), `knip.jsonc`, `packages/editor/package.json` (the test-harness export line only, if it needs adjusting) | `packages/editor/src/**`, `packages/editor/tests/**`, `packages/cli/**`, `packages/desktop/**`, `tools/**` | Reconciliation fix per the addendum, message merge, seam wiring to `mountGutterpressEditor`, config gaps, all suites green including the formerly-red regression test |

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

## Deviations and evidence

Added by repair round 1 (finding "The run's required evidence record does
not exist: 19 source comments cite 'this run's report'..."). This is that
record — every in-repo comment that used to say "see this run's report"
now points here instead, or has been shortened because the context it
referenced is now resolved.

### Host-fidelity deviation (`@vscode/test-electron`)

The run spec's "Host-fidelity requirement" calls for one bounded,
time-boxed `@vscode/test-electron` attempt, with the exact command and
exact failure recorded as a deviation if it cannot run. Re-verified fresh
during repair round 1 (the original scaffold's own launcher, `tests/
host-fidelity/launch.mjs`, called `@vscode/test-electron`'s
`downloadAndUnzipVSCode`, which resolves `update.code.visualstudio.com`):

```
$ curl -sS -m 15 -o /dev/null -w "HTTP_STATUS:%{http_code}\n" \
    "https://update.code.visualstudio.com/api/versions/stable/linux-x64/stable"
curl: (56) CONNECT tunnel failed, response 403
HTTP_STATUS:000
```

The session's outbound-proxy status endpoint confirms this is a policy
denial, not a transient failure — the proxy's `noProxy` allowlist
(`$HTTPS_PROXY/__agentproxy/status`) does not include
`update.code.visualstudio.com` or any VS Code download host, and its
`recentRelayFailures` log records the same `"gateway answered 403 to
CONNECT (policy denial or upstream failure)"` shape for other
non-allowlisted hosts requested in this same session. `bun run
test:host-fidelity` (before its removal below) would fail identically:
`downloadAndUnzipVSCode` cannot fetch VS Code's version manifest, well
before `run-in-host.js`'s own `vscode.extensions.getExtension(...)` line
ever runs.

**Substitute:** `tests/support/fidelity-vscode.ts`'s FIDELITY MOCK — a
`TextDocument`/`WorkspaceEdit`/workspace-event/trust surface with real
`offsetAt`/`positionAt`/`getText`/`version` semantics and a real,
mutating `applyEdit` — is, and remains, the sanctioned substitute the run
spec names for exactly this situation ("the mock stays only for fast unit
suites" if the attempt succeeds, unconditionally otherwise). Its own
fidelity checklist records exactly what is and is not reproduced,
including the one honestly-flagged gap (CRLF line endings are untested).

**Scaffold removed, not fixed, in repair round 1:** the outer launcher
(`tests/host-fidelity/launch.mjs`), the inner VS-Code-host entry
(`run-in-host.js`), its fixture, the `test:host-fidelity` package.json
script, and the `@vscode/test-electron` devDependency were deleted rather
than kept as untested dead code. Beyond being unreachable in this
environment, `run-in-host.js`'s own first assertion was independently
confirmed WRONG regardless of network access: a VS Code extension
identifier is `<publisher>.<manifest name>`, and this package's real
`name` is the scoped `@dimm-city/gutterpress-vscode` (D1's binding
package name — not something this repair round may rename), so the
identifier VS Code actually computes is
`dimm-city.@dimm-city/gutterpress-vscode`, never the bare
`dimm-city.gutterpress-vscode` the deleted script looked up — and a
scoped package name is not even a valid VS Code extension name (`vsce`
rejects it), so no non-D1-violating rename could have fixed this either.
Re-adding a host-fidelity launcher against a real, verified VS Code host,
on a networked runner, remains a legitimate future improvement; it is not
attempted here.

### G-12/AP-20 sabotage-proof results

Both were re-verified fresh during repair round 1 (not merely re-cited
from an earlier, uncommitted claim):

1. **`tests/support/fidelity-vscode.ts`'s document-identity filter proof.**
   Mutated: `src/host/document-gateway.ts`'s
   `if (event.document !== this.#api.document) return;` guard inside the
   `onDidChangeTextDocument` subscription, replaced with a no-op comment.
   Command: `bun test tests/host/document-gateway.test.ts`. Result: 23
   pass, 1 fail — `DocumentGateway — filters events to THIS document only
   (sabotage-provable) > a change to a DIFFERENT document on the same
   workspace produces NO message for this gateway`, `expect(sent).toHaveLength(0)`
   received `1`. Guard restored; full suite back to 24 pass, 0 fail.

2. **`tests/webview/disposal.btest.ts`'s listener-leak proof.** Mutated:
   `src/webview/index.ts`'s `WebviewSession.dispose()`, its `host.dispose()`
   call replaced with a no-op comment. Command:
   `bun test ./tests/webview/disposal.btest.ts`. Result: 1 pass, 3 fail —
   every assertion of the shape `expect(await listenerCount()).toBe(0)`
   (in "dispose removes the transport-level listener > listenerCount drops
   from 1 to 0", "... > dispose is idempotent", and "dispose then remount
   on the same fake host > exactly one MORE apply-edit reaches the host
   after remount") received `1` instead of `0`. Call restored; full suite
   back to 4 pass, 0 fail.

Repair round 1 also produced and locally sabotage-verified several NEW
gates/tests of its own before committing them (each verified to fail
against the pre-fix code and pass against the fix, then restored to the
fix):

- `tests/extension-load.test.ts` (finding "dist/extension.js is not
  loadable") — fails with the exact `SyntaxError: Cannot use 'import.meta'
  outside a module` the finding predicted when `gutterpress` is bundled
  instead of externalized.
- `tests/webview/production-shell.btest.ts` (finding "the webview bundle
  is ESM served through a classic <script> tag") — times out waiting for
  the "ready" handshake and records a real
  `SyntaxError: Cannot use 'import.meta' outside a module` page error when
  the `<script>` tag omits `type="module"`.
- `tests/webview/projection-upgrade.btest.ts`'s new negative case (finding
  "Projection staleness compares the host's TextDocument.version against
  the webview mirror's LOCAL version") — reverting the
  `ProxyDocumentHost#remapProjectionSourceVersion` wiring back to an
  unremapped `projection: message.projection` makes BOTH the positive and
  the new negative case in that file fail (the positive case now reads its
  `sourceVersion` from the host's own stamp space via `hostStamp()` rather
  than a hand-picked mirror-space literal, so it is no longer accidentally
  insensitive to the bug either).
- `tests/webview/protocol-rejection.btest.ts` (finding "One malformed
  inbound message permanently destroys the editing surface") — reverting
  `ProxyDocumentHost#reportRejectedInbound` to call `onDiagnostic` instead
  of `onProtocolRejection` makes both cases in this file fail
  (`editorElementCount()` drops to `0`, i.e. the mount was torn down by a
  single malformed/unrelated message).
- `tests/host/document-gateway.test.ts`'s new "order-independent echo
  suppression" describe block, `changeEventTiming="after-resolve"` cases
  (finding "the gateway's echo suppression depends on an uncited
  applyEdit/onDidChangeTextDocument ordering") — reverting
  `DocumentGateway#broadcastSnapshot`/`#sendSnapshot` back to the
  `#applyInProgress`-only guard makes exactly the two "after-resolve"
  cases fail (`sent` grows to 2/3 instead of staying at 1/2), while the
  "before-resolve" cases keep passing (the old guard was already correct
  for that one ordering) — demonstrating the fix is genuinely
  order-independent, not merely differently lucky.
- `tests/webview/trust-explanation.btest.ts` (finding "D9's required trust
  explanation is not implemented" — the WEBVIEW-side half: a visible notice
  banner, `src/webview/index.ts`'s `updateNotices`/`renderNoticeBanner`/
  `onTrustChange`). Three separate mutations, each restored immediately
  after its run:
  1. `onTrustChange: (trusted) => { if (trusted) renderNoticeBanner([]); }`
     replaced with a no-op. Command:
     `bun test ./tests/webview/trust-explanation.btest.ts`. Result: 2 pass,
     2 fail, 1 unhandled error (the shared Chromium session closes after
     the first timeout, so later tests in the same file report a page-
     closed error rather than their own timeout — the decisive result is
     that "mechanism 1" itself failed on a timeout waiting for
     `noticeBannerHidden() === true`, and the initial "shows the notice"
     test, which does not depend on `onTrustChange` at all, still passed).
     Restored; full file back to 4 pass, 0 fail.
  2. `updateNotices`'s closing `renderNoticeBanner(visible);` guarded with
     `if (visible.length > 0)` (never clears on an empty resend). Command:
     `bun test ./tests/webview/trust-explanation.btest.ts`. Result: 3 pass,
     1 fail, 1 unhandled error — "mechanism 2" timed out waiting for
     `noticeBannerHidden() === true`; both the initial "shows" test and
     "mechanism 1" (a different clearing path) still passed, showing the
     two mechanisms are genuinely independent of each other in this suite,
     not accidentally covering for one another. Restored; full file back to
     4 pass, 0 fail.
  3. `updateNotices`'s `if (input.diagnostic) diagnostics.push(input.diagnostic);`
     replaced with `if (false && input.diagnostic) ...` (the diagnostic is
     silently dropped). Command:
     `bun test ./tests/webview/trust-explanation.btest.ts`. Result: 1 pass,
     3 fail, 1 unhandled error — every test that depends on the banner ever
     becoming visible in the first place (all three in the "D9 trust
     explanation" describe block) timed out or errored on the now-closed
     session; only the unrelated "harness liveness" test passed. Restored;
     full file back to 4 pass, 0 fail.

### CSP/protocol-category rationale accounts

- **CSP.** `src/provider.ts`'s `renderWebviewHtml` doc comment is the
  authoritative account of the CSP recipe (`default-src 'none'`, nonced
  `script-src`, un-nonced `style-src: 'unsafe-inline'` and why, `img-src`/
  `font-src` scoped to `cspSource`). `tests/webview/csp-inertness.btest.ts`
  and `tests/provider.test.ts`'s `renderWebviewHtml` describe block prove
  it live and pin its string shape, respectively; no separate account was
  needed beyond those two plus the doc comment itself.
- **Protocol-category mapping.** `src/protocol/diagnostics.ts`'s
  `diagnosticForProtocolRejection` doc comment records the judgment call
  (no dedicated D14 "malformed message" category exists, and
  `packages/editor/src/core/diagnostics.ts` — where one would have to be
  added — is outside every lane's write boundary this run) and, as of
  repair round 1, the scope narrowing that judgment call now has: it
  governs only the `diagnostic-report` WIRE message the host logs and
  never acts on, not the webview's own reaction, which
  `ProxyDocumentHost`'s `onProtocolRejection` (a separate channel,
  introduced in repair round 1) now owns — see that option's own doc
  comment for the full account of why conflating the two was itself a
  confirmed defect.
- **Message-origin filtering — a documented non-fix.** The security
  review's "message-origin and shape validation on both sides" requirement
  is met for SHAPE (`validateHostToWebviewMessage`, fully verified,
  engine-agnostic) but deliberately NOT for origin: `src/webview/index.ts`'s
  production `onMessage` wiring carries a comment recording that an
  `event.origin`-based filter was tried, empirically caught by this
  package's own `production-shell.btest.ts` rejecting its own legitimate
  same-origin test traffic, and reverted — VS Code's real webview
  host<->content bridge's exact `event.origin`/`event.source` value could
  not be verified against a real host in this environment (see the
  host-fidelity deviation above), and shipping an unverified guess that
  already demonstrated it can silently break message delivery was judged
  worse than the narrower gap that remains once the "one rejected message
  is fatal" defect (this run's actual severe consequence) is fixed. A
  verified origin/source check is a legitimate future improvement once it
  can be proven against a real VS Code host.

### Self-inflicted flake found and fixed during repair round 1

`tests/extension-load.test.ts` (added by this round, for finding "dist/
extension.js is not loadable") originally called `Bun.build()` in-process,
mirroring `tests/webview/build-output.test.ts`'s own pattern. Running the
FULL `bun run test` suite with both files present made
`build-output.test.ts` fail DETERMINISTICALLY, every run, never in
isolation or in a 2-file subset: `error: EISDIR reading file:
".../packages/editor/src/core/index.ts"` against a plain, real,
non-directory file both bundles' dependency graphs happen to share. This
is a Bun 1.3.11 test-file-concurrency interaction between two `Bun.build()`
calls in different files racing on a shared source file, not a defect in
either bundle's own config — reproduced 3/3 runs with both files present,
0/3 with `extension-load.test.ts` temporarily moved aside. Fixed by having
`extension-load.test.ts` shell out to the real `bun run build` as a genuine
child process instead of calling `Bun.build()` in-process (a strict
improvement independent of the flake: it now exercises the real build
script end to end rather than a duplicated config that could drift from
it) — re-verified 3/3 clean runs of the full suite after the fix.

### Acceptance

`docs/plans/source-first-editor/acceptance.md`'s AC-10 ("VS Code host
integration and trust") is updated by this repair round to reflect the
round-1 fixes described above; it remains owned by the run's close-out
step for final sign-off, not by this repair round.

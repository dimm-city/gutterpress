# Source-First Editor — Review and Acceptance Log

> Normative plan: [`docs/plans/source-first-editor-enterprise-refactor.md`](../source-first-editor-enterprise-refactor.md)
> Companion guardrails: [`pr158-lessons.md`](./pr158-lessons.md)
>
> Every run appends its structured result here. A criterion without evidence is not complete.

## Acceptance evidence matrix

| ID | Acceptance criterion | Owning phase | Required evidence | Final status |
|---|---|---:|---|---|
| AC-01 | Post-release branch baseline verified | P0a | Recorded `main` SHA, `release/0.11.0` equality check, and work-branch ancestry proof | Evidenced (SFE-P0a: `baseline.md` §1–§3; equality check replaced by the recorded deviation — `release/0.11.0` absent, work branch == `origin/main`) — Implementation: `docs/plans/source-first-editor/baseline.md`. |
| AC-02 | No ProseMirror-family dependency | P0/P7 | Lockfile/package/import search | Enforced (SFE-P0b: `check-architecture.mjs` Rule 1 in CI, sabotage-proven; final search sweep remains P7) — Implementation: `tools/check-architecture.mjs` (Rule 1), wired in `.github/workflows/ci.yml`. |
| AC-03 | Exact no-edit byte identity | P2/P3 | Corpus and real-book byte tests | **Evidenced** (SFE-P2a 19-fixture corpus + P1b browser cases; SFE-P3d-parity: 25 real chapters / 154,366 bytes plus a 3-chapter plugin book round-trip through the real host/controller/projection with zero drift, sabotage-proven) — Implementation: `packages/editor/src/core/apply-edit.ts`, `validate.ts`, `contract-tests.ts`; real-book host: `packages/desktop/src/lib/editor-host/desktop-document-host.ts`. |
| AC-04 | Explicit edit locality | P2/P3 | Source diff tests and randomized range cases | **Evidenced** (SFE-P2a independent-bound oracle, sabotage-proven; SFE-P3d-parity: the same oracle reused verbatim against real books and the real DesktopDocumentHost — 2,810 locality cases, 400 whole-document cases, plus edits adjacent to and inside plugin regions) — Implementation: `packages/editor/src/core/apply-edit.ts` (minimal-range replacement); the command layer emitting the edits: `packages/editor/src/web/standard/*.ts`, `packages/editor/src/core/commands.ts`. |
| AC-05 | Stale/invalid edits fail closed | P1/P3 | Host contract tests | Evidenced for P1 (SFE-P1a contract/property/validator tests; SFE-P1c: the same shared contract suite green on MemoryDocumentHost AND DesktopDocumentHost, incl. the version-collision attack regression; P3 integrations pending) — Implementation: `packages/editor/src/core/apply-edit.ts`, `validate.ts`, `memory-host.ts`; `packages/desktop/src/lib/editor-host/desktop-document-host.ts`. |
| AC-06 | Shared desktop/VS Code editor mount | P3 | Package import graph and integration tests | **Evidenced** (both hosts mount the same `mountEditor`/`mountGutterpressEditor` over their own `EditorDocumentHost`: desktop via `DesktopDocumentHost` (P3ab/P3e), VS Code via `ProxyDocumentHost` (P3c), each passing the one shared contract suite; `packages/editor/src` unchanged by the VS Code run — the host-agnosticism proof held) — Implementation: `packages/editor/src/web/mount.ts`, `packages/editor/src/gutterpress/mount.ts`; hosts at `packages/desktop/src/lib/editor-host/desktop-document-host.ts` and `packages/vscode-extension/src/webview-host/proxy-document-host.ts`. |
| AC-07 | Gutterpress projection coverage | P2 | Fixture matrix and diagnostics | **Evidenced** (SFE-P2b core markers/raw-html/generated views + malformed matrix + D13 caps; SFE-P2c plugin-region projection with a six-shape refusal matrix; SFE-P3e: the DESKTOP's own wiring now builds the plugin-aware, trusted projection host-side — the P2c machinery is reachable from the actual app, not just from tests) — Implementation: `packages/cli/src/lib/markdown/editor-projection.ts` (builder), `plugin-origin.ts` (transform origin); desktop wiring at `packages/desktop/electron/editor-projection.ts`. |
| AC-08 | Generated content cannot serialize | P2 | Negative source-path tests | Evidenced (SFE-P2b: GeneratedView has no from/to at the type level + runtime absence checks + provider never creates segments for generated content; browser proof of read-only in-chip preview) — Implementation: `packages/editor/src/core/contracts.ts` (`GeneratedView` carries no `from`/`to`); `packages/cli/src/lib/markdown/editor-projection.ts`. |
| AC-09 | Desktop document-session integration | P3a | Source/rich switch and persistence tests | **Evidenced** (SFE-P1c session/host suites; SFE-P3ab: source↔rich switching, non-Markdown fallback, and preview-commit/rich-command coexistence over one `DocumentHost`, with byte-identity assertions across every switch) — Implementation: `packages/desktop/src/lib/document-session/session.ts`, `packages/desktop/src/lib/editor-host/desktop-document-host.ts`, `packages/desktop/src/lib/editor/rich-mode.svelte.ts`, `rich-doc-host-controller.svelte.ts`. |
| AC-10 | VS Code host integration and trust | P3c | Extension-host/webview tests | **Evidenced** (SFE-P3c: TextDocument/WorkspaceEdit gateway with native undo; stamped one-in-flight reconciliation passing the shared contract suite under latency/out-of-order replies; workspace-trust gate with loader spy-proof and a browser-proven trust-explanation banner; workspace-root-scoped plugin paths with a `../`-escape refusal fixture; CSP'd webview proven in real Chromium — 228 unit + 34 browser tests. Real-VS-Code activation remains a recorded deviation: a bounded `@vscode/test-electron` attempt failed on a network policy denial and its dead launcher scaffold was removed; see SFE-P3c.md's "Deviations and evidence") — Implementation: `packages/vscode-extension/src/provider.ts`, `src/host/document-gateway.ts`, `src/project/projection.ts`, `src/project/path-containment.ts`; fidelity mock at `tests/support/fidelity-vscode.ts`. |
| AC-11 | Authoring interaction parity | P3b/P3d | Packaged interaction suite | **Evidenced** (SFE-P3ab desktop surface; SFE-P3d-sweep: all twenty P3d scenarios audited with read citations, five gaps closed in real Chromium, two packaged-Electron scenarios pass under the driver's own xvfb fallback; three product facts pinned as-is — plain-text-only paste, no pointer-drag block movement, no slash menu — and two open a11y items recorded for the product owner) — Implementation: `packages/desktop/src/lib/editor/rich-commands.ts`, `packages/desktop/src/lib/components/RichEditor.svelte`; shared commands at `packages/editor/src/web/standard/*.ts`. |
| AC-12 | Preview remains print authority | P3/P4 | Preview/PDF and navigation tests | Evidenced for navigation (SFE-P3d-parity: D8 capability coverage audit, host-command round trips through the real bridge and shell, and a two-layer mutation-separability proof; the P4 deletion itself remains) — Implementation: `packages/cli/scripts/native-parity-gate.ts`; preview client at `packages/desktop/src/lib/preview-client.ts`, `packages/desktop/src/lib/components/PreviewFrame.svelte`. |
| AC-13 | Preview editing deleted | P4 | Search proof and removed tests/protocol | **Evidenced** (SFE-P4: eight-identifier search proofs pasted in the deletion ledger with exactly two ruled residual classes — one v9 version-history comment and absence-asserting test strings; protocol v8→v9; the characterization suites and the 1,047-line packaged E2E of the deleted feature removed; net −6,719 LOC) — Implementation: proven by absence — search commands in `docs/plans/source-first-editor/deletion-ledger.md`'s SFE-P4 section; the surviving read-only surface is `packages/desktop/src/lib/preview-client.ts`. |
| AC-14 | Dormant PWA deleted | P5a | File/dependency/search proof | **Evidenced** (SFE-P5a: WebAdapter/web-fs/web-store/fsa.d.ts/service-worker/web manifest and four test suites deleted with pasted search proofs; getPlatform() fails loudly off-Electron; the build step that silently regenerated the orphaned viewer bundle fixed at the generator; net -2,546 LOC over 19 production+test files, `git diff c33868f8..5db8c581`) — Implementation: proven by absence — search commands in `docs/plans/source-first-editor/deletion-ledger.md`'s SFE-P5a section. |
| AC-15 | Narrow capabilities replace Platform | P5b | Consumer inventory and import proof | **Evidenced** (SFE-P5b: getPlatform()/Platform/HostServices/ElectronAdapter deleted; the five feature-owned capability modules that existed at that run's close over one bridge accessor — grown to twelve by P5c's route migrations; two deliberate collapses into sole consumers; five dead members deleted with proofs; the full inventory and api.ts→P5c assignment in capability-map.md, audited by the review) — Implementation: the twelve capability modules under `packages/desktop/src/lib/*/*-capability.ts` (e.g. `remote/remote-capability.ts`, `update/updater-capability.ts`, `editor-host/editor-projection-capability.ts`) over the one shared accessor `packages/desktop/src/lib/platform/bridge.ts`. |
| AC-16 | HTTP transport deleted | P5c/P5d | Route/client/server search and packaged smoke | Evidenced for the route/client/server search half (SFE-P5c: 104 → 0 routes across four subruns, api.ts deleted, every operation on validated typed IPC, two D12 leaks caught and fixed in review; SFE-P5d: adapter-node/sveltekit-host.ts/the loopback server/bearer token deleted with search proofs, adapter-static + app-protocol.ts in place, traversal-refusal tests including the win32 containment case). **Packaged smoke closed by the P7 sweep** (`p7-sweeps.md`): SFE-P5d's own smoke evidence had run Electron unpackaged (`app.isPackaged === false`), leaving `resolveBuildDir`'s asar branch covered only by a unit test; SFE-P7 Lane C drove a real `electron-builder --linux dir` build (app.asar, 8,856 entries — renderer build + main + preload inside, zero server markers) and launched the packaged binary headlessly to first paint with the renderer served over `app://` from the asar, zero fatal log lines; win/mac packaged smokes remain CI-runner work — Implementation: `packages/desktop/electron/app-protocol.ts` (`app://` serving), `packages/desktop/electron/server-bridge/secure-handle.ts` (the shared IPC wrapper), `packages/desktop/electron/api/*.ts` (21 registrar modules) plus 5 bespoke registrars (`docs/architecture/source-first-editor.md` names all 26). |
| AC-17 | Composition roots reduced | P6 | Responsibility review and module tests | Evidenced (SFE-P6: `+page.svelte` 4,739→4,543, `main.ts` 2,188→1,965; extractions in feature owners with race-scenario/controller tests; 26 registrars liveness-asserted; 120-channel IPC surface byte-identical across the refactor, reviewer-verified) — Implementation: `packages/desktop/src/routes/+page.svelte`, `packages/desktop/electron/main.ts`. |
| AC-18 | Public compatibility preserved | All | CLI/API/build/preview/publish gates | Pending — Implementation: `packages/cli/tests/integration/package-exports.test.ts`; the pinned surface is `packages/cli/package.json`'s `exports` map. |
| AC-19 | Architecture CI active | P0b/P6 | CI workflow and deliberate-failure proof | Evidenced for P0b (generated-file + architecture checks wired into the CI build job, each with a self-test proving pass and fail paths; P6 additions pending) — Implementation: `tools/check-architecture.mjs`, `tools/check-generated-files.mjs`, wired in `.github/workflows/ci.yml`. |
| AC-20 | Net complexity reduced | P7 | Final deletion ledger and measured diff | Pending — Implementation: `docs/plans/source-first-editor/deletion-ledger.md` (this run's final nine-metric section is Lane A's own deliverable). |
| AC-21 | Real-book regression gate green | P3/P7 | User guide, advanced book, field guide evidence | Evidenced for P3 (SFE-P3d-parity: full user guide, design-guide book, validation example and a plugin-using fixture book — 28 chapters total; the field guide is gitignored and out of corpus, and the final P7 sweep remains) — Implementation: `packages/cli/scripts/native-parity-gate.ts`; corpus at `examples/gutterpress-user-guide/`, `examples/with-design-guide/`, `examples/with-validation/`. |
| AC-22 | Documentation complete | P7 | Doc link and example lint | Pending — Implementation: `docs/architecture/source-first-editor.md`, `docs/vscode-extension.md`, `docs/adr/0011`–`0016`, `docs/ARCHITECTURE.md`. |
| AC-23 | Security boundaries preserved | P2/P3/P5 | CSP, trust, IPC validation, secret scan tests | Evidenced for P2 and the desktop P3 boundary (SFE-P2c security review: host-only plugin execution, inert plugin HTML, fail-closed trust gate; SFE-P3e: rich-mode plugins execute only in main for the opened project — the same trust decision the preview already exercises — over one validated IPC channel whose projectDir must equal the host's own workspace root; SFE-P3c: nonced CSP with fixed base and dist-scoped roots proven inert in real Chromium, both-side message validation, workspace-trust-gated plugin loading with a path-containment refusal, sanitized wire errors; P5 boundaries pending) — Implementation: `packages/cli/src/lib/markdown/plugin-origin.ts` + `packages/desktop/electron/editor-projection.ts` (host-only plugin execution); `packages/vscode-extension/src/webview/index.ts` (CSP); `packages/desktop/electron/server-bridge/secure-handle.ts` (sender-validated IPC). |
| AC-24 | Performance budgets met | P3d | Recorded benchmark results | **Measured — NOT met** (SFE-P3d-sweep/P3f: 25 KiB within the 100 ms p95 budget; 250 KiB p95 ~545–632 ms and 1 MiB p95 ~2.3 s, root-caused to the fork's whole-document geometry remeasurement; the sound Patch 2 helps end-of-document typing only. The budget assertion stays red in `test:perf`; follow-ups: benchmark navigation fix, delta-translation patch variant, then the located-not-proven EditContext residual. Sandbox caveat: not the CI reference runner) — Implementation: `packages/editor/tests/perf/perf-sweep.btest.ts`, `perf-control.btest.ts` (run via `packages/editor`'s `test:perf`); the vendored fix attempt is `packages/vscode-markdown-editor/PATCHES.md` Patch 2. |

## Run results

<!-- Structured run results are appended below, newest last. -->

### SFE-P0a — Execution baseline verification and record

```json
{
  "status": "complete",
  "baseSha": "764613ec090892080e54f2aeaaceb92b12f3ca3e",
  "headSha": "63d9d5da3a1df0813ddbac61dd2dc8022cfab298",
  "history": [
    "1a22bcbd test(p0): characterize editor mutation paths",
    "2cda6b87 docs(p0): inventory platform and transport boundaries",
    "5a53aa4e docs(p0): record post-release execution baseline",
    "17929629 fix(p0): address review findings (round 1)",
    "63d9d5da fix(p0): address review findings (round 2)"
  ],
  "confirmedFindings": [
    "R1: false coverage claim — show()'s first requestId checkpoint was unpinned (fixed: third characterization test + sabotage proof for all three)",
    "R1: mutation inventory omitted context-menu-actions.ts and context-menu protocol identifiers (fixed: §1.5 added; image-classes.ts classified SHARED-AND-SURVIVING)",
    "R1: platform-inventory §11 dropped the lint namespace and double-counted in reconciliation (fixed: 19+29+25+31 = 104 exact)",
    "R1: misleading 'no active iframe' test title (fixed: renamed; unprovable try/catch coverage documented honestly instead of claimed)",
    "R1: run-spec gates used `bun --cwd <pkg> run <script>`, which exits 0 without running anything on Bun 1.3.x (fixed: `cd <pkg> && bun run` + warning note in SFE-P0a/SFE-P1a specs)",
    "R2 (repair-introduced): §1.5 claimed ContextMenuController calls getContextTargetAt — the host-side wrapper has zero production callers (fixed: reclassified TEST-ONLY, P4b deletion candidate)"
  ],
  "advisories": [
    "Cited test range preview-client.test.ts:174-207 slightly undershoots the second test's end (citation precision only)"
  ],
  "gate": {
    "commands": [
      "bun run typecheck — exit 0",
      "cd packages/desktop && bun run test — exit 0 (2132 pass, 1 skip, 0 fail, 5983 expect(), 142 files)",
      "cd packages/cli && bun run test — exit 0 (1810 pass, 60 skip, 0 fail, 5075 expect(), 151 files)",
      "git diff --stat ea7b60d5..HEAD -- <production paths + manifests + bun.lock> — empty (byte-identical to baseline)"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-01 evidenced"],
  "deletionLedgerUpdates": ["Baseline column filled: 104 routes, 12 IPC registrations, 5 preview-mutation messages, 30 Platform/HostServices methods, LOC/dep/generated-file counts"],
  "checkpointSummary": "Baseline recorded and reproducible; mutation and platform/transport inventories complete with P4/P5 search-proof identifier lists; two previously uncovered mutation behaviors pinned with sabotage-proven tests; review ran 2 repair rounds to approve."
}
```

### SFE-P0b — Hygiene and architecture fitness functions

```json
{
  "status": "complete",
  "baseSha": "095119569ac22f5410d1ad2320c117d4bb10ae0b",
  "headSha": "b61045f7987ca1cc6699456519d281be8e2951a9",
  "history": [
    "9fc63b02 chore(p0): remove tracked generated output",
    "a2f6a58c test(p0): enforce architecture boundaries",
    "be415fc5 chore(p0): ratchet dead-code checks",
    "5f009542 chore(p0): wire hygiene and architecture checks into CI",
    "f3b99141 fix(p0): address review findings (round 1)",
    "b61045f7 fix(p0): address review findings (round 2)"
  ],
  "confirmedFindings": [
    "R1: guardrails.md described the wiring as 'not yet wired' and carried wrong assertion/tool counts (fixed against the committed code)",
    "R1: check-generated-files.test.mjs lacked sabotage fixtures for the build/ and out/ patterns (added; all 5 patterns now have proven fail paths)",
    "R1: knip exemption audit used existence checks instead of removal tests (redone by scratch-config removal testing; 4 truly inert entries removed, ungated output proven byte-identical)",
    "R1: check-architecture Rules 1/3 could PASS after scanning zero files (scanned-target counts + AP-21 liveness FAIL added, with self-tests)",
    "R2 (repair-introduced): guardrails.md recorded a false removal-test measurement for the desktop tests/** knip entry (re-measured: gated exit 1, 16 unused files — row reclassified Load-bearing)"
  ],
  "advisories": [],
  "gate": {
    "commands": [
      "bun run typecheck — exit 0",
      "node tools/check-generated-files.test.mjs — exit 0",
      "node tools/check-architecture.test.mjs — exit 0",
      "bun run check:generated-files — exit 0 (1083 tracked files, none generated)",
      "bun run check:architecture — exit 0 (routes 104==baseline; 338 cli + 282 desktop files scanned; future packages skipped)",
      "bun run knip — exit 0",
      "cd packages/desktop && bun run test — exit 0 (2132 pass, 1 skip, 0 fail)",
      "cd packages/cli && bun run test — exit 0 (1810 pass, 60 skip, 0 fail)"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-02 enforced in CI", "AC-19 evidenced for P0b"],
  "deletionLedgerUpdates": ["Tracked generated files: 7 → 0 (root .svelte-kit/ untracked; check-generated-files gate prevents recurrence)"],
  "checkpointSummary": "Guardrails installed and CI-wired: generated-file hygiene, ProseMirror ban, route ratchet (104), D4 import direction with future-package activation, knip exemptions audited by removal-testing and annotated with deletion phases. Review ran 2 repair rounds to approve."
}
```

### SFE-P1a — Shared editor contracts and package skeletons

```json
{
  "status": "complete",
  "baseSha": "ebe2c24f34cc4881b3ad068393288517548b60ab",
  "headSha": "42189c13 (fix round 1)",
  "history": [
    "c3a2405c feat(p1): create shared editor core package",
    "db2f68ea feat(p1): add framework-free web mount shell",
    "da7b1b59 feat(p1): scaffold VS Code extension host",
    "42189c13 fix(p1): address review findings (round 1)"
  ],
  "confirmedFindings": [
    "R1: applyEdit TOCTOU — edit fields re-read after validation, exploitable via accessor-backed objects (fixed: single destructure + regression test)",
    "R1: disposed mount could fire diagnostics/write detached DOM on re-entrant host notification (fixed: post-applyEdit disposed re-check + race test)",
    "R1: dispose listener-release, surface class, and invalid-range assertions unproven (fixed + sabotage-verified)",
    "R1: fabricated spec/plan quotations in comments across Lane B/C files (all swept and corrected against the real docs)",
    "R1: vacuous onDidDispose registration and disposal test in the extension provider (deleted pending real per-resolve state)",
    "R1: browser-purity checker passed vacuously on zero files and ignored .svelte (fail-closed + extensions + self-tests added)",
    "R1: dead --package-root flag with false justification (deleted)",
    "R1: new packages' typecheck/test/purity gates never ran in CI (AP-20) (wired into the build job)"
  ],
  "advisories": [
    "provider.test.ts header cites a D12 bullet the suite does not exercise",
    "dom-stub.ts attributes a stub-vs-dependency instruction to lane instructions with no locatable source",
    "browser-purity self-test runs twice in CI (dedicated step + bun test auto-discovery)"
  ],
  "gate": {
    "commands": [
      "bun install --frozen-lockfile — exit 0",
      "bun run typecheck — exit 0 (4 workspace packages)",
      "packages/editor typecheck (both programs) / test (118 pass, 0 fail) / purity (11 files clean) / purity self-test (19 ok) — all exit 0",
      "packages/vscode-extension typecheck / test (22 pass, 0 fail) — exit 0",
      "check:architecture — exit 0 (Rule 4 scans both new packages)",
      "check:generated-files — exit 0 (1120 tracked files)",
      "knip — exit 0",
      "packages/desktop test — exit 0 (2132 pass, 1 skip, 0 fail)",
      "packages/cli test — exit 0 (1810 pass, 60 skip, 0 fail)"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-05 evidenced for P1"],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "packages/editor core (D3 contract, D14 diagnostics, hardened validators, memory host) and web mount shell live with 118 tests; packages/vscode-extension skeleton registers the optional gutterpress.markdownEditor provider importing the shared protocol. P1b dependency @vscode/markdown-editor@0.0.2-84 verified present on the npm registry."
}
```

### SFE-P1b — `@vscode/markdown-editor` compatibility and fork gate

```json
{
  "status": "complete",
  "baseSha": "a8a93c0c",
  "headSha": "5cc16061",
  "history": [
    "171c961f chore(p1): exact-pin @vscode/markdown-editor 0.0.2-84",
    "3cfe67c3 docs(p1): specify run SFE-P1b",
    "70f5c0f8 feat(p1): adapt vscode markdown editor",
    "12707d22 docs(p1): record package adoption decision — FORK",
    "f3d12e01 docs(p1): specify run SFE-P1b2",
    "5cc16061 fix(p1): address review findings (round 1)"
  ],
  "confirmedFindings": [
    "R1: knip gate failed on .btest.ts-reachable files (entry added)",
    "R1: deferred rejection revert replayed a stale captured snapshot; echo guard could drop genuine external notifications in the submission window (adapter fixed: fresh host read at revert; predicted-echo-only guard; new race tests)",
    "R1: test:browser had no CI invocation path (harness gained a system-Chrome fallback tier; CI step wired)",
    "R1: decision record omitted renderMath as a second inactive-render hook (catalog corrected; fork seam upgraded to the CustomBlockRendering{dom,segments?} shape mirroring MathRendering)",
    "R1: real-clipboard assertion was a tautology (replaced with an unconditional behavioral assertion behind an asserted capability probe)",
    "R1: pointer-drag proof partially tautological + sourceSlice doc mismatch (fixed slice source; overclaims withdrawn from the decision record; drag-precision scoped as open for P1b2)"
  ],
  "advisories": [
    "Case 6 pointer-drag assertion remains inert (honestly labeled; P1b2 must make it invertible or delete it)",
    "New CI browser-test step is correct by construction but has not yet executed on a real GitHub runner"
  ],
  "gate": {
    "commands": [
      "bun install --frozen-lockfile / typecheck (root + editor) / editor test 126:0 / test:browser 39:0 (3 suites) / purity / architecture / generated-files / knip / desktop 2132:0 / cli 1810:0 — all exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": [],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "All 8 D5 mandatory cases exercised against the exact pinned runtime in real Chromium: 1/1b/2/3/6/7/8 PASS, case 4 (and consequently 5) FAIL — no generic custom-block hook. Verdict FORK, ratified: minimal CustomBlockRendering seam on the paragraph/unhandledBlock arms, executed as SFE-P1b2."
}
```

### SFE-P1b2 — Minimal internal fork: `renderCustomBlock` seam

```json
{
  "status": "complete",
  "baseSha": "00806d8c",
  "headSha": "2aa10f43",
  "history": [
    "1df7ce37 chore(p1): vendor minimal vscode markdown editor fork",
    "f5df9dff test(p1): prove renderCustomBlock — D5 suite fully green on the fork",
    "2aa10f43 fix(p1): address review findings (round 1)"
  ],
  "confirmedFindings": [
    "R1: verify-vendored was a required integrity gate with no CI path and no sabotage self-test (script wired as check:vendored in CI; 20-assertion self-test added)",
    "R1: verify-vendored lacked a completeness walk and an upstream baseline for the patched files (git ls-files completeness pass + upstreamBaseline pre-patch hashes added; delete-entry-then-edit bypass reproduced and closed)",
    "R1: the fork applied only half the code-block path's wrapping — md-block class now added by the fork itself; PATCHES.md hunks corrected to quote the full expressions"
  ],
  "advisories": [
    "No test yet exercises the host-applies-md-block contract with a provider that omits the class (regression path already closed by the checksum pin)",
    "verify-vendored's scripts/ allowlist and git-tracked-only scope are the remaining narrow holes in the completeness claim"
  ],
  "gate": {
    "commands": [
      "install / typecheck / editor 126:0 / test:browser 51:0 (4 suites) / verify-vendored self-test 20 ok / check:vendored 26 hashes + 33 files accounted / purity / architecture / generated-files / knip / desktop 2132:0 / cli 1810:0 — all exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["D5 suite fully green against the fork — cases 4/5 PASS via renderCustomBlock with real per-character segments (option a)"],
  "deletionLedgerUpdates": ["Fork carries its own deletion trigger: remove packages/vscode-markdown-editor when upstream ships an equivalent generic block-render hook (PATCHES.md)"],
  "checkpointSummary": "The ratified FORK executed: published artifact vendored with checksum+completeness integrity gates in CI, one generic CustomBlockRendering seam patched in (4 documented hunks/file), segments wired and proven — caret entry and drag precision now match the keyboard baseline on the paragraph probe."
}
```

### SFE-P1c — Pure document session and desktop host adapter

```json
{
  "status": "complete",
  "baseSha": "85874a9a",
  "headSha": "95034a8b",
  "history": [
    "d338ea15 refactor(p1): extract pure document-session state machine",
    "4895af7b feat(p1): desktop document host proven by the shared contract suite + refactor(p1): thin EditorBuffer onto the document session",
    "95034a8b fix(p1): address review findings (round 1)"
  ],
  "confirmedFindings": [
    "R1: two sources of truth for document identity — cross-file write on restoreContent, a flush() hang (pre-fix repro required a process kill), and the version-0 collision across file switches (fixed: two-phase beginRestore/finishRestore, documentId-keyed flush guard, strictly monotonic versions; all sabotage-verified)",
    "R1: duplicate LayoutBlockKind with a false blocker comment (single shared definition now)",
    "R1: replaceExternal after reset() broke the clean-implies-not-dirty invariant (explicit no-document guard + regression)",
    "R1: shipped comments asserted a pre-integration state the merged code contradicts (rewritten)"
  ],
  "advisories": [
    "commands.ts provenance comment now circular after the LayoutBlockKind extraction (low, comment-only)",
    "an edit() before the first open() can reuse version 1 across the first identity boundary (residual tail, documented; unreachable through EditorBuffer's real flow)"
  ],
  "gate": {
    "commands": [
      "install / typecheck / editor 160:0 + 51:0 browser / desktop 2252:0 + svelte-check 829 files 0 errors + lint / cli 1810:0 / architecture / generated-files / vendored / knip — all exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-05 further evidenced (shared contract suite green on both hosts)"],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "The authoritative source lifecycle is now a pure, exhaustively-pinned state machine (72 transition tests); DesktopDocumentHost passes the same contract suite as the memory host plus 13 desktop-specific cases; EditorBuffer is a thin reactive shell with its public API byte-identical and all 27 pre-existing pinned test files green; the shared EditorCommand union and the first desktop->editor dependency edge are in place. Checkpoint A group (P0-P1c) complete."
}
```

### SFE-P2a — Standard Markdown rich editor

```json
{
  "status": "complete",
  "baseSha": "d6c3a2b5",
  "headSha": "fbc2862a",
  "history": [
    "cfebcef7 feat(p2): back the editor mount with the fork surface",
    "b81b8f06 feat(p2): shared formatting-command layer as pure source transforms",
    "51f3998a test(p2): byte-identity, locality, and randomized corpora",
    "d0edefc3 / 828c9fde / fbc2862a fix(p2): address review findings (rounds 1-3)"
  ],
  "confirmedFindings": [
    "R1: toggle-code-block unfencing could DELETE authored content (closing-fence line-boundary detection rewritten; unclosed fences fall through non-destructively)",
    "R1: set-heading absorbed a thematic break after a list item/blockquote as a setext underline (opensOtherBlock guard)",
    "R1: toggle-italic destroyed **bold**/__bold__ markers (contiguous marker-run parity detection, applied identically to edit and commandState)",
    "R1: ordered-list toggle pair destroyed the author's numbering (recoverable double-stack pattern; byte-exact inverse restored)",
    "R1: desktop toolbar mapping was not behavior-identical (caret math + per-line minimal dispatch restored; false header claims rewritten; divergences pinned by new tests)",
    "R1: the locality corpus's oracle was the host's own splice — tautological (independent per-command-family bound added, sabotage-proven at ~1468 failing assertions against a widened implementation)",
    "R1: the corpus never exercised a single refusal (refusal-liveness test asserts both named reasons fire under the fixed seed)",
    "R1: a moved-assertion supersession claim was false for the re-entrant-dispose case (self-disposing-host regression added)"
  ],
  "advisories": [],
  "gate": {
    "commands": [
      "install / typecheck / editor 3003:0 unit + 65:0 browser (5 suites) / desktop 2260:0 + svelte-check 841 files + lint / cli 1810:0 / architecture / generated-files / vendored / knip — all exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-03 and AC-04 evidenced for standard Markdown"],
  "deletionLedgerUpdates": ["diff.ts + DOM stub + racy-host superseded and deleted (-377 LOC)"],
  "checkpointSummary": "The rich editor is real for standard Markdown: the mount runs the fork surface with embedded CSS, twelve formatting commands emit minimal source edits with byte-exact toggle inverses, ten desktop toolbar actions share the implementation, and the corpora that prove it were themselves hardened until they could fail. Review ran the full three repair rounds and approved."
}
```

### SFE-P2b — Sparse Gutterpress projection

```json
{
  "status": "complete",
  "baseSha": "065d55f0",
  "headSha": "6bf082d1",
  "history": [
    "8fd16e91 feat(p2): browser-safe sparse editor projection",
    "7243a9bc feat(p2): gutterpress projection consumer layer + feat(p2): enforce D13 projection caps",
    "de549260 / 3ec2d36f / 6bf082d1 fix(p2): address review findings (rounds 1-3)"
  ],
  "confirmedFindings": [
    "R1: CI ran editor gates before packages/cli/dist existed (build:library step added + gate order fixed)",
    "R1: limits.btest.ts invoked by nothing (wired into test:browser — now 7 suites)",
    "R1: match.ts wrong-block chip on duplicate marker text (last-write-wins replaced by fail-closed ambiguous-key drop)",
    "R1-R3: match.ts failed OPEN on projection-refused markers across three successive shapes (blockquote, no-blank-separator/list-item/CRLF, then the general class) — converged on a whole-document line-indexed container-prefix-stripping ambiguity detector; the reviewer-suggested consuming-cursor design was rejected with live browser evidence that it breaks chip-restore-on-deactivation, documented in the module header",
    "R1: the D13 fail-closed browser proof was vacuous (fixture matched nothing regardless of limited — replaced with matched control + over-cap isolation)",
    "R1: two committed comments asserted nonexistent integrator work/defects (corrected)"
  ],
  "advisories": [
    "Over-suppression: a marker line quoted inside a fenced code block or HTML block kills the real top-level marker's chip (fail-closed direction, P2c input)",
    "The ambiguity guard is a text heuristic that must track the fork's container semantics (projection-evidence alternative recorded for P2c consideration)",
    "The 4-space indented-code duplicate is protected by the fork's behavior, not the guard",
    "A pre-existing markers.js nesting quirk surfaced during verification (out of scope, recorded)"
  ],
  "gate": {
    "commands": [
      "install / cli build (render purity) / typecheck / cli 1860:0 / editor 3028:0 unit + 90:0 browser (7 suites) / purity / desktop 2260:0 + svelte-check 842 files / architecture / generated-files / vendored / knip — all exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-07 evidenced for core markers", "AC-08 evidenced"],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "The editor understands Gutterpress: exact-range projections from the real pipeline's own evidence (declaration-line spans, G-05-clean), marker chips with per-character segments, inert raw-html, read-only generated previews, fail-closed caps and ambiguity handling — with the review driving the matcher from fail-open to fail-closed across three adversarial rounds. Includes recovery from a mid-run container restart: Lane C's completed work was recovered from the journal, Lane B's was verified directly against every gate. P2c (plugin transform-origin) is next."
}
```

### SFE-P2c — Project plugins, transform origin, and trusted rendering

```json
{
  "status": "complete",
  "baseSha": "d0de018d",
  "headSha": "a9fb0090",
  "history": [
    "93c14f47 feat(p2): plugin-aware projection with an explicit trust gate",
    "6ee0eb64 feat(p2): evidence-based plugin transform origin + plugin-region views",
    "24306d9c / e7b08cc6 / a9fb0090 fix(p2): address review findings (rounds 1-3)"
  ],
  "confirmedFindings": [
    "R1: the rule-4 copy shape (one consumed region, two output regions) went undetected — sibling open tokens in the added run now refuse independently",
    "R1: rule-named refusal reasons were computed then discarded behind one generic diagnostic — the rule name now reaches projection.diagnostics end to end",
    "R1: plugin-region ranges were emitted with no self-check (container-prefix over-claim, nested markers, uncorroborated wide maps) — authored-shape guard + overlap guard added on both the evidence-bearing and recovered paths",
    "R1: base-pipeline rules (footnote_tail, curly_attributes) ran inside the origin bracket and had their effects attributed to the plugin by name — tight per-rule bracketing added, plus a latent bug where the diff compared against the caller's post-completion array rather than the captured snapshot",
    "R1: refused regions shipped no source affordance and the justifying comment cited a nonexistent spec sentence — diagnostics now flow to onDiagnostic as a document-level notice (no chip over an unverified span)",
    "R1: the inactive plugin view rendered authored source rather than the plugin's own HTML — now rendered through the same renderer the print path uses, capped by D13, failing closed",
    "R2-R3: bidirectional containment and further residual shapes (see the run's review log)"
  ],
  "advisories": [
    "The raw-html overlap guard is order-sensitive: a footnote-relocated html_block that previously projected out of order now refuses (fail-closed direction)",
    "A trusted plugin-region can still claim a span wider than its tokens wrapped; the invariant holds but the claim is over-wide"
  ],
  "gate": {
    "commands": [
      "install / cli build (render purity) / typecheck / cli 1913:0 / editor 3038:0 unit + 99:0 browser (8 suites) / purity / desktop 2260:0 + svelte-check 842 files / architecture / generated-files / vendored / knip — all exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-07 fully evidenced", "AC-23 evidenced for P2"],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "Plugin regions are real and safe: plugins execute host-side only (proven by bundle scan), a clean-splice origin mechanism recovers authored ranges from token object identity across a tightly-bracketed plugin boundary, six distinct shapes refuse by rule name, and everything the mechanism cannot prove falls back to plain source editing with a diagnostic. Three review rounds; P2 is complete."
}
```

### SFE-P3ab — Desktop rich mode and authoring parity

```json
{
  "status": "complete",
  "baseSha": "62fa1457",
  "headSha": "daef08cf",
  "history": [
    "a5c74f29 feat(p3): mount the shared rich editor in the desktop",
    "3578bb46 feat(p3): rich-mode command surface and authoring controls",
    "5250d1c4 feat(p3): surface the live caret and bind rich commands to it",
    "27f49e0a / daef08cf fix(p3): address review findings (rounds 1-2)"
  ],
  "confirmedFindings": [
    "R1: rich mode was a second, never-refreshed document owner — preview commits bypassed richDocHost and the next rich command silently reverted them",
    "R1: block movement corrupted fenced code, misclassified @mention prose as markers, and swapped content across scope-affecting marker boundaries",
    "R1: rich mode mounted over non-Markdown files with no way back (now gated on isMarkdownPath, with richSurfaceActive as the single source of truth for the live surface)",
    "R1: rich-mode Link destroyed a non-collapsed selection (the toolbar's fixed placeholder override is now cleared when a real selection exists, matching source mode)",
    "R1: async-dialog selections were re-applied with no document identity (image properties + snippet picker now capture {host, version, selection} and refuse EDITOR_STALE_EDIT)",
    "R1: getSelection()'s 'never focused' contract was false and its consumers failed open (browser-proven recurrence; explicit caret-relative callers now refuse with NO_LIVE_CARET)",
    "R1: the desktop never built a D6 projection, so mountGutterpressEditor and its diagnostics were unreachable (now built via the browser-safe gutterpress/render subpath in lockstep with richDocHost)",
    "R1: lane-ownership violation — the selection accessor shipped under an undefined 'Lane D' label (spec amended to name Lane C; every in-code attribution rewritten)",
    "R2: a project plugin's OPENING marker was unprotected while its @end-* closer was a boundary, so one swap could evict the region's body — fixed by structural opener/closer pairing, not by widening the marker vocabulary"
  ],
  "advisories": [
    "Plugin-region pairing is deliberately conservative and can refuse a legitimate move (fail-closed; source mode always remains available)",
    "The desktop projection is not project-plugin-aware and is not rebuilt per keystroke, matching mountGutterpressEditor's documented rebuild-and-remount contract"
  ],
  "gate": {
    "commands": [
      "install / cli build (render purity) + cli 1913:60 / typecheck (4 workspaces) / editor 3038 unit + 109 browser (8 suites) + browser-purity / desktop 2380:1 + svelte-check 889 files + lint + build (renderer purity, 144 files) / architecture (route ratchet 104==104) / generated-files (1246 tracked) / vendored (26 hashes, 33 files) / knip — all 15 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": [
    "AC-09 evidenced",
    "AC-11 evidenced for the desktop surface (P3d packaged/a11y/perf sweep still owed)"
  ],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "The desktop authors in rich mode for real: the shared editor mounts behind a lazily-loaded shell over the same DocumentHost the source surface and the preview commit engine write through, twelve commands plus images, links, layout markers and block movement route through the shared implementation rather than a desktop copy, the live caret is a first-class contract on both mounts, and projection diagnostics reach the UI with a source-mode escape. Two review rounds; nine confirmed findings, most of them silent data-loss paths."
}
```

### SFE-P3d-parity — The parity gate that must be green before P4

```json
{
  "status": "complete",
  "baseSha": "079efe49",
  "headSha": "b9ca42a9",
  "history": [
    "50fdacb5 feat(p3): derived parity gate, real-book byte-drift and separability evidence (lanes A/B/C)",
    "cf917ab2 docs(p3): amend SFE-P3d-parity with lanes D and E",
    "cf25729b feat(p3): close the image/link parity gaps and add a plugin-book corpus (lanes D/E)",
    "b9ca42a9 fix(p3): address review findings (round 1)"
  ],
  "confirmedFindings": [
    "R1: the parity gate was not standing — neither check:parity nor its 410-line sabotage suite had any CI invocation, under a comment in that workflow reading 'a gate that exists but is never invoked is the same as no gate at all'",
    "R1: the derived extraction dropped mutation-capable actions SILENTLY in six ordinary TypeScript shapes (method-shorthand run, modifier-less helper, class-field arrow, module-level function, object spread, bound method reference) — all six exited 0 with RULE 3 PASS, and the live block-edit action was already invisible to its own file's extraction",
    "R1: fail-open — one ordinary /['\\\"]/g regex collapsed the whole context-menu extraction to zero, and AP-21 liveness was computed on the UNION of both files so the gate still exited 0",
    "R1: none of the ten replacement commands the matrix named for condition 2 was exercised by any test — the cited suites drove the pure token module, not the wrappers holding the only non-pure logic",
    "R1: the source-mode staleness guard was a byte compare at fixed offsets with no document identity — a file switch during the dialog could write into the wrong document",
    "R1: the caret-token refusal covered fenced blocks only and would rewrite real committed book content markdown-it renders as literal (reproduced against examples/with-design-guide/design-guide/05-layout.md)",
    "R1: load-bearing header comments named four command functions that do not exist",
    "R1: two factual claims in the checker's LIMITATIONS header were false",
    "R1: condition 3's no-edit test titles claimed a rich mount that never occurs"
  ],
  "advisories": [
    "The widened literal-region refusal over-refuses two ordinary shapes and reports them with a 'code block' message",
    "RULE 1b attributes a commit call site to any commit-reaching method, even when no item consumes it",
    "evidenceReferencesReplacement passes a row when ANY one of its replacements is referenced by ANY one evidence file",
    "A doc comment in +page.svelte still describes the two surfaces' staleness guards as differing in kind",
    "The desktop's buildRichProjection does not yet build a plugin-aware projection — createEditorProjection's capability is proven, the desktop's wiring of it is not",
    "ContextMenuController still takes commitEngine as a non-optional dependency and reads commitEngine.generation at every menu build — P4 removes that coupling itself",
    "packages/desktop tests now reach into packages/editor's test tree by deep relative path (reusing P2a's oracle) — a cross-package coupling no fitness check covers"
  ],
  "gate": {
    "commands": [
      "install / typecheck (4 workspaces) / cli build (render purity) + 1913:60 / editor 3038 unit + 109 browser (8 suites) + browser-purity (35 files) / desktop 5981:1 + check (892 files) + lint + build (render purity, 145 files) / check-parity self-test + gate (13 extracted, 13 mapped, 0 waivers) / architecture (route ratchet 104==104) / generated-files (1273 tracked) / vendored (26 hashes, 33 files) / knip — all 17 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": [
    "AC-03 fully evidenced (real-book byte identity)",
    "AC-04 fully evidenced (real-book locality)",
    "AC-21 evidenced for P3",
    "AC-12 evidenced for the preview-navigation half"
  ],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "Parity conditions 1-4 are green on derived, sabotage-proven evidence; condition 5 is the product owner's. The run's real find was a capability loss P4 would have shipped: no command in either editing surface could change an EXISTING image or link, and the only in-place rewriter lived in the preview context menu P4 deletes. The review then found the gate itself defeatable in six ordinary code shapes and a data-loss bug that rewrote a real book's code sample — both fixed. P4 is unblocked on technical grounds, pending sign-off."
}
```

### SFE-P3e — Plugins in the rich editor for real, and machinery removal

```json
{
  "status": "complete",
  "baseSha": "cf66572c",
  "headSha": "317bb490",
  "history": [
    "fba2bead feat(p3): plugin-aware rich-editor projection; delete parity analyzer and scanners (lanes A/B)",
    "7a5e9f8e feat(p3): gutterpress/plugins subpath; the desktop host uses the one real loader (lane C)",
    "b6aeb814 / 8ec005d6 / 317bb490 fix(p3): address review findings (rounds 1-3)"
  ],
  "confirmedFindings": [
    "R1: the headline feature was inert in the app — richDocHost published synchronously while the host projection arrived an IPC round trip later, so the mount always took mountEditor and P3ab's marker chips regressed with it",
    "R1: the parser-evidence gate was block-scoped, not caret-scoped — a code-span occurrence became editable when the same destination appeared for real in the block",
    "R1: new over-refusal — images/links inside GFM table cells (map-less inline tokens) could no longer be edited",
    "R1: the de-duplicated plugin loader was re-duplicated at BUILD level — electron-vite externalized only bare 'gutterpress', bundling render+plugins subpaths into out/main/main.js (827 KB -> 197 KB after the one-line RegExp fix)",
    "R1: fixture manifest and support docs still described the deleted duplicate loader",
    "R1: host-projection failure degraded silently and D13's 2 MiB ceiling had no user-visible effect",
    "R2: occurrence numbers were counted in two coordinate spaces (document vs. the block's own state.src) — the false accept survived round 1 and repeated tokens across blocks falsely refused",
    "R2: the .code-tagged thrown Error never crossed Electron's IPC serialization — replaced by a RESOLVED discriminated outcome threaded through the whole seam",
    "R2: round 1's deferred publication re-opened the committed-preview-edit divergence (cross-chapter CommitEngine race) — closed via richDocHostPending awaited in selectEditorFile",
    "R3: the same occurrence inversion reproduced inside a GFM table row — fixed with one InlineScope per inline token, both occurrence numbers counted in the same string by construction"
  ],
  "advisories": [
    "An escaped pipe in a table row refuses every image/link in that row (fail-closed, broader than necessary)",
    "Per-cell scope recovery is positional string matching, not a parser range",
    "Images inside a raw html_block now refuse (fail-closed behavior change vs. baseline)",
    "Full-document reparse (~80-105 ms at 250 KiB) per toolbar invocation on the UI thread — fine for clicks, not for any future per-keystroke reuse",
    "Rich mode feeds plugin code unsaved buffer content where the preview processes saved files — same project, same trust decision, slightly wider input set",
    "Deleting the analyzer removes the ratchet that would catch a NEW mutation-capable preview action before P4 — accepted explicitly by the product-owner ruling; P4's review re-verifies the matrix once, at deletion time"
  ],
  "gate": {
    "commands": [
      "install / typecheck (4 workspaces) / cli build (render purity) + 1913:60 / editor 3038 unit + 109 browser (8 suites) + browser-purity (35 files) / desktop 6017:1 + check (896 files, 0 errors) + lint + build (render purity, 145 files) + electron:build (subpaths external, node --check on out/main+preload) / architecture (route ratchet 104==104) / generated-files (1276 tracked) / vendored (26 hashes, 33 files) / knip — all 16 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": [
    "AC-07 now evidenced through the DESKTOP's own wiring (not just createEditorProjection in isolation)",
    "AC-23 evidenced for the rich-editor plugin boundary (host-only execution, opened-project trust, validated IPC)",
    "AC-20 advanced: net -2,300 lines of machinery removed this run against a one-module feature addition"
  ],
  "deletionLedgerUpdates": [
    "tools/check-parity.mjs + check-parity.test.mjs + root script + 2 CI steps deleted (-2,142 LOC)",
    "caret-token literal-region scanners replaced by parser evidence",
    "desktop duplicate plugin loader deleted (-129 LOC in editor-projection.ts) in favor of the D11 gutterpress/plugins subpath"
  ],
  "checkpointSummary": "The 90% feature is real: a plugin-using project's chapters show plugin regions in the desktop's rich mode, built host-side by the one loader the preview uses, trusted by the same opened-project decision, degrading per-plugin with visible diagnostics. Getting there took three review rounds because the first wiring was inert in the actual app and the parser-evidence rewrite had to converge from block-scoped to caret-and-cell-scoped occurrence identity. Net complexity is strongly negative per the product-owner ruling."
}
```

### SFE-P3c — VS Code extension implementation

```json
{
  "status": "complete",
  "baseSha": "a3e0da88",
  "headSha": "0768ab7f",
  "history": [
    "fe344658 feat(p3): VS Code authority layer — protocol, gateway, proxy host, build (lane A)",
    "f1b4a5f8 feat(p3): VS Code project integration and webview entry; spec addendum (lanes B/C)",
    "5dc78c69 fix(p3): stamped reconciliation, message merge, projection upgrade path (lane D)",
    "c003057e / 0768ab7f fix(p3): address review findings (rounds 1-2)"
  ],
  "confirmedFindings": [
    "R1: dist/extension.js was not loadable by a real extension host — gutterpress was bundled in, dragging unpdf's import.meta.resolve into CJS (now externalized, with a real-node load test)",
    "R1: the webview bundle was ESM behind a classic script tag — the editor could never mount in a real webview (type=module + a production-shell browser proof over the real renderWebviewHtml output)",
    "R1: every accepted keystroke rebuilt the projection and dispose-remounted the editor (projection now resends only on ready and trust grant)",
    "R1: projection staleness conflated the host's version with the mirror's local version — the class the reconciliation addendum removed for edits, reintroduced for projections (now remapped through the host stamp, conservative NEGATIVE_INFINITY fallback, negative browser test)",
    "R1+R2: a queued edit dispatched after a REJECTED in-flight edit applied against a state that never existed — silent source corruption; round 1's repair report silently omitted this one and round 2 caught the omission (a rejection now discards the queue with the replacement)",
    "R1: manifest plugin paths were not workspace-root-scoped — a ../ escape LOADED AND EXECUTED code outside the project (path containment before the loader, refusal fixture, marker-file proof it never executes)",
    "R1: absolute filesystem paths crossed into the webview via pluginErrors (fixed sanitized wire messages; raw errors stay host-side)",
    "R1: D9's trust explanation was unimplemented — trust-state and pluginErrors reached the webview and were discarded (a real notice banner, browser-proven including both clearing mechanisms)",
    "R1: gutterpress.preview could serve the wrong project after restart (identity handle never updated)",
    "R1: one malformed inbound message permanently destroyed the editing surface while the mirror stayed writable",
    "R1: the gateway's echo suppression rested on an uncited applyEdit/onDidChangeTextDocument ordering the fidelity mock only reproduced in the favourable order",
    "R1: the host-fidelity scaffold looked up an extension id that can never exist and was wired to no gate",
    "R1: the run's evidence record did not exist — 19 comments cited a report that was never written (now the run spec's Deviations and evidence section)",
    "R1: build.mjs's webview placeholder was dead machinery with a false header and a silent-fail path",
    "R2: bun install --frozen-lockfile failed — the lockfile was not regenerated after the @vscode/test-electron removal"
  ],
  "advisories": [
    "A rejected in-flight edit with unchanged host text emits one redundant version bump + EXTERNAL_REPLACEMENT diagnostic (fail-closed direction)",
    "Real-VS-Code activation is a recorded deviation: @vscode/test-electron is scaffolded (tests/host-fidelity/, own script, honest UNVERIFIED header) but its VS Code download is network-blocked in this environment — first host with network access should run it",
    "webview.postMessage FIFO ordering between one sender/receiver pair is reasoned, not observed in a real host — recorded where the reconciliation and handshake logic lean on it",
    "The fidelity mock is LF-only; CRLF TextDocument offset math is unverified against a real host"
  ],
  "gate": {
    "commands": [
      "install (frozen) / typecheck (4 workspaces) / vscode-extension 228 unit + 34 browser (9 suites) + build / editor 3038 + 109 browser + purity / cli build (render purity) + 1913:60 / desktop 6017:1 + check (896 files) + lint + build (render purity) / architecture (route ratchet 104==104) / generated-files (1319 tracked) / vendored (26 hashes) / knip — all 18 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": [
    "AC-06 evidenced (one shared mount, two real hosts, one contract suite)",
    "AC-10 evidenced (with the recorded real-VS-Code-activation deviation)",
    "AC-23 evidenced for the VS Code boundary"
  ],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "The same editor that runs in the desktop now runs as a VS Code custom text editor: TextDocument and WorkspaceEdit own persistence and undo, a stamped one-in-flight reconciliation keeps the webview mirror honest under latency and rejection, plugins load host-side only under workspace trust with path containment, and the CSP'd webview is proven in real Chromium. The review needed three rounds and its first pass found the extension would not have loaded in a real VS Code at all — the strongest argument this program has produced for reviewing against the built artifact, not the source."
}
```

### SFE-P3d-sweep + SFE-P3f — Interaction/a11y/perf sweep, fork measurement patch, Checkpoint B

```json
{
  "status": "complete",
  "baseSha": "bc98a23f",
  "headSha": "873e9d94",
  "history": [
    "57d3e684 test(p3): P3d sweep — scenario audit, five gap closures, a11y, D13 numbers (lanes A/B/C)",
    "f2b08636 / ef63b406 docs+test(p3): lane D — D13 root cause proven inside the fork",
    "80b77f1d / f3e6f2e4 docs+perf(p3): SFE-P3f fork measurement patch (Patch 2)",
    "404c0583 / d1b6e573 fix(p3): address review findings (rounds 1-2)",
    "873e9d94 test(p3): drift-immune interleaved perf control"
  ],
  "confirmedFindings": [
    "R1: fork Patch 2 was fast but WRONG — the cached visual-line map was not keyed on absoluteStart, so pointer->offset and caret math were stale for every block after an edit; fixed with the absoluteStart guard and a defect-class test that fails against the pre-fix bytes",
    "R1: no test in the tree could detect that defect class — the browser safety net never re-queried pointer math on a reused block after an edit; closed via fork-hook.btest.ts's new correctness block driving the fork's own offsetAtClientPoint",
    "R1: PATCHES.md's correctness proof was false as written, and the upstream draft was ready-to-file on the same false argument — both corrected, the 45-50% improvement claim withdrawn as an artifact of the broken cache",
    "R1: the audit's before/after numbers were measured on the incorrect implementation — re-measured on the corrected patch: 250 KiB p95 551.8-577.0 ms, statistically the unpatched baseline for mid-document typing (the benchmark types at ~937 of 256,018 chars — worst case for the corrected patch, whose mechanism is verified real for end-of-document typing)",
    "R1: the G-12 perf control was vacuous (both assertions passed with zero injected slowdown) and echo-guard's liveness tolerance was 10x its signal — both made differential/tightened",
    "R1: audit mis-nesting and an over-claiming pointer-drag test title — corrected",
    "R2: PATCHES.md's new fallback-over-shift section stated the opposite of what was measured — corrected",
    "Post-gate: the sequential differential control produced a drift false-negative under sandbox contention (delta 63.3 ms of an injected 150) — made interleaved per-keystroke; now measures 151.1/123.6/144.2 ms"
  ],
  "advisories": [
    "A pre-existing prototype claim elsewhere in PATCHES.md still cites the flawed-benchmark reduction, labeled as such",
    "drive.ts's click+End navigation lands at ~937 of 256,018 characters — the named priority follow-up for the perf work",
    "The EditContext input-path residual suspect is located, not proven — its earlier attribution was measured on the flawed benchmark and needs re-profiling after the navigation fix"
  ],
  "gate": {
    "commands": [
      "install / typecheck (4 workspaces) / cli build + 1913:60 / editor 3038 unit + 121 browser (9 suites) + purity / vscode-extension 228 + 35 browser + build / desktop 6045:1 + check + lint + build / vendored (Patch 2 hashes) / architecture (104==104) / generated-files / knip — all exit 0; test:perf exits 1 on exactly the two 250 KiB D13 budget assertions (designed red, AC-24's recorded state) with the interleaved control and both mechanism guards green"
    ],
    "passed": true
  },
  "acceptanceUpdates": [
    "AC-11 evidenced (with recorded open a11y items)",
    "AC-24 measured — NOT met, honestly red with named follow-ups"
  ],
  "deletionLedgerUpdates": [],
  "checkpointSummary": "Checkpoint B is assembled in the run spec: fork decision, both hosts' behavior, parity/security/a11y evidence, and the corrected performance narrative. The review's defining catch: a fork patch that was fast but wrong — stale caret math for every block after an edit, invisible to 118 green browser tests — fixed soundly at the cost of the apparent win, with the withdrawal recorded in every document that had cited it. The D13 budget stays red with three ordered follow-ups; the parity gate that governs P4 is green and its designated blocker closed."
}
```

### SFE-P4 — Delete preview editing and the mutation machinery

```json
{
  "status": "complete",
  "baseSha": "cf5dacda",
  "headSha": "81b482c3",
  "history": [
    "731aee7e refactor(p4): delete the desktop side of preview editing (-4,172)",
    "6080b4a4 refactor(p4): delete the book side — protocol v9 (-722)",
    "781809b3 docs(p4): ledger totals, search proofs, doc statusing",
    "0944088b / 81b482c3 fix(p4): address review findings (rounds 1-2, -1,825 more)"
  ],
  "confirmedFindings": [
    "R1: a live 1,047-line Playwright E2E of the deleted feature survived untouched with its npm script and CI reference (deleted; mutation-inventory.md had explicitly required it be listed, not silently dropped)",
    "R1: parity-matrix.md's block-edit row — the row authorizing this run's central deletion — cited a test this run deleted (surviving evidence named; preamble corrected)",
    "R1: the ledger's survivor dependency proof was contradicted by its own quoted grep (real consumer set recorded with verbatim output)",
    "R1: selection-search.ts (358 LOC) and its 433-line test were fully orphaned and left in the tree (deleted with search proof)",
    "R1: the ledger's mutation-only-source-metadata row over-claimed DONE while data-gp-source-token/-occurrence are still emitted (downgraded to PARTIALLY DONE with exact files/lines and a named follow-up)",
    "R1: stale present/future-tense comments describing the deleted flows as present (rewritten as history)",
    "R1: a claimed doc-status edit the diff did not support (made real)",
    "R2: the round-1 repair's own E2E deletion was missing from the ledger, leaving the headline LOC wrong by 1,034 lines (totals re-derived from git)"
  ],
  "advisories": [
    "data-gp-source-token/-occurrence attribute emission survives with no consumer — small packages/cli follow-up, tracked in the ledger",
    "The preview-shell test harness cannot exercise the double-rAF old-iframe removal (no requestAnimationFrame in its sandbox) — a pre-existing limitation the replacement swap test works within, recorded"
  ],
  "gate": {
    "commands": [
      "install / typecheck (4 workspaces) / cli build + 1913:60 / editor 3038 + 104 browser + purity / vscode-extension 228 + 35 browser / desktop 5859:1 + check (893) + lint + build / architecture / generated-files (1329) / vendored / knip — all 17 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-13 evidenced"],
  "deletionLedgerUpdates": ["Preview mutation protocol messages 5 → 0 (v9)", "InlineEditController, CommitEngine, context-menu mutation half, in-flow contenteditable path, inline-editing E2E, selection-search pair: deleted with SHAs", "Run net: −6,719 LOC"],
  "checkpointSummary": "The preview no longer edits anything: the mutation half is gone on both sides of the bridge, the read-only D8 surface is pinned green, and the review twice corrected the run's own bookkeeping before approving — including catching a live E2E of the deleted feature and the matrix row that authorized the deletion citing evidence the deletion had removed."
}
```

### SFE-P5a — Delete the dormant PWA implementation

```json
{
  "status": "complete",
  "baseSha": "c33868f8",
  "headSha": "c6704b52",
  "history": [
    "5db8c581 refactor(p5): delete the dormant PWA host (~-2,700)",
    "2aa01524 / c6704b52 fix(p5): address review findings (rounds 1-2)"
  ],
  "confirmedFindings": [
    "R1: the orphaned static viewer bundle was REGENERATED by every CLI library build — build-engine-bundles.mjs's unconditional copy step meant a plain delete would silently resurrect; fixed at the generator, proven with a clean-slate rebuild",
    "R1: the ledger's P5a section committed stale against its own commit (no head SHA, mid-flight framing, proofs describing already-fixed defects as open)",
    "R1: ux-design-contract.md still declared the PWA SHIPPED and delegated normatively to the closed WebAdapter plan",
    "R1: CLAUDE.md §8's capability class 3 (FSA-divergent fs) still justified the Platform seam with an implementation that no longer exists",
    "R1: the desktop README documented a browser-tab dev mode that now hard-throws before first paint (replaced with an honest two-mode story pointing at electron:hmr)",
    "R2: the round-1 repair's §3 rewrite deleted the shipped desktop auto-save spec along with the PWA content (restored verbatim, citation repointed)"
  ],
  "advisories": [],
  "gate": {
    "commands": [
      "install / typecheck (4 workspaces) / cli build + 1913:60 / editor 3038 / desktop 5815:1 + check (889) + lint + build (render purity, 143 files) / architecture (104==104) / generated-files (1319) / vendored / knip — all 13 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-14 evidenced"],
  "deletionLedgerUpdates": ["WebAdapter 901 + web-fs 279 + web-store 167 + fsa.d.ts 31 + service-worker 110 + four test suites 560 + manifest + viewer bundle + generator copy step: deleted with SHAs and proofs; net -2,546 LOC over 19 production+test files (corrected in P7 repair round 1 from an uncorroborated ~-3,100 figure — see deletion-ledger.md's SFE-P5a section, `git diff c33868f8..5db8c581`)"],
  "checkpointSummary": "The desktop package hosts exactly one product again. The review's defining catch was the build step that would have silently resurrected the deleted viewer bundle on the next build — the difference between deleting a file and deleting a feature."
}
```

### SFE-P5b — Feature-owned capabilities replace the Platform locator

```json
{
  "status": "complete",
  "baseSha": "951623d7",
  "headSha": "7f369ad2",
  "history": [
    "f45d7961 refactor(p5): replace the Platform service locator with feature-owned capabilities",
    "a0e1e97e / 7f369ad2 fix(p5): address review findings (rounds 1-2)"
  ],
  "confirmedFindings": [
    "R1: four quotations attributed to the run specification exist nowhere in it — removed and re-attributed as the run's own reasoning",
    "R1: the capability map's member arithmetic did not close and its diffstat narration reported figures its own command could not produce — re-derived to a consistent 31-member baseline (20 moved, 4 collapsed, 5 dead, 1 type-only, 1 discriminant) and reproducible numstat commands",
    "R1: the DTO-relocation constraint was claimed met but only partly done — the editor-projection and capabilities types actually moved; the deliberate deferrals are now named",
    "R1: the ElectronBridge parity table claimed exact agreement over two real divergences, and electron/types.d.ts's Window.electron block is a zero-consumer duplicate flagged for P5c/P6",
    "R1: theme's onNativeThemeUpdated lost its only test in the collapse — restored as a real subscription-and-flip test",
    "R1: the platform barrel carried 15+ dead re-exports — trimmed to the seven names with live importers",
    "R1: an onFolderChanged consumer-count contradiction, six dangling HostServices JSDoc links, an unmeasured isDesktop census, a ledger section without SHAs, and a stale-prose sweep that had missed five locations including CLAUDE.md §8",
    "R2: the map's diffstat narrative disagreed with its own reproducible commands — made character-identical to the ledger's figures"
  ],
  "advisories": [
    "electron/types.d.ts's Window.electron block is a zero-consumer duplicate of the preload's own typing — P5c/P6 deletion candidate, recorded in the map"
  ],
  "gate": {
    "commands": [
      "install / typecheck (4 workspaces) / cli build + 1913:60 / editor 3038 / desktop 5823:1 + check (894) + lint + build (render purity, 143 files) / architecture (104==104) / generated-files (1332) / vendored / knip — all 13 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-15 evidenced"],
  "deletionLedgerUpdates": ["Platform/HostServices locator + 253-line adapter + 5 dead members deleted; net production +49 (modules replace forwarding), tests +280"],
  "checkpointSummary": "The desktop app has no service locator: five feature-owned capability modules over one bridge accessor, two honest collapses instead of ceremony modules, and a review that spent most of its force making the capability map — P5c's dispatch document — tell the exact truth."
}
```

### SFE-P5c — Desktop HTTP APIs to typed IPC (four subruns)

```json
{
  "status": "complete",
  "baseSha": "dc900e96",
  "headSha": "f1f369e1",
  "history": [
    "f6a6bb2d refactor(p5): P5c1 — fs/dialog/shell/log/app (104→69)",
    "c90ac668 refactor(p5): P5c2 — nine project-config groups (69→32)",
    "b77a6524 fix(p5): pass-1 review repair",
    "4616add1 refactor(p5): P5c3 — remote/sync/publish (32→10)",
    "0758cb9e refactor(p5): P5c4 — the last ten; ZERO routes",
    "df6e9f4f / f1f369e1 fix(p5): pass-2 review repairs"
  ],
  "confirmedFindings": [
    "Pass 1: fs:delete lost its fail-closed VCS-hooks gate (restored, regression-tested); tpl:listCustom exposed an unvalidated renderer-supplied absolute path (parameter deleted); dropped try/catch; four-way bridge drift incl. a silently dropped watchFolder; a re-implemented shared function; test-isolation leaks; ledger corrections",
    "Pass 2: the remote/publish error rethrow could carry a credentialed git URL to the renderer — the sanitizers redacted the log, not the throw (fixed in both wrappers, error-path tests drive a credentialed URL through the real handlers); the CI perf gate still POSTed to a deleted route; P5c4's capability modules missed the error scrub; the publish-error envelope workaround outlived its transport (AP-32, deleted); a false no-assertions-dropped claim held open until true"
  ],
  "advisories": [
    "The electron/server-bridge hooks bags survive with their rationale (reaching main-bundle mutable state) — P5d/P6 may simplify once the server dies",
    "P5d's sweep must not miss the still-live server descriptions the fossil sweep deliberately left accurate (sveltekit-host.ts, vite.config, fs-guard, README) — forward-pointer added to the plan's P5d section"
  ],
  "gate": {
    "commands": [
      "both passes: install / typecheck (4 workspaces) / cli build + 1913:60 / editor 3038 / desktop 5889:1 + check (688 files) + lint + build (render purity) / architecture (0==0) / generated-files / vendored / knip — all 13 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-16 evidenced for the route/client half"],
  "deletionLedgerUpdates": ["Desktop HTTP routes 104 → 0 (−104); IPC handlers 12 → 120 (+108); api.ts and the _lib route factory deleted; per-subrun diffstats recorded with SHAs"],
  "checkpointSummary": "Every desktop operation now crosses one validated, typed boundary. The reviews earned their keep twice over: a fail-closed gate lost in mechanical migration, and a credentialed-URL leak through an error rethrow that only a directed attack would have found. P5d deletes the server the routes no longer need."
}
```

### SFE-P5d — Static renderer, local server deleted (Checkpoint C)

```json
{
  "status": "complete",
  "baseSha": "d6092188",
  "headSha": "e4438144",
  "history": [
    "3df0ea74 refactor(p5): static renderer over app://, the local server deleted",
    "e4438144 fix(p5): address review findings (round 1)"
  ],
  "confirmedFindings": [
    "R1: the 'two independent defenses' claim was false — the containment check is the sole guard against backslash traversal; pinned by win32 tests verified to fail with the check deleted, claims reworded everywhere",
    "R1: 'packaged smoke' ran Electron unpackaged (app.isPackaged false) — relabeled honestly; the asar branch is unit-proven only and real packaged smoke stays an open item",
    "R1: CLAUDE.md and ARCHITECTURE.md still described the deleted adapter-node server; README/vite/+layout still named the P5b-deleted locator — all rewritten to the one-seam reality",
    "R1: check-render-purity's bare default scanned the nonexistent build/client (fail-open) — default, header, hint and self-test fixture fixed",
    "R1: Checkpoint C contradicted its own commit (a 'residual' already fixed, stale head, stale LOC) — corrected with reproducible commands"
  ],
  "advisories": [
    "Real packaged (asar) smoke remains open — named for the P7 sweep",
    "Checkpoint C's LOC row goes stale with every later commit by construction; the close-out records the final-at-HEAD derivation command instead of a frozen number"
  ],
  "gate": {
    "commands": [
      "install / typecheck (4) / cli build + 1913:60 / editor 3038 / vscode-extension 228 / desktop 5896:1 + check (688) + lint + build (adapter-static, purity 144 files) + electron:build / purity self-test 10:10 / architecture (0==0) / generated-files / vendored / knip — all 16 exit 0"
    ],
    "passed": true
  },
  "acceptanceUpdates": ["AC-16: route/client/server halves evidenced; packaged-smoke half pending (P7)"],
  "deletionLedgerUpdates": ["sveltekit-host (236 lines), bearer token, proxy, adapter-node deleted; app-protocol.ts (222) is the surviving boundary with traversal proofs; all-of-P5 net −3,621 LOC across 313 files"],
  "checkpointSummary": "The desktop app is one process talking to itself over one validated boundary: no server, no token, no proxy, no locator, no second host. Checkpoint C is assembled in the run spec; the one honest asterisk is that packaged-asar smoke is unit-proven, not driven, and P7 owns closing it."
}
```

### SFE-P6 — Composition roots, public exports, architecture records (Checkpoint D)

```json
{
  "status": "complete",
  "baseSha": "b7242a71",
  "headSha": "fc6f543a",
  "history": [
    "fa8ea498 refactor(p6): slim both composition roots — zero behavior change",
    "52d099b3 docs(p6): P6c — export tests, six ADRs, architecture and ownership records",
    "de4445d2 fix(p6): address review findings (round 1)",
    "fc6f543a docs(p6): review log, Checkpoint D, and the SFE-P7 run specification"
  ],
  "confirmedFindings": [
    "R1: live CI break — the new package-exports test hard-throws without a built dist/ that CI's test job never built; fixed with a build:library step before the cli test filter",
    "R1: electron/api/updater.ts hard-imported Electron at module load, breaking the hooks-only registrar pattern (green in-suite only via cross-file mock leakage); fixed by adding applyNow to UpdaterHooks — isolate runs clean",
    "R1: the .finally epoch guard in RichDocHostController was mutation-provably untested; a new race case pins it (reviewer re-mutated: exactly that test fails)",
    "R1: preload-surface.test.ts counted registrars never invoked; now asserts every exported register*Handlers is called in main.ts (mutation-proven, >20 liveness floor)",
    "R1: package-exports.test.ts was a self-referential oracle; now pins the literal surface {'.','./api','./render','./plugins'} x [default,types] (sabotage-proven, 18 cases)",
    "R1: ADR 0013 said seven hunks / one seam vs PATCHES.md's ten hunks / two patches; rewritten to the two-patch reality with a two-condition removal trigger",
    "R1: the stale-ADR decline was proven on a subset presented as repo-wide, and a new file cited nonexistent ADR 0006; re-proven repo-wide (106 files / 193 occurrences) with per-area dispositions"
  ],
  "advisories": [
    "R2 (both record-accuracy, disposed at close-out): ledger's P6c table kept pre-repair counts (annotated in place); repair report attached full-suite counts to the --isolate command (correct counts recorded in the review log)",
    "Carried to P7: plan-named check:package-exports script does not exist (mapping recorded in the SFE-P7 spec); stale capability-module counts, registrar-enumeration omissions, rename fossils, ADR 0015/0016 'all moved' phrasing; two registrations deliberately inline in main.ts"
  ],
  "gate": {
    "commands": [
      "install (frozen, 806 pkgs) / typecheck (4 workspaces) / cli build (render-pure) + 1931:60 / editor 3038 unit + 121 browser (9 suites) / vscode-extension 228 / desktop 5915:1 + check (693 files, 0 errors) + lint + build (adapter-static, purity 144 files) + electron:build (node --check) / architecture 4/4 (ratchet 0==0) / generated-files (1267) / vendored (26 hashes, 33 files) / knip — all 16 exit 0 at fc6f543a"
    ],
    "passed": true
  },
  "acceptanceUpdates": [
    "AC-17 evidenced: both roots reduced with extractions in feature owners, 26 registrars liveness-asserted, 120-channel IPC surface byte-identical across the refactor (reviewer-verified)",
    "AC-18 advanced: pinned public export surface with sabotage-proven test; final P7 sweep remains"
  ],
  "deletionLedgerUpdates": [
    "Checkpoint D assembled: +page.svelte 4,739->4,543 (-196), main.ts 2,188->1,965 (-223), run diffstat 56 files +3,887/-1,008, five advisories carried to P7"
  ],
  "checkpointSummary": "The two composition roots now compose: features own their workflows, registration lives beside the handlers, and the whole refactor is provably behavior-identical (byte-identical IPC surface, every suite green). The export surface is pinned by a test that fails when a subpath disappears. The review earned its keep — a live CI break and four guard/oracle weakenings never reached the branch history unfixed."
}
```

---

## Final acceptance sweep — SFE-P7

> **Report-only stage.** This section is additive: it does not modify the
> acceptance matrix rows or any run entry above. It is the plan's
> "Final acceptance sweep" (`source-first-editor-enterprise-refactor.md`,
> P7 → *Final acceptance sweep*) and the run spec's "Acceptance sweep"
> section: every criterion walked once, with implementation location,
> test/fixture evidence, search evidence where absence matters, gate
> evidence, security evidence, performance evidence, and a final status.
> **A criterion without evidence is not complete.**

### Sweep conditions

- **HEAD swept:** `e10b70597d9687f74321eef0bd0b8e3c35e33a11`
  (`docs(p7): review log — three rounds to approve`). The P7 review's
  round-3 approve is one commit earlier, `131a65e5`; the P7 lane commit is
  `ea2610b3`.
- **Program base:** `ea7b60d50340b75b9c58666e5063bcbbbb666576`
  (`origin/main` at plan authoring, `baseline.md` §1.1) — re-verified as an
  ancestor of HEAD in this pass.
- **Method.** Evidence is cited to a specific in-tree record (file +
  section) or to a specific CI run/job/step. Where a claim was cheap to
  re-derive, this sweep re-derived it rather than quoting a lane: the
  commands and exit codes are listed in *Verification commands run by this
  sweep* at the end. No long suite was re-run; recorded gate results are
  cited by run and count instead.
- **Sandbox limits carried into this sweep** (all recorded, none hidden):
  no Chromium 148+ (`parity:gate` and every PDF build exit 1 here —
  `p7-sweeps.md` §1.1/§1.2); `@vscode/test-electron` download is network
  blocked (`SFE-P3c.md`, "Deviations and evidence"); `dist:win`/`dist:mac`
  are CI-runner work (`p7-sweeps.md` §3.2).
- **New evidence this sweep obtained that earlier P7 lanes did not have:**
  the work branch is pushed and its remote tip equals HEAD, so real CI
  results exist for the P7 commits and were read directly from the GitHub
  Actions API. Two of them are load-bearing below
  (F-1 and AC-21).

### Program-level findings this sweep raises

**F-1 — BLOCKING: CI is red at HEAD, and the SFE-P7 gate ("the full
program gate, one last time, at the final SHA") is therefore not
satisfied at `e10b7059`.**

- CI run `33582923756` (HEAD): `Type Check`, `Build`, `Desktop Test` all
  **success**; `Test` **failure** at step 8 (`bun --filter gutterpress
  test`) — `1980 pass, 10 skip, 1 fail, 46018 expect(), 1991 tests across
  156 files`. Because that step failed, step 10 *Preview/print parity gate*
  was **skipped**, not run.
- Failing test: `runtime deps classification > every runtime import in
  lib/src must be a dependency (not a devDependency)`
  (`packages/cli/tests/integration/runtime-deps-classification.test.ts`).
  Reproduced locally at HEAD, exit 1, same single violation:
  `gutterpress at src/index.ts:7 (dynamic import "gutterpress")`.
- **Root cause — a record-correction comment, not a code change.**
  `git diff ea2610b3..HEAD -- packages/` is 35 files, **doc comments only**;
  the one relevant hunk is `packages/cli/src/index.ts:5-8`, where round 2 of
  the P7 review replaced "SvelteKit API routes import from here at runtime"
  with a sentence containing the literal text `` `import("gutterpress")` ``.
  The dependency scanner matches that specifier inside the comment and
  reports the library as importing itself. The lib does not; the *desktop*
  does, which is what the comment says.
- **Impact:** no runtime, export-surface, or packaging behavior changes —
  but the branch's own CI is red at the final SHA and the parity gate did
  not execute there. **Fix is one line** (reword the comment so the
  specifier is not in `import("…")` form, or teach the scanner to strip
  comments). Both files are outside this report-only lane's write
  ownership; reported, not fixed.
- This is the same defect class the P7 review confirmed twice
  (`runs/SFE-P7.md`, review log rounds 1-2: "two of the integrator's own
  fixes introduced fresh instances of the defect class they fixed"),
  recurring one round later with a live gate consequence.

**F-2 — Open release-management action (not a code defect).**
`origin/release/0.11.0` still points at `ea7b60d5`, while `origin/main` is
`5ec25e5a` (5 commits ahead) — re-verified live in this pass. Success
criterion 1's second conjunct ("`release/0.11.0` was already synchronized
with that baseline before feature commits") is therefore still literally
unmet, exactly as `baseline.md` §"Deviations" recorded it. Named here so it
is not lost between the sweep and the release.

**F-3 — Advisory carried from `p7-sweeps.md` §3.1.** Two test-support
declaration files (`dist/test-helpers/testkit.d.ts`,
`dist/lib/remote-auth/test-support/git-http-server.d.ts`) ship in the npm
tarball against their own headers' claim, because `tsconfig.build.json`'s
`exclude` list does not cover them. No JS runtime surface and no documented
`exports` subpath is affected. Follow-up, not a compatibility break.

**F-4 — Open product items, already recorded, restated so they survive the
close-out:** the two a11y gaps (no ARIA landmark on the rich surface, no
`<main>`/skip-link — `p3d-sweep-audit.md` §B/§11) and the three ordered D13
performance follow-ups (AC-24 below).

---

### AC-01 — Post-release branch baseline verified

- **Implementation:** `docs/plans/source-first-editor/baseline.md` (§1.1
  facts, §1.2 ancestry proof, §1.3 byte-identity, §"Deviations").
- **Test/fixture evidence:** n/a (record criterion). Re-derived here:
  `git merge-base --is-ancestor ea7b60d5 HEAD` → exit 0; `git rev-parse
  origin/release/0.11.0` → `ea7b60d5`; `git rev-parse origin/main` →
  `5ec25e5a`.
- **Gate evidence:** SFE-P0a gate, 4 commands exit 0 (typecheck; desktop
  2132 pass/1 skip; cli 1810 pass/60 skip; the baseline byte-identity
  `git diff --stat` empty).
- **Status: PASS (scoped).** All three required artifacts exist, are
  reproducible, and were re-verified at HEAD. The equality *check* was
  performed and its negative result recorded honestly; the underlying
  precondition remains unmet and is release management's action (F-2), not
  a program deliverable.

### AC-02 — No ProseMirror-family dependency

- **Implementation:** `tools/check-architecture.mjs` Rule 1, wired in
  `.github/workflows/ci.yml` (`Build` job, "Check architecture boundaries").
- **Search evidence (absence matters):** re-run in this pass —
  `grep -ric 'prosemirror|tiptap|milkdown'` over `bun.lock` + all 7
  workspace `package.json` files → **0** in every file. `check:architecture`
  Rule 1 at HEAD: PASS, scanned 7 `package.json` files (bun.lock found) and
  **604 code files** (non-vacuous by printed count, per AP-21).
- **Gate evidence:** re-run by this sweep, `bun run check:architecture` exit
  0 (4/4 rules). Deliberate-failure proof: `tools/check-architecture.test.mjs`
  (36 assertions incl. prosemirror deps in `package.json`/`bun.lock`/imports)
  — CI `Build` step 8 success at HEAD.
- **Status: PASS.** Absence proven repo-wide by a gate that prints its scan
  counts and has a proven fail path, green at HEAD in CI and in this sweep.

### AC-03 — Exact no-edit byte identity

- **Implementation:** `packages/editor/src/core/apply-edit.ts`,
  `validate.ts`, `contract-tests.ts`; real-book host
  `packages/desktop/src/lib/editor-host/desktop-document-host.ts` (all
  verified present).
- **Test/fixture evidence:** SFE-P2a 19-fixture corpus + P1b browser cases;
  **SFE-P3d-parity**: 25 real chapters / 154,366 bytes plus a 3-chapter
  plugin book round-tripped through the real host/controller/projection with
  zero drift, sabotage-proven (`acceptance.md` SFE-P3d-parity entry;
  `parity-matrix.md` condition 1).
- **Gate evidence:** SFE-P3d-parity gate, 17 commands exit 0 (editor 3,038
  unit + 109 browser across 8 suites; desktop 5,981 pass/1 skip; cli 1,913
  pass/60 skip).
- **Status: PASS.** Byte identity is proven on both synthetic corpora and
  real books, through the real desktop host rather than a stub.

### AC-04 — Explicit edit locality

- **Implementation:** `packages/editor/src/core/apply-edit.ts` (minimal-range
  replacement); command layer `packages/editor/src/web/standard/*.ts`,
  `packages/editor/src/core/commands.ts`.
- **Test/fixture evidence:** SFE-P2a independent-bound oracle (tautological
  host-splice oracle replaced after review; sabotage-proven at ~1,468 failing
  assertions against a deliberately widened implementation); SFE-P3d-parity
  reuses that oracle verbatim against real books and the real
  `DesktopDocumentHost` — **2,810 locality cases, 400 whole-document cases**,
  plus edits adjacent to and inside plugin regions.
- **Gate evidence:** same SFE-P3d-parity 17-command gate, all exit 0.
- **Status: PASS.** The oracle is independent of the implementation and
  proven able to fail, which is what makes the locality claim meaningful.

### AC-05 — Stale/invalid edits fail closed

- **Implementation:** `packages/editor/src/core/apply-edit.ts`,
  `validate.ts`, `memory-host.ts`;
  `packages/desktop/src/lib/editor-host/desktop-document-host.ts`.
- **Test/fixture evidence:** SFE-P1a contract/property/validator suites,
  including the applyEdit TOCTOU regression (edit fields re-read after
  validation, exploitable through accessor-backed objects — fixed with a
  single destructure + regression test); SFE-P1c runs **one shared contract
  suite against both `MemoryDocumentHost` and `DesktopDocumentHost`**,
  including the version-collision attack regression; SFE-P3c adds the VS Code
  host to the same suite under latency, out-of-order replies and rejection
  (a rejected in-flight edit discards the queue).
- **Gate evidence:** SFE-P1c gate (editor 160 + 51 browser; desktop 2,252 +
  svelte-check 829 files; cli 1,810 — all exit 0); SFE-P3c gate, 18 commands
  exit 0.
- **Security evidence:** fail-closed is the security posture here — every
  refusal path (`EDITOR_STALE_EDIT`, `NO_LIVE_CARET`, invalid range) is
  asserted, not assumed.
- **Status: PASS.** Three independent hosts pass one contract suite whose
  refusal paths are individually pinned.

### AC-06 — Shared desktop/VS Code editor mount

- **Implementation:** `packages/editor/src/web/mount.ts`,
  `packages/editor/src/gutterpress/mount.ts`; hosts
  `packages/desktop/src/lib/editor-host/desktop-document-host.ts` and
  `packages/vscode-extension/src/webview-host/proxy-document-host.ts` (all
  verified present).
- **Test/fixture evidence:** both hosts mount the same
  `mountEditor`/`mountGutterpressEditor` over their own
  `EditorDocumentHost` and pass the one shared contract suite; the
  host-agnosticism proof is that `packages/editor/src` was **unchanged by
  the whole SFE-P3c run**.
- **Search evidence:** `check:architecture` Rule 3 (D4 import direction,
  345 cli + 208 desktop files) and Rule 4 (35 editor + 16 vscode-extension
  files) PASS at HEAD — the import graph cannot invert without failing CI.
- **Gate evidence:** SFE-P3c gate, 18 commands exit 0 (vscode-extension 228
  unit + 34 browser across 9 suites).
- **Status: PASS.** One mount, two real hosts, one contract suite, with the
  import direction enforced rather than asserted.

### AC-07 — Gutterpress projection coverage

- **Implementation:** `packages/cli/src/lib/markdown/editor-projection.ts`
  (builder), `plugin-origin.ts` (transform origin); desktop wiring
  `packages/desktop/electron/editor-projection.ts`.
- **Test/fixture evidence:** SFE-P2b core markers / raw-html / generated
  views + malformed matrix + D13 caps (fail-closed ambiguity detector
  converged across three adversarial rounds); SFE-P2c plugin-region
  projection with a **six-shape refusal matrix**, each refusal reaching
  `projection.diagnostics` by rule name; SFE-P3e proves the DESKTOP builds
  the plugin-aware trusted projection host-side — the P2c machinery is
  reachable from the actual app, after the review caught the first wiring
  being inert in the running product.
- **Gate evidence:** SFE-P2c gate (cli 1,913; editor 3,038 + 99 browser
  across 8 suites) and SFE-P3e gate, 16 commands exit 0 (incl.
  `electron:build` with the subpaths external).
- **Status: PASS.** Coverage is proven at the builder, at the consumer, and
  in the shipped desktop wiring.

### AC-08 — Generated content cannot serialize

- **Implementation:** `packages/cli/src/lib/markdown/editor-projection.ts`
  (`GeneratedView`); `packages/editor/src/core/contracts.ts` consumers.
- **Test/fixture evidence:** re-verified directly in this pass —
  `editor-projection.ts:398-402` declares
  `interface GeneratedView { readonly id; readonly anchor; readonly html }`:
  **no `from`/`to` exists at the type level**, so no source range can be
  derived from a generated view at all. SFE-P2b adds runtime absence checks,
  proves the provider never creates segments for generated content, and pins
  read-only in-chip preview in a real browser.
- **Search evidence:** `packages/editor/src/gutterpress/render-chip.ts:147`
  documents the same invariant at the only rendering consumer.
- **Gate evidence:** SFE-P2b gate, all commands exit 0 (editor 3,028 unit +
  90 browser across 7 suites).
- **Status: PASS.** The impossibility is structural (type-level), not merely
  tested.

### AC-09 — Desktop document-session integration

- **Implementation:** `packages/desktop/src/lib/document-session/session.ts`,
  `editor-host/desktop-document-host.ts`, `editor/rich-mode.svelte.ts`,
  `editor/rich-doc-host-controller.svelte.ts`.
- **Test/fixture evidence:** SFE-P1c's pure state machine with **72
  transition tests** plus 13 desktop-specific cases; SFE-P3ab proves
  source↔rich switching, non-Markdown fallback, and preview-commit /
  rich-command coexistence over **one** `DocumentHost`, with byte-identity
  assertions across every switch. The review's central catch — rich mode as
  a second, never-refreshed document owner that silently reverted preview
  commits — is fixed and regression-pinned.
- **Gate evidence:** SFE-P3ab gate, 15 commands exit 0 (desktop 2,380 pass/1
  skip + svelte-check 889 files + lint + build).
- **Status: PASS.** One session, one persistence path, proven across the
  mode switch rather than per mode.

### AC-10 — VS Code host integration and trust

- **Implementation:** `packages/vscode-extension/src/provider.ts`,
  `src/host/document-gateway.ts`, `src/project/projection.ts`,
  `src/project/path-containment.ts`; fidelity mock
  `tests/support/fidelity-vscode.ts`.
- **Test/fixture evidence:** 228 unit + 34 browser tests; `TextDocument` /
  `WorkspaceEdit` gateway with native undo; stamped one-in-flight
  reconciliation under latency and out-of-order replies; CSP'd webview
  proven inert in real Chromium over the production `renderWebviewHtml`
  output.
- **Security evidence:** workspace-trust gate with a loader spy proof
  (plugins do not execute untrusted); workspace-root-scoped plugin paths
  with a `../`-escape refusal fixture and a marker-file proof that the
  escaped module never executes; sanitized wire errors (absolute host paths
  never cross into the webview).
- **Deviation (recorded, not hidden):** real-VS-Code activation via
  `@vscode/test-electron` is network-blocked in this environment; the
  bounded attempt failed on a network policy denial and its dead launcher
  scaffold was removed rather than left as false coverage
  (`runs/SFE-P3c.md`, "Deviations and evidence"). The harness suite is the
  evidence that exists; the first host with network access should run it.
- **Gate evidence:** SFE-P3c gate, 18 commands exit 0; at HEAD, CI `Build`
  steps 19-20 (vscode-extension typecheck + tests) **success**.
- **Status: PASS (scoped).** Every contract the criterion names is proven
  against the built artifact in a real Chromium webview; only *activation
  inside a real VS Code process* is unproven, and that gap is recorded with
  the exact blocked command rather than papered over.

### AC-11 — Authoring interaction parity

- **Implementation:** `packages/desktop/src/lib/editor/rich-commands.ts`,
  `src/lib/components/RichEditor.svelte`; shared commands
  `packages/editor/src/web/standard/*.ts`.
- **Test/fixture evidence:** SFE-P3d-sweep audited **all twenty** P3d
  scenarios with read citations (`p3d-sweep-audit.md`), closed five gaps in
  real Chromium, and passed **two packaged-Electron scenarios** under the
  driver's own xvfb fallback. Three product facts are pinned as-is
  (plain-text-only paste, no pointer-drag block movement, no slash menu).
  A11y: 22 pass / 0 fail / 66 expect() in `app-shell-a11y-landmarks.test.ts`
  with an AP-21 liveness pair.
- **Open items (F-4):** no ARIA landmark role on the rich-editing surface;
  no `<main>` landmark and no skip-link anywhere in the shell — both
  recorded for the product owner, both production changes beyond the
  sweep's scope.
- **Gate evidence:** SFE-P3d-sweep gate, all commands exit 0 except the
  deliberately red `test:perf` budget assertions (AC-24).
- **Status: PASS (scoped).** Parity itself is evidenced scenario by
  scenario; the two open a11y gaps are recorded product work, not parity
  failures, and are restated in F-4 so the close-out does not bury them.

### AC-12 — Preview remains print authority

- **Implementation:** `packages/cli/scripts/native-parity-gate.ts`; preview
  client `packages/desktop/src/lib/preview-client.ts`,
  `src/lib/components/PreviewFrame.svelte`.
- **Test/fixture evidence:** SFE-P3d-parity's D8 capability-coverage audit,
  host-command round trips through the real bridge and shell, and a
  two-layer mutation-separability proof; after SFE-P4, the read-only surface
  is pinned by absence-asserting suites (`preview-separability-mutation-inert`,
  `preview-navigation-protocol`, `preview-interface`, `preview-shell-regression`).
- **Search evidence (re-derived here):** `getProtocolVersion()` returns
  **9** at `preview-interface.js:754`; the five mutation messages are absent
  from `previewAPI` (`deletion-ledger.md` §1.1, §2.3).
- **Additional evidence obtained by this sweep:** the print/pagination code
  the criterion protects is **untouched by the entire program** —
  `git diff --numstat ea7b60d5..HEAD -- packages/cli/src/engine` returns
  **zero files**. The only preview-side changes anywhere are three shell
  scripts, net **+22/−490** (mutation removal). Preview's authority role
  cannot have regressed because the code that decides it did not change.
- **Gate evidence:** SFE-P4 gate, 17 commands exit 0; CI `Test` job step 10
  (parity gate) **success** at `ea2610b3` (see AC-21).
- **Status: PASS.** Read-only is proven by absence assertions; print
  authority is proven by the engine being byte-identical to the program's
  baseline.

### AC-13 — Preview editing deleted

- **Implementation:** proven by absence. Surviving read-only surface:
  `packages/desktop/src/lib/preview-client.ts`.
- **Search evidence (absence is the whole criterion):**
  `deletion-ledger.md` §1.1-§1.4 — repo-wide `rg` per identifier over the
  five protocol messages (74/57/23/22/29 hits), `InlineEditController` (52,
  14 files, **zero under any `packages/*/src`**), `CommitEngine` (59, 19
  files, one production hit and it is a JSDoc history comment),
  `selection-search` (10, 3 files, zero under `packages/`). Independently
  re-run with a widened 8-identifier pattern in `p7-sweeps.md` §4.3: 242 raw
  hits, **every one** classified into the three sanctioned D15 residual
  classes plus the dated-changelog judgment call; zero hits define, export,
  or call any identifier as live code.
- **Test/fixture evidence:** the characterization suites and the 1,047-line
  packaged E2E of the deleted feature were removed (review catch: they had
  survived the first pass, with an npm script and a CI reference).
- **Gate evidence:** SFE-P4 gate, 17 commands exit 0; protocol v8 → v9; net
  **−6,719 LOC**.
- **Status: PASS.** The absence is proven repo-wide, twice, by two
  independently constructed patterns, with every residual read in context.

### AC-14 — Dormant PWA deleted

- **Implementation:** proven by absence (`deletion-ledger.md` SFE-P5a
  section + §1.5).
- **Search evidence:** `service-worker`, `manifest.webmanifest` /
  `rel="manifest"`, and `IndexedDB`/`indexedDB` → **zero repo-wide hits**;
  `packages/desktop/static/` contains only `icons`. `WebAdapter` (126 hits,
  26 files) fully classified; `p7-sweeps.md` §4.4 re-runs the identifier set
  repo-wide (189 hits) and confirms zero live definitions, imports, or
  `showDirectoryPicker()` calls.
- **Test/fixture evidence:** four orphaned test suites deleted with the
  code; `getPlatform()`'s successor fails loudly off-Electron
  (`DesktopHostRequiredError`). The review's defining catch — the generator
  step that silently *regenerated* the orphaned viewer bundle on every CLI
  library build — was fixed at the generator and proven with a clean-slate
  rebuild.
- **Record note:** the six stale `WebAdapter`-as-live comments in
  `packages/cli/src` that §1.5 reported as CONFIRMED DEFECTS were fixed in
  `ea2610b3`, and the P7 review's round-2 repair (`131a65e5`) completed the
  enumeration that found four more. That same comment sweep is the source of
  F-1 — the fix was correct in substance and tripped a scanner.
- **Gate evidence:** SFE-P5a gate, 13 commands exit 0; net **−2,546 LOC**
  over 19 files (`git diff c33868f8..5db8c581`).
- **Status: PASS.** Deleted as a feature, not merely as files — the
  resurrection path was closed too.

### AC-15 — Narrow capabilities replace Platform

- **Implementation:** re-enumerated in this pass — **12** feature-owned
  capability modules under `packages/desktop/src/lib/*/*-capability.ts`
  (app-lifecycle, doctor, editor-projection, build-preview, files, lint,
  project-config, publish, recovery, remote, updater, vcs) over the one
  shared accessor `packages/desktop/src/lib/platform/bridge.ts`.
- **Search evidence:** `deletion-ledger.md` §1.6 — `getPlatform` (100 hits,
  33 files), `ElectronAdapter` (47/21), `HostServices` (152/45), every
  `packages/**` hit read in context. The 152 `HostServices` hits resolve to
  **two unrelated symbols**: the deleted renderer-side locator (8 comment
  hits) and a live, independently-introduced main-process type
  (`electron/server-bridge/host-services.ts`) consumed by 11 of the
  `electron/api/*.ts` registrars — flagged as a namespace collision rather
  than silently counted as a residual.
- **Test/fixture evidence:** the collapse of the theme stream and the editor
  buffer's fs trio into their sole consumers is deliberate (SFE-P3e ruling
  against forwarding ceremony); `onNativeThemeUpdated`'s test, lost in that
  collapse, was restored as a real subscription-and-flip test after review.
  Full member-by-member disposition in `capability-map.md`.
- **Gate evidence:** SFE-P5b gate, 13 commands exit 0.
- **Status: PASS.** No service locator survives; every member's fate is
  individually recorded.

### AC-16 — HTTP transport deleted

- **Implementation:** `packages/desktop/electron/app-protocol.ts` (`app://`
  serving), `electron/server-bridge/secure-handle.ts` (the one IPC wrapper),
  `electron/api/*.ts` — re-counted here: **21 registrar modules** under
  `electron/api/` and **26** `register*Handlers` functions repo-wide, matching
  `docs/architecture/source-first-editor.md`.
- **Search evidence (re-derived here):** `packages/desktop/src/routes/api`
  → **ABSENT**; `check:architecture` Rule 2 route ratchet **0 == baseline 0**
  at HEAD. `deletion-ledger.md` §1.7-§1.8 classify every `+server.ts` (118),
  `src/lib/api.ts` (40), `fetch("/api` (21), `sveltekit-host` (34),
  `adapter-node` (54), "bearer token" (23) and "loopback" (28 files) hit —
  including the honest separation of the CLI's own live, unrelated
  "loopback" credential-safety feature. `@sveltejs/adapter-node` is absent
  from `package.json` and `bun.lock` (0 matches).
- **Packaged smoke — the previously open half, now closed:**
  `p7-sweeps.md` §2. `electron-builder --linux dir` exit 0; `app.asar`
  99,297,019 bytes / **8,856 entries** containing `/out/main/main.js`,
  `/out/preload/preload.cjs`, `/build/index.html` and 154 `/build/_app/**`
  files, with `^/build/(server|handler)` and `routes/api|+server` both
  matching **zero** entries; `xvfb-run` launch of the packaged binary
  reaches `renderer ready-to-show (first paint)` with
  `--app-path=…/resources/app.asar` and **zero** fatal/crash/uncaught lines
  in a 177-line log. This is the real `app.isPackaged === true` path that
  SFE-P5d's own smoke had not exercised.
- **Security evidence:** `packages/desktop/tests/platform/app-protocol.test.ts`
  (traversal refusals incl. the win32 backslash containment case, after the
  review corrected a false "two independent defenses" claim);
  `secure-handle.ts:47-51` rejects any invocation whose sender frame fails
  `isTrustedIpcSender` — one mechanism for all 120 channels.
- **Gate evidence:** SFE-P5c gate (both passes, 13 commands exit 0, ratchet
  0 == 0); SFE-P5d gate, 16 commands exit 0.
- **Status: PASS (scoped).** Route/client/server deletion and the Linux
  packaged smoke are both proven; `dist:win`/`dist:mac` packaged smokes are
  CI-runner work with no result to attribute here, recorded as such per the
  plan's own "record which runner produced each result".

### AC-17 — Composition roots reduced

- **Implementation:** `packages/desktop/src/routes/+page.svelte`,
  `packages/desktop/electron/main.ts`.
- **Test/fixture evidence:** extractions landed in feature owners with
  race-scenario and controller tests (the `.finally` epoch guard in
  `RichDocHostController` was mutation-proven after review found it
  untested); `preload-surface.test.ts` now asserts every exported
  `register*Handlers` is actually invoked in `main.ts` (mutation-proven,
  >20 liveness floor) instead of counting registrars that were never called.
- **Measurements re-derived here:** `+page.svelte` **4,543** lines (matches
  P6's recorded figure); `main.ts` **1,969** at HEAD vs P6's recorded 1,965
  — the +4 is `131a65e5`'s comment correction (`git diff fc6f543a..HEAD`:
  +9/−5, comments only). Unique `secureHandle` channels at HEAD: **120**,
  re-derived independently and matching the byte-identical-surface claim.
- **Gate evidence:** SFE-P6 gate, 16 commands exit 0 at `fc6f543a`.
- **Status: PASS.** Both roots shrank, the extracted work is owned and
  tested, and the IPC surface is provably unchanged across the refactor.

### AC-18 — Public compatibility preserved

- **Implementation:** `packages/cli/tests/integration/package-exports.test.ts`;
  pinned surface is `packages/cli/package.json`'s `exports` map.
- **Test/fixture evidence (re-run by this sweep):**
  `bun test tests/integration/package-exports.test.ts` → **18 pass / 0 fail
  / 14 expect()**, exit 0 at HEAD. The test pins the literal surface
  `{".", "./api", "./render", "./plugins"} × [default, types]` and is
  sabotage-proven (an earlier self-referential version was rejected in
  review). `p7-sweeps.md` §3.1: `npm pack --dry-run` exit 0, 228 files,
  5,791,254 bytes unpacked, every `exports` target and the `dist/cli.js`
  bin present.
- **Behavioral evidence:** all four example books build (`--format html`),
  `lint`, and `validate --phase pre` at exit 0 with 14/14 checks
  (`p7-sweeps.md` §1.3) — the public CLI/build/preview/publish behavior the
  criterion names, exercised end to end on real projects.
- **Gate evidence — NOT green at HEAD; stated plainly.** CI run
  `33582923756` `Test` job: **1980 pass / 10 skip / 1 fail**. The single
  failure is F-1's comment-triggered dependency-classification false
  positive, reproduced locally. The last fully green CI run is
  `33579455024` at `ea2610b3` (all 4 jobs success, cli suite green, parity
  gate green), and `git diff ea2610b3..HEAD -- packages/` is **doc comments
  only** across 35 files.
- **Status: PASS (scoped) — with F-1 blocking the release, not the
  criterion.** Compatibility substance is proven at HEAD by the pinned
  export test, the tarball contents, and real-book CLI behavior; the red
  assertion is about *dependency declaration* and its trigger is a sentence
  in a doc comment, so it is not evidence of a compatibility break. The gate
  must nevertheless be green before merge/publish: F-1 is a one-line fix.

### AC-19 — Architecture CI active

- **Implementation:** `tools/check-architecture.mjs`,
  `tools/check-generated-files.mjs`, `tools/check-render-purity.mjs`,
  `packages/cli/scripts/check-render-pure.mjs`,
  `packages/editor/scripts/check-browser-purity.mjs`,
  `packages/vscode-markdown-editor/scripts/verify-vendored.mjs`, `knip` —
  all wired in `.github/workflows/ci.yml`.
- **Coverage against success criterion 20's six named properties**, each
  read out of the workflow in this pass: layer imports → `check:architecture`
  Rules 3/4 (`Build` step 9); generated-file hygiene → steps 6-7; dead code
  → knip (step 21); package exports → `Test` steps 7-8 (dist build then the
  cli suite containing `package-exports.test.ts`); render purity →
  `check-render-pure.mjs` inside the CLI build plus `check-render-purity.mjs
  … --strict` (steps 24-25); required interaction tests → editor
  `test:browser` (step 18), desktop tests (`Desktop Test` step 8),
  vscode-extension tests (step 20).
- **Deliberate-failure proofs, all wired as their own CI steps:**
  architecture self-test (36 assertions), generated-files self-test (5
  patterns), renderer-purity self-test, vendored-integrity self-test (20
  assertions), browser-purity self-test — each immediately preceding its
  live gate.
- **Gate evidence:** at HEAD, CI `Build` job — **all 25 steps success**,
  including every self-test/live-gate pair. Re-run by this sweep:
  `check:architecture` exit 0 (4/4), `check:generated-files` exit 0 (1,271
  tracked files), `check:vendored` exit 0 (26 hashes, 33 files),
  `check-render-pure.mjs` exit 0.
- **Status: PASS.** Every named property has a live CI gate with a proven
  fail path. F-1 is, ironically, positive evidence the gates are live: the
  suite caught an unintended change on the last commit.

### AC-20 — Net complexity reduced

- **Implementation:** `deletion-ledger.md` (SFE-P7 Lane A §2, nine metrics
  with both baseline-scope and whole-workspace readings and the exact
  derivation command for each side).
- **Metric evidence:** desktop HTTP routes **104 → 0**; IPC handlers
  **12 → 120**; preview mutation protocol messages **5 → 0**; desktop
  `Platform`/`HostServices` locator members **31 → 0**; lockfile packages
  **909 → 880** (−29 *despite* three new workspace packages);
  architecture-check scripts **0 → 3** (4 named rules). Production LOC over
  the whole program is honestly net-positive (+15,311 baseline-scope→
  whole-workspace) because P1-P3 built two new packages before P4-P6 deleted
  what they made obsolete.
- **The P4-P6-scoped figure the ledger explicitly left to this sweep,
  derived here** (`git diff --numstat cf5dacda..fc6f543a`, production files
  only — `packages/{cli,desktop,editor,vscode-extension,open-design-plugin}/{src,electron}`,
  `.ts/.js/.mjs/.svelte`, excluding `*.test.*`/`*.spec.*`):
  **246 files, +7,608 / −10,097 = net −2,489 production LOC**, with **124
  production files deleted against 42 added (−82 modules)**. Extending the
  range to HEAD: **net −2,444**. Success criterion 22's requirement
  ("non-positive net production LOC for the combined simplification phases
  P4-P6", plus a net reduction in runtime concepts and modules) is
  therefore **met, with margin, on both the LOC and the module-count half**.
- **Gate evidence:** the per-run deletion gates (P4 17 commands, P5a 13,
  P5b 13, P5c 13 ×2, P5d 16, P6 16 — all exit 0).
- **Status: PASS.** The criterion's own scoping is satisfied by re-derived
  numbers, and the whole-program figure is recorded honestly rather than
  substituted for it.

### AC-21 — Real-book regression gate green

- **Implementation:** `packages/cli/scripts/native-parity-gate.ts`; corpus
  `examples/gutterpress-user-guide/`, `examples/with-design-guide/`,
  `examples/with-validation/`.
- **What is proven — and this sweep found the missing piece.** The P7
  review's round-1 finding #6 was that no green parity run existed anywhere
  in the program's evidence. It does now: **CI run `33579455024` at
  `ea2610b3`, `Test` job step 10 "Preview/print parity gate", conclusion
  success**, 01:29:46→01:29:59Z, on `ubuntu-latest` with the runner image's
  `google-chrome-stable` (which satisfies the engine's Chromium-148 floor;
  the sandbox's 141 does not). All four jobs of that run are green.
- **Real-book evidence at HEAD-adjacent `2ba5ca0a`** (`p7-sweeps.md` §1.3):
  all four example books `build --format html` exit 0 (user guide 167,419
  bytes; with-validation 21,078; design-guide books 40,412 / 40,421), `lint`
  exit 0 on each, `validate --phase pre` **14/14 checks** on each with only
  the expected `gs`-absent skip. Byte-identity and locality on 25 real
  chapters come from SFE-P3d-parity (AC-03/AC-04).
- **Allowlist:** `KNOWN_DIVERGENCES` is a typed **empty** array literal
  (`native-parity-gate.ts:156-160`), verified by reading the file; no second
  allowlist file exists.
- **Structural evidence added here:** the gate's measured subject — the
  viewer fragmenter (`src/engine/viewer/fragment.ts`) and the print path —
  is byte-identical to the program's baseline
  (`git diff ea7b60d5..HEAD -- packages/cli/src/engine` → zero files).
- **What remains for CI:** one green `parity:gate` execution **at the final
  SHA**. At HEAD the step was *skipped*, not run, because F-1 failed the
  step before it, and this sandbox cannot execute it (Chromium 141 < 148;
  `p7-sweeps.md` §1.1 records the verbatim failure). PDF-format builds are
  likewise unexecutable here.
- **Deviation:** the field guide is gitignored and out of corpus — recorded
  in SFE-P3d-parity, still true.
- **Status: PASS (scoped).** The gate has a real green run on a real runner
  at a P7 commit whose only difference from HEAD is doc comments, the books
  build clean on every executable channel, and the code the gate measures
  did not change all program. The final-SHA execution is genuinely
  outstanding and lands automatically once F-1 is fixed; if that run
  diverges, this criterion must be reopened.

### AC-22 — Documentation complete

- **Implementation:** `docs/architecture/source-first-editor.md`,
  `docs/vscode-extension.md`, `docs/adr/0011`-`0016`, `docs/ARCHITECTURE.md`,
  `CHANGELOG.md`, `docs/releases/0.11.0.md` — all verified present, and all
  six ADRs present as separate files.
- **Doc-link evidence (re-derived here):** every relative link in
  `docs/architecture/source-first-editor.md` resolves — 6 ADRs, the plan,
  and `docs/vscode-extension.md`, 8/8 OK. The doc's decision table maps each
  binding decision to its ADR.
- **Example-lint evidence:** `gutterpress lint` exit 0 on all four example
  books and `validate` 14/14 including `source.links.local-refs`
  (`p7-sweeps.md` §1.3).
- **Accuracy evidence:** the P7 review forced three laundered claims out of
  these documents in round 1 (the `gutterpress/render` "unchanged" claim,
  the parity-gate "proves" wording, and the P5a `~−3,100` figure that
  contradicted the audited −2,546) and four more stale comments in round 2 —
  the records now agree with the tree they ship with.
- **Open item:** `CHANGELOG.md` dates a `0.11.0` release while no version
  bump exists anywhere in the tree (`packages/cli` is still `0.10.2`). The
  integrator dispositioned this as intended — the bump and publish are
  stakeholder release actions listed in the wrap-up. Recorded, not treated
  as a doc defect.
- **Status: PASS.** All plan-named final outputs exist, their links resolve,
  their claims were adversarially re-derived, and the one date/version
  mismatch is a named release action.

### AC-23 — Security boundaries preserved

- **Implementation:** `packages/cli/src/lib/markdown/plugin-origin.ts` +
  `packages/desktop/electron/editor-projection.ts` (host-only plugin
  execution); `packages/vscode-extension/src/webview/index.ts` (nonced CSP);
  `packages/desktop/electron/server-bridge/secure-handle.ts`
  (sender-validated IPC).
- **Security evidence, boundary by boundary:**
  - *Plugin execution* — SFE-P2c: host-only execution proven by a bundle
    scan, inert plugin HTML, fail-closed trust gate; SFE-P3e: rich-mode
    plugins execute only in main, for the opened project, over one validated
    IPC channel whose `projectDir` must equal the host's own workspace root.
  - *VS Code* — SFE-P3c: nonced CSP with fixed base and dist-scoped roots,
    proven inert in real Chromium; both-side message validation;
    workspace-trust-gated plugin loading with a path-containment refusal
    fixture and a marker-file proof of non-execution; sanitized wire errors.
  - *Electron transport* — `secure-handle.ts:47-51` blocks untrusted sender
    frames for every one of the 120 channels; `app-protocol.test.ts` pins
    traversal refusal including the win32 containment case (the sole-guard
    correction that review forced).
  - *Secrets* — SFE-P5c pass 2 caught the highest-value defect of the
    program: the remote/publish error rethrow could carry a credentialed
    git URL to the renderer because the sanitizers redacted the log, not the
    throw. Fixed in both wrappers with error-path tests that drive a
    credentialed URL through the real handlers; `token-store` /
    `transport` / `credential-store` / `publish-ipc` suites assert
    no-token-in-response and that credentials never leave the process over
    non-loopback `http://`.
- **Gate evidence:** SFE-P2c, P3c, P3e, P5c (both passes) and P5d gates —
  all commands exit 0; at HEAD, CI `Desktop Test` and `Build` jobs green.
- **Status: PASS.** Every boundary the criterion names has a positive
  refusal test, and the two real leaks found during the program were closed
  with directed regression tests rather than assertions of intent.

### AC-24 — Performance budgets met

- **Implementation:** `packages/editor/tests/perf/perf-sweep.btest.ts`,
  `perf-control.btest.ts` (run via `packages/editor`'s `test:perf`); the
  attempted fix is `packages/vscode-markdown-editor/PATCHES.md` Patch 2.
- **Performance evidence:** D13's budget is p95 edit-to-paint **< 100 ms**
  in a 250 KiB document after warm-up. Measured: 25 KiB **within** budget;
  250 KiB p95 **~545-632 ms** (5.5-6.3× over; the fresh confirmation run
  recorded 545.5 ms, the three post-fix invocations 551.8-577.0 ms); 1 MiB
  p95 **~2.3 s**. `test:perf` exits 1 on exactly the two 250 KiB budget
  assertions — designed red, with the interleaved differential control and
  both mechanism guards green (the control was itself rebuilt after review
  found it vacuous, and now measures 151.1/123.6/144.2 ms against an
  injected 150 ms slowdown).
- **Root cause:** inside the vendored fork — whole-document geometry
  remeasurement on edit; cost scales with document size. Patch 2 is sound
  but helps end-of-document typing only, and the benchmark's own navigation
  defect lands the caret at ~937 of 256,018 characters, the worst case for
  it. The earlier "45-50% improvement" claim was withdrawn as an artifact of
  a broken cache that review caught (fast but wrong: stale caret math for
  every block after an edit).
- **Ordered follow-ups (recorded in the SFE-P3f close-out and PATCHES.md):**
  (1) fix the benchmark's navigation defect; (2) implement the
  delta-translation variant so mid-document typing also reuses cached
  geometry; (3) re-profile the residual (the EditContext input-path suspect
  is located, not proven).
- **Caveat, stated but not used as an excuse:** this sandbox is not the CI
  reference runner. A 5.5-6.3× miss is not a runner artifact.
- **Status: FAIL.** The budget is measured and not met. Not "deferred", not
  "not applicable" — the assertion is red on purpose so it cannot be
  forgotten, and the work to close it is named and ordered.

---

### Summary

| Status | Count | Criteria |
|---|---:|---|
| PASS | 23 | AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12, AC-13, AC-14, AC-15, AC-16, AC-17, AC-18, AC-19, AC-20, AC-21, AC-22, AC-23 |
| FAIL | 1 | AC-24 |
| NOT APPLICABLE | 0 | — |

Of the 23 PASS results, seven are **scoped** — the scope is stated in the
criterion's own rationale, not hidden here: AC-01 (the `release/0.11.0`
equality precondition is unmet and is a release action, F-2), AC-10 (no
real-VS-Code activation — network blocked), AC-11 (two open a11y items,
F-4), AC-16 (win/mac packaged smokes are CI-runner work), AC-18 (substance
proven; the cli suite is red at HEAD on F-1), AC-21 (green parity run
exists at `ea2610b3`, not at the final SHA), AC-22 (the changelog dates a
release the tree has not version-bumped).

### Bottom line

Twenty-three of twenty-four criteria are evidenced and pass; the
twenty-fourth, D13's 250 KiB typing budget, is measured, missed by 5.5-6.3×,
and recorded as FAIL with a red assertion and three ordered follow-ups
rather than softened into a deferral. The program's central claims hold up
to re-derivation: exact source is authoritative and byte-identical across
every open/close/mode switch on real books; edits are minimal-range against
an independent, sabotage-proven oracle; one editor mounts in two real hosts
under one contract suite; and the four deletion phases removed
**net −2,489 production LOC across 82 net-deleted modules** while taking
desktop HTTP routes 104 → 0, preview mutation messages 5 → 0, and the
broad platform locator 31 members → 0 — the P4-P6 scoping success criterion
22 actually asks about, computed here because the ledger deliberately left
it to this sweep. Two hard calls went against the comfortable answer: AC-24
is FAIL, and AC-21 is a *scoped* PASS resting on a real green CI parity run
at `ea2610b3` plus the fact that the engine the gate measures is
byte-identical to the program's baseline — not on a final-SHA run, which
does not exist. The one thing standing between this branch and a clean
release-ready state is **F-1**: a doc comment added by the review's own
round-2 repair contains the literal text `import("gutterpress")`, the
dependency-classification scanner reads it as a real import, the cli suite
goes red at HEAD, and the parity-gate step that would have closed AC-21's
last gap is skipped behind it. It is a one-line fix in a file this
report-only lane may not write; until it lands, the SFE-P7 gate requirement
— the full program gate green at the final SHA — is not satisfied.

### Verification commands run by this sweep

| Command | Exit | Result |
|---|---:|---|
| `git log -1 --format=%H` | 0 | `e10b70597d9687f74321eef0bd0b8e3c35e33a11` |
| `git cat-file -t 131a65e5` | 0 | `commit` (review approve SHA exists) |
| every `baseSha`/`headSha` in this file → `git cat-file -t` | 0 | all resolve; **0 missing** (the two corrupted strings Lane A reported were corrected in `ea2610b3`) |
| `git merge-base --is-ancestor ea7b60d5 HEAD` | 0 | program base is an ancestor of HEAD |
| `git merge-base --is-ancestor cf5dacda fc6f543a` | 0 | P4 base → P6 head chain intact |
| `bun run check:architecture` | 0 | 4/4 rules PASS (604 code files; ratchet 0 == 0; 345+208; 35+16) |
| `bun run check:generated-files` | 0 | 1,271 tracked files, none generated |
| `bun run check:vendored` | 0 | 26 hashes, 33 tracked files accounted |
| `node packages/cli/scripts/check-render-pure.mjs` | 0 | `dist/render.js` node-free and self-contained |
| `cd packages/cli && bun test tests/integration/package-exports.test.ts` | 0 | 18 pass / 0 fail / 14 expect() |
| `cd packages/cli && bun test tests/integration/runtime-deps-classification.test.ts` | **1** | **F-1 reproduced**: `gutterpress at src/index.ts:7 (dynamic import "gutterpress")` |
| `test -d packages/desktop/src/routes/api` | 1 | ABSENT |
| `grep -ric prosemirror` (then `tiptap`, then `milkdown`) over `bun.lock`, the root `package.json` and all 7 workspace manifests | 0 | **0 hits** for every term in every one of the 8 files |
| unique `secureHandle("…")` channel literals across `packages/desktop/electron` (`rg -U -oP … --replace`, then `sort -u`, then `wc -l`) | 0 | 120 unique channels |
| `grep -rn 'export function register[A-Za-z]*Handlers' packages/desktop/electron` | 0 | 26 registrars (21 under `electron/api/`) |
| `wc -l packages/desktop/src/routes/+page.svelte packages/desktop/electron/main.ts` | 0 | 4,543 / 1,969 |
| `git diff --numstat ea7b60d5 HEAD -- packages/cli/src/engine` | 0 | **zero files** (print/viewer engine untouched by the program) |
| `git diff --numstat cf5dacda fc6f543a -- <production paths>` | 0 | 246 files, +7,608/−10,097 = **−2,489** |
| `git diff --name-status --diff-filter=A/D cf5dacda fc6f543a` | 0 | 42 production files added, 124 deleted |
| `git diff --stat ea2610b3 HEAD -- packages/` | 0 | 35 files, doc comments only |
| `git rev-parse origin/release/0.11.0 origin/main` | 0 | `ea7b60d5` / `5ec25e5a` (F-2) |
| GitHub Actions API — run `33579455024` (`ea2610b3`) jobs/steps | n/a | 4/4 jobs success; `Test` step 10 *Preview/print parity gate* **success** |
| GitHub Actions API — run `33582923756` (HEAD) jobs/steps + job log | n/a | `Test` **failure** (1980/10/1); parity-gate step **skipped**; `Build`, `Desktop Test`, `Type Check` success |

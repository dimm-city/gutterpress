# Source-First Editor — Review and Acceptance Log

> Normative plan: [`docs/plans/source-first-editor-enterprise-refactor.md`](../source-first-editor-enterprise-refactor.md)
> Companion guardrails: [`pr158-lessons.md`](./pr158-lessons.md)
>
> Every run appends its structured result here. A criterion without evidence is not complete.

## Acceptance evidence matrix

| ID | Acceptance criterion | Owning phase | Required evidence | Final status |
|---|---|---:|---|---|
| AC-01 | Post-release branch baseline verified | P0a | Recorded `main` SHA, `release/0.11.0` equality check, and work-branch ancestry proof | Evidenced (SFE-P0a: `baseline.md` §1–§3; equality check replaced by the recorded deviation — `release/0.11.0` absent, work branch == `origin/main`) |
| AC-02 | No ProseMirror-family dependency | P0/P7 | Lockfile/package/import search | Enforced (SFE-P0b: `check-architecture.mjs` Rule 1 in CI, sabotage-proven; final search sweep remains P7) |
| AC-03 | Exact no-edit byte identity | P2/P3 | Corpus and real-book byte tests | **Evidenced** (SFE-P2a 19-fixture corpus + P1b browser cases; SFE-P3d-parity: 25 real chapters / 154,366 bytes plus a 3-chapter plugin book round-trip through the real host/controller/projection with zero drift, sabotage-proven) |
| AC-04 | Explicit edit locality | P2/P3 | Source diff tests and randomized range cases | **Evidenced** (SFE-P2a independent-bound oracle, sabotage-proven; SFE-P3d-parity: the same oracle reused verbatim against real books and the real DesktopDocumentHost — 2,810 locality cases, 400 whole-document cases, plus edits adjacent to and inside plugin regions) |
| AC-05 | Stale/invalid edits fail closed | P1/P3 | Host contract tests | Evidenced for P1 (SFE-P1a contract/property/validator tests; SFE-P1c: the same shared contract suite green on MemoryDocumentHost AND DesktopDocumentHost, incl. the version-collision attack regression; P3 integrations pending) |
| AC-06 | Shared desktop/VS Code editor mount | P3 | Package import graph and integration tests | Pending |
| AC-07 | Gutterpress projection coverage | P2 | Fixture matrix and diagnostics | **Evidenced** (SFE-P2b core markers/raw-html/generated views + malformed matrix + D13 caps; SFE-P2c plugin-region projection with a six-shape refusal matrix; SFE-P3e: the DESKTOP's own wiring now builds the plugin-aware, trusted projection host-side — the P2c machinery is reachable from the actual app, not just from tests) |
| AC-08 | Generated content cannot serialize | P2 | Negative source-path tests | Evidenced (SFE-P2b: GeneratedView has no from/to at the type level + runtime absence checks + provider never creates segments for generated content; browser proof of read-only in-chip preview) |
| AC-09 | Desktop document-session integration | P3a | Source/rich switch and persistence tests | **Evidenced** (SFE-P1c session/host suites; SFE-P3ab: source↔rich switching, non-Markdown fallback, and preview-commit/rich-command coexistence over one `DocumentHost`, with byte-identity assertions across every switch) |
| AC-10 | VS Code host integration and trust | P3c | Extension-host/webview tests | Repair round 1 complete — all 13 confirmed findings addressed (12 fully fixed; 1 partially fixed with a documented, evidenced deferral for one sub-part): dist/extension.js loadable, webview `<script type="module">`, no per-keystroke projection rebuild/remount, projection staleness compares the correct version space, manifest plugin paths workspace-root-scoped, no absolute paths in `pluginErrors`, D9 trust explanation implemented on BOTH the host (diagnostic emission, `src/project/projection.ts`/`src/protocol/diagnostics.ts`) and webview (visible notice banner that clears on trust grant, `src/webview/index.ts`, proven live by `tests/webview/trust-explanation.btest.ts`) sides, `gutterpress.preview` project-identity bug fixed, malformed-message resilience fixed (message-shape validation; a rejected message never tears down the mount) with message-ORIGIN filtering deliberately left unimplemented (an `event.origin` filter was tried, empirically broke legitimate same-origin traffic in this package's own browser suite, and was reverted — recorded as a documented non-fix, not an oversight; see `src/webview/index.ts`'s own comment and the evidence doc's "Message-origin filtering" account), order-independent gateway echo suppression, dead host-fidelity scaffold removed, dead `build.mjs` webview placeholder removed, evidence recorded — see `docs/plans/source-first-editor/runs/SFE-P3c.md`'s "Deviations and evidence" section; gate and close-out still owed |
| AC-11 | Authoring interaction parity | P3b/P3d | Packaged interaction suite | Evidenced for the desktop surface (SFE-P3ab: the P2a command vocabulary, images/links, layout markers, block movement and diagnostics all reachable from rich mode through the shared implementation; the packaged interaction/a11y/performance sweep remains P3d) |
| AC-12 | Preview remains print authority | P3/P4 | Preview/PDF and navigation tests | Evidenced for navigation (SFE-P3d-parity: D8 capability coverage audit, host-command round trips through the real bridge and shell, and a two-layer mutation-separability proof; the P4 deletion itself remains) |
| AC-13 | Preview editing deleted | P4 | Search proof and removed tests/protocol | Pending |
| AC-14 | Dormant PWA deleted | P5a | File/dependency/search proof | Pending |
| AC-15 | Narrow capabilities replace Platform | P5b | Consumer inventory and import proof | Pending |
| AC-16 | HTTP transport deleted | P5c/P5d | Route/client/server search and packaged smoke | Pending |
| AC-17 | Composition roots reduced | P6 | Responsibility review and module tests | Pending |
| AC-18 | Public compatibility preserved | All | CLI/API/build/preview/publish gates | Pending |
| AC-19 | Architecture CI active | P0b/P6 | CI workflow and deliberate-failure proof | Evidenced for P0b (generated-file + architecture checks wired into the CI build job, each with a self-test proving pass and fail paths; P6 additions pending) |
| AC-20 | Net complexity reduced | P7 | Final deletion ledger and measured diff | Pending |
| AC-21 | Real-book regression gate green | P3/P7 | User guide, advanced book, field guide evidence | Evidenced for P3 (SFE-P3d-parity: full user guide, design-guide book, validation example and a plugin-using fixture book — 28 chapters total; the field guide is gitignored and out of corpus, and the final P7 sweep remains) |
| AC-22 | Documentation complete | P7 | Doc link and example lint | Pending |
| AC-23 | Security boundaries preserved | P2/P3/P5 | CSP, trust, IPC validation, secret scan tests | Evidenced for P2 and the desktop P3 boundary (SFE-P2c security review: host-only plugin execution, inert plugin HTML, fail-closed trust gate; SFE-P3e: rich-mode plugins execute only in main for the opened project — the same trust decision the preview already exercises — over one validated IPC channel whose projectDir must equal the host's own workspace root; VS Code trust remains P3c, P5 boundaries pending) |
| AC-24 | Performance budgets met | P3d | Recorded benchmark results | Pending |

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
  "baseSha": "0951195669ab9082cb90409b9c05f3c9bf2077b9",
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
  "baseSha": "ebe2c24f42e34a2b4d21df3fca8964355a99209c",
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

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
| AC-03 | Exact no-edit byte identity | P2/P3 | Corpus and real-book byte tests | Pending |
| AC-04 | Explicit edit locality | P2/P3 | Source diff tests and randomized range cases | Pending |
| AC-05 | Stale/invalid edits fail closed | P1/P3 | Host contract tests | Evidenced for P1 (SFE-P1a: applyEdit contract tests incl. TOCTOU-hardened accessor case, seeded 500-case property test, validator negatives; P3 host integrations pending) |
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
| AC-19 | Architecture CI active | P0b/P6 | CI workflow and deliberate-failure proof | Evidenced for P0b (generated-file + architecture checks wired into the CI build job, each with a self-test proving pass and fail paths; P6 additions pending) |
| AC-20 | Net complexity reduced | P7 | Final deletion ledger and measured diff | Pending |
| AC-21 | Real-book regression gate green | P3/P7 | User guide, advanced book, field guide evidence | Pending |
| AC-22 | Documentation complete | P7 | Doc link and example lint | Pending |
| AC-23 | Security boundaries preserved | P2/P3/P5 | CSP, trust, IPC validation, secret scan tests | Pending |
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

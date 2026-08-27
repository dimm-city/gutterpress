# Source-First Editor — Review and Acceptance Log

> Normative plan: [`docs/plans/source-first-editor-enterprise-refactor.md`](../source-first-editor-enterprise-refactor.md)
> Companion guardrails: [`pr158-lessons.md`](./pr158-lessons.md)
>
> Every run appends its structured result here. A criterion without evidence is not complete.

## Acceptance evidence matrix

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

## Run results

<!-- Structured run results are appended below, newest last. -->

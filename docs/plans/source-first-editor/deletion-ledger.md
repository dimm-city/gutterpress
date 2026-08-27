# Source-First Editor — Deletion and Simplification Ledger

> Complexity removed is a first-class deliverable. P0a records exact baseline counts;
> each deletion run updates them. The final ledger must show reduction in runtime
> branches, concepts, modules, and production LOC — not merely file movement.

## Baseline counts (recorded by P0a)

Filled by run SFE-P0a from the recorded `origin/main` baseline SHA
`ea7b60d50340b75b9c58666e5063bcbbbb666576`. Full commands, outputs, and
cross-references live in `docs/plans/source-first-editor/baseline.md` §4–§6;
only the Baseline column is filled here per this run's write ownership —
Current/Delta are left as em-dashes for the deletion runs that will measure
against them.

| Metric | Baseline | Current | Delta |
|---|---:|---:|---:|
| Desktop HTTP routes (`+server.ts`) | 104 | — | — |
| IPC handlers (`ipcMain.handle`) | 12 (`secureHandle` registrations — the sole `ipcMain.handle` call site is 1; see baseline.md §4.2) | — | — |
| Preview mutation protocol messages | 5 — the `beginBlockEdit`/`endBlockEdit` command pair plus the `blockEditRequested`/`blockEditFinished`/`blockEditStateChanged` event triplet ONLY (mutation-inventory.md §1.1–§1.2). Does NOT include the separate `contextMenuRequested` event or `getContextTargetAt` command (mutation-inventory.md §1.5, added in repair round 1): those are read/target-resolution messages the context-menu path uses, not mutations, and may survive past P4 as part of the read-only context menu D8 keeps. | — | — |
| `Platform`/`HostServices` methods | 30 (9 `PlatformAdapter` + 21 `HostServices`, combined with one override; platform-inventory.md §1–§2) | — | — |
| Production LOC (workspace `src/`) | 426 files / 85,668 lines (strict `src/` only); 471 files / 94,859 lines workspace-wide incl. `packages/desktop/electron/`; see baseline.md §4.5 | — | — |
| Test LOC | 316 files / 76,861 lines (at baseline SHA; see baseline.md §4.6) | — | — |
| Dependencies (workspace, prod) | 41 (summed across packages: cli 28, desktop 13, open-design-plugin 0; see baseline.md §4.7) | — | — |
| Tracked generated files | 7 (stray root-level `.svelte-kit/`, pre-existing at baseline SHA; see baseline.md §4.4) | — | — |

## Planned deletions

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

## Deletion run updates

<!-- Each deletion run appends measured before/after counts and proofs here. -->

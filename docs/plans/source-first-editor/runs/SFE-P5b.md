# SFE-P5b — Replace the broad Platform with feature-owned capabilities

## Objective

Remove the service locator. After P5a there is exactly one host
implementation, so the `Platform`/`HostServices` seam is indirection with a
single tenant: `getPlatform()` is a global locator, `ElectronAdapter` is a
1:1 forwarding layer, and the contract is a 120-member grab bag whose DTOs
live away from their owners. P5b replaces that with **feature-owned
capability modules**: each bounded context owns its slice of the preload
bridge, its DTOs, and its push streams, consumed by direct import — the same
shape `api.ts` already gives routes, minus the locator.

## Design constraints (P3e ruling applied)

- **Delete indirection; do not re-house it.** A capability module is a thin,
  typed slice over `window.electron`'s existing bridge surface — module
  functions, not classes, not injection containers, no new "manager"/
  "provider" layer. If a capability module would merely forward calls the
  way `ElectronAdapter` does today, the forwarding dies instead.
- **Group by bounded context, not by transport.** The plan names the axes:
  updater; theme; sync/remote/GitHub; build/preview/export pipeline; editor
  projection; app lifecycle (flush/close, folder events, file launch);
  files/dialog. Lane judgment on the exact cut, recorded in the map.
- **DTOs move to their owning capability.** `contract.ts`/`dtos.ts`/
  `shared-types.ts` shrink accordingly; truly cross-process types stay in
  one shared IPC-DTO module only where BOTH sides genuinely import them.
- **`getPlatform()` → zero call sites.** The fail-loudly guard moves to the
  one place that still needs it (the bridge accessor each capability module
  uses). `isDesktop()` survives only if a real consumer remains.
- **`api.ts` and the routes are NOT this run's surface** — P5c migrates
  them. But the capability map MUST record, per bounded context, which
  `api.ts` namespaces belong to it, because the map is P5c's migration
  plan. The map is a planning artifact — P5c's subruns are re-scoped
  against it at dispatch, and the plan's P5c1–P5c4 grouping wins if they
  conflict.
- Only `electron-adapter.ts` may touch `window.electron` today; after this
  run, only the capability modules' shared bridge accessor may.
- Behavior is unchanged. This is a seam refactor: every suite green, no new
  features, net LOC negative or flat (the map is the only growth).

## Deliverables

1. `docs/plans/source-first-editor/capability-map.md` — the inventory:
   every current contract member and every `api.ts` namespace, assigned to
   a bounded context, with its consumers listed; the P5c subrun each group
   lands in; and the members found DEAD during inventory (deleted this run
   with search proof, not migrated).
2. The capability modules under `packages/desktop/src/lib/` in
   feature-owned locations, with their DTOs.
3. The ~13 `getPlatform()` consumers migrated; `getPlatform()`,
   `ElectronAdapter`'s forwarding, and the dead contract members deleted;
   `contract.ts`/`index.ts` shrunk to what still has a consumer (the
   `ElectronBridge`/preload types remain — they type the real boundary).
4. Tests updated where they stubbed the locator; the platform tests that
   exercised forwarding now exercise the capability modules.

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test`
- `bun run check:architecture && bun run check:generated-files && bun run knip`

## Review log

Four batches over `951623d7..HEAD`, three rounds. Round 1: **12 CONFIRMED** —
dominated by truthfulness defects in the capability map (the document P5c
dispatches from): four quotations attributed to the run spec that exist
nowhere in it; member arithmetic that did not close (21 vs 22 vs 30 vs 31);
a DTO-relocation constraint claimed met but only partly done; an
ElectronBridge parity table claiming exact agreement over two real
divergences (a `build.allowShrink` missing from `types.d.ts`, an
`onSyncStatus` cast) plus a zero-consumer duplicate `Window.electron` block
flagged for P5c/P6 deletion; a "real output" block narrating figures its
command could not produce; and an unmeasured isDesktop() census. Real code
findings alongside: theme's `onNativeThemeUpdated` lost its only test
(restored as a real subscription-and-flip test), the platform barrel carried
15+ dead re-exports (trimmed to the seven with live importers), six dangling
`{@link HostServices…}` references, and the editor-projection DTO exception
was nominal until the types actually moved. Round 2 confirmed one residual
(the map's diffstat narrative vs the reproducible numbers) and round 3
verified it: **approve, 0 confirmed, 1 advisory**.

Net production change over the run: 21 files, +580/−531 (+49); tests +280.
The locator, the 253-line forwarding adapter, and five dead members are
gone; behavior-identity probing produced no confirmed production defect.

## Gate

PASS — all 13 commands exit 0: install (frozen); typecheck (4 workspaces);
cli build + 1913:60; editor 3038; desktop 5823:1 + check (894 files) + lint
+ build (render purity, 143 files); architecture (route ratchet 104 == 104);
generated-files (1332 tracked); vendored; knip.

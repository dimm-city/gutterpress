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

<!-- Appended by the review stage. -->

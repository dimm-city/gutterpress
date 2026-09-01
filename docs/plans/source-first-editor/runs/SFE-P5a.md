# SFE-P5a — Delete the dormant PWA implementation

## Objective

Remove the inactive browser host from the Electron package (D10): the
`WebAdapter`, its FSA/IndexedDB machinery, the service worker and app
manifest, the PWA fallbacks in platform selection, and every dead-code
exemption that existed to protect them. A future web product is a separate
package consuming `@dimm-city/gutterpress-editor` and `gutterpress/render` —
not a second host hiding inside the desktop app.

## Authority and supersession

The plan's D10 and P5a sections authorize this deletion explicitly. They
supersede two in-repo documents that describe the PWA as live scaffolding:
CLAUDE.md §8's "PWA scaffolding … not dead code to delete" paragraph and
`docs/pwa-webadapter-plan.md` — Lane C re-statuses both. Knip's desktop
workspace carries entries that exist only to protect this code
(`src/service-worker.{ts,js}`, `web-store.ts` and the deletion-tie comment
naming P5a) — Lane B removes them WITH the code, per the ledger's ties.

## Behavior that must remain unchanged

- The Electron desktop app: every suite, `svelte-check`, lint, build and
  render-purity gate stays green.
- `ElectronAdapter`, the platform contract's Electron half, and every
  `api.ts` route call — P5b/P5c own those; this run deletes only the WEB
  half.
- The static `engine/` and `icons/` assets (not PWA-only; verify, don't
  assume).

## Binding decisions

- **Fail loudly, not partially (plan P5a Lane A):** after deletion,
  `vite dev` without Electron must fail clearly or run an explicitly named
  mock host — never silently select a partial product. The platform
  selection path (`getPlatform()`/`isDesktop()`) must have an explicit,
  typed non-Electron behavior (a thrown, named error is acceptable and
  simplest).
- **D15:** every deletion claim carries search proof and passing tests.
  Required: `WebAdapter` → zero runtime occurrences; `web-fs`/`web-store` →
  zero; service-worker registration → zero; `manifest.webmanifest` → gone
  unless something non-PWA consumes it (verify).
- **Deletion only** — no compensating machinery, net LOC strongly negative.

## Lane ownership (A, B, C in parallel — disjoint)

| Lane | May write | Must not write | Deliverable |
|---|---|---|---|
| A | `packages/desktop/src/lib/platform/**` (web files + index + contract's web-only members), `packages/desktop/src/service-worker.ts` (delete), `packages/desktop/src/routes/+layout.svelte` and `+page.svelte` (ONLY the service-worker registration / web-fallback call sites), `packages/desktop/src/lib/components/SyncStatusPill.svelte`, `src/lib/settings.svelte.ts` + `settings-merge.ts` (ONLY web-fallback branches), desktop tests for all of the above | `packages/desktop/package.json`, build configs, `knip.json`, docs, `electron-adapter.ts`'s Electron behavior, `api.ts`'s route methods | The web host's code deleted; platform selection fails loudly off-Electron |
| B | `packages/desktop/package.json`, `packages/desktop/vite.config.*`, `svelte.config.*`, `packages/desktop/static/manifest.webmanifest` (delete if PWA-only), root `knip.json` (desktop workspace entries only), `.github/workflows/*` (only lines referencing deleted files) | `packages/desktop/src/**` except nothing, docs | Build/dependency/exemption cleanup |
| C | `CLAUDE.md` (§8's PWA paragraphs only), `docs/pwa-webadapter-plan.md`, `docs/adr/**` (statusing only), `docs/plans/source-first-editor/deletion-ledger.md` | production source, tests | Docs re-statused; ledger rows discharged with proofs |

## Gate

- `bun install --frozen-lockfile`
- `bun run typecheck`
- `cd packages/desktop && bun run test && bun run check && bun run lint && bun run build`
- `cd packages/cli && bun run build && bun run test`
- `cd packages/editor && bun run test`
- `bun run check:architecture && bun run check:generated-files && bun run knip`

## Review log

<!-- Appended by the review stage. -->

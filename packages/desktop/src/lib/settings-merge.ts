/**
 * Shared settings deep-merge (Phase 1b).
 *
 * Previously this logic was duplicated inline in both `platform/web-adapter.ts`
 * (localStorage persistence) and `settings.svelte.ts` (the reactive store). The
 * two copies DISAGREED on array handling — the web-adapter guarded
 * `!Array.isArray(value)`, the store did not — a latent settings-corruption bug
 * (an array-valued section patch would spread into an object as numeric index
 * keys in the store copy). This is the single reconciled implementation, using
 * the web-adapter's correct behaviour: arrays are REPLACED wholesale (the outer
 * section spread swaps a nested array field), and a malformed array-valued
 * SECTION patch is ignored rather than index-spread.
 *
 * Pure — no `node:*`/`fs`/`path`/`url`/`postcss` imports — so it stays
 * PWA-clean in the renderer bundle (CLAUDE.md §8).
 *
 * A patch section is filtered to `base`'s own keys before spreading (#274):
 * a persisted settings file can still carry a key a later schema version
 * removed (e.g. the deleted `editor.autoSaveDelay`), and without this filter
 * that dead key would spread into the merged object, ride along on every
 * subsequent settings write, and live forever. Filtering against `base[key]`
 * — DEFAULT_SETTINGS at load time, the already-clean live state thereafter —
 * drops it instead of merely hiding it behind the type system.
 */
// Import from the shared-types leaf, NOT the ./platform value barrel: this pure
// module is also consumed host-side (electron/settings-store.ts), and pulling
// the barrel would drag the SPA adapters into the Electron compile graph.
import type { AppSettings, DeepPartial } from "./platform/shared-types";

/** Section-level merge: spread the patch section over the base section. */
function mergeSettingsSection<K extends keyof AppSettings>(
  target: AppSettings,
  base: AppSettings,
  key: K,
  value: DeepPartial<AppSettings>[K],
): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const known: Record<string, unknown> = {};
    for (const k of Object.keys(value as object)) {
      if (k in (base[key] as object)) known[k] = (value as Record<string, unknown>)[k];
    }
    target[key] = { ...base[key], ...known } as AppSettings[K];
  }
}

/** Merge a settings patch over a base, returning a new object (base untouched). */
export function deepMergeSettings(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out: AppSettings = { ...base };
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    mergeSettingsSection(out, base, key, patch[key]);
  }
  return out;
}

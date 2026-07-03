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
 */
import type { AppSettings, DeepPartial } from "./platform";

/** Section-level merge: spread the patch section over the base section. */
function mergeSettingsSection<K extends keyof AppSettings>(
  target: AppSettings,
  base: AppSettings,
  key: K,
  value: DeepPartial<AppSettings>[K],
): void {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    target[key] = { ...base[key], ...value } as AppSettings[K];
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

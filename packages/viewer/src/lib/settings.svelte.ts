/**
 * useSettings() — the reactive, persisted user-settings store (#45).
 *
 * A Svelte 5 `$state`-backed module store (not a class, no legacy Svelte
 * stores). It loads `AppSettings` from the platform adapter once at first
 * access and writes every change back through `getPlatform().setSettings()`.
 *
 * Reads are reactive: components that reference `useSettings().current.<...>`
 * inside a `$derived`/`$effect`/template re-run when a setting changes.
 *
 * Distinct from `ViewerPrefs` (session/per-project state via setViewerPrefs).
 * Settings are durable user preferences persisted to `userData/app-settings.json`
 * on desktop and `localStorage` on web.
 */
import { getPlatform, DEFAULT_SETTINGS } from "$lib/platform";
import type { AppSettings, DeepPartial } from "$lib/platform";

// The single reactive settings object. Seeded with defaults so reads are valid
// before the async load resolves; `_loadSettings()` overwrites with persisted
// values on app start.
const state = $state<{ current: AppSettings; loaded: boolean }>({
  current: structuredClone(DEFAULT_SETTINGS),
  loaded: false,
});

let loadPromise: Promise<void> | null = null;

function mergeInto(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    const value = patch[key];
    if (value && typeof value === "object") {
      out[key] = { ...base[key], ...(value as object) };
    }
  }
  return out as unknown as AppSettings;
}

/**
 * Load persisted settings from the host once. Idempotent — repeated calls share
 * the same in-flight promise. Call once at app start (e.g. from +page.svelte).
 */
export function _loadSettings(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = getPlatform()
    .getSettings()
    .then((loaded) => {
      state.current = loaded;
      state.loaded = true;
    })
    .catch(() => {
      // Keep the defaults already in `state.current`.
      state.loaded = true;
    });
  return loadPromise;
}

/**
 * Patch settings: optimistically updates the reactive store, then persists via
 * the platform adapter. Accepts a deep-partial so callers patch one section.
 */
function set(patch: DeepPartial<AppSettings>): void {
  state.current = mergeInto(state.current, patch);
  getPlatform().setSettings(patch).catch(() => {});
}

/** Reset one section to its defaults and persist. */
function resetSection(section: keyof AppSettings): void {
  const defaults = structuredClone(DEFAULT_SETTINGS[section]);
  set({ [section]: defaults } as DeepPartial<AppSettings>);
}

/**
 * The settings store handle. `current` is the reactive `AppSettings` proxy;
 * read `useSettings().current.appearance.previewBg` etc.
 */
export function useSettings() {
  return {
    get current(): AppSettings {
      return state.current;
    },
    get loaded(): boolean {
      return state.loaded;
    },
    set,
    resetSection,
  };
}

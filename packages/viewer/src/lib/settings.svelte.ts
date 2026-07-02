/**
 * useSettings() — the reactive, persisted user-settings store (#45).
 *
 * A Svelte 5 `$state`-backed module store (not a class, no legacy Svelte
 * stores). It loads `AppSettings` from the host (via `api.app.getSettings`) once
 * at first access and writes every change back through `api.app.setSettings()`.
 *
 * Reads are reactive: components that reference `useSettings().current.<...>`
 * inside a `$derived`/`$effect`/template re-run when a setting changes.
 *
 * Distinct from `ViewerPrefs` (session/per-project state via setViewerPrefs).
 * Settings are durable user preferences persisted to `userData/app-settings.json`
 * on desktop and `localStorage` on web.
 */
import { DEFAULT_SETTINGS } from "$lib/platform";
import type { AppSettings, DeepPartial } from "$lib/platform";
import { api } from "$lib/api";

// The single reactive settings object. Seeded with defaults so reads are valid
// before the async load resolves; `_loadSettings()` overwrites with persisted
// values on app start.
const state = $state<{ current: AppSettings; loaded: boolean }>({
  current: structuredClone(DEFAULT_SETTINGS),
  loaded: false,
});

let loadPromise: Promise<void> | null = null;

/** Subscribers notified after every `set()` call with the updated settings. */
const subscribers: Array<(settings: AppSettings) => void> = [];

function mergeSettingsSection<K extends keyof AppSettings>(
  target: AppSettings,
  base: AppSettings,
  key: K,
  value: DeepPartial<AppSettings>[K],
): void {
  if (value && typeof value === "object") {
    target[key] = { ...base[key], ...value } as AppSettings[K];
  }
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<AppSettings>;
  return !!settings.editor && !!settings.appearance && !!settings.preview && !!settings.versionHistory;
}

function mergeInto(base: AppSettings, patch: DeepPartial<AppSettings>): AppSettings {
  const out: AppSettings = { ...base };
  for (const key of Object.keys(patch) as Array<keyof AppSettings>) {
    mergeSettingsSection(out, base, key, patch[key]);
  }
  return out;
}

/**
 * Load persisted settings from the host once. Idempotent — repeated calls share
 * the same in-flight promise. Call once at app start (e.g. from +page.svelte).
 */
export function _loadSettings(): Promise<void> {
  if (loadPromise) return loadPromise;
  loadPromise = api.app
    .getSettings()
    .then((loaded) => {
      if (isAppSettings(loaded)) {
        state.current = loaded;
      }
      state.loaded = true;
      // Notify imperative subscribers (subscribe() callers) so they can react
      // to the persisted values that just arrived.
      for (const fn of [...subscribers]) fn(state.current);
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
  api.app.setSettings(patch as Record<string, unknown>).catch(() => {});
  for (const fn of [...subscribers]) fn(state.current);
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
    /**
     * Subscribe to settings changes. The callback is called after every `set()`
     * with the full updated `AppSettings`. Returns an unsubscribe function.
     * Use in `onMount` with its return teardown instead of `$effect`.
     */
    subscribe(fn: (settings: AppSettings) => void): () => void {
      subscribers.push(fn);
      return () => {
        const i = subscribers.indexOf(fn);
        if (i >= 0) subscribers.splice(i, 1);
      };
    },
  };
}

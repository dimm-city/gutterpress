/**
 * Theme controller (#48).
 *
 * Resolves the effective app-chrome theme from the persisted appearance setting
 * (`AppSettings.appearance.theme`: "light" | "dark" | "system") plus the OS
 * preference, and writes it to `document.documentElement.dataset.theme`.
 *
 * Svelte 5 runes module — no class. The reactive `themeMode`/`resolvedTheme`
 * are read by UI controls; `setThemeMode()` persists through the settings store.
 *
 * No-flash contract: the canonical store is `AppSettings`. To set `data-theme`
 * before first paint, `app.html` runs an inline script that reads a fast-path
 * cache from `localStorage[THEME_CACHE_KEY]`. `initTheme()` keeps that cache
 * in sync on every resolve so the next launch paints the correct theme
 * synchronously.
 *
 * SFE-P5b: the OS-theme push subscription is the sole consumer of
 * `onNativeThemeUpdated`, so it calls the shared bridge accessor directly
 * (`bridge().onNativeThemeUpdated(...)`) rather than through a dedicated
 * capability module — the smallest honest shape for a single 1:1 forward.
 */
import { bridge } from "$lib/platform/bridge";
import { useSettings } from "$lib/settings.svelte";
import type { NativeThemeState } from "$lib/platform/contract";
import { getNativeTheme } from "$lib/app-lifecycle/app-lifecycle-capability";

export type ThemeMode = "light" | "dark" | "system";
type ResolvedTheme = "light" | "dark";

/** localStorage key the no-flash inline script in app.html reads. Keep in sync. */
const THEME_CACHE_KEY = "gutterpress.theme-mode";

const state = $state<{
  mode: ThemeMode;
  resolved: ResolvedTheme;
  osDark: boolean;
  initialized: boolean;
}>({
  mode: "system",
  resolved: "dark",
  osDark: true,
  initialized: false,
});

let unsubscribeOs: (() => void) | null = null;

function resolve(mode: ThemeMode, osDark: boolean): ResolvedTheme {
  if (mode === "light") return "light";
  if (mode === "dark") return "dark";
  return osDark ? "dark" : "light";
}

/** Apply the resolved theme to the document and refresh the fast-path cache. */
function apply(): void {
  const resolved = resolve(state.mode, state.osDark);
  state.resolved = resolved;
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = resolved;
  }
  try {
    globalThis.localStorage?.setItem(THEME_CACHE_KEY, state.mode);
  } catch {
    // Private-mode / disabled storage — the live resolve still works; only the
    // next-launch no-flash fast-path is unavailable.
  }
}

/**
 * Initialise theming: read the persisted mode + OS preference, apply, and
 * subscribe to OS theme changes. Idempotent — safe to call from an `$effect`.
 */
export function initTheme(): void {
  if (state.initialized) return;
  state.initialized = true;

  const settings = useSettings();

  // Seed mode from the (already-seeded) settings store; refines once settings
  // finish loading via the reactive read below.
  state.mode = settings.current.appearance.theme;

  getNativeTheme()
    .then((s: NativeThemeState) => {
      state.osDark = s.shouldUseDarkColors;
      apply();
    })
    .catch(() => {
      apply();
    });

  unsubscribeOs = bridge().onNativeThemeUpdated((s) => {
    state.osDark = s.shouldUseDarkColors;
    apply();
  });

  // Apply immediately with whatever we have so far (no wait for the async query).
  apply();
}

/**
 * Re-read the persisted theme mode from the settings store and re-apply. Call
 * this from a reactive `$effect` so the document follows the Settings control.
 */
export function syncThemeFromSettings(): void {
  const mode = useSettings().current.appearance.theme;
  if (mode !== state.mode) {
    state.mode = mode;
    apply();
  }
}

/** Persist a new theme mode through the settings store and re-apply. */
export function setThemeMode(mode: ThemeMode): void {
  state.mode = mode;
  useSettings().set({ appearance: { theme: mode } });
  apply();
}


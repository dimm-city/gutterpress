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
 * Notification channels (ARCH #61): rune reactivity serves reads — templates
 * and `$derived` re-run when `current` changes. Imperative side-effects
 * (pushing a changed value into a non-reactive sink like the preview client
 * or the editor buffer) go through `onSettingsChange()` below, because this
 * repo BANS `$effect` in the SPA (enforced by eslint `no-restricted-syntax`;
 * see CLAUDE.md §8's desktop conventions). The hazard #61 flagged — a setter
 * that forgets the manual notify loop silently breaking imperative
 * consumers — is closed structurally: every state replacement routes through
 * the single `replaceState()` choke point, which owns the notify. Because
 * `set()` replaces the WHOLE `current` object on every call (not just the
 * touched section), listeners fire on every settings change — use
 * `settingsChangeGuard()` below to dedupe against the value actually read,
 * exactly as the old `lastBg`-style closures did.
 *
 * Distinct from `DesktopPrefs` (session/per-project state via setDesktopPrefs).
 * Settings are durable user preferences persisted to `userData/app-settings.json`
 * on desktop. `api.app.getSettings`/`setSettings` reach that file through the
 * `api/app/settings` server route, which requires Electron main to have
 * registered its prefs hooks (`getPrefsHooks()`); outside Electron (a plain
 * browser / `vite dev`) that route 503s, `_loadSettings()`'s `.catch()` keeps
 * the in-memory defaults, and `set()`'s `.catch(() => {})` silently drops the
 * write — so today settings do NOT persist on web; they reset every session.
 * `WebAdapter` (web-adapter.ts) already has a real `localStorage`-backed
 * `getSettings`/`setSettings` implementation, but it is dormant (unreachable
 * from here) until the #33 PWA milestone wires this store onto
 * `getPlatform()` for the web target — see `CLAUDE.md` §8.
 */
import { DEFAULT_SETTINGS } from "$lib/platform";
import type { AppSettings, DeepPartial } from "$lib/platform";
import { api } from "$lib/api";
import { deepMergeSettings } from "$lib/settings-merge";

// The single reactive settings object. Seeded with defaults so reads are valid
// before the async load resolves; `_loadSettings()` overwrites with persisted
// values on app start.
const state = $state<{ current: AppSettings; loaded: boolean }>({
  current: structuredClone(DEFAULT_SETTINGS),
  loaded: false,
});

let loadPromise: Promise<void> | null = null;

type SettingsListener = (current: AppSettings) => void;
const listeners = new Set<SettingsListener>();

/**
 * The single choke point every state replacement routes through, so the
 * imperative notification can never be forgotten by a future setter (the
 * dual-write hazard ARCH #61 flagged).
 */
function replaceState(next: AppSettings): void {
  state.current = next;
  for (const fn of listeners) fn(state.current);
}

/**
 * Register an imperative settings-change listener; returns an unsubscribe.
 * For side-effect consumers only (the repo bans `$effect` — see the header);
 * reactive reads should use `useSettings().current` directly. Listeners fire
 * on EVERY settings change — wrap field-specific sinks in
 * `settingsChangeGuard()` to dedupe.
 */
export function onSettingsChange(fn: SettingsListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function isAppSettings(value: unknown): value is AppSettings {
  if (!value || typeof value !== "object") return false;
  const settings = value as Partial<AppSettings>;
  return !!settings.editor && !!settings.appearance && !!settings.preview && !!settings.versionHistory;
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
        replaceState(loaded);
      }
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
  replaceState(deepMergeSettings(state.current, patch));
  api.app.setSettings(patch as Record<string, unknown>).catch(() => {});
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

/**
 * Build a guarded settings-change sink for use inside an `onSettingsChange`
 * listener (ARCH #61). `set()` replaces the whole `AppSettings.current`
 * object on every call, so a listener that reads one nested field (e.g.
 * `current.appearance.previewBg`) would otherwise re-apply its side effect
 * on every UNRELATED settings change too.
 *
 * The returned function calls `onChange(value)` only when `value` differs
 * (`!==`) from the last value it actually applied, AND `ready()` (default:
 * always true) returns true. `ready()` is checked BEFORE recording the value
 * as "seen", so a value that arrives while the guarded resource isn't ready
 * yet (e.g. the preview client hasn't mounted) is not silently dropped —
 * the sink still fires the next time it's called with `ready()` true, even if
 * the value hasn't changed since the skipped attempt. This mirrors the
 * `lastBg`-style closures the manual `subscribe()` consumers used to hand-roll
 * individually.
 *
 * Usage (an `onSettingsChange` listener, registered in `onMount`):
 * ```ts
 * const bgSink = settingsChangeGuard((bg: string) => client?.injectStyles(...), () => !!client);
 * const off = onSettingsChange((s) => bgSink(s.appearance.previewBg));
 * ```
 */
export function settingsChangeGuard<T>(
  onChange: (value: T) => void,
  ready: () => boolean = () => true,
): (value: T) => void {
  let last: T | undefined;
  return (value: T) => {
    if (value !== last && ready()) {
      last = value;
      onChange(value);
    }
  };
}

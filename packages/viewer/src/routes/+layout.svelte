<script lang="ts">
  import "$lib/theme.css";
  import { onMount } from "svelte";
  import { _loadSettings } from "$lib/settings.svelte";
  import { initTheme, syncThemeFromSettings } from "$lib/theme.svelte";
  import { isDesktop } from "$lib/platform";

  let { children } = $props();

  // PWA service worker (#33 Phase 4). Register ONLY in a real browser
  // (!isDesktop()) — NEVER under Electron, where the SPA loads via app:// and
  // ships inside the app (updated as a whole via electron-updater); a SW there
  // would serve stale cached assets across app updates. The SW precaches the
  // app shell + vendored paged.js for offline use. SvelteKit does not
  // auto-register it, so we do.
  onMount(() => {
    if (isDesktop()) return;
    if (!("serviceWorker" in navigator)) return;
    // import.meta.env.DEV is false in the static production build; skip
    // registration in `vite dev` because the SW would cache the dev server's
    // unhashed modules and break HMR.
    if (import.meta.env.DEV) return;
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}service-worker.js`, { type: "module" })
      .catch((err) => console.warn("[pwa] service worker registration failed:", err));
  });

  // Kick off the settings load so the theme controller can read the persisted
  // appearance.theme. (Idempotent — +page.svelte also calls it.)
  _loadSettings();

  // Initialise theming on mount (sets document data-theme + OS subscription)
  // and sync with any already-loaded settings value.
  // The no-flash inline script in app.html has already painted the cached
  // theme synchronously; this refines it with the canonical persisted value
  // and wires up live OS-change tracking. setThemeMode() (called from
  // SettingsDialog) calls apply() directly, so no reactive tracking is needed
  // beyond this initial sync.
  onMount(() => {
    initTheme();
    syncThemeFromSettings();
    // Re-sync once the async settings load resolves — the initial call above
    // may fire before persisted settings have been fetched from the host.
    _loadSettings().then(() => syncThemeFromSettings()).catch(() => {});
  });
</script>

{@render children?.()}

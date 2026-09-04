<script lang="ts">
  import "$lib/theme.css";
  import { onMount } from "svelte";
  import { _loadSettings } from "$lib/settings.svelte";
  import { initTheme, syncThemeFromSettings } from "$lib/theme.svelte";

  let { children } = $props();

  // SFE-P5a (D10): the PWA service worker registration that used to live here
  // was deleted along with `src/service-worker.ts` and the dormant WebAdapter
  // it supported — a future web product is a separate package, not a second
  // host inside this Electron-only SPA.

  // Kick off the settings load so the theme controller can read the persisted
  // appearance.theme. (Idempotent — +page.svelte also calls it.)
  _loadSettings();

  // Initialise theming on mount (sets document data-theme + OS subscription)
  // and sync with any already-loaded settings value.
  // The no-flash inline script in app.html has already painted the cached
  // theme synchronously; this refines it with the canonical persisted value
  // and wires up live OS-change tracking. setThemeMode() (called from
  // SettingsView) calls apply() directly, so no reactive tracking is needed
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

<script lang="ts">
  import "$lib/theme.css";
  import { _loadSettings } from "$lib/settings.svelte";
  import { initTheme, syncThemeFromSettings } from "$lib/theme.svelte";

  let { children } = $props();

  // Kick off the settings load so the theme controller can read the persisted
  // appearance.theme. (Idempotent — +page.svelte also calls it.)
  _loadSettings();

  // Initialise theming on mount (sets document data-theme + OS subscription).
  // The no-flash inline script in app.html has already painted the cached
  // theme synchronously; this refines it with the canonical persisted value
  // and wires up live OS-change tracking.
  $effect(() => {
    initTheme();
  });

  // Follow the Settings "Theme" control: when appearance.theme changes in the
  // store, re-resolve and re-apply. Reading the reactive setting inside the
  // effect registers the dependency.
  $effect(() => {
    syncThemeFromSettings();
  });
</script>

{@render children?.()}

<script lang="ts">
  /**
   * Appearance section of ProjectConfigPanel — the theme grid (apply / remove /
   * import from folder + URL) and per-card thumbnail preview. Presentational:
   * theme state, `api.theme.*` calls, and thumbnail loading all live in the
   * composition root; this child renders props and emits changes via callbacks.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ThemeInfo } from "$lib/api";
  import { keyOf } from "./config-helpers";

  let {
    themeError,
    builtIns,
    projectThemes,
    activeThemeId,
    thumbs,
    themeBusyId,
    themeUrl = $bindable(""),
    applyTheme,
    removeTheme,
    importThemeFolder,
    importThemeUrl,
  }: {
    themeError: string | null;
    builtIns: ThemeInfo[];
    projectThemes: ThemeInfo[];
    activeThemeId: string | null;
    thumbs: Record<string, string>;
    themeBusyId: string | null;
    themeUrl: string;
    applyTheme: (t: ThemeInfo) => void;
    removeTheme: (t: ThemeInfo) => void;
    importThemeFolder: () => void;
    importThemeUrl: () => void;
  } = $props();

  /** True when this theme card is the project's active applied theme. */
  function isActiveTheme(t: ThemeInfo): boolean {
    // The active theme always lives in the project (apply copies built-ins into
    // themes/<id>). Match the project-kind card only, so a built-in card doesn't
    // also light up when its copy is the active project theme.
    return t.kind === "project" && activeThemeId === t.id;
  }
</script>

<section class="block">
  <h3>Appearance</h3>
  {#if themeError}
    <p class="error" role="alert">{themeError}</p>
  {/if}
  <p class="hint">Pick a look — applying copies the theme into your project and wires the manifest.</p>
  <ul class="theme-grid">
    {#each builtIns as t (keyOf(t))}
      {@render themeCard(t)}
    {/each}
    {#each projectThemes as t (keyOf(t))}
      {@render themeCard(t)}
    {/each}
  </ul>
  <div class="actions row">
    <button class="ghost small" onclick={importThemeFolder} disabled={themeBusyId !== null} title="Import a theme from a folder on disk">
      <Icon name="folder" size={13} /> Import from folder…
    </button>
  </div>
  <div class="add-row">
    <input
      class="input"
      type="text"
      placeholder="Theme URL (.css or theme folder)"
      value={themeUrl}
      oninput={(e) => (themeUrl = e.currentTarget.value)}
      onkeydown={(e) => { if (e.key === "Enter") importThemeUrl(); }}
    />
    <button class="ghost small" onclick={importThemeUrl} disabled={themeBusyId !== null}>Import</button>
  </div>
</section>

{#snippet themeCard(t: ThemeInfo)}
  <li class="theme-card" class:active={isActiveTheme(t)}>
    <div class="thumb">
      {#if thumbs[keyOf(t)] && thumbs[keyOf(t)] !== "__fallback__"}
        <iframe title={`Preview of ${t.name}`} srcdoc={thumbs[keyOf(t)]} sandbox="allow-same-origin" loading="lazy"></iframe>
      {:else}
        <div class="thumb-placeholder" role="img" aria-label={`Theme preview loading for ${t.name}`}>
          <span class="theme-fallback-title">Aa</span>
          <span class="theme-fallback-line"></span>
          <span class="theme-fallback-line short"></span>
        </div>
      {/if}
    </div>
    <div class="theme-info">
      <span class="theme-name">{t.name}</span>
      {#if t.author}<span class="theme-author">{t.author}</span>{/if}
      {#if isActiveTheme(t)}<span class="badge">active</span>{/if}
    </div>
    <div class="theme-actions">
      {#if isActiveTheme(t)}
        <span class="muted dim">Current theme</span>
        {#if t.kind === "project"}
          <button class="ghost small" onclick={() => removeTheme(t)} disabled={themeBusyId !== null} title="Remove this project theme">Remove</button>
        {/if}
      {:else}
        <button class="primary small" onclick={() => applyTheme(t)} disabled={themeBusyId !== null}>Apply</button>
        {#if t.kind === "project"}
          <button class="ghost icononly" onclick={() => removeTheme(t)} disabled={themeBusyId !== null} title="Remove" aria-label={`Remove ${t.name}`}>
            <Icon name="trash" size={13} />
          </button>
        {/if}
      {/if}
    </div>
  </li>
{/snippet}

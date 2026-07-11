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
  import { visibleBuiltInThemes } from "./theme-grid";

  let {
    themeError,
    builtIns,
    projectThemes,
    activeThemeId,
    thumbs,
    themeBusyId,
    themeUrl = $bindable(""),
    removeArmedKey,
    applyTheme,
    requestRemoveTheme,
    cancelRemoveTheme,
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
    /** Key (`keyOf`) of the card whose Remove button is armed, or null. */
    removeArmedKey: string | null;
    applyTheme: (t: ThemeInfo) => void;
    /** First click arms the Remove confirm on this card; a second click while armed removes it. */
    requestRemoveTheme: (t: ThemeInfo) => void;
    /** Disarm a Remove confirm without removing (Cancel / Escape / clicking elsewhere). */
    cancelRemoveTheme: () => void;
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

  // UX review M6: the grid used to render BOTH a built-in card and the
  // project's own copy of the same theme, with no dedupe — clicking Apply on
  // the built-in twin re-ran the destructive copy over the project copy's
  // (possibly customized) theme.css. Once a project copy of an id exists, hide
  // the built-in card for that id; see `visibleBuiltInThemes` for the full
  // rationale. Removing the project copy makes the built-in card reappear.
  let visibleBuiltIns = $derived(visibleBuiltInThemes(builtIns, projectThemes));
</script>

<section class="block">
  <h3>Appearance</h3>
  {#if themeError}
    <p class="error" role="alert">{themeError}</p>
  {/if}
  <p class="hint">Pick a look — applying copies the theme into your project and wires the manifest.</p>
  <ul class="theme-grid">
    {#each visibleBuiltIns as t (keyOf(t))}
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
      {#if removeArmedKey === keyOf(t)}
        {@render removeConfirm(t)}
      {:else if isActiveTheme(t)}
        <span class="muted dim">Current theme</span>
        {#if t.kind === "project"}
          <button class="ghost small" onclick={() => requestRemoveTheme(t)} disabled={themeBusyId !== null} title="Remove this project theme">Remove</button>
        {/if}
      {:else}
        <button class="primary small" onclick={() => applyTheme(t)} disabled={themeBusyId !== null}>Apply</button>
        {#if t.kind === "project"}
          <button class="ghost icononly" onclick={() => requestRemoveTheme(t)} disabled={themeBusyId !== null} title="Remove" aria-label={`Remove ${t.name}`}>
            <Icon name="trash" size={13} />
          </button>
        {/if}
      {/if}
    </div>
  </li>
{/snippet}

<!--
  UX review M7: a one-click "Remove" used to run an immediate recursive delete
  of the theme folder (and the customizations in its theme.css) with no
  confirm at any layer. This mirrors the CrashRecoveryDialog two-step inline
  confirm (M12): the FIRST click arms this block in place of the normal
  actions (naming the theme + warning customizations are gone for good); a
  SECOND click on "Delete" confirms. "Cancel" (or arming a different card)
  backs out without deleting anything.
-->
{#snippet removeConfirm(t: ThemeInfo)}
  <p class="remove-confirm-msg" role="alert">
    Delete "{t.name}"? Its customizations can't be recovered.
  </p>
  <button
    class="danger small"
    onclick={() => requestRemoveTheme(t)}
    disabled={themeBusyId !== null}
    aria-label={`Confirm delete ${t.name}`}
  >
    Delete
  </button>
  <button
    class="ghost small"
    onclick={cancelRemoveTheme}
    disabled={themeBusyId !== null}
    aria-label={`Cancel deleting ${t.name}`}
  >
    Cancel
  </button>
{/snippet}

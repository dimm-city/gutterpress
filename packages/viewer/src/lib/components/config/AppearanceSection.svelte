<script lang="ts">
  /**
   * Appearance section of ProjectConfigPanel — the theme grid (apply / remove /
   * import from folder + URL) and per-card thumbnail preview. All state,
   * `api.theme.*` calls, and thumbnail loading live in
   * `AppearanceSectionController` (passed as the single `controller` prop, per
   * the design-controller pattern — see M14); this child renders the
   * controller's rune fields and calls its intent methods. Shared primitives
   * come from `config-section-shared.css`; the Appearance-only theme-grid/
   * theme-card/thumbnail layout is scoped here.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ThemeInfo } from "$lib/platform/dtos";
  import { keyOf } from "./config-helpers";
  import { visibleBuiltInThemes } from "./theme-grid";
  import type { AppearanceSectionController } from "$lib/routes/appearance-section-controller.svelte";

  let { controller }: { controller: AppearanceSectionController } = $props();

  /** True when this theme card is the project's active applied theme. */
  function isActiveTheme(t: ThemeInfo): boolean {
    // The active theme always lives in the project (apply copies built-ins into
    // themes/<id>). Match the project-kind card only, so a built-in card doesn't
    // also light up when its copy is the active project theme.
    return t.kind === "project" && controller.activeThemeId === t.id;
  }

  // UX review M6: the grid used to render BOTH a built-in card and the
  // project's own copy of the same theme, with no dedupe — clicking Apply on
  // the built-in twin re-ran the destructive copy over the project copy's
  // (possibly customized) theme.css. Once a project copy of an id exists, hide
  // the built-in card for that id; see `visibleBuiltInThemes` for the full
  // rationale. Removing the project copy makes the built-in card reappear.
  let visibleBuiltIns = $derived(visibleBuiltInThemes(controller.builtIns, controller.projectThemes));
</script>

<section class="block">
  <h3>Appearance</h3>
  {#if controller.themeError}
    <p class="error" role="alert">{controller.themeError}</p>
  {/if}
  <p class="hint">Pick a look — applying copies the theme into your project and wires the manifest.</p>
  <ul class="theme-grid">
    {#each visibleBuiltIns as t (keyOf(t))}
      {@render themeCard(t)}
    {/each}
    {#each controller.projectThemes as t (keyOf(t))}
      {@render themeCard(t)}
    {/each}
  </ul>
  <div class="actions row">
    <button class="ghost small" onclick={controller.importThemeFolder} disabled={controller.themeBusyId !== null} title="Import a theme from a folder on disk">
      <Icon name="folder" size={13} /> Import from folder…
    </button>
  </div>
  <div class="add-row">
    <input
      class="input"
      type="text"
      placeholder="Theme URL (.css or theme folder)"
      bind:value={controller.themeUrl}
      onkeydown={(e) => { if (e.key === "Enter") controller.importThemeUrl(); }}
    />
    <button class="ghost small" onclick={controller.importThemeUrl} disabled={controller.themeBusyId !== null}>Import</button>
  </div>
</section>

{#snippet themeCard(t: ThemeInfo)}
  <li class="theme-card" class:active={isActiveTheme(t)}>
    <div class="thumb">
      {#if controller.thumbs[keyOf(t)] && controller.thumbs[keyOf(t)] !== "__fallback__"}
        <iframe title={`Preview of ${t.name}`} srcdoc={controller.thumbs[keyOf(t)]} sandbox="allow-same-origin" loading="lazy"></iframe>
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
      {#if controller.removeArmedKey === keyOf(t)}
        {@render removeConfirm(t)}
      {:else if isActiveTheme(t)}
        <span class="muted dim">Current theme</span>
        {#if t.kind === "project"}
          <button class="ghost small" onclick={() => controller.requestRemoveTheme(t)} disabled={controller.themeBusyId !== null} title="Remove this project theme">Remove</button>
        {/if}
      {:else}
        <button class="primary small" onclick={() => controller.applyTheme(t)} disabled={controller.themeBusyId !== null}>Apply</button>
        {#if t.kind === "project"}
          <button class="ghost icononly" onclick={() => controller.requestRemoveTheme(t)} disabled={controller.themeBusyId !== null} title="Remove" aria-label={`Remove ${t.name}`}>
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
    onclick={() => controller.requestRemoveTheme(t)}
    disabled={controller.themeBusyId !== null}
    aria-label={`Confirm delete ${t.name}`}
  >
    Delete
  </button>
  <button
    class="ghost small"
    onclick={controller.cancelRemoveTheme}
    disabled={controller.themeBusyId !== null}
    aria-label={`Cancel deleting ${t.name}`}
  >
    Cancel
  </button>
{/snippet}

<style>
  @import "$lib/styles/config-section-shared.css";

  .theme-grid { list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; }
  .theme-card {
    display: flex; flex-direction: column; gap: 4px; padding: 6px;
    border: 1px solid var(--app-border); border-radius: 7px; background: var(--app-surface-sunken);
  }
  .theme-card.active { border-color: var(--app-focus-ring); }
  .thumb { width: 100%; aspect-ratio: 4 / 3; border-radius: 4px; overflow: hidden; background: var(--app-control-bg); border: 1px solid var(--app-border-subtle); }
  .thumb iframe { width: 100%; height: 100%; border: 0; transform: scale(0.6); transform-origin: top left; width: 167%; height: 167%; }
  .thumb-placeholder {
    width: 100%; height: 100%; display: grid; place-content: center;
    gap: 5px; padding: 12px; background:
      linear-gradient(135deg, var(--app-surface), var(--app-control-bg));
  }
  .theme-fallback-title { font-size: 22px; font-weight: 700; color: var(--app-text); line-height: 1; }
  .theme-fallback-line { display: block; width: 68px; height: 4px; border-radius: 999px; background: var(--app-border-strong); }
  .theme-fallback-line.short { width: 46px; }
  .theme-info { display: flex; flex-direction: column; gap: 1px; }
  .theme-name { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .theme-author { font-size: 10px; color: var(--app-text-faint); }
  .theme-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  /* Armed Remove confirm (UX review M7): names the theme + warns customizations
     are gone for good, full-width above the Delete/Cancel pair. */
  .remove-confirm-msg {
    flex: 1 1 100%; margin: 0; font-size: 11px; line-height: 1.4; color: var(--app-error-text);
  }
  .danger { background: var(--app-error-bg); border-color: var(--app-error-border); color: var(--app-error-text); }
  .danger:hover:not(:disabled) { background: var(--app-error-border); }

  @media (max-width: 480px) {
    .theme-grid { grid-template-columns: 1fr 1fr; }
  }
</style>

<script lang="ts">
  /**
   * Styles section of ProjectConfigPanel — the active-stylesheet toggle +
   * open-in-editor list. Presentational: style state and `api.style.*` /
   * `api.project.listStyles` calls live in the composition root; this child
   * renders props and emits changes via callbacks.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProjectStyle } from "$lib/api";

  let {
    stylesError,
    styles,
    stylesBusy,
    toggleStyleActive,
    editStyle,
  }: {
    stylesError: string | null;
    styles: ProjectStyle[];
    stylesBusy: boolean;
    toggleStyleActive: (s: ProjectStyle, on: boolean) => void;
    editStyle: (s: ProjectStyle) => void;
  } = $props();
</script>

<section class="block">
  <h3>Styles</h3>
  {#if stylesError}
    <p class="error" role="alert">{stylesError}</p>
  {/if}
  {#if styles.length === 0}
    <p class="muted">No stylesheets found. Apply a theme to create one.</p>
  {:else}
    <ul class="style-list">
      {#each styles as s (s.path)}
        <li class:active={s.active}>
          <label class="style-row" title={s.path}>
            <input
              type="checkbox"
              checked={s.active}
              onchange={(e) => toggleStyleActive(s, e.currentTarget.checked)}
              disabled={stylesBusy}
              aria-label={`Enable ${s.displayName}`}
            />
            <span class="style-name">{s.displayName}</span>
            {#if s.active}<span class="badge">active</span>{/if}
          </label>
          <button class="ghost small" onclick={() => editStyle(s)} title="Open in editor">
            <Icon name="file-text" size={13} /> Edit
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<script lang="ts">
  /**
   * Styles section of ProjectConfigPanel — the active-stylesheet toggle +
   * open-in-editor list. Presentational: style state and `api.style.*` /
   * `api.project.listStyles` calls live in the composition root; this child
   * renders props and emits changes via callbacks.
   *
   * M35 guard: unchecking every stylesheet yields an unstyled preview with no
   * explanation (`toggleStyleActive` could pass an empty array straight to
   * `api.style.setActive`). Computed entirely from the `styles` prop this
   * component already receives, so the guard needs no changes anywhere else:
   * once only one stylesheet is active, that one's checkbox is disabled with
   * an explanatory hint instead of allowing the last uncheck.
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

  const LAST_ACTIVE_HINT = "Keep at least one stylesheet active — the preview needs one to render styled.";
  let activeCount = $derived(styles.filter((s) => s.active).length);
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
        {@const isLastActive = s.active && activeCount <= 1}
        <li class:active={s.active}>
          <label class="style-row" title={isLastActive ? LAST_ACTIVE_HINT : s.path}>
            <input
              type="checkbox"
              checked={s.active}
              onchange={(e) => toggleStyleActive(s, e.currentTarget.checked)}
              disabled={stylesBusy || isLastActive}
              aria-label={isLastActive ? `${s.displayName} — ${LAST_ACTIVE_HINT}` : `Enable ${s.displayName}`}
            />
            <span class="style-name">{s.displayName}</span>
            {#if s.active}<span class="badge">active</span>{/if}
            {#if isLastActive}<span class="muted dim" title={LAST_ACTIVE_HINT}>last active</span>{/if}
          </label>
          <button class="ghost small" onclick={() => editStyle(s)} title="Open in editor">
            <Icon name="file-text" size={13} /> Edit
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</section>

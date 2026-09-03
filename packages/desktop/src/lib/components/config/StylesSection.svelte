<script lang="ts">
  /**
   * Stylesheet-list sub-section of the merged "Look & style" section (UX
   * review M35 — see LookSection's header comment for the merge
   * rationale). This is the THIRD pane ProjectConfigPanel composes under one
   * "Look & style" heading — the raw monospace-path checkbox list a writer
   * almost never needs, so the parent now nests it behind an "Advanced"
   * `<details>` disclosure instead of giving it an always-visible section of
   * its own. No section wrapper or `<h3>` of its own anymore. All state and
   * `api.style.*` / `api.project.listStyles` calls live in
   * `StylesSectionController` (passed as the single `controller` prop, per
   * the design-controller pattern — see M14); this child renders the
   * controller's rune fields and calls its intent methods.
   *
   * M35 guard: unchecking every stylesheet yields an unstyled preview with no
   * explanation (`toggleStyleActive` could pass an empty array straight to
   * `api.style.setActive`). Computed entirely from `controller.styles`, so the
   * guard needs no changes anywhere else: once only one stylesheet is active,
   * that one's checkbox is disabled with an explanatory hint instead of
   * allowing the last uncheck.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { StylesSectionController } from "$lib/routes/styles-section-controller.svelte";

  let { controller }: { controller: StylesSectionController } = $props();

  const LAST_ACTIVE_HINT = "Keep at least one stylesheet active — the preview needs one to render styled.";
  let activeCount = $derived(controller.styles.filter((s) => s.active).length);
</script>

<div class="look-subsection styles-subsection">
  <p class="hint">Turn individual stylesheets on or off. Most writers never need this — a theme manages its own stylesheets automatically.</p>
  {#if controller.stylesError}
    <p class="error" role="alert">{controller.stylesError}</p>
  {/if}
  {#if controller.styles.length === 0}
    <p class="muted">No stylesheets found. Apply a theme to create one.</p>
  {:else}
    <ul class="style-list">
      {#each controller.styles as s (s.path)}
        {@const isLastActive = s.active && activeCount <= 1}
        <li class:active={s.active}>
          <label class="style-row" title={isLastActive ? LAST_ACTIVE_HINT : s.path}>
            <input
              type="checkbox"
              checked={s.active}
              onchange={(e) => controller.toggleStyleActive(s, e.currentTarget.checked)}
              disabled={controller.stylesBusy || isLastActive}
              aria-label={isLastActive ? `${s.displayName} — ${LAST_ACTIVE_HINT}` : `Enable ${s.displayName}`}
            />
            <span class="style-name">{s.displayName}</span>
            {#if s.active}<span class="badge">active</span>{/if}
            {#if isLastActive}<span class="muted dim" title={LAST_ACTIVE_HINT}>last active</span>{/if}
          </label>
          <button class="ghost small" onclick={() => controller.editStyle(s)} title="Open in editor">
            <Icon name="file-text" size={13} /> Edit
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  @import "$lib/styles/config-section-shared.css";

  .style-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
  .style-list li {
    display: flex; align-items: center; gap: 8px; padding: 7px 9px;
    border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken);
  }
  .style-list li.active { border-color: var(--app-focus-ring); }
  .style-row { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; cursor: pointer; }
  .style-name { font-size: 12px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--app-font-mono); }
</style>

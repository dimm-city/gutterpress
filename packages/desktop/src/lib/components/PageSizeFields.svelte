<script lang="ts">
  /**
   * The custom page-size inputs — a size dropdown plus width/height in inches
   * for "My own size…". One component for the new-book wizard and Book settings
   * (#357), so the two never offer different sizes or word them differently.
   * The choices + arithmetic live in `$lib/page-size-choices`.
   */
  import { COMMON_SIZES } from "$lib/page-size-choices";

  let {
    idPrefix,
    sizeChoice = $bindable(),
    widthIn = $bindable(),
    heightIn = $bindable(),
  }: {
    /** Prefix for the control ids (two instances never share an id). */
    idPrefix: string;
    sizeChoice: string;
    widthIn: string;
    heightIn: string;
  } = $props();
</script>

<label class="size-field" for="{idPrefix}-page-size">
  <span>Page size</span>
  <select id="{idPrefix}-page-size" bind:value={sizeChoice}>
    {#each COMMON_SIZES as size (size.id)}
      <option value={size.id}>{size.label}</option>
    {/each}
  </select>
</label>
{#if sizeChoice === "custom"}
  <div class="custom-page" role="group" aria-label="Page size in inches">
    <label class="page-field" for="{idPrefix}-page-width">
      <span>Width (in)</span>
      <input
        id="{idPrefix}-page-width"
        bind:value={widthIn}
        type="number"
        min="0.1"
        step="0.25"
        placeholder="8.5"
        autocomplete="off"
      />
    </label>
    <span class="page-times" aria-hidden="true">×</span>
    <label class="page-field" for="{idPrefix}-page-height">
      <span>Height (in)</span>
      <input
        id="{idPrefix}-page-height"
        bind:value={heightIn}
        type="number"
        min="0.1"
        step="0.25"
        placeholder="11"
        autocomplete="off"
      />
    </label>
  </div>
{/if}

<style>
  .size-field { display: flex; flex-direction: column; gap: 4px; margin-top: 2px; }
  .size-field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .size-field select {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 7px 8px;
    border-radius: 6px;
    font-size: 13px;
  }
  .size-field select:focus { outline: none; border-color: var(--app-focus-ring); }
  .custom-page { display: flex; align-items: flex-end; gap: 8px; margin-top: 2px; }
  .page-field { display: flex; flex-direction: column; gap: 4px; }
  .page-field > span { font-size: 11px; color: var(--app-text-muted); }
  .page-field input {
    width: 90px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 6px 8px;
    border-radius: 6px;
    font-size: 13px;
  }
  .page-field input:focus { outline: none; border-color: var(--app-focus-ring); }
  .page-times { color: var(--app-text-muted); font-size: 13px; padding-bottom: 8px; }
</style>

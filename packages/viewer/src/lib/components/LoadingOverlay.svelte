<script lang="ts">
  let {
    visible = false,
    label = "Loading…",
    cancelLabel,
    onCancel,
  }: {
    visible?: boolean;
    label?: string;
    cancelLabel?: string;
    onCancel?: (() => void) | undefined;
  } = $props();
</script>

{#if visible}
  <div class="loading-overlay" role="status" aria-live="assertive" aria-busy="true">
    <div class="spinner-wrap">
      <div class="spinner" aria-hidden="true"></div>
      <p class="label" aria-atomic="true">{label}</p>
      {#if onCancel}
        <button class="cancel-btn" onclick={onCancel}>{cancelLabel ?? "Cancel"}</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .loading-overlay {
    position: fixed;
    inset: 0;
    top: 56px; /* below toolbar */
    background: var(--app-overlay);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
    backdrop-filter: blur(2px);
  }

  .spinner-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 16px;
  }

  .spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--app-spinner-track);
    border-top-color: var(--app-spinner-head);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .label {
    margin: 0;
    color: var(--app-text-secondary);
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid var(--app-border-strong);
    color: var(--app-text-secondary);
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }

  .cancel-btn:hover {
    background: var(--app-scrim-strong);
  }
</style>

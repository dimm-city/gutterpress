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
    background: rgba(32, 32, 32, 0.88);
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
    border: 3px solid #3a3a3a;
    border-top-color: #0077dd;
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .label {
    margin: 0;
    color: #ccc;
    font-size: 13px;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  }

  .cancel-btn {
    background: transparent;
    border: 1px solid #6b7280;
    color: #e5e7eb;
    border-radius: 999px;
    padding: 6px 12px;
    font-size: 12px;
    cursor: pointer;
  }

  .cancel-btn:hover {
    background: rgba(255, 255, 255, 0.08);
  }
</style>

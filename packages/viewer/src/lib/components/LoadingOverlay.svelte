<script lang="ts">
  import { fade } from "svelte/transition";

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
  <!-- Snaps in when work starts; fades OUT over 400ms when it ends, so on render
       completion it dissolves while the preview iframe fades in (a cross-fade). -->
  <div
    class="loading-overlay"
    role="status"
    aria-live="assertive"
    aria-busy="true"
    out:fade={{ duration: 400 }}
  >
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
    /* TRANSLUCENT on purpose — must never be fully opaque. The preview
       iframe underneath is cross-origin, and Chromium render-throttles a
       cross-origin iframe with no visible pixels (own opacity:0 OR fully
       covered by an opaque element) to ~1fps. That was the 0.4.1 slow-render
       regression: ~1 page/sec instead of ~30 on a 287-page book. The scrim
       dims the layout shuffle without hiding the iframe. Measured live:
       opaque cover = 1.1 pp/s for the entire render; translucent = full
       speed. */
    background: var(--app-overlay);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 9999;
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

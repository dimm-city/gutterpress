<script lang="ts">
  import { fade } from "svelte/transition";

  let {
    visible = false,
    label = "Loading…",
    cancelLabel,
    onCancel,
    variant = "app",
  }: {
    visible?: boolean;
    label?: string;
    cancelLabel?: string;
    onCancel?: (() => void) | undefined;
    /**
     * "pane"  — position:absolute, scoped to the nearest position:relative
     *            ancestor (used inside .preview-pane so the overlay covers
     *            only the preview area, not the editor pane or toolbar).
     * "app"   — position:fixed from top:56px (below toolbar), z-index:50 so
     *            it stays below all app dialogs (1000+). Used for the initial
     *            folder-open busy state when no preview pane exists yet.
     */
    variant?: "pane" | "app";
  } = $props();
</script>

{#if visible}
  <!-- Snaps in when work starts; fades OUT over 400ms when it ends, so on render
       completion it dissolves while the preview iframe fades in (a cross-fade).
       variant="pane"  → position:absolute inside .preview-pane (covers preview only).
       variant="app"   → position:fixed below toolbar, z-index:50 (below dialogs). -->
  <div
    class="loading-overlay"
    class:variant-pane={variant === "pane"}
    class:variant-app={variant === "app"}
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
    /* position is set by the consumer:
         - "pane" variant: position:absolute within .preview-pane (covers preview only,
           not the editor or toolbar). Used during page layout (rendering=true).
         - "app" variant: position:fixed covering the content area below the toolbar
           (top:56px), with z-index:50 — below the toolbar (100) and all dialogs
           (1000+). Used during initial folder open (busy=true, no previewUrl yet).
       The base rule sets the shared layout; the variant classes override position/inset. */
    inset: 0;
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
    /* Default z-index: below toolbar (100) and all dialogs (1000+) so the
       overlay never traps interactive UI elements above it. The pane variant
       only needs to be above the iframe (no z-index stacking contest needed
       since it lives in a separate stacking context inside .preview-pane). */
    z-index: 10;
  }

  /* Pane variant: scoped to .preview-pane (position:relative parent). */
  .loading-overlay.variant-pane {
    position: absolute;
  }

  /* App variant: covers the full content area below the toolbar for the
     initial "Opening folder…" busy state. z-index:50 keeps it below the
     toolbar (z-index:100) and all app dialogs (z-index:1000+). */
  .loading-overlay.variant-app {
    position: fixed;
    top: 56px; /* below toolbar */
    z-index: 50;
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

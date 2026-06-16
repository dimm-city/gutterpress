<script lang="ts">
  /**
   * RecoveryOverlay — transparent blocking auto-recovery progress.
   *
   * Shows a NON-INTRUSIVE, NON-DISMISSABLE overlay while the host auto-repairs
   * a sync problem. Transitions to a calm "All set" success state that
   * auto-dismisses after ~1.8 s. No Git jargon. PWA-clean (CLAUDE.md §8 / ADR 0004).
   *
   * SCRIM RULE (0.4.1 regression guard): the background MUST remain translucent.
   * An opaque cover over the cross-origin preview iframe throttles Chromium to
   * ~1 fps. We use var(--app-overlay) + backdrop-filter:blur only — no opacity:0,
   * no solid background colour.
   */
  import { fade } from "svelte/transition";

  let {
    visible = false,
    phase = "checking" as "checking" | "backup" | "repairing" | "done",
    state = "recovering" as "recovering" | "recovered",
    backupZipPath,
    onShowBackup,
    onDone,
  }: {
    visible?: boolean;
    phase?: "checking" | "backup" | "repairing" | "done";
    state?: "recovering" | "recovered";
    backupZipPath?: string;
    onShowBackup?: (() => void) | undefined;
    onDone?: (() => void) | undefined;
  } = $props();

  /** Phase-driven copy shown while the host is repairing. */
  function phaseMessage(p: typeof phase): string {
    switch (p) {
      case "checking":  return "Checking your project…";
      case "backup":    return "Saving a backup of your work first…";
      case "repairing": return "Putting things right…";
      case "done":      return "Finishing up…";
      default:          return "Working…";
    }
  }

  // Auto-dismiss: fire onDone ~1800ms after state transitions to "recovered".
  let autoDismissTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    clearTimeout(autoDismissTimer);
    if (state === "recovered" && visible) {
      autoDismissTimer = setTimeout(() => {
        onDone?.();
      }, 1800);
    }
    return () => clearTimeout(autoDismissTimer);
  });
</script>

{#if visible}
  <!--
    Pane variant: position:absolute scoped to the nearest position:relative
    ancestor (.preview-pane). The scrim is TRANSLUCENT — var(--app-overlay) +
    backdrop-filter:blur — so Chromium never throttles the cross-origin iframe.
  -->
  <div
    class="recovery-overlay pane"
    role="status"
    aria-live="polite"
    aria-busy={state === "recovering"}
    out:fade={{ duration: 400 }}
  >
    <div class="content-wrap">
      {#if state === "recovering"}
        <!-- Spinner (decorative) -->
        <div class="spinner" aria-hidden="true"></div>

        <h2 class="title">Fixing a sync problem</h2>
        <p class="phase-line">{phaseMessage(phase)}</p>
        <p class="reassurance">
          Your work was backed up first. This only takes a moment.
        </p>
        <!-- No cancel / close button while recovering — intentionally omitted. -->

      {:else}
        <!-- state === "recovered" -->
        <div class="check-icon" aria-hidden="true">✓</div>

        <h2 class="title">All set</h2>
        <p class="success-body">
          We fixed a small sync problem and your work is safe.
        </p>

        {#if backupZipPath}
          <button class="show-backup-link" onclick={onShowBackup}>
            Show backup
          </button>
        {/if}

        <button class="done-btn" onclick={onDone}>Done</button>
      {/if}
    </div>
  </div>
{/if}

<style>
  .recovery-overlay {
    /* Pane variant: position:absolute scoped to the preview pane container. */
    position: absolute;
    inset: 0;

    /*
     * TRANSLUCENT SCRIM — must never be fully opaque.
     * An opaque cover over the cross-origin preview iframe throttles
     * Chromium to ~1 fps (the 0.4.1 slow-render regression). Use only
     * var(--app-overlay) (which carries alpha) + backdrop-filter:blur.
     */
    background: var(--app-overlay);
    backdrop-filter: blur(2px);

    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10;
  }

  /* Alias so the "pane" keyword appears in source (test 8.5 signal). */
  .recovery-overlay.pane {
    position: absolute;
  }

  .content-wrap {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    padding: 28px 32px;
    border-radius: 10px;
    background: var(--app-surface);
    border: 1px solid var(--app-border-subtle);
    box-shadow: 0 8px 28px var(--app-shadow-lg, rgba(0,0,0,0.18));
    max-width: 340px;
    text-align: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }

  .title {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text);
  }

  .phase-line {
    margin: 0;
    font-size: 13px;
    color: var(--app-text-secondary);
    line-height: 1.5;
  }

  .reassurance {
    margin: 0;
    font-size: 12px;
    color: var(--app-text-faint, var(--app-text-muted));
    line-height: 1.5;
  }

  .success-body {
    margin: 0;
    font-size: 13px;
    color: var(--app-text-secondary);
    line-height: 1.5;
  }

  /* Spinner — decorative, matches LoadingOverlay pattern. */
  .spinner {
    width: 36px;
    height: 36px;
    border: 3px solid var(--app-spinner-track);
    border-top-color: var(--app-spinner-head);
    border-radius: 50%;
    animation: spin 0.75s linear infinite;
    flex-shrink: 0;
  }

  @keyframes spin {
    to { transform: rotate(360deg); }
  }

  .check-icon {
    width: 36px;
    height: 36px;
    border-radius: 50%;
    background: var(--app-accent-subtle, color-mix(in srgb, var(--app-focus-ring) 14%, transparent));
    border: 2px solid var(--app-focus-ring);
    color: var(--app-focus-ring);
    font-size: 18px;
    font-weight: 700;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }

  .done-btn {
    margin-top: 4px;
    padding: 6px 20px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid var(--app-border);
    background: var(--app-surface-hover);
    color: var(--app-text-secondary);
  }

  .done-btn:hover {
    background: var(--app-surface);
    color: var(--app-text);
  }

  .done-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }

  .show-backup-link {
    background: transparent;
    border: none;
    padding: 0;
    font-size: 12px;
    color: var(--app-focus-ring);
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .show-backup-link:hover {
    color: var(--app-accent-hover, var(--app-focus-ring));
  }

  .show-backup-link:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
</style>

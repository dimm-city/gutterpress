<script lang="ts">
  /**
   * RecoveryGuidanceDialog — shown when recovery is blocked or failed.
   *
   * Presents plain-language guidance, recommended next step, optional safe steps,
   * backup location row, and a "Copy details for support" button that is the ONLY
   * place technical text may appear (supportDetails behind an action, never inline).
   *
   * No Git jargon in any always-visible string. PWA-clean (CLAUDE.md §8 / ADR 0004).
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ManualGuidanceInfo } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    guidance,
    backupZipPath: backupZipPathProp,
    onShowBackup,
    onPrimary,
    triggerEl,
  }: {
    open?: boolean;
    guidance?: ManualGuidanceInfo;
    /** Fallback backup path from SyncStatus when not present in guidance (Integrate handoff). */
    backupZipPath?: string | null;
    onShowBackup?: (path: string) => void;
    onPrimary?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let copyAnnouncement = $state<string>("");

  // Derive backup path: prefer guidance prop, fall back to the explicit backupZipPath prop
  // (which the Integrate parent merges from SyncStatus.backupZipPath when needed).
  const backupZipPath = $derived(guidance?.backupZipPath ?? backupZipPathProp ?? null);
  const safeNextSteps = $derived(
    guidance?.safeNextSteps && guidance.safeNextSteps.length > 0
      ? guidance.safeNextSteps
      : null,
  );
  const supportDetails = $derived(guidance?.supportDetails ?? null);

  $effect(() => {
    if (!open) return;
    copyAnnouncement = "";
    queueMicrotask(() => dialogEl?.focus());
  });

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  function close() {
    open = false;
    triggerEl?.focus();
  }

  function handlePrimary() {
    onPrimary?.();
    close();
  }

  function handleShowBackup() {
    if (backupZipPath) {
      onShowBackup?.(backupZipPath);
    }
  }

  async function copyDetails() {
    if (!supportDetails) return;
    try {
      await navigator.clipboard.writeText(supportDetails);
      copyAnnouncement = "Details copied to clipboard.";
    } catch {
      copyAnnouncement = "Could not copy. Please select and copy the details manually.";
    }
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="guidance-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="guidance-title">
        <Icon name="triangle-alert" />
        We couldn't finish syncing
      </h2>
      <button
        class="close"
        onclick={close}
        title="Close (Esc)"
        aria-label="Close"
      ><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- aria-live region for copy confirmation announcement -->
      <div class="sr-only" role="status" aria-live="polite">
        {copyAnnouncement}
      </div>

      {#if guidance}
        <p class="summary">{guidance.userSummary}</p>

        <!-- Recommended next step — highlighted block -->
        <div class="recommended-step" role="note">
          <p class="step-text">{guidance.recommendedNextStep}</p>
          <button class="primary" onclick={handlePrimary}>
            {guidance.recommendedAction}
          </button>
        </div>

        {#if safeNextSteps}
          <div class="safe-steps">
            <p class="safe-steps-label">Other options:</p>
            <ol>
              {#each safeNextSteps as step}
                <li>{step}</li>
              {/each}
            </ol>
          </div>
        {/if}

        {#if backupZipPath}
          <div class="backup-row">
            <Icon name="file-down" size={14} />
            <span class="backup-label">Your backup is saved here</span>
            <button class="ghost small" onclick={handleShowBackup}>
              Show backup
            </button>
          </div>
        {/if}

        {#if supportDetails}
          <div class="copy-details-row">
            <button class="ghost small" onclick={copyDetails}>
              Copy details for support
            </button>
            {#if copyAnnouncement}
              <span class="copy-confirm">{copyAnnouncement}</span>
            {/if}
          </div>
        {/if}
      {/if}
    </div>

    <footer class="actions">
      <button class="ghost" onclick={close}>Close</button>
    </footer>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--app-backdrop);
    z-index: 1000;
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(540px, 94vw);
    max-height: 84vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text);
  }

  .close {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    min-height: 28px;
  }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .summary {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }

  /* Highlighted recommended-step block */
  .recommended-step {
    padding: 12px 14px;
    border-radius: 8px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .step-text {
    margin: 0;
    font-size: 13px;
    line-height: 1.5;
    color: var(--app-text-secondary);
  }

  .safe-steps {
    font-size: 13px;
    color: var(--app-text-secondary);
  }

  .safe-steps-label {
    margin: 0 0 6px;
    font-weight: 600;
    font-size: 12px;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .safe-steps ol {
    margin: 0;
    padding-left: 20px;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .safe-steps li {
    font-size: 13px;
    line-height: 1.5;
    color: var(--app-text-secondary);
  }

  /* Backup location row */
  .backup-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 12px;
    border-radius: 8px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    color: var(--app-text-muted);
    font-size: 12px;
  }

  .backup-label {
    flex: 1;
    color: var(--app-text-secondary);
  }

  /* Copy details row */
  .copy-details-row {
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .copy-confirm {
    font-size: 12px;
    color: var(--app-text-muted);
  }

  /* Pinned action bar */
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
    padding: 14px 18px;
    border-top: 1px solid var(--app-border-subtle);
    background: var(--app-surface);
  }

  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    align-self: flex-start;
  }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .primary:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .ghost {
    background: transparent;
    color: var(--app-text-muted);
    border: 1px solid var(--app-border);
    cursor: pointer;
    border-radius: 4px;
  }
  .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .ghost:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .small {
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 5px;
  }
</style>

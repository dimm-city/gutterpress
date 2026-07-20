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
  import OperationLogDialog from "$lib/components/OperationLogDialog.svelte";
  import type { ManualGuidanceInfo } from "$lib/platform/contract";
  import { dialogBehavior } from "$lib/dialog";

  let {
    open = $bindable(false),
    guidance,
    backupZipPath: backupZipPathProp,
    logFilePath,
    onShowBackup,
    onPrimary,
    triggerEl,
  }: {
    open?: boolean;
    guidance?: ManualGuidanceInfo;
    /** Fallback backup path from SyncStatus when not present in guidance (Integrate handoff). */
    backupZipPath?: string | null;
    /** Operation log path from SyncStatus — backs the "View log" button. */
    logFilePath?: string | null;
    onShowBackup?: (path: string) => void;
    onPrimary?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let copyAnnouncement = $state<string>("");
  let logDialogOpen = $state<boolean>(false);
  let viewLogBtn = $state<HTMLButtonElement | undefined>(undefined);

  // Derive backup path: prefer guidance prop, fall back to the explicit backupZipPath prop
  // (which the Integrate parent merges from SyncStatus.backupZipPath when needed).
  const backupZipPath = $derived(guidance?.backupZipPath ?? backupZipPathProp ?? null);
  const safeNextSteps = $derived(
    guidance?.safeNextSteps && guidance.safeNextSteps.length > 0
      ? guidance.safeNextSteps
      : null,
  );
  const supportDetails = $derived(guidance?.supportDetails ?? null);

  function onDialogMount(_el: HTMLElement) {
    copyAnnouncement = "";
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
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "guidance-title", focusContainer: true }}
    use:onDialogMount
  >
    <header class="dlg-header">
      <h2 id="guidance-title">
        <Icon name="triangle-alert" />
        We couldn't finish syncing
      </h2>
      <button
        class="dlg-close"
        onclick={close}
        title="Close (Esc)"
        aria-label="Close"
      ><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- aria-live region for copy confirmation announcement -->
      <div class="dlg-sr-only" role="status" aria-live="polite">
        {copyAnnouncement}
      </div>

      {#if guidance}
        <p class="summary">{guidance.userSummary}</p>

        <!-- Recommended next step — highlighted block -->
        <div class="recommended-step" role="note">
          <p class="step-text">{guidance.recommendedNextStep}</p>
          <button class="dlg-primary app-btn-primary" onclick={handlePrimary}>
            {guidance.recommendedAction}
          </button>
        </div>

        {#if safeNextSteps}
          <div class="safe-steps">
            <p class="safe-steps-label">Good to know</p>
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
            <button class="dlg-ghost small" onclick={handleShowBackup}>
              Show backup
            </button>
          </div>
        {/if}

        {#if supportDetails}
          <div class="copy-details-row">
            <button class="dlg-ghost small" onclick={copyDetails}>
              Copy details for support
            </button>
            {#if logFilePath}
              <button
                bind:this={viewLogBtn}
                class="dlg-ghost small"
                onclick={() => { logDialogOpen = true; }}
              >
                View log
              </button>
            {/if}
            {#if copyAnnouncement}
              <span class="copy-confirm">{copyAnnouncement}</span>
            {/if}
          </div>
        {:else if logFilePath}
          <div class="copy-details-row">
            <button
              bind:this={viewLogBtn}
              class="dlg-ghost small"
              onclick={() => { logDialogOpen = true; }}
            >
              View log
            </button>
          </div>
        {/if}
      {/if}
    </div>

    <footer class="dlg-actions">
      <button class="dlg-ghost" onclick={close}>Close</button>
    </footer>
  </div>
{/if}

<OperationLogDialog
  bind:open={logDialogOpen}
  logFilePath={logFilePath}
  triggerEl={viewLogBtn}
/>


<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(540px, 94vw);
    max-height: 84vh;
  }
  .dlg-header h2 {
    color: var(--app-text);
  }

  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 14px;
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
    color: var(--app-text-secondary);
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

  /* The recommended-step CTA lives inline in the body (not the footer), so
     unlike a normal `.dlg-primary` (sized by `.dlg-actions button`'s base
     rule) it needs its own base sizing here. Colors come from the shared
     .app-btn-primary recipe (theme.css) — the L5 convergence removed this
     dialog's local gradient copy. */
  .recommended-step .dlg-primary {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    border-width: 1px;
    border-style: solid;
    cursor: pointer;
    align-self: flex-start;
  }
</style>

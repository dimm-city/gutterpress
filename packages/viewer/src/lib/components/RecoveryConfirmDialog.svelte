<script lang="ts">
  /**
   * RecoveryConfirmDialog — "risky-repair confirmation" modal (UX state b).
   *
   * Shown when the host recovery subsystem needs author approval before a
   * medium/high-risk repair. The host fires ConfirmationGate.confirmRepair
   * (resolved by respondRecoveryConfirm), so this dialog must ALWAYS answer
   * the gate — never leave the promise hanging.
   *
   * PWA-clean (CLAUDE.md §8 / ADR 0004):
   *  - NO value imports from @dimm-city/print-md
   *  - NO node:* / fs / path / url / isomorphic-git imports
   *  - All host work via getPlatform()
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import type { RecoveryConfirmRequest } from "$lib/platform/contract";
  import { dialogBehavior } from "$lib/dialog";

  let {
    open = $bindable(false),
    request = undefined,
    onShowBackup = undefined,
    triggerEl = undefined,
  }: {
    open?: boolean;
    request?: RecoveryConfirmRequest;
    onShowBackup?: (path: string) => void;
    triggerEl?: HTMLElement | undefined;
  } = $props();

  /** Prevent double-answering the gate. */
  let answered = $state(false);
  /** Status announced to assistive tech when the author answers. */
  let statusMsg = $state("");

  /**
   * High-risk repairs get a calmer-but-more-careful treatment than medium:
   * a warning glyph, an accent edge, and a "take your time" subline — so the
   * two confirmations don't read identically (three-judge gate finding).
   */
  let isHigh = $derived(request?.confirmation.risk === "high");

  /** Selector for the button dialogBehavior should focus on open — "Not now"
   *  for high-risk (calmer, safer default), "Continue" otherwise. */
  let initialFocusSelector = $derived(
    isHigh ? "button[data-action='not-now']" : "button[data-action='continue']",
  );

  function onDialogMount(_el: HTMLElement) {
    answered = false;
  }

  async function answer(approved: boolean) {
    if (!request || answered) return;
    answered = true;
    statusMsg = approved
      ? "Applying the fix…"
      : "Cancelled — nothing was changed.";
    open = false;
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    try {
      await getPlatform().respondRecoveryConfirm(request.requestId, approved);
    } catch (e) {
      // The dialog is already closed; a failed IPC response must not surface
      // as an unhandled rejection (the host's confirm timeout fail-safes to
      // "denied" on its own).
      console.error("respondRecoveryConfirm failed:", e);
    }
  }

</script>

{#if open && request}
  <div class="dlg-backdrop" role="presentation" onclick={() => answer(false)}></div>

  <div
    class="dlg-shell"
    class:high={isHigh}
    use:dialogBehavior={{
      onClose: () => answer(false),
      triggerEl,
      labelledBy: "recovery-confirm-title",
      initialFocus: initialFocusSelector,
    }}
    use:onDialogMount
  >
    <!-- Live region for status announcements (populated when the author answers). -->
    <div class="dlg-sr-only" role="status" aria-live="polite">{statusMsg}</div>

    <header class="dlg-header" class:high={isHigh}>
      <h2 id="recovery-confirm-title">
        {#if isHigh}<span class="warn-glyph" aria-hidden="true"><Icon name="triangle-alert" size={18} /></span>{/if}
        We can fix this — your choice
      </h2>
    </header>

    <div class="dialog-body">
      <p class="lede">
        To get your project syncing again, we need to {request.confirmation.summary}.
        We already saved a backup of everything, so nothing is lost.
      </p>
      {#if isHigh}
        <p class="caution-line">Take your time — there's no rush, and your backup is safe either way.</p>
      {/if}

      <div class="backup-row" role="note">
        <span class="backup-label"><Icon name="check" size={13} /> Backup saved</span>
        {#if request.confirmation.backupZipPath}
          <button
            class="show-backup-btn"
            onclick={() => onShowBackup?.(request!.confirmation.backupZipPath)}
          >
            Show backup
          </button>
        {/if}
      </div>
    </div>

    <footer class="dlg-actions">
      <button
        class="dlg-ghost"
        data-action="not-now"
        onclick={() => answer(false)}
      >Not now</button>
      <button
        class="dlg-primary app-btn-primary"
        data-action="continue"
        onclick={() => answer(true)}
      >Continue</button>
    </footer>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(480px, 94vw);
    /* Content-sized — this dialog is short by design, no scroll cap. */
    max-height: none;
  }

  /* High-risk: a calm-but-distinct accent so it never reads identical to the
     medium dialog (three-judge gate). Amber edge + warning glyph, not alarm. */
  .dlg-shell.high {
    border-top: 3px solid var(--app-warning-text);
  }

  .dlg-header {
    padding: 18px 20px 14px;
  }
  .dlg-header h2 {
    color: var(--app-text);
  }

  .warn-glyph {
    color: var(--app-warning-text);
    display: inline-flex;
    align-items: center;
  }

  .caution-line {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-muted);
  }

  .dialog-body {
    padding: 18px 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .lede {
    margin: 0;
    font-size: 13px;
    line-height: 1.6;
    color: var(--app-text-secondary);
  }

  .backup-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    font-size: 12px;
  }

  .backup-label {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    color: var(--app-text-secondary);
    flex: 1;
  }

  .show-backup-btn {
    padding: 3px 10px;
    font-size: 11px;
    border-radius: 5px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    cursor: pointer;
    white-space: nowrap;
  }

  .show-backup-btn:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .show-backup-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  /* Pinned footer here uses 20px horizontal padding + 16px button padding —
     a hair roomier than the shared 18px/14px default (this dialog only ever
     has two buttons, no crowding to avoid). */
  .dlg-actions {
    padding: 14px 20px;
  }
  .dlg-actions button {
    padding: 6px 16px;
  }

  /* Primary-button colors come from the shared .app-btn-primary recipe
     (theme.css) — the L5 convergence removed this dialog's local copy. */
</style>

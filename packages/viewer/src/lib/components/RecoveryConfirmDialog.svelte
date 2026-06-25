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
  let dialogEl = $state<HTMLElement | undefined>(undefined);
  /** Status announced to assistive tech when the author answers. */
  let statusMsg = $state("");

  /**
   * High-risk repairs get a calmer-but-more-careful treatment than medium:
   * a warning glyph, an accent edge, and a "take your time" subline — so the
   * two confirmations don't read identically (three-judge gate finding).
   */
  let isHigh = $derived(request?.confirmation.risk === "high");

  // Reset answered state whenever dialog opens with a new request.
  $effect(() => {
    if (open && request) {
      answered = false;
      // Focus the appropriate button after the DOM settles.
      queueMicrotask(() => {
        if (!dialogEl) return;
        const risk = request?.confirmation.risk;
        if (risk === "high") {
          const notNowBtn = dialogEl.querySelector<HTMLElement>("button[data-action='not-now']");
          notNowBtn?.focus();
        } else {
          const continueBtn = dialogEl.querySelector<HTMLElement>("button[data-action='continue']");
          continueBtn?.focus();
        }
      });
    }
  });

  async function answer(approved: boolean) {
    if (!request || answered) return;
    answered = true;
    statusMsg = approved
      ? "Applying the fix…"
      : "Cancelled — nothing was changed.";
    open = false;
    triggerEl?.focus();
    await getPlatform().respondRecoveryConfirm(request.requestId, approved);
  }

  function focusableElements(): HTMLElement[] {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])',
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
</script>

{#if open && request}
  <div class="backdrop" role="presentation" onclick={() => answer(false)}></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    class:high={isHigh}
    role="dialog"
    aria-modal="true"
    aria-labelledby="recovery-confirm-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <!-- Live region for status announcements (populated when the author answers). -->
    <div class="sr-only" role="status" aria-live="polite">{statusMsg}</div>

    <header class="dialog-header" class:high={isHigh}>
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
        <span class="backup-label">✓ Backup saved</span>
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

    <footer class="actions">
      <button
        class="ghost"
        data-action="not-now"
        onclick={() => answer(false)}
      >Not now</button>
      <button
        class="primary"
        data-action="continue"
        onclick={() => answer(true)}
      >Continue</button>
    </footer>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) answer(false);
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
    width: min(480px, 94vw);
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

  /* High-risk: a calm-but-distinct accent so it never reads identical to the
     medium dialog (three-judge gate). Amber edge + warning glyph, not alarm. */
  .dialog.high {
    border-top: 3px solid var(--app-warning, #d9a441);
  }

  .dialog-header {
    padding: 18px 20px 14px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    color: var(--app-text);
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .warn-glyph {
    color: var(--app-warning, #d9a441);
    display: inline-flex;
    align-items: center;
  }

  .caution-line {
    margin: 0 0 4px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-faint, var(--app-text-muted));
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

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
    padding: 14px 20px;
    border-top: 1px solid var(--app-border-subtle);
    background: var(--app-surface);
  }

  .actions button {
    padding: 6px 16px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  button:disabled { opacity: 0.5; cursor: not-allowed; }

  .primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .primary:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .ghost {
    background: transparent;
    color: var(--app-text-muted);
    border-color: var(--app-border);
  }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .ghost:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
</style>

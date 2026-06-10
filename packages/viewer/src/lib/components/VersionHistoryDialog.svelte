<script lang="ts">
  /**
   * VersionHistoryDialog (#13) — the single author-facing surface for local
   * version history. Capability-driven (never inspects the source type
   * directly):
   *
   *   - `canEnableVersionHistory` (a plain folder): shows the friendly
   *     "Enable Version History" explanation + button.
   *   - `canViewHistory` / `canSnapshot` / `canRestoreSnapshot` (history on):
   *     shows Save Snapshot + the snapshot list with per-entry Restore.
   *
   * All host work goes through getPlatform() (§8 / ADR 0004) — the git
   * mechanics live in the lib (isomorphic-git, CLAUDE.md §7) behind the
   * vcs:* IPC. UI copy is author language only: snapshot / history / restore —
   * never "commit" / "repository".
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import type {
    ProjectCapabilities,
    ProjectClassification,
    SnapshotEntry,
  } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    projectDir,
    capabilities,
    onEnabled,
    onSnapshotSaved,
    onRestored,
    triggerEl,
  }: {
    open?: boolean;
    projectDir: string | null;
    capabilities: ProjectCapabilities | null;
    /** History was just enabled — parent stores the new source/capabilities. */
    onEnabled?: (result: ProjectClassification) => void;
    onSnapshotSaved?: (entry: SnapshotEntry) => void;
    /** A restore completed; files on disk changed (preview/editor reconcile). */
    onRestored?: (backupId?: string) => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let enableBtn = $state<HTMLButtonElement | undefined>(undefined);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let notice = $state<string | null>(null);
  let entries = $state<SnapshotEntry[]>([]);
  let loadingList = $state(false);
  let snapshotMessage = $state("");
  /** Snapshot id awaiting the plain-language restore confirmation. */
  let confirmRestoreId = $state<string | null>(null);

  let canEnable = $derived(capabilities?.canEnableVersionHistory ?? false);
  let canHistory = $derived(capabilities?.canViewHistory ?? false);
  let canSnapshot = $derived(capabilities?.canSnapshot ?? false);
  let canRestore = $derived(capabilities?.canRestoreSnapshot ?? false);

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
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

  // Reset transient state + load the list whenever the dialog opens.
  $effect(() => {
    if (!open) return;
    error = null;
    notice = null;
    confirmRestoreId = null;
    snapshotMessage = "";
    if (canHistory) void refreshList();
    // In the enable view, lead with the primary action; otherwise the first
    // focusable element (the close button).
    queueMicrotask(() => (enableBtn ?? focusableElements()[0])?.focus());
  });

  function friendly(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    // Strip Electron's IPC prefix ("Error invoking remote method 'vcs:…': Error:")
    return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
  }

  async function refreshList() {
    if (!projectDir) return;
    loadingList = true;
    try {
      entries = await getPlatform().listSnapshots(projectDir);
    } catch (e) {
      error = friendly(e);
      entries = [];
    } finally {
      loadingList = false;
    }
  }

  async function enable() {
    if (!projectDir || busy) return;
    busy = true;
    error = null;
    try {
      const result = await getPlatform().enableVersionHistory(projectDir);
      onEnabled?.(result);
      notice = "Version history is now enabled. Your first snapshot has been saved.";
      await refreshList();
    } catch (e) {
      error = friendly(e);
    } finally {
      busy = false;
    }
  }

  async function saveSnapshot() {
    if (!projectDir || busy) return;
    busy = true;
    error = null;
    notice = null;
    try {
      const entry = await getPlatform().saveSnapshot(
        projectDir,
        snapshotMessage.trim() || undefined,
      );
      snapshotMessage = "";
      // Feedback is the parent's toast (onSnapshotSaved) — same pattern as
      // onRestored — so there's no duplicate in-dialog notice.
      onSnapshotSaved?.(entry);
      await refreshList();
    } catch (e) {
      error = friendly(e);
    } finally {
      busy = false;
    }
  }

  async function restore(id: string) {
    if (!projectDir || busy) return;
    busy = true;
    error = null;
    notice = null;
    try {
      const result = await getPlatform().restoreSnapshot(projectDir, id);
      confirmRestoreId = null;
      onRestored?.(result.backupId);
      notice = result.backupId
        ? "Your project was restored. A backup of the previous state was saved first, so nothing is lost."
        : "Your project was restored to that version.";
      await refreshList();
    } catch (e) {
      error = friendly(e);
    } finally {
      busy = false;
    }
  }

  function relativeTime(ms: number): string {
    const diff = Date.now() - ms;
    const min = Math.round(diff / 60_000);
    if (min < 1) return "just now";
    if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
    const hours = Math.round(min / 60);
    if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
    const days = Math.round(hours / 24);
    if (days < 14) return `${days} day${days === 1 ? "" : "s"} ago`;
    try {
      return new Date(ms).toLocaleDateString();
    } catch {
      return "";
    }
  }

  function fullTime(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "";
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
    aria-labelledby="vh-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="vh-title">
        <Icon name="history" />
        Version History
      </h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">&times;</button>
    </header>

    <div class="dialog-body">
      {#if notice}
        <p class="notice" role="status">{notice}</p>
      {/if}
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      {#if canEnable}
        <!-- Plain folder: friendly enable prompt (#13 issue copy). -->
        <p class="lede">
          print-md can keep a local history of changes for this folder. This
          lets you save snapshots of your work and restore earlier versions.
          Nothing is uploaded.
        </p>
        <!-- The technical disclosure is prescribed by issue #13 — keep it, but
             collapsed so the default view stays pure author language. -->
        <details class="hint">
          <summary>What does this do technically?</summary>
          <p>
            This creates a hidden <code>.git</code> folder inside your project.
            It stores local version history on this computer. Nothing is
            uploaded.
          </p>
        </details>
        <footer class="actions">
          <button class="ghost" onclick={close}>Not now</button>
          <button bind:this={enableBtn} class="primary" onclick={enable} disabled={busy}>
            {busy ? "Enabling…" : "Enable Version History"}
          </button>
        </footer>
      {:else if canHistory}
        {#if canSnapshot}
          <div class="snapshot-row">
            <input
              type="text"
              placeholder="What changed? (optional)"
              bind:value={snapshotMessage}
              disabled={busy}
              maxlength="200"
              aria-label="Snapshot description"
              onkeydown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  void saveSnapshot();
                }
              }}
            />
            <button class="primary" onclick={saveSnapshot} disabled={busy}>
              {busy ? "Saving…" : "Save Snapshot"}
            </button>
          </div>
        {/if}

        {#if loadingList}
          <p class="hint" role="status">Loading history…</p>
        {:else if entries.length === 0}
          <p class="hint">No snapshots yet. Save one to start your history.</p>
        {:else}
          <ul class="history-list">
            {#each entries as entry (entry.id)}
              <li class="history-item">
                <div class="entry-row">
                  <div class="entry-info">
                    <span class="entry-message">{entry.message}</span>
                    <span class="entry-meta" title={fullTime(entry.timestamp)}>
                      {relativeTime(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}
                    </span>
                  </div>
                  {#if canRestore}
                    <button
                      class="restore-btn"
                      onclick={() =>
                        (confirmRestoreId =
                          confirmRestoreId === entry.id ? null : entry.id)}
                      disabled={busy}
                      aria-expanded={confirmRestoreId === entry.id}
                    >
                      Restore Version
                    </button>
                  {/if}
                </div>
                {#if confirmRestoreId === entry.id}
                  <!-- role=region + aria-live, NOT alertdialog: a nested
                       alertdialog inside an open dialog is invalid ARIA. -->
                  <div class="confirm" role="region" aria-live="polite" aria-label="Confirm restore">
                    <p>
                      This returns your project files to how they were at this
                      snapshot. A backup of the current state is saved first, so
                      nothing is ever lost — you can come back here to undo this.
                    </p>
                    <div class="confirm-actions">
                      <button class="ghost" onclick={() => (confirmRestoreId = null)} disabled={busy}>
                        Cancel
                      </button>
                      <button class="primary" onclick={() => restore(entry.id)} disabled={busy}>
                        {busy ? "Restoring…" : "Yes, restore this version"}
                      </button>
                    </div>
                  </div>
                {/if}
              </li>
            {/each}
          </ul>
        {/if}
      {:else}
        <p class="hint">Version history isn't available for this project.</p>
      {/if}
    </div>
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
    width: min(560px, 92vw);
    max-height: 80vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .dialog-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }
  .close {
    background: transparent;
    border: 0;
    color: var(--app-text-muted);
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover { color: var(--app-text); }
  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
  }
  .lede {
    margin: 0 0 12px;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }
  .hint {
    font-size: 12px;
    color: var(--app-text-faint);
    margin: 0 0 14px;
    line-height: 1.5;
  }
  .hint code {
    font-family: ui-monospace, monospace;
    font-size: 11px;
  }
  details.hint summary {
    cursor: pointer;
    user-select: none;
  }
  details.hint summary:hover { color: var(--app-text-secondary); }
  details.hint p { margin: 6px 0 0; }
  .notice {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-success-bg);
    border: 1px solid var(--app-success-border);
    color: var(--app-success-text);
    font-size: 12px;
    line-height: 1.5;
  }
  .error {
    margin: 0 0 12px;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    color: var(--app-error-text);
    font-size: 12px;
    line-height: 1.5;
  }

  .snapshot-row {
    display: flex;
    gap: 8px;
    margin-bottom: 14px;
  }
  .snapshot-row input {
    flex: 1 1 auto;
    min-width: 0;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
  }
  .snapshot-row input:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }

  .history-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .history-item {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 10px 12px;
  }
  .entry-row {
    display: flex;
    align-items: center;
    gap: 12px;
  }
  .entry-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .entry-message {
    font-weight: 600;
    font-size: 13px;
    color: var(--app-text);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .entry-meta {
    font-size: 11px;
    color: var(--app-text-faint);
  }
  .restore-btn {
    flex: 0 0 auto;
    padding: 5px 10px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-control-bg, transparent);
    color: var(--app-text);
    cursor: pointer;
  }
  .restore-btn:hover:not(:disabled) { background: var(--app-control-hover-bg); }
  .confirm {
    margin-top: 10px;
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
  }
  .confirm p {
    margin: 0 0 10px;
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-secondary);
  }
  .confirm-actions,
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
  }
  .actions {
    padding-top: 16px;
    margin-top: 4px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions button,
  .confirm-actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
  .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
</style>

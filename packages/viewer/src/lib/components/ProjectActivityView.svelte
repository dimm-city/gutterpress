<script lang="ts">
  /**
   * ProjectActivityView — the writer-facing view of a project's version
   * history and operation log (UX review M37: the ONE log/activity surface;
   * OperationLogDialog is a separate, self-contained modal used by the
   * recovery flows and is intentionally NOT folded in here — see its own
   * header comment).
   *
   * Restore (H2): the host's `/api/vcs/restore-snapshot` route validates the
   * snapshot id and snapshots the current state before restoring (ADR 0006
   * D5), so restoring can never lose the author's in-progress work. This view
   * still asks for a plain-language confirmation before calling it, shows a
   * busy state per row, and — on success — asks the parent to reconcile the
   * open editor buffer/preview against the (now-changed) files on disk via
   * `onRestored` (the same reconciliation the folder watcher runs for any
   * other external change, per #44/H1).
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api, type SnapshotEntry } from "$lib/api";
  import { friendlyHostError } from "$lib/errors";
  import { versionLabel, versionDescription, groupVersionsByDay } from "$lib/routes/version-timeline";

  let {
    projectDir,
    logFilePath = null,
    onClose,
    onRestored,
  }: {
    projectDir: string | null;
    logFilePath?: string | null;
    onClose?: () => void;
    /** Called after a snapshot is successfully restored, so the parent can
     * reload the editor buffer/preview from the (now-changed) disk state. */
    onRestored?: () => void;
  } = $props();

  let entries = $state<SnapshotEntry[]>([]);
  // Newest-first versions grouped into day buckets for the timeline. Date.now()
  // is read at derive time (fine in the SPA — the ban is on workflow scripts,
  // not runtime), so "Today"/"Yesterday" stay current as versions load.
  const days = $derived(groupVersionsByDay(entries, Date.now()));
  let hasMore = $state(false);
  let historyLoading = $state(false);
  let loadingOlder = $state(false);
  let logLoading = $state(false);
  let logContent = $state("");
  let error = $state<string | null>(null);

  // ── Restore (H2) ────────────────────────────────────────────────────────────
  // Two-step inline confirm per row (never a pair of buttons that appear/
  // disappear elsewhere — the row's own button swaps in place, so arming the
  // confirm never steals focus). Only one row can be armed/restoring at a time.
  let restoreConfirmId = $state<string | null>(null);
  let restoringId = $state<string | null>(null);
  let restoreError = $state<string | null>(null);

  function armRestore(id: string) {
    restoreConfirmId = id;
    restoreError = null;
  }

  function cancelRestore() {
    restoreConfirmId = null;
  }

  async function confirmRestore(id: string) {
    if (!projectDir) return;
    restoringId = id;
    restoreError = null;
    try {
      await api.vcs.restoreSnapshot(projectDir, id);
      restoreConfirmId = null;
      // Reload so the new "restored to <version>" safety snapshot (and any
      // remote-side commits) appear immediately.
      await loadHistory();
      onRestored?.();
    } catch (e) {
      restoreError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      restoringId = null;
    }
  }

  async function loadHistory() {
    if (!projectDir) return;
    historyLoading = true;
    try {
      const page = await api.vcs.listSnapshotsPage(projectDir);
      entries = page.entries;
      hasMore = page.hasMore;
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      historyLoading = false;
    }
  }

  /** Re-fetch the snapshot list (called by the parent after a sync completes
   * — H2/L8 — so newly-created snapshots appear without reopening the view). */
  export function refreshHistory() {
    void loadHistory();
  }

  async function loadOlder() {
    if (!projectDir || !entries.length || loadingOlder) return;
    const last = entries[entries.length - 1]!;
    loadingOlder = true;
    try {
      const page = await api.vcs.listSnapshotsPage(projectDir, { before: last.id });
      entries = [...entries, ...page.entries];
      hasMore = page.hasMore;
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingOlder = false;
    }
  }

  async function loadLog() {
    if (!logFilePath) return;
    logLoading = true;
    try {
      logContent = (await api.log.read(logFilePath)) ?? "";
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      logLoading = false;
    }
  }

  function when(ms: number): string {
    try { return new Date(ms).toLocaleString(); } catch { return ""; }
  }

  onMount(() => {
    void loadHistory();
    void loadLog();
  });
</script>

<div class="activity-view">
  <header class="activity-header">
    <h2><Icon name="history" size={16} /> Previous versions</h2>
    <button class="close" onclick={onClose} title="Close" aria-label="Close previous versions"><Icon name="x" size={14} /></button>
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <section class="activity-section">
    {#if historyLoading}
      <p class="muted">Loading previous versions…</p>
    {:else if entries.length === 0}
      <p class="muted">No versions yet.</p>
    {:else}
      {#each days as day (day.key)}
        <h3 class="day-heading">{day.label}</h3>
        <ul class="history-list">
          {#each day.entries as entry (entry.id)}
            <li>
              <div class="entry-row">
                <div class="entry-info">
                  <span class="msg">{versionLabel(entry.message)}</span>
                  {#if versionDescription(entry.message)}
                    <span class="desc">{versionDescription(entry.message)}</span>
                  {/if}
                  <span class="meta">{when(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}</span>
                </div>
                {#if restoreConfirmId === entry.id}
                  <div class="restore-confirm">
                    <span class="confirm-copy">We'll save your current work as a version first. Restore to this version?</span>
                    <button
                      class="ghost small"
                      onclick={cancelRestore}
                      disabled={restoringId === entry.id}
                    >
                      Cancel
                    </button>
                    <button
                      class="primary small"
                      onclick={() => confirmRestore(entry.id)}
                      disabled={restoringId === entry.id}
                    >
                      {restoringId === entry.id ? "Restoring…" : "Yes, restore"}
                    </button>
                  </div>
                {:else}
                  <button
                    class="ghost small"
                    onclick={() => armRestore(entry.id)}
                    disabled={restoringId !== null}
                    title="Restore the project to this version"
                  >
                    Restore this version
                  </button>
                {/if}
              </div>
              {#if restoreError && (restoreConfirmId === entry.id || restoringId === entry.id)}
                <p class="error restore-error" role="alert">{restoreError}</p>
              {/if}
            </li>
          {/each}
        </ul>
      {/each}
      {#if hasMore}
        <button class="ghost" onclick={loadOlder} disabled={loadingOlder}>
          {loadingOlder ? "Loading…" : "Show older versions"}
        </button>
      {/if}
    {/if}
  </section>

  {#if logContent || logLoading}
    <section class="activity-section">
      {#if logLoading}
        <p class="muted">Loading…</p>
      {:else}
        <details class="log-details">
          <summary>Technical details</summary>
          <pre>{logContent}</pre>
        </details>
      {/if}
    </section>
  {/if}
</div>

<style>
  .activity-view { display: flex; flex-direction: column; gap: 14px; height: 100%; overflow: auto; background: var(--app-bg); color: var(--app-text-secondary); }
  .activity-header { padding: 12px 16px; border-bottom: 1px solid var(--app-border); background: var(--app-surface-raised); display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: var(--app-text); }
  .activity-section { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text); }
  .day-heading { margin: 6px 0 2px; font-size: 11px; text-transform: none; letter-spacing: 0; color: var(--app-text-muted); }
  .day-heading:first-of-type { margin-top: 0; }
  .desc { color: var(--app-text-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
  .history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .history-list li { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .entry-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .entry-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .msg { color: var(--app-text); font-weight: 600; font-size: 12px; }
  .meta, .muted { color: var(--app-text-muted); font-size: 12px; }
  .error { color: var(--app-error-text); margin: 0 16px; }
  .restore-error { margin: 0; font-size: 11px; }
  .restore-confirm { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .confirm-copy { color: var(--app-text-secondary); font-size: 11px; max-width: 220px; }
  pre { margin: 0; padding: 10px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px; white-space: pre-wrap; font-size: 11px; overflow: auto; }
  .log-details summary { cursor: pointer; color: var(--app-text-muted); font-size: 12px; padding: 4px 0; }
  .log-details pre { margin-top: 8px; }
  .ghost { align-self: flex-start; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 5px 10px; cursor: pointer; }
  .ghost:disabled, .primary:disabled { opacity: 0.6; cursor: default; }
  .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); border: 1px solid transparent; border-radius: 5px; padding: 5px 10px; cursor: pointer; font-weight: 600; }
  .ghost.small, .primary.small { padding: 4px 8px; font-size: 11px; }
  .close { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 4px; cursor: pointer; }
</style>

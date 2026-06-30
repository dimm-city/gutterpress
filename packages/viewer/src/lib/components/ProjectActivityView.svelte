<script lang="ts">
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api, type SnapshotEntry } from "$lib/api";

  let {
    projectDir,
    logFilePath = null,
    onClose,
  }: {
    projectDir: string | null;
    logFilePath?: string | null;
    onClose?: () => void;
  } = $props();

  let entries = $state<SnapshotEntry[]>([]);
  let hasMore = $state(false);
  let historyLoading = $state(false);
  let logLoading = $state(false);
  let logContent = $state("");
  let error = $state<string | null>(null);

  async function loadHistory() {
    if (!projectDir) return;
    historyLoading = true;
    try {
      const page = await api.vcs.listSnapshotsPage(projectDir);
      entries = page.entries;
      hasMore = page.hasMore;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      historyLoading = false;
    }
  }

  async function loadOlder() {
    if (!projectDir || !entries.length) return;
    const last = entries[entries.length - 1]!;
    const page = await api.vcs.listSnapshotsPage(projectDir, { before: last.id });
    entries = [...entries, ...page.entries];
    hasMore = page.hasMore;
  }

  async function loadLog() {
    if (!logFilePath) return;
    logLoading = true;
    try {
      logContent = (await api.log.read(logFilePath)) ?? "";
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
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
    <h2><Icon name="history" size={16} /> Project activity</h2>
    <button class="close" onclick={onClose} title="Close activity view" aria-label="Close activity view"><Icon name="x" size={14} /></button>
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}

  <section class="activity-section">
    <h3>Version history</h3>
    {#if historyLoading}
      <p class="muted">Loading history…</p>
    {:else if entries.length === 0}
      <p class="muted">No snapshots yet.</p>
    {:else}
      <ul class="history-list">
        {#each entries as entry (entry.id)}
          <li>
            <span class="msg">{entry.message}</span>
            <span class="meta">{when(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}</span>
          </li>
        {/each}
      </ul>
      {#if hasMore}<button class="ghost" onclick={loadOlder}>Show older versions</button>{/if}
    {/if}
  </section>

  <section class="activity-section">
    <h3>Operation log</h3>
    {#if logLoading}
      <p class="muted">Loading log…</p>
    {:else if logContent}
      <pre>{logContent}</pre>
    {:else}
      <p class="muted">No log entries recorded.</p>
    {/if}
  </section>
</div>

<style>
  .activity-view { display: flex; flex-direction: column; gap: 14px; height: 100%; overflow: auto; background: var(--app-bg); color: var(--app-text-secondary); }
  .activity-header { padding: 12px 16px; border-bottom: 1px solid var(--app-border); background: var(--app-surface-raised); display: flex; align-items: center; justify-content: space-between; }
  h2 { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: var(--app-text); }
  .activity-section { padding: 0 16px 14px; display: flex; flex-direction: column; gap: 8px; }
  h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text); }
  .history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .history-list li { display: flex; flex-direction: column; gap: 2px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .msg { color: var(--app-text); font-weight: 600; font-size: 12px; }
  .meta, .muted { color: var(--app-text-muted); font-size: 12px; }
  .error { color: var(--app-error-text); margin: 0 16px; }
  pre { margin: 0; padding: 10px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px; white-space: pre-wrap; font-size: 11px; overflow: auto; }
  .ghost { align-self: flex-start; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 5px 10px; cursor: pointer; }
  .close { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 4px; cursor: pointer; }
</style>

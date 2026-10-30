<script lang="ts">
  /**
   * ProjectActivityView — the Version history view (#408): the writer-facing
   * view of a book's versions, in the product's own words (version, backed
   * up, online copy, this computer — never commit, push, pull), with Save a
   * version at the top. It opens inside Book setup → Online copy, in place of
   * the tab's content; its back button returns to the rest of the tab.
   *
   * Each version says what it changed (the host's `describeVersions`: files
   * with a plain size hint) and whether it is backed up or on this computer
   * only. A changed text file opens as a read-only two-column compare
   * (VersionCompareView). "Look at this version" asks the page to render the
   * version read-only beside the live preview, which closes Book setup. When
   * the book has an online copy, the top section lists what is in the online
   * copy and not yet on this computer, so getting the latest is no longer a
   * leap of faith.
   *
   * Restore: the host's `/api/vcs/restore-snapshot` route validates the
   * version id and saves the current state as a version before restoring, so
   * restoring can never lose the author's in-progress work. This view still
   * asks for a plain-language confirmation before calling it, shows a
   * busy state per row, and — on success — asks the parent to reconcile the
   * open editor buffer/preview against the (now-changed) files on disk via
   * `onRestored` (the same reconciliation the folder watcher runs for any
   * other external change, per #44).
   */
  import { onMount } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import VersionCompareView from "#lib/components/VersionCompareView.svelte";
  import { api, type CompareRow, type VersionEntry, type VersionFileChange } from "#lib/api.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import { NOTHING_NEW_NOTICE } from "#lib/save-status.ts";
  import {
    versionLabel,
    versionDescription,
    groupVersionsByDay,
    collapseAutomaticRuns,
    autoRunSummary,
  } from "#lib/routes/version-timeline.ts";

  let {
    projectDir,
    logFilePath = null,
    hasRemote = false,
    viewingId = null,
    onBack,
    onRestored,
    onSaveVersion,
    onLookAt,
    onStopLooking,
  }: {
    projectDir: string | null;
    logFilePath?: string | null;
    /** The book has an online copy, so the view checks what is online. */
    hasRemote?: boolean;
    /** The version the page is showing beside the live preview, if any. */
    viewingId?: string | null;
    /** Back to the rest of Online copy. */
    onBack: () => void;
    /** Called after a version is successfully restored, so the parent can
     * reload the editor buffer/preview from the (now-changed) disk state. */
    onRestored?: () => void;
    /** Save a version now: the page saves and toasts (and reloads this list); resolves "unchanged" when there was nothing new. */
    onSaveVersion?: () => Promise<"saved" | "unchanged">;
    /** "Look at this version": show it read-only beside the live preview. */
    onLookAt?: (id: string, label: string) => void;
    onStopLooking?: () => void;
  } = $props();

  let entries = $state<VersionEntry[]>([]);
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

  // ── Save a version ──────────────────────────────────────────────────────────
  let savingVersion = $state(false);
  let nothingNew = $state(false);

  async function saveVersion() {
    if (!onSaveVersion || savingVersion) return;
    savingVersion = true;
    try {
      nothingNew = (await onSaveVersion()) === "unchanged";
      if (!nothingNew) refreshHistory();
    } catch {
      // The page shows the failure toast.
    } finally {
      savingVersion = false;
    }
  }

  // ── In the online copy, not yet on this computer ────────────────────────────
  let online = $state<VersionEntry[]>([]);
  let onlineState = $state<"idle" | "checking" | "checked" | "unavailable">("idle");

  // ── Compare one file ────────────────────────────────────────────────────────
  let compare = $state<{ entry: VersionEntry; path: string; rows: CompareRow[]; binary: boolean } | null>(null);
  let compareLoadingKey = $state<string | null>(null);

  // ── Restore ─────────────────────────────────────────────────────────────────
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
      // Reload so the new safety version (and any that came from the
      // online copy) appear immediately.
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

  /** What is online that this computer has not got. Quiet when it cannot tell. */
  async function loadOnline() {
    if (!projectDir || !hasRemote) return;
    onlineState = "checking";
    try {
      const result = await api.vcs.onlineVersions(projectDir);
      online = result.entries;
      onlineState = result.reason ? "unavailable" : "checked";
    } catch {
      online = [];
      onlineState = "unavailable";
    }
  }

  /** Re-fetch the version list (after saving a version here, and called by the
   * parent after backing up — so new versions appear without reopening the view). */
  export function refreshHistory() {
    void loadHistory();
    void loadOnline();
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

  async function openCompare(entry: VersionEntry, change: VersionFileChange) {
    if (!projectDir || compareLoadingKey) return;
    compareLoadingKey = `${entry.id}:${change.path}`;
    try {
      const result = await api.vcs.compareFile(projectDir, entry.id, change.path);
      compare = {
        entry,
        path: change.path,
        rows: result.binary ? [] : result.rows,
        binary: result.binary,
      };
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      compareLoadingKey = null;
    }
  }

  function when(ms: number): string {
    try { return new Date(ms).toLocaleString(); } catch { return ""; }
  }

  /** The card title (with a manual save's own note) and time, as the preview bar and the compare column name it. */
  function lookLabel(entry: VersionEntry): string {
    const note = versionDescription(entry.message);
    return `${versionLabel(entry.message)}${note ? ` — ${note}` : ""} · ${when(entry.timestamp)}`;
  }

  let headingEl = $state<HTMLElement>();

  onMount(() => {
    headingEl?.focus();
    void loadHistory();
    void loadOnline();
    void loadLog();
  });
</script>

<!-- One version row (used at the top level of a day, inside a collapsed
     automatic run, and in the online copy section — `online` rows cannot be
     restored: Sync brings them in). -->
{#snippet versionRow(entry: VersionEntry, isOnline: boolean)}
  <li>
    <div class="entry-row">
      <div class="entry-info">
        <span class="msg">{versionLabel(entry.message)}</span>
        {#if versionDescription(entry.message)}
          <span class="desc">{versionDescription(entry.message)}</span>
        {/if}
        <span class="meta">
          {when(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}
          {#if !isOnline && entry.backedUp === true}<span class="badge">Backed up</span>{/if}
          {#if !isOnline && entry.backedUp === false}<span class="badge local">Only on this computer</span>{/if}
        </span>
      </div>
      <div class="entry-actions">
        {#if onLookAt}
          {#if viewingId === entry.id}
            <button class="ghost small active" onclick={() => onStopLooking?.()} title="Back to the live preview only">
              Stop looking
            </button>
          {:else}
            <button class="ghost small" onclick={() => onLookAt?.(entry.id, lookLabel(entry))} title="Show this version beside the current book in the preview">
              Look at this version
            </button>
          {/if}
        {/if}
        {#if !isOnline}
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
                class="primary small app-btn-primary"
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
              title="Restore the book to this version"
            >
              Restore this version
            </button>
          {/if}
        {/if}
      </div>
    </div>
    <!-- What this version changed: file · plain size hint. A text file
         opens the side-by-side compare; a picture is listed only. -->
    {#if entry.changes.length === 0}
      <span class="no-changes">No changes</span>
    {:else}
      <ul class="changes">
        {#each entry.changes as change (change.path)}
          <li>
            {#if change.text && change.kind !== "removed"}
              <button
                class="change-link"
                onclick={() => openCompare(entry, change)}
                disabled={compareLoadingKey !== null}
                title="Compare this file with how it is now"
              >{change.path}</button>
            {:else}
              <span class="change-path">{change.path}</span>
            {/if}
            <span class="change-hint"> · {change.hint}</span>
          </li>
        {/each}
        {#if entry.moreChanges > 0}
          <li class="change-more">and {entry.moreChanges} more</li>
        {/if}
      </ul>
    {/if}
    {#if restoreError && (restoreConfirmId === entry.id || restoringId === entry.id)}
      <p class="error restore-error" role="alert">{restoreError}</p>
    {/if}
  </li>
{/snippet}

{#if compare}
  <VersionCompareView
    path={compare.path}
    versionLabel={lookLabel(compare.entry)}
    rows={compare.rows}
    binary={compare.binary}
    onBack={() => (compare = null)}
  />
{:else}
<div class="activity-view">
  <header class="activity-header">
    <button class="back" onclick={onBack}><Icon name="chevron-left" size={14} /> Online copy</button>
    <h2 bind:this={headingEl} tabindex="-1"><Icon name="history" size={16} /> Version history</h2>
    {#if onSaveVersion}
      <button class="ghost small save" onclick={() => void saveVersion()} disabled={savingVersion}>
        {savingVersion ? "Saving a version…" : "Save a version"}
      </button>
    {/if}
  </header>

  {#if error}<p class="error" role="alert">{error}</p>{/if}
  {#if nothingNew}<p class="notice" role="status">{NOTHING_NEW_NOTICE}</p>{/if}

  {#if hasRemote && (onlineState === "checking" || online.length > 0 || onlineState === "unavailable")}
    <section class="activity-section online-section">
      <h3 class="day-heading">In the online copy, not yet on this computer</h3>
      {#if onlineState === "checking"}
        <p class="muted">Checking what's online…</p>
      {:else if onlineState === "unavailable"}
        <p class="muted">Couldn't check what's online right now.</p>
      {:else}
        <ul class="history-list">
          {#each online as entry (entry.id)}
            {@render versionRow(entry, true)}
          {/each}
        </ul>
        <p class="muted">They come in on their own while Gutterpress backs up automatically, or when you choose <strong>Sync</strong>.</p>
      {/if}
    </section>
  {/if}

  <section class="activity-section">
    {#if historyLoading}
      <p class="muted">Loading versions…</p>
    {:else if entries.length === 0}
      <p class="muted">No versions yet.</p>
    {:else}
      {#each days as day (day.key)}
        <h3 class="day-heading">{day.label}</h3>
        <ul class="history-list">
          {#each collapseAutomaticRuns(day.entries) as row (row.key)}
            {#if row.kind === "auto-run"}
              <!-- 2+ consecutive automatic versions fold into one native
                   disclosure — no expansion state to manage; restore still
                   operates on the individual entries inside. -->
              <li>
                <details class="auto-run">
                  <summary>{autoRunSummary(row.entries)}</summary>
                  <ul class="history-list auto-run-list">
                    {#each row.entries as entry (entry.id)}
                      {@render versionRow(entry, false)}
                    {/each}
                  </ul>
                </details>
              </li>
            {:else}
              {@render versionRow(row.entry, false)}
            {/if}
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
{/if}

<style>
  .activity-view { display: flex; flex-direction: column; gap: 14px; color: var(--app-text-secondary); }
  .activity-header { padding-bottom: 12px; border-bottom: 1px solid var(--app-border-subtle); display: flex; align-items: center; gap: 12px; }
  .back { display: inline-flex; align-items: center; gap: 4px; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 4px 8px; font-size: 12px; cursor: pointer; flex: 0 0 auto; }
  .back:hover { background: var(--app-control-hover-bg); }
  .save { margin-left: auto; }
  .notice { margin: 0; font-size: 12px; font-weight: 600; color: var(--app-text); }
  h2 { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 15px; color: var(--app-text); outline: none; }
  .activity-section { padding: 0 0 14px; display: flex; flex-direction: column; gap: 8px; }
  .online-section { padding-bottom: 6px; border-bottom: 1px solid var(--app-border); }
  h3 { margin: 0; font-size: 12px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text); }
  .day-heading { margin: 6px 0 2px; font-size: 11px; text-transform: none; letter-spacing: 0; color: var(--app-text-muted); }
  .day-heading:first-of-type { margin-top: 0; }
  .desc { color: var(--app-text-secondary); font-size: 11px; overflow: hidden; text-overflow: ellipsis; }
  .history-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .history-list li { display: flex; flex-direction: column; gap: 6px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .auto-run summary { cursor: pointer; color: var(--app-text-secondary); font-size: 12px; font-weight: 600; }
  .auto-run-list { margin-top: 6px; }
  .entry-row { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
  .entry-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .entry-actions { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .msg { color: var(--app-text); font-weight: 600; font-size: 12px; }
  .meta, .muted { color: var(--app-text-muted); font-size: 12px; }
  .badge { display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 999px; font-size: 10px; font-weight: 600; background: var(--app-success-bg); border: 1px solid var(--app-success-border); color: var(--app-success-text); }
  .badge.local { background: var(--app-info-bg); border-color: var(--app-info-border); color: var(--app-info-text); }
  /* The changed-files list: plain rows under the card, no hunks. */
  .changes { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; font-size: 11px; }
  .history-list .changes li { display: block; padding: 0; border: 0; background: transparent; }
  .change-path, .change-link { color: var(--app-text); }
  .change-link { padding: 0; border: 0; background: none; font: inherit; cursor: pointer; text-decoration: underline; text-decoration-color: var(--app-border-strong); }
  .change-link:hover { color: var(--app-link); text-decoration-color: currentColor; }
  .change-link:disabled { cursor: default; }
  .change-hint, .change-more, .no-changes { color: var(--app-text-muted); }
  .no-changes { font-size: 11px; }
  .error { color: var(--app-error-text); margin: 0; }
  .restore-error { margin: 0; font-size: 11px; }
  .restore-confirm { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .confirm-copy { color: var(--app-text-secondary); font-size: 11px; max-width: 220px; }
  pre { margin: 0; padding: 10px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px; white-space: pre-wrap; font-size: 11px; overflow: auto; }
  .log-details summary { cursor: pointer; color: var(--app-text-muted); font-size: 12px; padding: 4px 0; }
  .log-details pre { margin-top: 8px; }
  .ghost { align-self: flex-start; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 5px 10px; cursor: pointer; }
  .ghost.active { color: var(--app-accent-text); border-color: var(--app-accent-border); background: var(--app-accent-subtle); }
  .ghost:disabled, .primary:disabled { opacity: 0.6; cursor: default; }
  /* Colors come from the shared .app-btn-primary recipe (theme.css). */
  .primary { border-width: 1px; border-style: solid; border-radius: 5px; padding: 5px 10px; cursor: pointer; }
  .ghost.small, .primary.small { padding: 4px 8px; font-size: 11px; }
</style>

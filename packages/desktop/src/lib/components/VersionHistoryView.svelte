<script lang="ts">
  /**
   * VersionHistoryView — the book's Version history as a screen of its own
   * (#448), the way word processors show it: the versions down the left,
   * grouped by day, and the selected one on the right — the files it changed
   * (a text file opens line by line beside the book as it is now) or, when
   * the author asks (Pages), its pages, rendered read-only. Selecting a
   * version never renders it: rendering one writes out all its files and
   * starts a preview, too slow to do for every click. Restore this version
   * sits at the top of the selected version. It opens over Book setup →
   * Online copy and closing it (X or Escape) returns there.
   *
   * Every card lists the files its version changed, as in 0.11.22 (#484).
   * They load as the card scrolls into view (VersionChangesController), so
   * opening the screen and Show older versions list versions only, and a
   * card already seen opens its Changed files at once.
   *
   * Restore: the host's `/api/vcs/restore-snapshot` saves the current state as
   * a version first, so restoring never loses work; the screen still asks once.
   * On success the parent reloads the open editor and preview (`onRestored`).
   * Versions in the online copy that this computer hasn't got are listed at
   * the top, each with the files it changed (#484), once the list is shown:
   * Sync (or automatic backing up) brings them in.
   *
   * PWA-clean (§8): api.* routes only.
   */
  import { onDestroy, onMount } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import PreviewFrame from "#lib/components/PreviewFrame.svelte";
  import VersionCompareView from "#lib/components/VersionCompareView.svelte";
  import { api, type CompareRow, type OnlineVersionEntry, type VersionEntry, type VersionFileChange } from "#lib/api.ts";
  import { dialogBehavior } from "#lib/dialog.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import type { PreviewClient } from "#lib/preview-client.ts";
  import { VersionChangesController } from "#lib/routes/version-changes-controller.svelte.ts";
  import { autoRunSummary, collapseAutomaticRuns, groupVersionsByDay, versionDescription, versionLabel } from "#lib/routes/version-timeline.ts";

  let {
    projectDir,
    hasRemote = false,
    logFilePath = null,
    initialId = null,
    onClose,
    onRestored,
  }: {
    projectDir: string;
    /** The book has an online copy, so the screen says what is there and not here yet. */
    hasRemote?: boolean;
    /** The newest operation log, for Technical details. */
    logFilePath?: string | null;
    /** The version to select on open (a recent one clicked in Online copy); the newest otherwise. */
    initialId?: string | null;
    onClose: () => void;
    /** A version was restored: the parent reloads the open editor and preview from disk. */
    onRestored?: () => void;
  } = $props();

  let entries = $state<VersionEntry[]>([]);
  const days = $derived(groupVersionsByDay(entries, Date.now()));
  let hasMore = $state(false);
  let loading = $state(true);
  let loadingOlder = $state(false);
  let error = $state<string | null>(null);
  /** Versions in the online copy that this computer hasn't got, each with its changed files. */
  let online = $state<OnlineVersionEntry[]>([]);

  /** What each version changed: a card's as it scrolls into view, the selected one's first. */
  const changesOf = new VersionChangesController((id) => api.vcs.versionChanges(projectDir, id));

  let selected = $state<VersionEntry | null>(null);
  /** What the right side shows for the selected version. */
  let view = $state<"files" | "pages" | "log">("files");
  /** The selected version's changed files, once the host has listed them. */
  const changes = $derived(selected ? (changesOf.loaded[selected.id] ?? null) : null);
  let changesError = $state<string | null>(null);
  /** The version whose pages were asked for (only ever the selected one). */
  let pagesFor = $state<string | null>(null);
  let pagesUrl = $state<string | null>(null);
  let pagesError = $state<string | null>(null);
  let compare = $state<{ path: string; rows: CompareRow[]; binary: boolean } | null>(null);
  let comparing = $state<string | null>(null);
  let logContent = $state<string | null>(null);

  let confirming = $state(false);
  let restoring = $state(false);
  let restoreError = $state<string | null>(null);

  const when = (ms: number): string => {
    try { return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; }
  };
  const time = (ms: number): string => {
    try { return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  };

  async function loadHistory(): Promise<void> {
    loading = true;
    try {
      const page = await changesOf.listFirst(api.vcs.listSnapshotsPage(projectDir));
      entries = page.entries;
      hasMore = page.hasMore;
      const keep = selected && entries.find((e) => e.id === selected!.id);
      void select(keep ?? entries.find((e) => e.id === initialId) ?? entries[0] ?? null);
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      loading = false;
    }
  }

  async function loadOlder(): Promise<void> {
    const last = entries[entries.length - 1];
    if (!last || loadingOlder) return;
    loadingOlder = true;
    try {
      const page = await changesOf.listFirst(api.vcs.listSnapshotsPage(projectDir, { before: last.id }));
      entries = [...entries, ...page.entries];
      hasMore = page.hasMore;
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingOlder = false;
    }
  }

  /** Show a version: the files it changed. Its pages wait until the author asks (Pages). */
  async function select(entry: VersionEntry | null): Promise<void> {
    selected = entry;
    view = "files";
    confirming = false;
    restoreError = null;
    compare = null;
    changesError = null;
    closePages();
    if (!entry) return;
    try {
      await changesOf.load(entry.id);
    } catch (e) {
      if (selected?.id === entry.id) changesError = friendlyHostError(e instanceof Error ? e.message : String(e));
    }
  }

  /** What is in the online copy and not on this computer yet. Quiet when it can't tell. */
  async function loadOnline(): Promise<void> {
    online = (await api.vcs.onlineVersions(projectDir).catch(() => null))?.entries ?? [];
  }

  /** Cards report coming into and leaving the list's view; their changes load while they are in it. */
  let observer: IntersectionObserver | null = null;
  const cardIds = new WeakMap<Element, string>();
  function cardInView(node: HTMLElement, id: string) {
    observer ??= new IntersectionObserver(
      (seen) => {
        for (const card of seen) {
          const seenId = cardIds.get(card.target);
          if (!seenId) continue;
          if (card.isIntersecting) changesOf.show(seenId);
          else changesOf.hide(seenId);
        }
      },
      // A little ahead of the view, so a card scrolled to usually has its files already.
      { root: node.closest(".vh-list"), rootMargin: "120px 0px" },
    );
    cardIds.set(node, id);
    observer.observe(node);
    return {
      destroy() {
        observer?.unobserve(node);
        cardIds.delete(node);
        changesOf.hide(id);
      },
    };
  }

  /** Pages: render the selected version, once, now that the author asked. */
  async function showPages(): Promise<void> {
    view = "pages";
    compare = null;
    const entry = selected;
    if (!entry || pagesFor === entry.id) return;
    pagesFor = entry.id;
    try {
      // null: a later open or close replaced this one before it started.
      const opened = await api.vcs.openVersionPreview(projectDir, entry.id);
      if (opened && pagesFor === entry.id) pagesUrl = opened.url;
    } catch (e) {
      if (pagesFor === entry.id) pagesError = friendlyHostError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Stop showing a version's pages; the host drops its preview, or skips one not started yet. */
  function closePages(): void {
    if (pagesFor === null) return;
    pagesFor = null;
    pagesUrl = null;
    pagesError = null;
    void api.vcs.closeVersionPreview().catch(() => {});
  }

  async function openFile(change: VersionFileChange): Promise<void> {
    if (!selected || comparing) return;
    const id = selected.id;
    comparing = change.path;
    try {
      const result = await api.vcs.compareFile(projectDir, id, change.path);
      // Another version selected meanwhile: this file belongs to the old one.
      if (selected?.id === id) compare = { path: change.path, rows: result.binary ? [] : result.rows, binary: result.binary };
    } catch (e) {
      error = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      comparing = null;
    }
  }

  async function restore(): Promise<void> {
    if (!selected || restoring) return;
    restoring = true;
    restoreError = null;
    try {
      await api.vcs.restoreSnapshot(projectDir, selected.id);
      confirming = false;
      onRestored?.();
      await loadHistory();
    } catch (e) {
      restoreError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      restoring = false;
    }
  }

  async function showLog(): Promise<void> {
    view = "log";
    if (logContent !== null || !logFilePath) return;
    logContent = (await api.log.read(logFilePath).catch(() => null)) ?? "";
  }

  onMount(() => {
    // The online copy is checked once the list is shown, so it never holds the list up.
    void loadHistory().then(() => (hasRemote ? loadOnline() : undefined));
  });
  onDestroy(() => {
    observer?.disconnect();
    void api.vcs.closeVersionPreview().catch(() => {});
  });

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }
</script>

<!-- What a version changed, on its card: "chapter-02.md · 3 paragraphs changed", "and N more", "No changes". -->
{#snippet changedFiles(files: VersionFileChange[], more: number)}
  <span class="ver-files">
    {#each files as change (change.path)}
      <span class="ver-file"><span class="ver-path">{change.path}</span> · {change.hint}</span>
    {:else}
      <span class="ver-file">No changes</span>
    {/each}
    {#if more}<span class="ver-file">and {more} more</span>{/if}
  </span>
{/snippet}

<!-- A version in the online copy only: shown with what it changed; it comes in with the next backup. -->
{#snippet onlineRow(entry: OnlineVersionEntry)}
  <li class="online-ver">
    <span class="ver-title">{versionLabel(entry.message)}</span>
    {#if versionDescription(entry.message)}<span class="ver-note">{versionDescription(entry.message)}</span>{/if}
    <span class="ver-meta">{when(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}</span>
    {@render changedFiles(entry.changes, entry.moreChanges)}
  </li>
{/snippet}

{#snippet row(entry: VersionEntry)}
  {@const loaded = changesOf.loaded[entry.id]}
  <li use:cardInView={entry.id}>
    <button
      class="ver"
      class:selected={selected?.id === entry.id}
      aria-current={selected?.id === entry.id ? "true" : undefined}
      onclick={() => void select(entry)}
    >
      <span class="ver-title">{versionLabel(entry.message)}</span>
      {#if versionDescription(entry.message)}<span class="ver-note">{versionDescription(entry.message)}</span>{/if}
      <span class="ver-meta">
        {time(entry.timestamp)}{entry.author ? ` · ${entry.author}` : ""}
        {#if entry.backedUp === false}<span class="dot local" title="Only on this computer"></span>{/if}
      </span>
      {#if loaded}
        {@render changedFiles(loaded.files, loaded.more)}
      {:else}
        <span class="ver-files pending" aria-hidden="true"></span>
      {/if}
    </button>
  </li>
{/snippet}

<section
  class="vh"
  use:portal
  use:dialogBehavior={{ onClose, labelledBy: "vh-title", focusContainer: true }}
>
  <header class="vh-head">
    <h1 id="vh-title"><Icon name="history" size={18} /> Version history</h1>
    <button class="vh-close" onclick={onClose} aria-label="Close version history" title="Back to Book setup (Esc)"><Icon name="x" size={16} /></button>
  </header>

  <div class="vh-body">
    <nav class="vh-list" aria-label="Versions">
      {#if online.length > 0}
        <section class="online" aria-labelledby="vh-online-title">
          <h2 class="day" id="vh-online-title"><Icon name="cloud" size={13} /> Online, not yet on this computer</h2>
          <ul>
            {#each collapseAutomaticRuns(online) as item (item.key)}
              {#if item.kind === "auto-run"}
                <li>
                  <details class="run">
                    <summary>{autoRunSummary(item.entries)}</summary>
                    <ul>
                      {#each item.entries as entry (entry.id)}{@render onlineRow(entry)}{/each}
                    </ul>
                  </details>
                </li>
              {:else}
                {@render onlineRow(item.entry)}
              {/if}
            {/each}
          </ul>
          <p class="online-note">They come in the next time this book backs up.</p>
        </section>
      {/if}
      {#if loading && entries.length === 0}
        <p class="muted pad">Loading versions…</p>
      {:else if entries.length === 0}
        <p class="muted pad">No versions yet.</p>
      {:else}
        {#each days as day (day.key)}
          <h2 class="day">{day.label}</h2>
          <ul>
            {#each collapseAutomaticRuns(day.entries) as item (item.key)}
              {#if item.kind === "auto-run"}
                <li>
                  <details class="run">
                    <summary>{autoRunSummary(item.entries)}</summary>
                    <ul>
                      {#each item.entries as entry (entry.id)}{@render row(entry)}{/each}
                    </ul>
                  </details>
                </li>
              {:else}
                {@render row(item.entry)}
              {/if}
            {/each}
          </ul>
        {/each}
        {#if hasMore}
          <button class="ghost older" onclick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "Loading…" : "Show older versions"}</button>
        {/if}
      {/if}
      {#if logFilePath}
        <button class="link tech" onclick={() => void showLog()}>Technical details</button>
      {/if}
      {#if error}<p class="error pad" role="alert">{error}</p>{/if}
    </nav>

    <div class="vh-detail">
      {#if view === "log"}
        <div class="detail-head">
          <div><h2>Technical details</h2><p class="muted">The log of this book's recent backing up.</p></div>
          <button class="ghost" onclick={() => (view = "files")}>Back to the version</button>
        </div>
        <pre class="log">{logContent ?? "Loading…"}</pre>
      {:else if selected}
        <div class="detail-head">
          <div class="detail-title">
            <h2>{versionLabel(selected.message)}{#if versionDescription(selected.message)}<span class="note"> — {versionDescription(selected.message)}</span>{/if}</h2>
            <p class="muted">
              {when(selected.timestamp)}{selected.author ? ` · ${selected.author}` : ""}
              {#if selected.backedUp === true}<span class="badge">Backed up</span>{/if}
              {#if selected.backedUp === false}<span class="badge local">Only on this computer</span>{/if}
            </p>
          </div>
          <div class="detail-actions">
            {#if confirming}
              <span class="confirm">Your current work is saved as a version first.</span>
              <button class="ghost" onclick={() => (confirming = false)} disabled={restoring}>Cancel</button>
              <button class="app-btn-primary" onclick={() => void restore()} disabled={restoring}>{restoring ? "Restoring…" : "Restore"}</button>
            {:else}
              <button class="app-btn-primary" onclick={() => (confirming = true)}>Restore this version</button>
            {/if}
          </div>
        </div>
        {#if restoreError}<p class="error" role="alert">{restoreError}</p>{/if}

        <div class="tabs" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={view === "files"} class:active={view === "files"} onclick={() => (view = "files")}>
            Changed files{changes?.files.length ? ` (${changes.files.length + changes.more})` : ""}
          </button>
          <button role="tab" aria-selected={view === "pages"} class:active={view === "pages"} onclick={() => void showPages()}>Pages</button>
        </div>

        {#if view === "pages"}
          <div class="pages">
            {#if pagesUrl}
              {#key pagesUrl}
                <PreviewFrame url={pagesUrl} onClientReady={(c: PreviewClient) => c.setExpectedOrigin(pagesUrl ?? undefined)} />
              {/key}
            {:else if pagesError}
              <p class="error pad" role="alert">Couldn't show this version. {pagesError}</p>
            {:else}
              <p class="muted pad">Getting this version's pages ready…</p>
            {/if}
          </div>
        {:else if compare}
          <div class="compare">
            <VersionCompareView
              path={compare.path}
              versionLabel={`${versionLabel(selected.message)} · ${when(selected.timestamp)}`}
              rows={compare.rows}
              binary={compare.binary}
              onBack={() => (compare = null)}
            />
          </div>
        {:else if changesError}
          <p class="error pad" role="alert">Couldn't show this version. {changesError}</p>
        {:else if changes}
          <ul class="files">
            {#each changes.files as change (change.path)}
              <li>
                {#if change.text}
                  <button class="file" onclick={() => void openFile(change)} disabled={!!comparing}>
                    <span class="file-path">{change.path}</span><span class="file-hint">{change.hint}</span>
                  </button>
                {:else}
                  <span class="file static"><span class="file-path">{change.path}</span><span class="file-hint">{change.hint}</span></span>
                {/if}
              </li>
            {:else}
              <li class="muted pad">This version changed nothing.</li>
            {/each}
            {#if changes.more}<li class="muted pad">and {changes.more} more</li>{/if}
          </ul>
        {/if}
      {:else if !loading}
        <p class="muted pad">Choose a version on the left to see it.</p>
      {/if}
    </div>
  </div>
</section>

<style>
  .vh {
    position: fixed; inset: 0; z-index: var(--app-z-sheet);
    display: flex; flex-direction: column;
    background: var(--app-bg); color: var(--app-text); outline: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  }
  .vh-head {
    display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding: 12px 20px; background: var(--app-surface); border-bottom: 1px solid var(--app-border);
  }
  .vh-head h1 { margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; }
  .vh-close { display: inline-flex; padding: 5px; border: 0; border-radius: 6px; background: none; color: var(--app-text-secondary); cursor: pointer; }
  .vh-close:hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .vh-close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }

  .vh-body { flex: 1; min-height: 0; display: grid; grid-template-columns: minmax(260px, 320px) minmax(0, 1fr); }

  .vh-list { overflow-y: auto; background: var(--app-surface); border-right: 1px solid var(--app-border); padding-bottom: 16px; }
  .vh-list ul { list-style: none; margin: 0; padding: 0; }
  .day { margin: 0; padding: 14px 16px 6px; font-size: 11.5px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); }
  .ver {
    display: flex; flex-direction: column; align-items: flex-start; gap: 1px; width: 100%;
    padding: 8px 16px; border: 0; border-left: 3px solid transparent; background: none;
    font: inherit; text-align: left; color: var(--app-text); cursor: pointer;
  }
  .ver:hover { background: var(--app-surface-hover); }
  .ver.selected { background: var(--app-accent-subtle); border-left-color: var(--app-accent); }
  .ver:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .ver-title { font-size: 13px; font-weight: 600; }
  .ver-note { font-size: 12.5px; color: var(--app-text-secondary); overflow-wrap: anywhere; }
  .ver-meta { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--app-text-muted); }
  .dot.local { width: 7px; height: 7px; border-radius: 50%; background: var(--app-info-text); }
  /* A card's changed files: plain lines under its title, as in 0.11.22. One line is
     kept while they load, so most cards do not grow when they arrive. */
  .ver-files { display: flex; flex-direction: column; gap: 1px; margin-top: 3px; min-width: 0; max-width: 100%; font-size: 11.5px; color: var(--app-text-muted); }
  .ver-files.pending { min-height: 1.35em; }
  .ver-file { line-height: 1.35; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ver-path { color: var(--app-text-secondary); }
  .run summary { padding: 8px 16px; cursor: pointer; font-size: 12.5px; color: var(--app-text-secondary); }
  .run summary:hover { background: var(--app-surface-hover); }
  .run .ver { padding-left: 28px; }
  .online { background: var(--app-info-bg); border-bottom: 1px solid var(--app-info-border); }
  /* Laid out like a card, but not one to select: it comes in with the next backup. */
  .online-ver { display: flex; flex-direction: column; align-items: flex-start; gap: 1px; padding: 8px 16px 8px 19px; color: var(--app-text); }
  .run .online-ver { padding-left: 31px; }
  .online .day { display: flex; align-items: center; gap: 6px; color: var(--app-info-text); }
  .online-note { margin: 0; padding: 4px 16px 12px; font-size: 12px; line-height: 1.4; color: var(--app-info-text); }
  .older { margin: 10px 16px 0; }
  .tech { display: block; margin: 14px 16px 0; }

  .vh-detail { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .detail-head {
    display: flex; align-items: center; justify-content: space-between; gap: 16px;
    padding: 14px 20px; background: var(--app-surface); border-bottom: 1px solid var(--app-border-subtle);
  }
  .detail-head h2 { margin: 0; font-size: 15px; font-weight: 600; color: var(--app-text); overflow-wrap: anywhere; }
  .detail-head .note { font-weight: 400; color: var(--app-text-secondary); }
  .detail-head .muted { margin: 3px 0 0; }
  .detail-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
  .confirm { font-size: 12.5px; color: var(--app-text-secondary); }
  .tabs { display: flex; gap: 2px; padding: 0 20px; background: var(--app-surface); border-bottom: 1px solid var(--app-border); }
  .tabs button {
    padding: 9px 12px; border: 0; border-bottom: 2px solid transparent; background: none;
    font: inherit; font-size: 13px; color: var(--app-text-muted); cursor: pointer;
  }
  .tabs button.active { color: var(--app-text); font-weight: 600; border-bottom-color: var(--app-accent); }
  .tabs button:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .pages { flex: 1; min-height: 0; display: flex; background: var(--app-surface-sunken); }
  .pages :global(iframe) { flex: 1; width: 100%; height: 100%; border: 0; }
  .compare { flex: 1; min-height: 0; overflow: auto; padding: 16px 20px; }
  .files { list-style: none; margin: 0; padding: 8px 0; overflow-y: auto; }
  .file {
    display: flex; align-items: baseline; gap: 10px; width: 100%; padding: 8px 20px;
    border: 0; background: none; font: inherit; text-align: left; cursor: pointer; color: var(--app-text);
  }
  button.file:hover { background: var(--app-surface-hover); }
  button.file .file-path { text-decoration: underline; text-decoration-color: var(--app-border-strong); }
  .file.static { cursor: default; }
  .file-path { font-size: 13px; }
  .file-hint { font-size: 12px; color: var(--app-text-muted); }
  .log { flex: 1; margin: 16px 20px; padding: 12px; overflow: auto; white-space: pre-wrap; font-size: 11.5px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }

  .muted { margin: 0; font-size: 12.5px; color: var(--app-text-muted); }
  .pad { padding: 14px 16px; }
  .error { margin: 0; padding: 8px 20px; font-size: 12.5px; color: var(--app-error-text); }
  .badge { display: inline-block; margin-left: 6px; padding: 0 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; background: var(--app-success-bg); border: 1px solid var(--app-success-border); color: var(--app-success-text); }
  .badge.local { background: var(--app-info-bg); border-color: var(--app-info-border); color: var(--app-info-text); }
  .ghost { padding: 6px 12px; font: inherit; font-size: 12.5px; border-radius: 5px; border: 1px solid var(--app-border); background: transparent; color: var(--app-text-secondary); cursor: pointer; }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .ghost:disabled { opacity: 0.55; cursor: default; }
  .app-btn-primary { padding: 7px 14px; font: inherit; font-size: 13px; border-radius: 5px; border-width: 1px; border-style: solid; cursor: pointer; }
  .link { padding: 0; border: 0; background: none; font: inherit; font-size: 12px; color: var(--app-link); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }
</style>

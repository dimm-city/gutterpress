<script lang="ts">
  /**
   * VersionHistoryView — the book's Version history as a screen of its own
   * (#448): the versions down the left, the selected one on the right, the
   * way word processors show it. It opens on the newest version (or the one
   * clicked in Online copy) with its first changed text file already
   * compared, so there is always something to read.
   *
   * The list: grouped by day, and within a day a run of automatic versions
   * folds into an editing session ("Editing · 14 automatic saves") that names
   * the files it touched; the versions the author saved stand out between
   * them with a star. Rows name an author only when it is not the book's
   * usual one, and mark the versions not online yet. Search finds a version
   * by its note or by a file it changed; All · Named · Not online yet
   * narrow it. ↑/↓ move through the list, ←/→ through the selected version's
   * files.
   *
   * What each version changed loads as its row scrolls into view
   * (VersionChangesController), never a whole page up front, so listing stays
   * as quick as #461 made it; a session asks for each of its versions, and
   * its files fill in as they arrive.
   *
   * The selected version: its title, when, who and where it is kept; its
   * changed files as chips, the open one compared (VersionCompareView), or
   * its Pages rendered read-only when asked for. Restore the whole book… asks
   * once; the host's `/api/vcs/restore-snapshot` saves the current state as a
   * version first, so restoring never loses work, and the parent reloads the
   * editor and preview (`onRestored`). There is no "restore just this file":
   * the only safe single-file write path is the open editor's buffer, which
   * this screen does not reach.
   *
   * Versions in the online copy that this computer hasn't got are one banner
   * row over the list; Get them runs the page's get-latest pass
   * (`onGetLatest`). Opened, it lists them; one can be selected to see its
   * files, compared when this computer already has it, never restored.
   *
   * Below 1000 px the list is a drawer and the comparison opens Inline.
   * PWA-clean (§8): api.* routes only.
   */
  import { onDestroy, onMount, tick } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import PreviewFrame from "#lib/components/PreviewFrame.svelte";
  import VersionCompareView from "#lib/components/VersionCompareView.svelte";
  import { api, type OnlineVersionEntry, type VersionChanges, type VersionEntry } from "#lib/api.ts";
  import { dialogBehavior } from "#lib/dialog.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import type { PreviewClient } from "#lib/preview-client.ts";
  import { VersionChangesController } from "#lib/routes/version-changes-controller.svelte.ts";
  import {
    changedSummary,
    editingSessions,
    fileName,
    groupVersionsByDay,
    isNamed,
    matchesVersion,
    onlineSummary,
    pickFile,
    sessionFiles,
    sessionTitle,
    shortHint,
    timeSpan,
    usualAuthor,
    versionTitle,
    type TimelineRow,
    type VersionFilter,
  } from "#lib/routes/version-timeline.ts";
  import * as onlineCopy from "#lib/routes/online-copy-cache.ts";

  let {
    projectDir,
    hasRemote = false,
    logFilePath = null,
    initialId = null,
    onClose,
    onRestored,
    onGetLatest,
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
    /** Get them: the page's get-latest pass, the one the Online tab runs. */
    onGetLatest?: () => Promise<void> | void;
  } = $props();

  let entries = $state<VersionEntry[]>([]);
  let hasMore = $state(false);
  let loading = $state(true);
  let loadingOlder = $state(false);
  let error = $state<string | null>(null);
  let olderError = $state<string | null>(null);
  /** Versions in the online copy that this computer hasn't got, each with its changed files. */
  let online = $state<OnlineVersionEntry[]>([]);
  let onlineOpen = $state(false);
  let getting = $state(false);

  /** What each version changed: a row's as it scrolls into view, the selected one's first. */
  const changesOf = new VersionChangesController((id) => api.vcs.versionChanges(projectDir, id));

  // ── The list ──────────────────────────────────────────────────────────────
  let query = $state("");
  let filter = $state<VersionFilter>("all");
  const searching = $derived(query.trim() !== "" || filter !== "all");
  const author = $derived(usualAuthor(entries));
  const localCount = $derived(entries.filter((e) => e.backedUp === false).length);
  const shown = $derived(entries.filter((e) => matchesVersion(e, filter, query, changesOf.loaded[e.id])));
  /** Versions whose files a search cannot see yet. */
  const unchecked = $derived(query.trim() ? entries.filter((e) => !changesOf.loaded[e.id]).length : 0);
  /** Days, each as rows: editing sessions and versions; a search lists every match on its own. */
  const days = $derived(
    groupVersionsByDay(shown, Date.now()).map((day) => ({
      ...day,
      rows: searching
        ? day.entries.map((entry): TimelineRow<VersionEntry> => ({ kind: "version", key: entry.id, entry }))
        : editingSessions(day.entries),
    })),
  );
  /** Open sessions, by key. */
  let expanded = $state<Record<string, boolean>>({});
  /** Narrow window: the list is a drawer, open or not. */
  let drawerOpen = $state(false);

  // ── The selected version ─────────────────────────────────────────────────
  let selected = $state<VersionEntry | OnlineVersionEntry | null>(null);
  /** The selected version is one from the online copy not on this computer yet. */
  const selectedOnline = $derived(!!selected && online.some((o) => o.id === selected!.id));
  /** This computer has the version, so its files can be compared and its pages shown. */
  const local = $derived(!!selected && !!changesOf.loaded[selected.id]);
  /** A version's changed files: loaded here, or as the online copy listed them. */
  const filesOf = (entry: VersionEntry | OnlineVersionEntry): VersionChanges | null =>
    changesOf.loaded[entry.id] ?? ("moreChanges" in entry ? { files: entry.changes, more: entry.moreChanges } : null);
  const changes = $derived(selected ? filesOf(selected) : null);
  let changesError = $state<string | null>(null);
  /** The file the author last chose; kept open on other versions that changed it too. */
  let wanted = $state<string | null>(null);
  const openPath = $derived(changes ? pickFile(changes.files, wanted) : null);
  let view = $state<"changes" | "pages" | "log">("changes");
  /** The version whose pages were asked for (only ever the selected one). */
  let pagesFor = $state<string | null>(null);
  let pagesUrl = $state<string | null>(null);
  let pagesError = $state<string | null>(null);
  let logContent = $state<string | null>(null);

  let confirming = $state(false);
  let restoring = $state(false);
  let restoreError = $state<string | null>(null);
  /** What a finished restore says: which version the book went back to, and that the work from before was kept. */
  let restored = $state<string | null>(null);

  const when = (ms: number): string => {
    try { return new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); } catch { return ""; }
  };
  const time = (ms: number): string => {
    try { return new Date(ms).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }); } catch { return ""; }
  };
  /** " · Grace" for versions by someone other than the book's usual author. */
  const by = (...versions: VersionEntry[]): string => {
    const others = [...new Set(versions.map((v) => v.author).filter((a) => a && a !== author))];
    return others.length ? ` · ${others.join(", ")}` : "";
  };

  async function loadHistory(): Promise<void> {
    loading = true;
    error = null;
    try {
      // Online started reading this page when it opened, so it is usually already here.
      const page = await changesOf.listFirst(onlineCopy.takeVersionsPage(projectDir) ?? api.vcs.listSnapshotsPage(projectDir));
      entries = page.entries;
      hasMore = page.hasMore;
      const keep = selected && [...entries, ...online].find((e) => e.id === selected!.id);
      // The screen opens on something: the version kept from before, the one asked for, or the newest.
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
    olderError = null;
    try {
      const page = await changesOf.listFirst(api.vcs.listSnapshotsPage(projectDir, { before: last.id }));
      entries = [...entries, ...page.entries];
      hasMore = page.hasMore;
      if (query.trim()) checkAll();
    } catch (e) {
      olderError = friendlyHostError(e instanceof Error ? e.message : String(e));
    } finally {
      loadingOlder = false;
    }
  }

  /** Show a version: its changed files, the open one compared. Its pages wait until the author asks (Pages). */
  async function select(entry: VersionEntry | null): Promise<void> {
    selected = entry;
    view = "changes";
    confirming = false;
    restoreError = null;
    changesError = null;
    closePages();
    if (!entry) return;
    const session = days.flatMap((d) => d.rows).find((r) => r.kind === "session" && r.entries.some((e) => e.id === entry.id));
    if (session) expanded[session.key] = true;
    try {
      await changesOf.load(entry.id);
    } catch (e) {
      // A version from the online copy may not be on this computer: its files are still listed, uncompared.
      if (selected?.id === entry.id && !selectedOnline) changesError = friendlyHostError(e instanceof Error ? e.message : String(e));
    }
  }

  /** What is in the online copy and not on this computer yet. Quiet when it can't tell. */
  async function loadOnline(): Promise<void> {
    // The Online tab checked a moment ago, as a rule: its check is reused rather than asked again.
    online = (await api.vcs.onlineVersions(projectDir, { maxAgeMs: onlineCopy.FRESH_MS }).catch(() => null))?.entries ?? [];
    // Opened on a version that is online only (a Coming down row in the Online tab): it is
    // listed only now, so select it, unless the author has chosen another meanwhile.
    const asked = online.find((e) => e.id === initialId);
    if (asked && (!selected || selected.id === entries[0]?.id)) {
      onlineOpen = true;
      void select(asked);
    }
  }

  /** Get them: the page's get-latest pass, then the list again with what came in. */
  async function getThem(): Promise<void> {
    if (!onGetLatest || getting) return;
    getting = true;
    try {
      await onGetLatest();
      await loadHistory();
      await loadOnline();
    } finally {
      getting = false;
    }
  }

  /** A search looks through every listed version's files: ask for the ones not loaded yet. */
  function checkAll(): void {
    for (const e of entries) changesOf.show(e.id);
  }
  async function onSearch(): Promise<void> {
    // After the list redraws: rows a search hides tell the controller they left the view.
    await tick();
    if (query.trim()) checkAll();
  }

  /** Rows report coming into and leaving the list's view; their versions' changes load while they are in it. */
  let observer: IntersectionObserver | null = null;
  const rowIds = new WeakMap<Element, string[]>();
  /** A search keeps every version's changes coming, in view or not. */
  const hide = (ids: string[]) => { if (!query.trim()) for (const id of ids) changesOf.hide(id); };
  function inView(node: HTMLElement, ids: string[]) {
    observer ??= new IntersectionObserver(
      (seen) => {
        for (const row of seen) {
          const seenIds = rowIds.get(row.target);
          if (!seenIds) continue;
          if (row.isIntersecting) for (const id of seenIds) changesOf.show(id);
          else hide(seenIds);
        }
      },
      // A little ahead of the view, so a row scrolled to usually has its files already.
      { root: node.closest(".vh-scroll"), rootMargin: "120px 0px" },
    );
    rowIds.set(node, ids);
    observer.observe(node);
    return {
      destroy() {
        observer?.unobserve(node);
        rowIds.delete(node);
        hide(ids);
      },
    };
  }

  /** ↑/↓, Home/End: move through the list's rows; landing on a version selects it. */
  async function onListKeydown(e: KeyboardEvent): Promise<void> {
    if (e.altKey || e.ctrlKey || e.metaKey || !["ArrowDown", "ArrowUp", "Home", "End"].includes(e.key)) return;
    const list = e.currentTarget as HTMLElement;
    // An open session's header is passed over: its versions are listed under it.
    const stops = [...list.querySelectorAll<HTMLElement>('[data-stop]:not([aria-expanded="true"])')];
    if (stops.length === 0) return;
    e.preventDefault();
    let at = stops.indexOf(document.activeElement as HTMLElement);
    if (at < 0) at = stops.findIndex((s) => s.dataset.version === selected?.id);
    const down = e.key === "ArrowDown" || e.key === "Home";
    const next =
      e.key === "Home" ? 0
      : e.key === "End" ? stops.length - 1
      : Math.min(stops.length - 1, Math.max(0, at + (down ? 1 : -1)));
    const stop = stops[next]!;
    // A closed session opens on the version the move comes to: its newest going down, its oldest going up.
    const session = days.flatMap((d) => d.rows).find((r) => r.kind === "session" && r.key === stop.dataset.session);
    const id = session?.kind === "session" ? session.entries[down ? 0 : session.entries.length - 1]!.id : stop.dataset.version;
    const entry = id ? [...online, ...entries].find((v) => v.id === id) : null;
    if (entry && entry.id !== selected?.id) { restored = null; void select(entry); }
    await tick();
    const row = (id && list.querySelector<HTMLElement>(`[data-version="${id}"]`)) || stop;
    row.focus();
    row.scrollIntoView({ block: "nearest" });
  }

  /** ←/→ anywhere but a text field or the comparison's text: the selected version's previous/next file. */
  function onWindowKeydown(e: KeyboardEvent): void {
    if (e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowLeft" && e.key !== "ArrowRight")) return;
    const target = e.target as HTMLElement | null;
    if (view !== "changes" || !changes || target?.closest("input, textarea, [contenteditable], .cm-editor")) return;
    const at = changes.files.findIndex((f) => f.path === openPath);
    const next = changes.files[at + (e.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    wanted = next.path;
  }

  function choose(entry: VersionEntry): void {
    restored = null;
    drawerOpen = false;
    void select(entry);
  }


  /** Pages: render the selected version, once, now that the author asked. */
  async function showPages(): Promise<void> {
    view = "pages";
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

  async function restore(): Promise<void> {
    if (!selected || restoring || selectedOnline) return;
    restoring = true;
    restoreError = null;
    try {
      const target = selected;
      await api.vcs.restoreSnapshot(projectDir, target.id);
      confirming = false;
      onlineCopy.dropVersionsPage(projectDir);
      // True with or without `backupId`: work not yet in a version was saved as one first, and everything else already was.
      restored = `Restored the whole book to "${versionTitle(target.message)}" (${when(target.timestamp)}). Your earlier work is saved as a version, so you can come back to it.`;
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
    drawerOpen = false;
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

  /** Skeleton rows while the first page lists. */
  const SKELETON = [1, 2, 3, 4, 5, 6, 7, 8];
</script>

<svelte:window onkeydown={onWindowKeydown} />

<!-- A version on its own row: a star for the ones the author saved, what it changed (filled in as it loads), who when not the usual author, and whether it is online yet. -->
{#snippet versionRow(entry: VersionEntry)}
  {@const loaded = filesOf(entry)}
  <li use:inView={[entry.id]}>
    <button
      class="row"
      class:named={isNamed(entry.message)}
      class:selected={selected?.id === entry.id}
      aria-current={selected?.id === entry.id ? "true" : undefined}
      tabindex={selected?.id === entry.id ? 0 : -1}
      data-stop
      data-version={entry.id}
      onclick={() => choose(entry)}
    >
      <span class="ic">{#if isNamed(entry.message)}<Icon name="star" size={13} />{/if}</span>
      <span class="t">{versionTitle(entry.message)}</span>
      <span class="tm">{time(entry.timestamp)}</span>
      <span class="f">
        {loaded ? changedSummary(loaded) : ""}{by(entry)}
        {#if entry.backedUp === false}<span class="local"><Icon name="cloud-off" size={11} /> not online yet</span>{/if}
      </span>
    </button>
  </li>
{/snippet}

<!-- An editing session: its automatic saves, the time they span and the files they touched; opened, one line per version. -->
{#snippet sessionRow(row: Extract<TimelineRow<VersionEntry>, { kind: "session" }>)}
  {@const open = !!expanded[row.key]}
  {@const files = sessionFiles(row.entries.map((e) => changesOf.loaded[e.id]))}
  <li>
    <button
      class="row session"
      class:holds={row.entries.some((e) => e.id === selected?.id)}
      aria-expanded={open}
      tabindex={!open && row.entries.some((e) => e.id === selected?.id) ? 0 : -1}
      data-stop
      data-session={row.key}
      use:inView={row.entries.map((e) => e.id)}
      onclick={() => (expanded[row.key] = !open)}
    >
      <span class="ic"><Icon name={open ? "chevron-down" : "chevron-right"} size={13} /></span>
      <span class="t">{sessionTitle(row.entries.length)}</span>
      <span class="tm">{timeSpan(row.entries)}</span>
      <span class="f">
        {files}{by(...row.entries)}
        {#if row.entries.some((e) => e.backedUp === false)}<span class="local"><Icon name="cloud-off" size={11} /> not online yet</span>{/if}
      </span>
    </button>
    {#if open}
      <ul>
        {#each row.entries as entry (entry.id)}
          {@const loaded = changesOf.loaded[entry.id]}
          <li>
            <button
              class="row sub"
              class:selected={selected?.id === entry.id}
              aria-current={selected?.id === entry.id ? "true" : undefined}
              tabindex={selected?.id === entry.id ? 0 : -1}
              data-stop
              data-version={entry.id}
              onclick={() => choose(entry)}
            >
              <span class="t">{loaded ? changedSummary(loaded) : versionTitle(entry.message)}{by(entry)}</span>
              <span class="tm">{time(entry.timestamp)}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  </li>
{/snippet}

<section
  class="vh"
  use:portal
  use:dialogBehavior={{ onClose, labelledBy: "vh-title", focusContainer: true }}
>
  <header class="vh-head">
    <button class="vh-icon drawer-toggle" aria-expanded={drawerOpen} aria-controls="vh-list" onclick={() => (drawerOpen = !drawerOpen)} title="Show the versions">
      <Icon name="panel-left" size={16} /> <span>Versions</span>
    </button>
    <h1 id="vh-title"><Icon name="history" size={18} /> Version history</h1>
    <button class="vh-icon" onclick={onClose} aria-label="Close version history" title="Back to Book setup (Esc)"><Icon name="x" size={16} /></button>
  </header>

  <div class="vh-body" class:drawer-open={drawerOpen}>
    <!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
    <nav
      class="vh-list"
      id="vh-list"
      aria-label="Versions"
      onkeydown={(e) => { if (e.key === "Escape" && drawerOpen) { e.stopPropagation(); drawerOpen = false; } }}
    >
      <div class="find">
        <input
          type="search"
          bind:value={query}
          oninput={() => void onSearch()}
          aria-label="Find a version or a file"
          placeholder="Find a version or a file — e.g. ch07"
        />
        <div class="chips" role="group" aria-label="Show">
          <button class:on={filter === "all"} aria-pressed={filter === "all"} onclick={() => (filter = "all")}>All</button>
          <button class:on={filter === "named"} aria-pressed={filter === "named"} onclick={() => (filter = "named")}>Named</button>
          {#if hasRemote}
            <button class:on={filter === "local"} aria-pressed={filter === "local"} onclick={() => (filter = "local")}>Not online yet · {localCount}</button>
          {/if}
        </div>
      </div>

      <!-- svelte-ignore a11y_no_static_element_interactions -->
      <div class="vh-scroll" onkeydown={(e) => void onListKeydown(e)}>
        {#if online.length > 0}
          <div class="banner">
            <button class="banner-toggle" aria-expanded={onlineOpen} onclick={() => (onlineOpen = !onlineOpen)}>
              <Icon name={onlineOpen ? "chevron-down" : "chevron-right"} size={13} />
              <span>{onlineSummary(online)}</span>
            </button>
            {#if onGetLatest}
              <button class="get" onclick={() => void getThem()} disabled={getting}>{getting ? "Getting…" : "Get them"}</button>
            {/if}
          </div>
          {#if onlineOpen}
            <ul class="online" aria-label="Online, not yet on this computer">
              {#each online as entry (entry.id)}{@render versionRow(entry)}{/each}
            </ul>
          {/if}
        {/if}

        {#if error}
          <p class="error pad" role="alert">Couldn't list the versions. {error} <button class="link" onclick={() => void loadHistory()}>Try again</button></p>
        {:else if loading && entries.length === 0}
          <div aria-busy="true" aria-label="Loading versions">
            <p class="day"><span class="bone" style="width: 54px"></span></p>
            {#each SKELETON as n (n)}
              <div class="row skeleton" aria-hidden="true">
                <span class="ic"></span><span class="t"><span class="bone" style="width: {50 + ((n * 37) % 40)}%"></span></span><span class="tm"><span class="bone" style="width: 48px"></span></span>
                <span class="f"><span class="bone" style="width: {30 + ((n * 23) % 45)}%"></span></span>
              </div>
            {/each}
          </div>
        {:else if entries.length === 0}
          <p class="muted pad">No versions yet.</p>
        {:else if shown.length === 0}
          <div class="muted pad" role="status">
            <p>No version matches{query.trim() ? ` “${query.trim()}”` : ""}.</p>
            {#if unchecked > 0}<p>Still looking through the files of {unchecked} versions…</p>{/if}
            {#if hasMore}<p>Older versions match once they are listed.</p>{/if}
          </div>
        {:else}
          {#each days as day (day.key)}
            <h2 class="day">{day.label}</h2>
            <ul>
              {#each day.rows as row (row.key)}
                {#if row.kind === "session"}{@render sessionRow(row)}{:else}{@render versionRow(row.entry)}{/if}
              {/each}
            </ul>
          {/each}
        {/if}
        {#if hasMore && !error && entries.length > 0}
          <button class="app-btn app-btn-ghost older" onclick={loadOlder} disabled={loadingOlder}>{loadingOlder ? "Listing…" : "Show older versions"}</button>
          {#if olderError}<p class="error pad" role="alert">Couldn't list older versions. {olderError}</p>{/if}
        {/if}
        {#if logFilePath}
          <button class="link tech" onclick={() => void showLog()}>Technical details</button>
        {/if}
      </div>
      <p class="keys" aria-hidden="true"><kbd><Icon name="chevron-up" size={10} /></kbd><kbd><Icon name="chevron-down" size={10} /></kbd> versions · <kbd><Icon name="chevron-left" size={10} /></kbd><kbd><Icon name="chevron-right" size={10} /></kbd> files · <kbd>Alt</kbd>+<kbd><Icon name="chevron-down" size={10} /></kbd> next change</p>
    </nav>
    <button class="scrim" aria-label="Hide the versions" tabindex="-1" onclick={() => (drawerOpen = false)}></button>

    <div class="vh-detail">
      {#if view === "log"}
        <div class="dhead">
          <div><h2>Technical details</h2><p class="meta">The log of this book's recent sending online.</p></div>
          <button class="app-btn app-btn-ghost" onclick={() => (view = "changes")}>Back to the version</button>
        </div>
        <pre class="log">{logContent ?? "Loading…"}</pre>
      {:else if selected}
        <div class="dhead">
          <div class="dtitle">
            <h2>{versionTitle(selected.message)}</h2>
            <p class="meta">
              {when(selected.timestamp)}{selected.author ? ` · ${selected.author}` : ""}
              {#if selectedOnline}
                <span class="badge local"><Icon name="cloud" size={11} /> Online, not on this computer yet</span>
              {:else if selected.backedUp === true}
                <span class="badge"><Icon name="cloud" size={11} /> Online</span>
              {:else if selected.backedUp === false}
                <span class="badge local"><Icon name="cloud-off" size={11} /> Only on this computer</span>
              {/if}
            </p>
          </div>
          <div class="restore">
            <button
              class="app-btn app-btn-ghost"
              aria-expanded={confirming}
              disabled={selectedOnline}
              title={selectedOnline ? "Get this version onto this computer first" : undefined}
              onclick={() => (confirming = !confirming)}
            >Restore the whole book to this version…</button>
            {#if confirming}
              <div class="confirm" role="group" aria-label="Restore the whole book to this version?">
                <p><strong>Restore the whole book to this version?</strong></p>
                <p>Every file goes back to how it was on {when(selected.timestamp)}. Your current work is saved as a version first.</p>
                {#if restoreError}<p class="error-text" role="alert">{restoreError}</p>{/if}
                <div class="confirm-actions">
                  <button class="app-btn app-btn-ghost" onclick={() => (confirming = false)} disabled={restoring}>Cancel</button>
                  <button class="app-btn app-btn-primary" onclick={() => void restore()} disabled={restoring}>{restoring ? "Restoring…" : "Restore the whole book"}</button>
                </div>
              </div>
            {/if}
          </div>
        </div>
        {#if restored}
          <p class="restored" role="status">
            <Icon name="circle-check" size={15} /> <span>{restored}</span>
            <button class="link" onclick={() => (restored = null)}>Dismiss</button>
          </p>
        {/if}

        <div class="files" role="group" aria-label="Changed files">
          {#if changes}
            {#each changes.files as change (change.path)}
              <button
                class="file"
                class:on={view === "changes" && change.path === openPath}
                aria-pressed={view === "changes" && change.path === openPath}
                title={change.path}
                onclick={() => { wanted = change.path; view = "changes"; }}
              >
                {#if !change.text}<Icon name="image" size={13} />{/if}
                {change.path} <span class="n">{shortHint(change.hint)}</span>
              </button>
            {/each}
            {#if changes.more}<span class="more">and {changes.more} more</span>{/if}
          {:else if !changesError}
            <span class="file bone-chip" aria-hidden="true"></span><span class="file bone-chip" aria-hidden="true"></span>
          {/if}
        </div>

        <div class="tabs" role="tablist" aria-label="Show">
          <button role="tab" aria-selected={view === "changes"} class:active={view === "changes"} onclick={() => (view = "changes")}>Changes</button>
          <button role="tab" aria-selected={view === "pages"} class:active={view === "pages"} disabled={!local} onclick={() => void showPages()}>Pages</button>
        </div>

        {#if view === "pages"}
          <div class="pages">
            {#if pagesUrl}
              {#key pagesUrl}
                <PreviewFrame url={pagesUrl} onClientReady={(c: PreviewClient) => c.setExpectedOrigin(pagesUrl ?? undefined)} />
              {/key}
            {:else if pagesError}
              <p class="error pad" role="alert">Couldn't show this version's pages. {pagesError} <button class="link" onclick={() => { pagesFor = null; void showPages(); }}>Try again</button></p>
            {:else}
              <p class="muted pad">Getting this version's pages ready…</p>
            {/if}
          </div>
        {:else if changesError}
          <p class="error pad" role="alert">Couldn't list what this version changed. {changesError} <button class="link" onclick={() => void select(selected)}>Try again</button></p>
        {:else if changes && changes.files.length === 0}
          <p class="muted pad">This version changed nothing.</p>
        {:else if changes && openPath && local}
          {#key `${selected.id}:${openPath}`}
            <VersionCompareView {projectDir} id={selected.id} path={openPath} />
          {/key}
        {:else if changes && selectedOnline}
          <p class="muted pad">
            {fileName(openPath ?? "")} can be compared once this version is on this computer.
            {#if onGetLatest}<button class="link" onclick={() => void getThem()} disabled={getting}>Get them</button>{/if}
          </p>
        {/if}
      {:else if !loading && entries.length > 0}
        <p class="muted pad">Choose a version to see what it changed.</p>
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
    display: flex; align-items: center; gap: 12px;
    padding: 12px 20px; background: var(--app-surface); border-bottom: 1px solid var(--app-border);
  }
  .vh-head h1 { flex: 1; margin: 0; display: inline-flex; align-items: center; gap: 8px; font-size: 17px; font-weight: 700; }
  .vh-icon { display: inline-flex; align-items: center; gap: 6px; padding: 5px; border: 0; border-radius: 6px; background: none; font: inherit; font-size: 13px; color: var(--app-text-secondary); cursor: pointer; }
  .vh-icon:hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .vh-icon:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .drawer-toggle { display: none; }

  .vh-body { position: relative; flex: 1; min-height: 0; display: grid; grid-template-columns: 340px minmax(0, 1fr); }

  /* ── The list ── */
  .vh-list { display: flex; flex-direction: column; min-height: 0; background: var(--app-surface); border-right: 1px solid var(--app-border); }
  .vh-list ul { list-style: none; margin: 0; padding: 0; }
  .find { display: flex; flex-direction: column; gap: 8px; padding: 12px 12px 10px; border-bottom: 1px solid var(--app-border-subtle); }
  .find input {
    width: 100%; box-sizing: border-box; padding: 7px 10px; font: inherit; font-size: 13px;
    border: 1px solid var(--app-field-border); border-radius: 6px; background: var(--app-bg); color: var(--app-text);
  }
  .find input:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .chips button {
    padding: 3px 10px; font: inherit; font-size: 12px; border: 1px solid var(--app-border); border-radius: 999px;
    background: none; color: var(--app-text-secondary); cursor: pointer;
  }
  .chips button:hover { background: var(--app-surface-hover); }
  .chips button.on { background: var(--app-accent-subtle); border-color: var(--app-accent-border); color: var(--app-text); font-weight: 600; }
  .chips button:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .vh-scroll { flex: 1; min-height: 0; overflow-y: auto; padding-bottom: 12px; }

  .banner {
    display: flex; align-items: center; gap: 4px; margin: 10px 12px 2px; padding: 4px 6px 4px 4px; border-radius: 8px;
    background: var(--app-info-bg); border: 1px solid var(--app-info-border); color: var(--app-info-text); font-size: 12.5px;
  }
  .banner-toggle {
    flex: 1; min-width: 0; display: flex; align-items: center; gap: 6px; padding: 5px 6px; border: 0; border-radius: 6px;
    background: none; font: inherit; color: inherit; text-align: left; cursor: pointer;
  }
  .banner-toggle :global(svg) { flex-shrink: 0; }
  .get { flex-shrink: 0; padding: 4px 8px; border: 0; border-radius: 5px; background: none; font: inherit; font-weight: 600; color: var(--app-link); cursor: pointer; }
  .banner-toggle:hover, .get:hover:not(:disabled) { background: var(--app-surface-hover); }
  .banner-toggle:focus-visible, .get:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .get:disabled { opacity: 0.6; cursor: default; }
  .online { margin: 4px 0 6px; border-bottom: 1px solid var(--app-border-subtle); }

  .day { margin: 0; padding: 14px 16px 4px; font-size: 11px; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--app-text-muted); }
  .row {
    display: grid; grid-template-columns: 16px minmax(0, 1fr) auto; column-gap: 6px; line-height: 1.4; row-gap: 1px; align-items: baseline;
    width: 100%; padding: 6px 14px 6px 13px; border: 0; border-left: 3px solid transparent; background: none;
    font: inherit; font-size: 13px; text-align: left; color: var(--app-text); cursor: pointer;
  }
  .row:hover { background: var(--app-surface-hover); }
  .row:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .row.selected, .row.session.holds { background: var(--app-accent-subtle); }
  .row.selected { border-left-color: var(--app-accent); }
  .row.session.holds { border-left-color: var(--app-accent); }
  .ic { display: inline-flex; align-self: start; align-items: center; justify-content: center; height: 1.4em; color: var(--app-text-muted); }
  .named .ic { color: var(--app-warning-text); }
  .t { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .session .t { font-weight: 500; }
  .tm { font-size: 12px; color: var(--app-text-muted); font-variant-numeric: tabular-nums; white-space: nowrap; }
  /* One line kept whether or not the files have loaded, so a row never grows when they arrive. */
  .f { grid-column: 2 / 4; min-height: 1.4em; font-size: 12px; line-height: 1.4; color: var(--app-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .local { margin-left: 4px; color: var(--app-info-text); }
  .local :global(svg) { vertical-align: -1px; }
  .row.sub { grid-template-columns: minmax(0, 1fr) auto; padding-left: 37px; }
  .row.sub .t { font-weight: 400; }
  .row.sub.selected .t { font-weight: 600; }
  .skeleton { cursor: default; }
  .skeleton:hover { background: none; }
  .bone { display: inline-block; height: 0.8em; border-radius: 3px; background: var(--app-surface-sunken); vertical-align: middle; }
  .older { display: block; margin: 12px 16px 0; }
  .tech { display: block; margin: 14px 16px 0; }
  .keys { margin: 0; padding: 8px 14px; border-top: 1px solid var(--app-border-subtle); font-size: 11.5px; color: var(--app-text-muted); }
  kbd { display: inline-flex; align-items: center; min-height: 13px; margin-right: 1px; padding: 0 2px; font: 10.5px var(--app-font-mono); vertical-align: -2px; border: 1px solid var(--app-border); border-radius: 3px; background: var(--app-bg); }
  .scrim { display: none; }

  /* ── The selected version ── */
  .vh-detail { min-width: 0; min-height: 0; display: flex; flex-direction: column; }
  .dhead {
    display: flex; align-items: flex-start; justify-content: space-between; gap: 16px;
    padding: 14px 20px 10px; background: var(--app-surface);
  }
  .dhead h2 { margin: 0; font-size: 16px; font-weight: 600; overflow-wrap: anywhere; }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin: 3px 0 0; font-size: 12.5px; color: var(--app-text-muted); }
  .badge {
    display: inline-flex; align-items: center; gap: 4px; padding: 1px 8px; border-radius: 999px; font-size: 11.5px; font-weight: 600;
    background: var(--app-success-bg); border: 1px solid var(--app-success-border); color: var(--app-success-text);
  }
  .badge.local { background: var(--app-info-bg); border-color: var(--app-info-border); color: var(--app-info-text); }
  .restore { position: relative; flex-shrink: 0; }
  .restore > .app-btn { font: inherit; font-size: 12.5px; border-radius: 6px; }
  /* Over the content, not above it: asking never moves the page. */
  .confirm {
    position: absolute; top: calc(100% + 6px); right: 0; z-index: var(--app-z-popover); width: 340px; padding: 12px 14px;
    border: 1px solid var(--app-border); border-radius: 8px; background: var(--app-surface-raised); box-shadow: var(--app-shadow-lg);
    font-size: 13px; color: var(--app-text-secondary);
  }
  .confirm p { margin: 0 0 8px; line-height: 1.45; }
  .confirm strong { color: var(--app-text); }
  .confirm-actions { display: flex; justify-content: flex-end; gap: 8px; }
  .confirm .app-btn { font: inherit; font-size: 12.5px; }
  .error-text { color: var(--app-error-text); }
  .restored {
    display: flex; align-items: center; gap: 8px; margin: 0; padding: 9px 20px;
    font-size: 13px; color: var(--app-success-text); background: var(--app-success-bg);
  }
  .restored span { flex: 1; }
  .restored :global(svg) { flex-shrink: 0; color: var(--app-success-strong); }
  .restored .link { color: inherit; }

  .files { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-height: 30px; padding: 0 20px 12px; background: var(--app-surface); border-bottom: 1px solid var(--app-border); }
  .file {
    display: inline-flex; align-items: center; gap: 6px; max-width: 320px; padding: 4px 10px; font: inherit; font-size: 12.5px;
    border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-bg); color: var(--app-text);
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer;
  }
  .file:hover { background: var(--app-surface-hover); }
  .file.on { border-color: var(--app-accent); background: var(--app-accent-subtle); font-weight: 600; }
  .file:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .file :global(svg) { flex-shrink: 0; color: var(--app-text-muted); }
  .file .n { font-weight: 400; color: var(--app-text-muted); }
  .bone-chip { width: 120px; height: 28px; box-sizing: border-box; background: var(--app-surface-sunken); border-color: transparent; cursor: default; }
  .more { font-size: 12.5px; color: var(--app-text-muted); }
  .tabs { display: flex; gap: 2px; padding: 0 20px; background: var(--app-surface); border-bottom: 1px solid var(--app-border); }
  .tabs button {
    padding: 9px 12px; border: 0; border-bottom: 2px solid transparent; background: none;
    font: inherit; font-size: 13px; color: var(--app-text-muted); cursor: pointer;
  }
  .tabs button.active { color: var(--app-text); font-weight: 600; border-bottom-color: var(--app-accent); }
  .tabs button:disabled { opacity: 0.5; cursor: default; }
  .tabs button:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: -2px; }
  .pages { flex: 1; min-height: 0; display: flex; background: var(--app-surface-sunken); }
  .pages :global(iframe) { flex: 1; width: 100%; height: 100%; border: 0; }
  .log { flex: 1; margin: 16px 20px; padding: 12px; overflow: auto; white-space: pre-wrap; font-size: 11.5px; background: var(--app-surface); border: 1px solid var(--app-border); border-radius: 6px; }

  .muted { margin: 0; font-size: 12.5px; color: var(--app-text-muted); }
  .muted p { margin: 0 0 4px; }
  .pad { padding: 14px 20px; }
  .error { margin: 0; font-size: 12.5px; color: var(--app-error-text); }
  .link { padding: 0; border: 0; background: none; font: inherit; font-size: 12.5px; color: var(--app-link); cursor: pointer; text-decoration: underline; text-underline-offset: 2px; }

  /* ── Narrow: the list is a drawer over the version ── */
  @media (max-width: 999px) {
    .drawer-toggle { display: inline-flex; }
    .vh-body { grid-template-columns: minmax(0, 1fr); }
    .vh-list {
      position: absolute; inset: 0 auto 0 0; z-index: 2; width: min(340px, 88vw);
      box-shadow: var(--app-shadow-lg); visibility: hidden; transform: translateX(-100%);
    }
    .drawer-open .vh-list { visibility: visible; transform: none; }
    .drawer-open .scrim { display: block; position: absolute; inset: 0; z-index: 1; border: 0; background: var(--app-backdrop); }
  }
  @media (max-width: 999px) and (prefers-reduced-motion: no-preference) {
    .vh-list { transition: transform 160ms ease-out, visibility 160ms; }
  }
</style>

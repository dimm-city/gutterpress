<script lang="ts">
  /**
   * ProjectsListBody — the reusable list body for browsing/opening projects.
   * Extracted from OpenLocationDialog for composition into the left panel's
   * Projects tab and for direct use in the dialog itself.
   *
   * Owns: recents/favorites/discovered data, filter, DISCOVERED_CAP, keyboard nav.
   * The parent passes callback props for actions so this component is purely
   * presentational with data-loading.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { basenameOf } from "$lib/platform/paths";
  import { api } from "$lib/api";

  // #49: recents/favorites are FolderRef-shaped (key + precomputed displayName)
  // in the app-facing contract. Discovered projects still come back path-keyed
  // from the host scan (a raw filesystem path is the right unit there).
  type RecentFolder = {
    key: string;
    displayName: string;
    title: string;
    openedAt: string;
    exists: boolean;
    /** C2: absolute folder of the last-active book, for a repo-backed entry. */
    lastActiveBook?: string;
  };
  type FavoriteFolder = { key: string; displayName: string; title: string; exists: boolean };
  type DiscoveredProject = { path: string; title: string };

  let {
    onChosen,
    onOpenUrl,
    onOpenGitHub,
    onNewProject,
    onBrowse,
    currentProjectPath = null,
    currentProjectDisplayName = null,
    filterInput = "",
    compact = false,
  }: {
    /** Called when the user selects a folder path to open. */
    onChosen?: (path: string) => void;
    /** Called when user submits a URL. */
    onOpenUrl?: (url: string) => void;
    /** Hand off to the GitHub connect flow. */
    onOpenGitHub?: () => void;
    /** Hand off to the new-project wizard. */
    onNewProject?: () => void;
    /** Trigger a native folder picker and call onChosen with the result. */
    onBrowse?: () => void;
    /** Currently open project, when this list is hosted inside the workspace panel. */
    currentProjectPath?: string | null;
    currentProjectDisplayName?: string | null;
    /** External filter text (e.g. from a search input in the parent). */
    filterInput?: string;
    /** Compact layout for use inside a panel tab (no outer padding). */
    compact?: boolean;
  } = $props();

  let location = $state("");
  let error = $state<string | null>(null);
  let recents = $state<RecentFolder[]>([]);
  let favorites = $state<FavoriteFolder[]>([]);
  let discovered = $state<DiscoveredProject[]>([]);
  let loading = $state(false);
  let locationInput = $state<HTMLInputElement | undefined>(undefined);
  let containerEl = $state<HTMLDivElement | undefined>(undefined);

  let focusedRowIndex = $state<number | null>(null);

  export async function reload() {
    await loadLists();
  }

  async function loadLists() {
    if (!isDesktop()) return;
    loading = true;
    try {
      const [rawR, rawF] = await Promise.all([
        api.app.getRecentFolders(),
        api.app.getFavorites(),
      ]);
      recents = rawR.map((r) => ({
        key: r.path,
        displayName: basenameOf(r.path),
        title: r.title,
        openedAt: (r as { openedAt?: string }).openedAt ?? '',
        exists: r.exists,
        lastActiveBook: r.lastActiveBook,
      }));
      favorites = rawF.map((f) => ({
        key: f.path,
        displayName: basenameOf(f.path),
        title: f.title,
        exists: f.exists,
      }));
    } catch {
      // non-fatal
    } finally {
      loading = false;
    }
    // Background scan — non-blocking
    if (isDesktop()) {
      api.app
        .discoverProjects()
        .then((r) => { discovered = r as typeof discovered; })
        .catch(() => {});
    }
  }

  // Load on mount
  onMount(() => {
    void loadLists();
  });

  function isUrl(val: string): boolean {
    try {
      const u = new URL(val.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  function isLiteralPath(val: string): boolean {
    const v = val.trim();
    if (!v) return false;
    return v.startsWith("/") || v.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(v);
  }

  // Combine external filter and local input
  let effectiveFilter = $derived.by<string>(() => {
    const ext = filterInput.trim().toLowerCase();
    const loc = location.trim().toLowerCase();
    // If location looks like a path/URL, don't use it as a filter term
    if (loc && !isLiteralPath(location) && !isUrl(location)) return loc;
    return ext;
  });

  function matchesFilter(path: string, title: string, term: string): boolean {
    if (!term) return true;
    return path.toLowerCase().includes(term) || (title ?? "").toLowerCase().includes(term);
  }

  let currentProject = $derived.by<
    { key: string; displayName: string } | null
  >(() => {
    if (!currentProjectPath) return null;
    const displayName = currentProjectDisplayName ?? basenameOf(currentProjectPath);
    if (!matchesFilter(currentProjectPath, displayName, effectiveFilter)) return null;
    return { key: currentProjectPath, displayName };
  });

  let filteredFavorites = $derived(
    favorites.filter((f) => matchesFilter(f.key, f.title, effectiveFilter))
  );
  let filteredRecents = $derived(
    recents.filter((r) => matchesFilter(r.key, r.title, effectiveFilter))
  );

  const DISCOVERED_CAP = 8;
  // expandedForFilter: the effectiveFilter value at the time the user clicked
  // "Show all". When the filter changes, this no longer matches effectiveFilter
  // and the list collapses again — no $effect needed.
  let expandedForFilter = $state<string | null>(null);

  let filteredDiscovered = $derived.by<DiscoveredProject[]>(() => {
    // #49: dedup discovered against recents/favorites by FolderRef.key.
    const shown = new Set<string>([
      ...filteredFavorites.map((f) => f.key),
      ...filteredRecents.map((r) => r.key),
    ]);
    return discovered.filter(
      (d) => !shown.has(d.path) && matchesFilter(d.path, d.title, effectiveFilter)
    );
  });

  // Expanded only when the user explicitly expanded FOR the current filter.
  let discoveredExpanded = $derived(expandedForFilter === effectiveFilter);

  let visibleDiscovered = $derived(
    discoveredExpanded ? filteredDiscovered : filteredDiscovered.slice(0, DISCOVERED_CAP)
  );

  // #49: `path` here is the host-neutral key (a FolderRef.key for recents /
  // favorites, the raw scan path for discovered) — the unit openRow/onChosen
  // and keyboard nav operate on.
  let allRows = $derived.by<
    Array<{ path: string; title: string; exists: boolean; isFavorite: boolean }>
  >(() => {
    const favRows = filteredFavorites.map((f) => ({
      path: f.key, title: f.title, exists: f.exists, isFavorite: true,
    }));
    const recentRows = filteredRecents.map((r) => ({
      path: r.key, title: r.title, exists: r.exists, isFavorite: false,
    }));
    const discoveredRows = visibleDiscovered.map((d) => ({
      path: d.path, title: d.title, exists: true, isFavorite: false,
    }));
    return [...favRows, ...recentRows, ...discoveredRows];
  });

  let canSubmitLocation = $derived.by<boolean>(() => {
    const v = location.trim();
    if (!v) return false;
    if (isLiteralPath(v) || isUrl(v)) return true;
    return allRows.length > 0;
  });

  function isFavorited(key: string): boolean {
    return favorites.some((f) => f.key === key);
  }

  async function openRow(path: string) {
    onChosen?.(path);
  }

  async function removeRecent(path: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    await api.app.removeRecent(path).catch(() => {});
    await loadLists();
  }

  async function toggleFavorite(path: string, title: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    await api.app.toggleFavorite(path, title).catch(() => {});
    await loadLists();
  }

  async function submitLocation() {
    const trimmed = location.trim();
    if (!trimmed) {
      error = "Enter a folder path or web address.";
      return;
    }
    error = null;
    if (isUrl(trimmed)) {
      onOpenUrl?.(trimmed);
      location = "";
      return;
    }
    if (isLiteralPath(trimmed)) {
      onChosen?.(trimmed);
      location = "";
      return;
    }
    const first = allRows[0];
    if (first) {
      onChosen?.(first.path);
      location = "";
    } else {
      error = "No matching projects. Type a folder path or web address.";
    }
  }

  async function handleBrowse() {
    if (onBrowse) {
      onBrowse();
      return;
    }
    if (!isDesktop()) return;
    const pathStr = await api.dialog.openDirectory();
    if (!pathStr) return;
    onChosen?.(pathStr);
  }

  function onListKeydown(e: KeyboardEvent, rowIndex: number, path: string) {
    if ((e.target as HTMLElement)?.closest(".row-actions")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusedRowIndex = Math.min(rowIndex + 1, allRows.length - 1);
      const rows = containerEl?.querySelectorAll<HTMLElement>(".list-row");
      rows?.[focusedRowIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rowIndex === 0) {
        locationInput?.focus();
        focusedRowIndex = null;
      } else {
        focusedRowIndex = rowIndex - 1;
        const rows = containerEl?.querySelectorAll<HTMLElement>(".list-row");
        rows?.[focusedRowIndex]?.focus();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const row = allRows[rowIndex];
      if (row?.exists !== false) void openRow(path);
    }
  }
</script>

<div class="projects-body" class:compact bind:this={containerEl}>
  <!-- Address/filter input -->
  <div class="input-section">
    <div class="input-with-browse">
      <input
        bind:this={locationInput}
        bind:value={location}
        type="text"
        class="location-input"
        placeholder="Folder path or web address…"
        spellcheck="false"
        autocomplete="off"
        aria-label="Folder path or web address"
        onkeydown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); void submitLocation(); }
          else if (e.key === "ArrowDown" && allRows.length > 0) {
            e.preventDefault();
            focusedRowIndex = 0;
            const rows = containerEl?.querySelectorAll<HTMLElement>(".list-row");
            rows?.[0]?.focus();
          }
        }}
      />
      <button class="browse-btn" onclick={handleBrowse} title="Browse for a folder" aria-label="Browse for folder">
        <Icon name="folder-open" size={14} />
      </button>
      {#if canSubmitLocation}
        <button class="open-btn primary" onclick={submitLocation} aria-label="Open typed path">Open</button>
      {/if}
    </div>
    {#if error}
      <p class="input-error" role="alert">{error}</p>
    {/if}
  </div>

  <!-- Scrollable list region -->
  <div class="lists">
    {#if currentProject}
      <section class="list-section">
        <h3 class="list-heading">Currently open</h3>
        <div class="current-project-row" title={currentProject.key}>
          <span class="row-icon" aria-hidden="true"><Icon name="folder-open" size={13} /></span>
          <span class="row-info">
            <span class="row-title">{currentProject.displayName}</span>
            <span class="row-path">{currentProject.key}</span>
          </span>
          <span class="current-project-badge">Open</span>
        </div>
      </section>
    {/if}

    {#if filteredFavorites.length > 0}
      <section class="list-section">
        <h3 class="list-heading">Favorites</h3>
        <ul class="list" aria-label="Favorite folders">
          {#each filteredFavorites as fav, i}
            <!-- row-actions are SIBLINGS of the role="button" row, never
                 descendants: ARIA buttons have presentational children, so
                 nested buttons lose their semantics for AT (judge gate). -->
            <li class="list-item">
              <div
                class="list-row"
                class:dimmed={!fav.exists}
                tabindex={fav.exists ? 0 : -1}
                role="button"
                aria-disabled={!fav.exists}
                onclick={() => fav.exists && openRow(fav.key)}
                onkeydown={(e) => onListKeydown(e, i, fav.key)}
                title={fav.exists ? fav.key : `${fav.key} (folder not found)`}
              >
                <span class="row-icon" aria-hidden="true"><Icon name="star" size={13} /></span>
                <span class="row-info">
                  <span class="row-title">{fav.title || fav.displayName}</span>
                  <span class="row-path">{fav.key}</span>
                </span>
                {#if !fav.exists}
                  <span class="not-found-badge">Not found</span>
                {/if}
              </div>
              <div class="row-actions">
                <button class="icon-action star active" title="Remove from favorites" aria-label="Remove from favorites"
                  onclick={(e) => toggleFavorite(fav.key, fav.title, e)}><Icon name="star" size={13} /></button>
              </div>
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    {#if !effectiveFilter || filteredRecents.length > 0}
      <section class="list-section">
        <h3 class="list-heading">Recently opened</h3>
        {#if filteredRecents.length > 0}
          <ul class="list" aria-label="Recently opened folders">
            {#each filteredRecents as recent, i}
              {@const rowIndex = filteredFavorites.length + i}
              {@const favorited = isFavorited(recent.key)}
              <!-- C2: `key` (repo root for repo-backed entries) is the identity
                   used for favorite/remove; `openPath` — the last-active book
                   when recorded, else `key` — is what actually opens. -->
              {@const openPath = recent.lastActiveBook ?? recent.key}
              <li class="list-item">
                <div
                  class="list-row"
                  class:dimmed={!recent.exists}
                  tabindex={recent.exists ? 0 : -1}
                  role="button"
                  aria-disabled={!recent.exists}
                  onclick={() => recent.exists && openRow(openPath)}
                  onkeydown={(e) => onListKeydown(e, rowIndex, openPath)}
                  title={recent.exists ? recent.key : `${recent.key} (folder not found)`}
                >
                  <span class="row-icon" aria-hidden="true"><Icon name="folder" size={13} /></span>
                  <span class="row-info">
                    <span class="row-title">{recent.title || recent.displayName}</span>
                    <span class="row-path">{recent.key}</span>
                  </span>
                  {#if !recent.exists}
                    <span class="not-found-badge">Not found</span>
                  {/if}
                </div>
                <div class="row-actions">
                  <button class="icon-action star" class:active={favorited}
                    title={favorited ? "Remove from favorites" : "Add to favorites"}
                    aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                    onclick={(e) => toggleFavorite(recent.key, recent.title, e)}><Icon name="star" size={13} /></button>
                  <button class="icon-action remove" title="Remove from recently opened" aria-label="Remove from recently opened"
                    onclick={(e) => removeRecent(recent.key, e)}><Icon name="x" size={14} /></button>
                </div>
              </li>
            {/each}
          </ul>
        {:else if !loading}
          <p class="empty-section-hint">No recent projects yet. Open a folder to get started.</p>
        {/if}
      </section>
    {/if}

    {#if filteredDiscovered.length > 0}
      <section class="list-section">
        <h3 class="list-heading">
          Discovered
          {#if filteredDiscovered.length > DISCOVERED_CAP}
            <span class="list-heading-count">({filteredDiscovered.length})</span>
          {/if}
        </h3>
        <ul class="list" aria-label="Discovered projects">
          {#each visibleDiscovered as proj, i}
            {@const rowIndex = filteredFavorites.length + filteredRecents.length + i}
            <li class="list-item">
              <div
                class="list-row"
                tabindex="0"
                role="button"
                onclick={() => openRow(proj.path)}
                onkeydown={(e) => onListKeydown(e, rowIndex, proj.path)}
                title={proj.path}
              >
                <span class="row-icon" aria-hidden="true"><Icon name="search" size={13} /></span>
                <span class="row-info">
                  <span class="row-title">{proj.title || basenameOf(proj.path)}</span>
                  <span class="row-path">{proj.path}</span>
                </span>
              </div>
              <div class="row-actions">
                <button class="icon-action star" title="Add to favorites" aria-label="Add to favorites"
                  onclick={(e) => toggleFavorite(proj.path, proj.title, e)}><Icon name="star" size={13} /></button>
              </div>
            </li>
          {/each}
        </ul>
        {#if filteredDiscovered.length > DISCOVERED_CAP}
          <button class="show-all-btn" onclick={() => (expandedForFilter = discoveredExpanded ? null : effectiveFilter)}>
            {discoveredExpanded ? "Show fewer" : `Show all ${filteredDiscovered.length} discovered`}
          </button>
        {/if}
      </section>
    {/if}

    {#if !loading && allRows.length === 0 && effectiveFilter}
      <p class="empty-hint">No projects match "{effectiveFilter}".</p>
    {/if}
  </div>

  <!-- Actions footer -->
  <div class="actions-footer">
    {#if onOpenGitHub}
      <button class="footer-action" onclick={onOpenGitHub} title="Open a project from GitHub">
        <Icon name="github" size={14} /> Open from GitHub
      </button>
    {/if}
    {#if onNewProject}
      <button class="footer-action primary" onclick={onNewProject} title="Create a new book project">
        <Icon name="plus" size={14} /> New project
      </button>
    {/if}
  </div>
</div>

<style>
  .projects-body {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }
  .input-section {
    flex-shrink: 0;
    padding: 8px 10px 6px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .projects-body.compact .input-section {
    padding: 6px 8px 5px;
  }
  .input-with-browse {
    display: flex;
    gap: 4px;
    align-items: stretch;
  }
  .location-input {
    flex: 1;
    min-width: 0;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 6px 8px;
    border-radius: 5px;
    font-size: 12px;
    font-family: ui-monospace, monospace;
  }
  .location-input:focus {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -1px;
    border-color: var(--app-focus-ring);
  }
  .browse-btn {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 5px 8px;
    border-radius: 5px;
    font-size: 12px;
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    color: var(--app-control-text);
    cursor: pointer;
    min-width: 28px;
    min-height: 28px;
  }
  .browse-btn:hover {
    background: var(--app-control-hover-bg);
    border-color: var(--app-control-hover-border);
  }
  .browse-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .open-btn {
    flex-shrink: 0;
    padding: 5px 10px;
    border-radius: 5px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    background: var(--app-accent);
    border: 1px solid var(--app-accent-border);
    color: var(--app-accent-text);
    min-height: 28px;
  }
  .open-btn:hover {
    background: var(--app-accent-hover);
  }
  .open-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .input-error {
    margin: 4px 0 0;
    font-size: 11px;
    color: var(--app-error-text);
  }
  .lists {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 8px 6px;
  }
  .list-section { display: flex; flex-direction: column; gap: 3px; }
  .list-heading {
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--app-text-muted);
    margin: 0;
    padding: 0 2px;
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .list-heading-count { font-weight: 500; letter-spacing: 0; text-transform: none; font-size: 10px; color: var(--app-text-faint); }
  .empty-section-hint { font-size: 11px; color: var(--app-text-faint); margin: 2px 0 0 2px; font-style: italic; }
  .show-all-btn {
    background: none; border: none; cursor: pointer;
    font-size: 11px; color: var(--app-link); padding: 3px 2px; text-align: left; border-radius: 3px;
  }
  .show-all-btn:hover { text-decoration: underline; }
  .show-all-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 1px; }
  /* row-actions are SIBLINGS of the role="button" row (ARIA: buttons have
     presentational children). The li is the visual row container. */
  .list-item { display: flex; align-items: center; gap: 2px; }
  .list-item > .list-row { flex: 1; min-width: 0; }
  .list-row {
    display: flex; align-items: center; gap: 8px;
    padding: 6px 8px; border-radius: 5px; cursor: pointer;
    border: 1px solid transparent; transition: background 0.1s;
  }
  .current-project-row {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 5px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-sunken);
  }
  .list-row:not(.dimmed):hover,
  .list-row:not(.dimmed):focus-visible {
    background: var(--app-surface-sunken); border-color: var(--app-border); outline: none;
  }
  .list-row:not(.dimmed):focus-visible { border-color: var(--app-focus-ring); }
  /* Dimmed = folder not found. Use explicit full-opacity muted colors for legibility;
     opacity dimming makes text fail WCAG AA on hover surfaces. Only the icon is dimmed.
     The border-left color-coding reuses the same found/missing differentiator pattern
     as HelpDialog's tool-status list (`.tools li.missing`), so unavailable rows read as
     unavailable from the non-text cue alone, independent of the "Not found" badge text. */
  .list-row.dimmed {
    cursor: default;
    border-left-width: 3px;
    border-left-color: var(--app-warning-text);
    padding-left: 6px;
  }
  .list-row.dimmed .row-title { color: var(--app-text-muted); }
  .list-row.dimmed .row-icon { opacity: 0.45; }
  .row-icon { font-size: 13px; flex-shrink: 0; width: 16px; text-align: center; display: inline-flex; align-items: center; color: var(--app-text-faint); }
  .row-info { flex: 1; display: flex; flex-direction: column; gap: 1px; min-width: 0; }
  .row-title { font-size: 12px; font-weight: 500; color: var(--app-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row-path { font-size: 10px; color: var(--app-text-faint); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-family: ui-monospace, monospace; }
  /* Fixed-width status label, laid out OUTSIDE the ellipsis-truncated .row-path span so
     it survives regardless of path length (visual-gate round 1 finding). */
  .not-found-badge {
    flex-shrink: 0;
    font-size: 9px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    color: var(--app-warning-text);
    background: var(--app-warning-bg);
    border: 1px solid var(--app-warning-border);
    border-radius: 4px;
    padding: 2px 6px;
    white-space: nowrap;
  }
  .current-project-badge {
    flex-shrink: 0;
    font-size: 10px;
    font-weight: 600;
    color: var(--app-accent-text);
    background: var(--app-accent);
    border: 1px solid var(--app-accent-border);
    border-radius: 999px;
    padding: 2px 7px;
  }
  .row-actions { display: flex; gap: 3px; align-items: center; flex-shrink: 0; opacity: 0; transition: opacity 0.1s; }
  .list-item:hover .row-actions, .list-item:focus-within .row-actions { opacity: 1; }
  .icon-action {
    background: transparent; border: 0; cursor: pointer;
    min-width: 24px; min-height: 24px; padding: 2px 4px; border-radius: 3px;
    font-size: 13px; line-height: 1; color: var(--app-text-faint); transition: color 0.1s;
  }
  .icon-action:hover { background: var(--app-surface-hover); }
  .icon-action:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .icon-action.star { color: var(--app-text-faint); }
  .icon-action.star:hover, .icon-action.star.active { color: var(--app-star); }
  .icon-action.remove:hover { color: var(--app-error-text); }
  .empty-hint { font-size: 12px; color: var(--app-text-faint); margin: 4px 0; text-align: center; }
  .actions-footer {
    flex-shrink: 0;
    display: flex;
    gap: 6px;
    padding: 6px 10px;
    border-top: 1px solid var(--app-border-subtle);
    flex-wrap: wrap;
  }
  .footer-action {
    display: inline-flex; align-items: center; gap: 5px;
    padding: 5px 10px; border-radius: 5px; font-size: 12px;
    cursor: pointer; background: var(--app-control-bg);
    border: 1px solid var(--app-control-border); color: var(--app-control-text);
  }
  .footer-action:hover { background: var(--app-control-hover-bg); }
  .footer-action:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .footer-action.primary {
    background: var(--app-accent); border-color: var(--app-accent-border);
    color: var(--app-accent-text); font-weight: 600;
  }
  .footer-action.primary:hover { background: var(--app-accent-hover); }
</style>

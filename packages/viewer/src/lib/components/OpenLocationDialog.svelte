<script lang="ts">
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform, isDesktop } from "$lib/platform";

  type RecentFolder = { path: string; title: string; openedAt: string; exists: boolean };
  type FavoriteFolder = { path: string; title: string; exists: boolean };
  type DiscoveredProject = { path: string; title: string };

  let {
    open = $bindable(false),
    onOpenFolder,
    onOpenUrl,
    onOpenGitHub,
    triggerEl,
  }: {
    open?: boolean;
    onOpenFolder?: (path: string) => void;
    onOpenUrl?: (url: string) => void;
    /** Hand off to the "Open from GitHub" flow (#15). */
    onOpenGitHub?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let location = $state("");
  let error = $state<string | null>(null);
  let recents = $state<RecentFolder[]>([]);
  let favorites = $state<FavoriteFolder[]>([]);
  let discovered = $state<DiscoveredProject[]>([]);
  let loading = $state(false);
  let input = $state<HTMLInputElement | undefined>(undefined);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  // Arrow-key row navigation: combined list of selectable rows
  let focusedRowIndex = $state<number | null>(null);

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

  async function loadLists() {
    if (!isDesktop()) return;
    loading = true;
    try {
      const platform = getPlatform();
      const [r, f] = await Promise.all([
        platform.getRecentFolders(),
        platform.getFavorites(),
      ]);
      recents = r;
      favorites = f;
    } catch {
      // non-fatal — lists stay empty
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      error = null;
      location = "";
      focusedRowIndex = null;
      discovered = [];
      loadLists();
      // Background project scan (#27) — non-blocking; the Discovered section is
      // absent until this resolves. Errors are swallowed (no scan on PWA).
      if (isDesktop()) {
        getPlatform()
          .discoverProjects()
          .then((r) => {
            discovered = r;
          })
          .catch(() => {});
      }
      queueMicrotask(() => input?.focus() ?? focusableElements()[0]?.focus());
    }
  });

  function close() {
    open = false;
    triggerEl?.focus();
  }

  // ── Filter-as-you-type (#27) ──────────────────────────────────────────────
  // When the input does NOT look like a literal path or URL, treat it as a
  // case-insensitive filter term against the folder name + full path. Literal
  // paths (/, ~/, C:\) and URLs bypass filtering entirely.
  function isLiteralPath(val: string): boolean {
    const v = val.trim();
    if (!v) return false;
    return v.startsWith("/") || v.startsWith("~/") || /^[A-Za-z]:[\\/]/.test(v);
  }

  // Active filter term: empty when the input is blank, a literal path, or a URL.
  let filterTerm = $derived.by<string>(() => {
    const v = location.trim();
    if (!v || isLiteralPath(v) || isUrl(v)) return "";
    return v.toLowerCase();
  });

  function matchesFilter(path: string, title: string, term: string): boolean {
    if (!term) return true;
    return path.toLowerCase().includes(term) || (title ?? "").toLowerCase().includes(term);
  }

  let filteredFavorites = $derived(
    favorites.filter((f) => matchesFilter(f.path, f.title, filterTerm)),
  );
  let filteredRecents = $derived(
    recents.filter((r) => matchesFilter(r.path, r.title, filterTerm)),
  );

  // Discovered entries not already shown in the filtered favorites/recents,
  // and that also match the active filter term.
  let filteredDiscovered = $derived.by<DiscoveredProject[]>(() => {
    const shown = new Set<string>([
      ...filteredFavorites.map((f) => f.path),
      ...filteredRecents.map((r) => r.path),
    ]);
    return discovered.filter(
      (d) => !shown.has(d.path) && matchesFilter(d.path, d.title, filterTerm),
    );
  });

  // Discovered list expand/collapse
  const DISCOVERED_CAP = 8;
  let discoveredExpanded = $state(false);

  let visibleDiscovered = $derived(
    discoveredExpanded ? filteredDiscovered : filteredDiscovered.slice(0, DISCOVERED_CAP)
  );

  // Combined ordered list used for arrow-key navigation: filtered favorites,
  // then filtered recents, then VISIBLE discovered. Must mirror the rows the
  // DOM actually renders — deriving from filteredDiscovered (uncapped) would
  // desync arrow-key/Enter indices whenever the Discovered list is collapsed.
  let allRows = $derived.by<
    Array<{ path: string; title: string; exists: boolean; isFavorite: boolean }>
  >(() => {
    const favRows = filteredFavorites.map((f) => ({ ...f, isFavorite: true }));
    const recentRows = filteredRecents.map((r) => ({
      path: r.path,
      title: r.title,
      exists: r.exists,
      isFavorite: false,
    }));
    const discoveredRows = visibleDiscovered.map((d) => ({
      path: d.path,
      title: d.title,
      exists: true,
      isFavorite: false,
    }));
    return [...favRows, ...recentRows, ...discoveredRows];
  });

  function isUrl(val: string): boolean {
    try {
      const u = new URL(val.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

  // The Open button submits the typed text as a path/URL. It's enabled when the
  // text is a literal path or a URL (always openable as-is). When the text is a
  // filter term, Open is meaningful only if it doesn't resolve to zero rows —
  // otherwise there's nothing to open and the button stays disabled.
  let canOpen = $derived.by<boolean>(() => {
    const v = location.trim();
    if (!v) return false;
    if (isLiteralPath(v) || isUrl(v)) return true;
    // A filter term: allow Open only if at least one row matches (Open would
    // otherwise pass a bare name that isn't a real path).
    return allRows.length > 0;
  });

  async function submit() {
    const trimmed = location.trim();
    if (!trimmed) {
      error = "Enter a folder path or web address.";
      return;
    }
    if (isUrl(trimmed)) {
      onOpenUrl?.(trimmed);
      open = false;
      triggerEl?.focus();
      return;
    }
    if (isLiteralPath(trimmed)) {
      onOpenFolder?.(trimmed);
      open = false;
      triggerEl?.focus();
      return;
    }
    // Filter term: open the first matching row, if any. With no matches the
    // Open button is disabled, but Enter can still reach here — guard it.
    const first = allRows[0];
    if (first) {
      onOpenFolder?.(first.path);
      open = false;
      triggerEl?.focus();
    } else {
      error = "No matching projects. Type a folder path or web address.";
    }
  }

  async function browse() {
    if (!isDesktop()) return;
    const dir = await getPlatform().openFolder();
    if (!dir) return;
    location = dir;
    onOpenFolder?.(dir);
    open = false;
    triggerEl?.focus();
  }

  async function openRow(path: string) {
    onOpenFolder?.(path);
    open = false;
    triggerEl?.focus();
  }

  async function removeRecent(path: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    await getPlatform().removeRecent(path).catch(() => {});
    await loadLists();
  }

  async function toggleFavorite(path: string, title: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    await getPlatform().toggleFavorite(path, title).catch(() => {});
    await loadLists();
  }

  function isFavorited(path: string): boolean {
    return favorites.some((f) => f.path === path);
  }

  // Reset expansion whenever the discovered list changes (e.g. new filter term)
  $effect(() => {
    filteredDiscovered; // track
    discoveredExpanded = false;
  });

  // Arrow key navigation across all rows
  function onListKeydown(e: KeyboardEvent, rowIndex: number, path: string, title: string) {
    // Let action buttons (star/remove) handle their own Enter/Space natively.
    if ((e.target as HTMLElement)?.closest(".row-actions")) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusedRowIndex = Math.min(rowIndex + 1, allRows.length - 1);
      const rows = dialogEl?.querySelectorAll<HTMLElement>(".list-row");
      rows?.[focusedRowIndex]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (rowIndex === 0) {
        input?.focus();
        focusedRowIndex = null;
      } else {
        focusedRowIndex = rowIndex - 1;
        const rows = dialogEl?.querySelectorAll<HTMLElement>(".list-row");
        rows?.[focusedRowIndex]?.focus();
      }
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const row = allRows[rowIndex];
      if (row?.exists !== false) openRow(path);
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
    aria-labelledby="open-location-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="open-location-title">Open location</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      <!-- Input row — always visible, never scrolls -->
      <div class="input-row">
        <label class="field" for="location-input">
          <span>Folder path or web address</span>
        </label>
        <div class="input-with-browse">
          <input
            id="location-input"
            bind:this={input}
            bind:value={location}
            type="text"
            placeholder='~/my-book  or  https://example.com/doc/'
            spellcheck="false"
            autocomplete="off"
            onkeydown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                submit();
              } else if (e.key === "ArrowDown" && allRows.length > 0) {
                e.preventDefault();
                focusedRowIndex = 0;
                const rows = dialogEl?.querySelectorAll<HTMLElement>(".list-row");
                rows?.[0]?.focus();
              }
            }}
          />
          {#if isDesktop()}
            <button class="browse-btn ghost" onclick={browse} title="Browse for a folder">Browse…</button>
          {/if}
        </div>
      </div>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <!-- Scrollable lists region — only this area scrolls -->
      <div class="lists">
        <!-- Favorites section -->
        {#if filteredFavorites.length > 0}
          <section class="list-section">
            <h3 class="list-heading">Favorites</h3>
            <ul class="list" role="listbox" aria-label="Favorite folders">
              {#each filteredFavorites as fav, i}
                {@const rowIndex = i}
                <li
                  class="list-row"
                  class:dimmed={!fav.exists}
                  role="option"
                  aria-selected="false"
                  aria-disabled={!fav.exists}
                  tabindex={fav.exists ? 0 : -1}
                  onclick={() => fav.exists && openRow(fav.path)}
                  onkeydown={(e) => onListKeydown(e, rowIndex, fav.path, fav.title)}
                  title={fav.exists ? fav.path : `${fav.path} (folder not found)`}
                >
                  <span class="row-icon" aria-hidden="true">★</span>
                  <span class="row-info">
                    <span class="row-title">{fav.title || fav.path.split(/[\\/]/).filter(Boolean).pop()}</span>
                    <span class="row-path">{fav.path}{!fav.exists ? " — folder not found" : ""}</span>
                  </span>
                  <div class="row-actions">
                    <button
                      class="icon-action star active"
                      title="Remove from favorites"
                      aria-label="Remove from favorites"
                      onclick={(e) => toggleFavorite(fav.path, fav.title, e)}
                    >★</button>
                  </div>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Recently Opened section: always shown when not filtering (desktop
             AND web — host-only gating belongs on actions, not on the list);
             shows placeholder copy on fresh installs so the section isn't
             invisible. -->
        {#if !filterTerm}
          <section class="list-section">
            <h3 class="list-heading">Recently Opened</h3>
            {#if filteredRecents.length > 0}
              <ul class="list" role="listbox" aria-label="Recently opened folders">
                {#each filteredRecents as recent, i}
                  {@const rowIndex = filteredFavorites.length + i}
                  {@const favorited = isFavorited(recent.path)}
                  <li
                    class="list-row"
                    class:dimmed={!recent.exists}
                    role="option"
                    aria-selected="false"
                    aria-disabled={!recent.exists}
                    tabindex={recent.exists ? 0 : -1}
                    onclick={() => recent.exists && openRow(recent.path)}
                    onkeydown={(e) => onListKeydown(e, rowIndex, recent.path, recent.title)}
                    title={recent.exists ? recent.path : `${recent.path} (folder not found)`}
                  >
                    <span class="row-icon" aria-hidden="true">📁</span>
                    <span class="row-info">
                      <span class="row-title">{recent.title || recent.path.split(/[\\/]/).filter(Boolean).pop()}</span>
                      <span class="row-path">{recent.path}{!recent.exists ? " — folder not found" : ""}</span>
                    </span>
                    <div class="row-actions">
                      <button
                        class="icon-action star"
                        class:active={favorited}
                        title={favorited ? "Remove from favorites" : "Add to favorites"}
                        aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                        onclick={(e) => toggleFavorite(recent.path, recent.title, e)}
                      >★</button>
                      <button
                        class="icon-action remove"
                        title="Remove from recents"
                        aria-label="Remove from recently opened"
                        onclick={(e) => removeRecent(recent.path, e)}
                      >&times;</button>
                    </div>
                  </li>
                {/each}
              </ul>
            {:else if !loading}
              <p class="empty-section-hint">No recent projects yet — open a folder to get started.</p>
            {/if}
          </section>
        {:else if filterTerm && filteredRecents.length > 0}
          <!-- Filter-active view: show matching recents without section gating -->
          <section class="list-section">
            <h3 class="list-heading">Recently Opened</h3>
            <ul class="list" role="listbox" aria-label="Recently opened folders">
              {#each filteredRecents as recent, i}
                {@const rowIndex = filteredFavorites.length + i}
                {@const favorited = isFavorited(recent.path)}
                <li
                  class="list-row"
                  class:dimmed={!recent.exists}
                  role="option"
                  aria-selected="false"
                  aria-disabled={!recent.exists}
                  tabindex={recent.exists ? 0 : -1}
                  onclick={() => recent.exists && openRow(recent.path)}
                  onkeydown={(e) => onListKeydown(e, rowIndex, recent.path, recent.title)}
                  title={recent.exists ? recent.path : `${recent.path} (folder not found)`}
                >
                  <span class="row-icon" aria-hidden="true">📁</span>
                  <span class="row-info">
                    <span class="row-title">{recent.title || recent.path.split(/[\\/]/).filter(Boolean).pop()}</span>
                    <span class="row-path">{recent.path}{!recent.exists ? " — folder not found" : ""}</span>
                  </span>
                  <div class="row-actions">
                    <button
                      class="icon-action star"
                      class:active={favorited}
                      title={favorited ? "Remove from favorites" : "Add to favorites"}
                      aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
                      onclick={(e) => toggleFavorite(recent.path, recent.title, e)}
                    >★</button>
                    <button
                      class="icon-action remove"
                      title="Remove from recents"
                      aria-label="Remove from recently opened"
                      onclick={(e) => removeRecent(recent.path, e)}
                    >&times;</button>
                  </div>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <!-- Discovered section (#27): projects found by the background scan that
             are not already shown in Favorites / Recently Opened. Capped at
             DISCOVERED_CAP rows; a "Show all (N)" button reveals the rest. -->
        {#if filteredDiscovered.length > 0}
          <section class="list-section">
            <h3 class="list-heading">
              Discovered
              {#if filteredDiscovered.length > DISCOVERED_CAP}
                <span class="list-heading-count">({filteredDiscovered.length})</span>
              {/if}
            </h3>
            <ul class="list" role="listbox" aria-label="Discovered projects">
              {#each visibleDiscovered as proj, i}
                {@const rowIndex = filteredFavorites.length + filteredRecents.length + i}
                <li
                  class="list-row"
                  role="option"
                  aria-selected="false"
                  tabindex="0"
                  onclick={() => openRow(proj.path)}
                  onkeydown={(e) => onListKeydown(e, rowIndex, proj.path, proj.title)}
                  title={proj.path}
                >
                  <span class="row-icon" aria-hidden="true">🔍</span>
                  <span class="row-info">
                    <span class="row-title">{proj.title || proj.path.split(/[\\/]/).filter(Boolean).pop()}</span>
                    <span class="row-path">{proj.path}</span>
                  </span>
                  <div class="row-actions">
                    <button
                      class="icon-action star"
                      title="Add to favorites"
                      aria-label="Add to favorites"
                      onclick={(e) => toggleFavorite(proj.path, proj.title, e)}
                    >★</button>
                  </div>
                </li>
              {/each}
            </ul>
            {#if filteredDiscovered.length > DISCOVERED_CAP}
              <button
                class="show-all-btn"
                onclick={() => (discoveredExpanded = !discoveredExpanded)}
              >
                {discoveredExpanded
                  ? "Show fewer"
                  : `Show all ${filteredDiscovered.length} discovered projects`}
              </button>
            {/if}
          </section>
        {/if}

        {#if !loading && allRows.length === 0 && filterTerm}
          <p class="empty-hint">No projects match "{location.trim()}".</p>
        {/if}
      </div>
    </div>

    <!-- Actions footer: lives OUTSIDE .dialog-body so it is never scrolled away -->
    <footer class="actions">
      {#if onOpenGitHub}
        <button
          class="ghost github-btn"
          onclick={() => {
            open = false;
            onOpenGitHub?.();
          }}
          title="Open a book project stored on GitHub"
        >Open from GitHub…</button>
      {/if}
      <span class="actions-spacer"></span>
      <button class="ghost" onclick={close}>Cancel</button>
      <button class="primary" onclick={submit} disabled={!canOpen}>Open</button>
    </footer>
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
    width: min(560px, 94vw);
    max-height: 80vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    overflow: hidden;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-width: 28px;
    min-height: 28px;
  }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .dialog-body {
    padding: 16px 18px 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    /* No overflow here — only .lists scrolls */
    flex: 1;
    min-height: 0;
  }
  /* Scrollable region that contains ONLY the list sections */
  .lists {
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
    min-height: 0;
    /* Slight inset so focus rings on list rows aren't clipped */
    padding-right: 2px;
  }
  .input-row { display: flex; flex-direction: column; gap: 6px; }
  .field { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .input-with-browse { display: flex; gap: 8px; align-items: stretch; }
  .input-with-browse input {
    flex: 1;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-family: ui-monospace, monospace;
    min-width: 0;
  }
  .input-with-browse input:focus {
    outline: none;
    border-color: var(--app-focus-ring);
  }
  .browse-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .empty-hint { font-size: 12px; color: var(--app-text-faint); margin: 4px 0; text-align: center; }

  /* List sections */
  .list-section { display: flex; flex-direction: column; gap: 4px; }
  .list-heading {
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.08em;
    color: var(--app-text-muted);
    margin: 0;
    padding: 0 2px;
    display: flex;
    align-items: center;
    gap: 5px;
  }
  .list-heading-count {
    font-weight: 500;
    letter-spacing: 0;
    text-transform: none;
    color: var(--app-text-faint);
    font-size: 11px;
  }
  .empty-section-hint {
    font-size: 12px;
    color: var(--app-text-faint);
    margin: 2px 0 0 2px;
    font-style: italic;
  }
  .show-all-btn {
    background: none;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--app-focus-ring);
    padding: 4px 2px;
    text-align: left;
    border-radius: 4px;
  }
  .show-all-btn:hover {
    color: var(--app-accent-hover);
    text-decoration: underline;
  }
  .list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .list-row {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 10px;
    border-radius: 6px;
    cursor: pointer;
    border: 1px solid transparent;
    transition: background 0.1s;
  }
  .list-row:not(.dimmed):hover,
  .list-row:not(.dimmed):focus {
    background: var(--app-surface-sunken);
    border-color: var(--app-border);
    outline: none;
  }
  .list-row:not(.dimmed):focus {
    border-color: var(--app-focus-ring);
  }
  .list-row.dimmed {
    cursor: default;
    opacity: 0.45;
  }
  .row-icon {
    font-size: 15px;
    flex-shrink: 0;
    width: 18px;
    text-align: center;
  }
  .row-info {
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 2px;
    min-width: 0;
  }
  .row-title {
    font-size: 13px;
    font-weight: 500;
    color: var(--app-text-secondary);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-path {
    font-size: 11px;
    color: var(--app-text-faint);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-family: ui-monospace, monospace;
  }
  .row-actions {
    display: flex;
    gap: 4px;
    align-items: center;
    flex-shrink: 0;
    opacity: 0;
    transition: opacity 0.1s;
  }
  .list-row:hover .row-actions,
  .list-row:focus-within .row-actions {
    opacity: 1;
  }
  .icon-action {
    background: transparent;
    border: 0;
    cursor: pointer;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-width: 24px;
    min-height: 24px;
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    color: var(--app-text-faint);
    transition: color 0.1s, background 0.1s;
  }
  .icon-action:hover { background: var(--app-surface-hover); }
  .icon-action.star { color: var(--app-text-faint); }
  .icon-action.star:hover,
  .icon-action.star.active { color: var(--app-star); }
  .icon-action.remove { color: var(--app-text-faint); }
  .icon-action.remove:hover { color: var(--app-error-text); }

  /* Footer actions — direct child of .dialog, never scrolls away */
  .actions-spacer { flex: 1; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 10px 18px;
    border-top: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
    background: var(--app-surface);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions button:disabled { opacity: 0.45; cursor: default; }
  .actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .actions .primary:not(:disabled):hover { background: var(--app-accent-hover); }
  .actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .actions .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>

<script lang="ts">
  type RecentFolder = { path: string; title: string; openedAt: string; exists: boolean };
  type FavoriteFolder = { path: string; title: string; exists: boolean };

  let {
    open = $bindable(false),
    onOpenFolder,
    onOpenUrl,
    triggerEl,
  }: {
    open?: boolean;
    onOpenFolder?: (path: string) => void;
    onOpenUrl?: (url: string) => void;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let location = $state("");
  let error = $state<string | null>(null);
  let recents = $state<RecentFolder[]>([]);
  let favorites = $state<FavoriteFolder[]>([]);
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
    const electron = (window as any).electron;
    if (!electron) return;
    loading = true;
    try {
      const [r, f] = await Promise.all([
        electron.getRecentFolders?.() ?? Promise.resolve([]),
        electron.getFavorites?.() ?? Promise.resolve([]),
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
      loadLists();
      queueMicrotask(() => input?.focus() ?? focusableElements()[0]?.focus());
    }
  });

  function close() {
    open = false;
    triggerEl?.focus();
  }

  // Combined ordered list: favorites first, then recents (deduped by path)
  let allRows = $derived.by<Array<{ path: string; title: string; exists: boolean; isFavorite: boolean }>>(() => {
    const favPaths = new Set(favorites.map((f) => f.path));
    const favRows = favorites.map((f) => ({ ...f, isFavorite: true }));
    const recentRows = recents
      .filter((r) => !favPaths.has(r.path))
      .map((r) => ({ path: r.path, title: r.title, exists: r.exists, isFavorite: false }));
    return [...favRows, ...recentRows];
  });

  function isUrl(val: string): boolean {
    try {
      const u = new URL(val.trim());
      return u.protocol === "http:" || u.protocol === "https:";
    } catch {
      return false;
    }
  }

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
    } else {
      onOpenFolder?.(trimmed);
      open = false;
      triggerEl?.focus();
    }
  }

  async function browse() {
    const electron = (window as any).electron;
    if (!electron?.openDirectory) return;
    const dir = await electron.openDirectory();
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
    const electron = (window as any).electron;
    await electron?.removeRecent?.(path).catch(() => {});
    await loadLists();
  }

  async function toggleFavorite(path: string, title: string, e: MouseEvent | KeyboardEvent) {
    e.stopPropagation();
    const electron = (window as any).electron;
    await electron?.toggleFavorite?.(path, title).catch(() => {});
    await loadLists();
  }

  function isFavorited(path: string): boolean {
    return favorites.some((f) => f.path === path);
  }

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
      <h2 id="open-location-title">Open Location</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">&times;</button>
    </header>

    <div class="dialog-body">
      <!-- Input row -->
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
            placeholder="~/my-book  or  https://example.com/doc/"
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
          <button class="browse-btn ghost" onclick={browse} title="Browse for a folder">Browse…</button>
        </div>
      </div>

      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <!-- Favorites section -->
      {#if favorites.length > 0}
        <section class="list-section">
          <h3 class="list-heading">Favorites</h3>
          <ul class="list" role="listbox" aria-label="Favorite folders">
            {#each favorites as fav, i}
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

      <!-- Recently Opened section -->
      {#if recents.length > 0}
        <section class="list-section">
          <h3 class="list-heading">Recently Opened</h3>
          <ul class="list" role="listbox" aria-label="Recently opened folders">
            {#each recents as recent, i}
              {@const rowIndex = favorites.length + i}
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
      {:else if !loading && favorites.length === 0}
        <p class="empty-hint">No recent projects yet. Open a folder to get started.</p>
      {/if}

      <footer class="actions">
        <button class="ghost" onclick={close}>Cancel</button>
        <button class="primary" onclick={submit} disabled={!location.trim()}>Open</button>
      </footer>
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
    background: rgba(0, 0, 0, 0.55);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(560px, 94vw);
    max-height: 80vh;
    background: #1e1e1e;
    color: #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
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
    border-bottom: 1px solid #303030;
    flex-shrink: 0;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 0;
    color: #aaa;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover { color: #fff; }
  .dialog-body {
    padding: 16px 18px;
    display: flex;
    flex-direction: column;
    gap: 12px;
    overflow-y: auto;
    flex: 1;
  }
  .input-row { display: flex; flex-direction: column; gap: 6px; }
  .field { font-size: 12px; color: #aaa; font-weight: 500; }
  .input-with-browse { display: flex; gap: 8px; align-items: stretch; }
  .input-with-browse input {
    flex: 1;
    background: #2a2a2a;
    border: 1px solid #404040;
    color: #e0e0e0;
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-family: ui-monospace, monospace;
    min-width: 0;
  }
  .input-with-browse input:focus {
    outline: none;
    border-color: #3a6fb5;
  }
  .browse-btn {
    flex-shrink: 0;
    padding: 6px 12px;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    white-space: nowrap;
  }
  .error { color: #f08080; font-size: 12px; margin: 0; }
  .empty-hint { font-size: 12px; color: #666; margin: 4px 0; text-align: center; }

  /* List sections */
  .list-section { display: flex; flex-direction: column; gap: 4px; }
  .list-heading {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #666;
    margin: 0;
    padding: 0 2px;
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
    background: #2a2a2a;
    border-color: #383838;
    outline: none;
  }
  .list-row:not(.dimmed):focus {
    border-color: #3a6fb5;
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
    color: #e0e0e0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .row-path {
    font-size: 11px;
    color: #666;
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
    padding: 2px 4px;
    border-radius: 4px;
    font-size: 14px;
    line-height: 1;
    color: #555;
    transition: color 0.1s, background 0.1s;
  }
  .icon-action:hover { background: #333; }
  .icon-action.star { color: #555; }
  .icon-action.star:hover,
  .icon-action.star.active { color: #f5c518; }
  .icon-action.remove { color: #555; }
  .icon-action.remove:hover { color: #f08080; }

  /* Footer actions */
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 12px;
    margin-top: 4px;
    border-top: 1px solid #303030;
    flex-shrink: 0;
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions button:disabled { opacity: 0.45; cursor: default; }
  .actions .primary { background: #3a6fb5; color: #fff; }
  .actions .primary:not(:disabled):hover { background: #4882d4; }
  .actions .ghost { background: transparent; color: #aaa; border-color: #404040; }
  .actions .ghost:hover { background: #262626; color: #fff; }
</style>

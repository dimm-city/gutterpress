<script lang="ts">
  /**
   * FileTree (#38) — the in-app editor's left sidebar.
   *
   * Browsable project tree: lists folders AND editable files, and lets the
   * author expand any subfolder to reach files nested anywhere in the project
   * (e.g. `themes/<id>/theme.css`, `styles/print.css`, `css/…`). Folder
   * children are loaded via `api.fs.listDir` (server route in Electron main).
   * There is no `isDesktop()` gate on the root load; the parent only mounts
   * this when a folder project is open (`sourceMode === "folder"`).
   *
   * The root load runs in `onMount`; the parent wraps this in `{#key projectDir}`
   * so switching projects remounts the tree (no `$effect`). Folder expansion is
   * a plain event handler.
   *
   * ── Staleness fix (UX review M9) ──────────────────────────────────────────
   * `childrenByPath` used to be a PERMANENT cache — `loadChildren` never
   * refetched a directory once loaded, so files created/renamed/deleted (in
   * the app or externally) never appeared until the whole project reopened.
   * Now: (1) `loadChildren` always refetches on every expand — no cache-hit
   * short-circuit — so re-expanding a folder is always current; (2) the
   * component subscribes to the same `onFolderChanged` push MediaPanel uses
   * to refresh the ROOT listing on external changes (git pull, an external
   * editor). The host's folder watcher is a single NON-RECURSIVE `fs.watch`
   * on the project root (`electron/folder-watch/watcher.ts`), so it can only
   * ever report root-level changes — nested directories are refreshed
   * directly by this component's own create/rename/delete calls (via
   * `afterMutateDir`, `file-tree-cache.ts`'s invalidation helpers), which
   * know exactly which directory just changed, rather than by that coarse
   * signal. A nested file changed by something OTHER than this app (with no
   * tree action to invalidate it) stays stale until its ancestor is
   * re-expanded or the project reopens — the same watcher-scope limit
   * `MediaPanel`/the editor's own external-edit reconciliation already live
   * with.
   *
   * ── CRUD (UX review M9 / issue #38) ────────────────────────────────────────
   * Row/context actions: New folder (root toolbar + per-folder-row "New
   * folder here"), New chapter (root toolbar ONLY — see below), Rename,
   * Delete. Delete uses the same two-step inline "armed" confirm as
   * AppearanceSection's theme Remove (W4/M7). Create/rename use a small
   * inline text input in place of the row's name, not a separate modal.
   *
   * "New chapter" is deliberately ROOT-ONLY, not a per-folder action: the
   * default chapter build (`renderChapters` in the lib, when a manifest
   * doesn't pin an explicit `source.files` list) discovers chapters with a
   * plain non-recursive `readdir` of the project root — a `.md` file
   * authored inside a subfolder would silently never render. Offering "New
   * chapter" inside a folder would set non-technical authors up to write a
   * chapter that never appears in their book. "New folder" has no such trap
   * (folders are purely organizational — themes/styles/assets already live
   * in subfolders), so it's offered at both levels.
   *
   * Reorder: chapters are ordered by filename (see the readdir+sort fallback
   * above), so renaming a chapter's leading number IS how an author reorders
   * it — the generic Rename action added here already covers this. A
   * dedicated swap/renumber control was deliberately NOT built: it would need
   * to detect a numbering convention across sibling files (not guaranteed to
   * exist), renumber potentially several files atomically without a
   * transient name collision, and keep the open-file buffer's `filePath`
   * consistent across more than one rename in the same gesture — real
   * complexity for a convenience Rename already provides. Drag-and-drop was
   * explicitly out of scope regardless.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { getPlatform, isDesktop } from "$lib/platform";
  import Icon from "$lib/components/Icon.svelte";
  import {
    invalidateDir,
    invalidateSubtree,
    collapseDir,
    renameExpanded,
  } from "./file-tree-cache";

  let {
    projectDir,
    selectedPath = null,
    onSelectFile,
    onBeforeRename,
    onBeforeDelete,
    onFileRenamed,
    onFileDeleted,
  }: {
    projectDir: string | null;
    selectedPath?: string | null;
    onSelectFile?: (path: string) => void;
    /**
     * Called with the CURRENT (pre-rename) path just before the rename API
     * call fires. The parent uses this to flush a pending editor save for
     * that exact file FIRST — see +page.svelte's `onTreeBeforeRename` for
     * why the ordering (flush-before-rename, not after) matters.
     */
    onBeforeRename?: (path: string) => boolean | void | Promise<boolean | void>;
    /** Return false to keep the file/folder when its open buffer did not flush. */
    onBeforeDelete?: (path: string) => boolean | void | Promise<boolean | void>;
    /** Called after a successful rename with the old and new absolute paths. */
    onFileRenamed?: (oldPath: string, newPath: string) => void;
    /** Called after a successful delete with the deleted absolute path. */
    onFileDeleted?: (path: string) => void;
  } = $props();

  type Entry = { name: string; path: string; isDir: boolean };

  // Editable text file extensions surfaced in the tree. Folders are always
  // shown (so the author can navigate into them) regardless of this filter.
  const EDITABLE_EXT = /\.(md|markdown|yaml|yml|css|txt)$/i;

  let rootEntries = $state<Entry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  // Per-folder lazy-load state, keyed by absolute folder path. Sets/records are
  // REASSIGNED (not mutated) so Svelte 5 reactivity fires.
  let expanded = $state<Set<string>>(new Set());
  let childrenByPath = $state<Record<string, Entry[]>>({});
  let loadingPaths = $state<Set<string>>(new Set());
  let errorByPath = $state<Record<string, string>>({});

  /** Folders first, then files; each group alphabetical, case-insensitive. */
  function sortEntries(entries: Entry[]): Entry[] {
    return [...entries].sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  }

  /** Keep folders + editable files; drop everything else. */
  function visibleEntries(raw: Array<{ name: string; path: string; isDir: boolean }>): Entry[] {
    return sortEntries(
      raw.filter((e) => e.isDir || EDITABLE_EXT.test(e.name)),
    );
  }

  // ── Root load + live-update subscription ──────────────────────────────────
  // A generation counter (same pattern as MediaPanel's `loadSeq`) guards
  // against an in-flight root load resolving after a newer one started —
  // both the initial mount load and every watcher-triggered refresh share
  // this one function/counter.
  let rootLoadSeq = 0;
  async function refreshRoot(dir: string): Promise<void> {
    const seq = ++rootLoadSeq;
    loading = true;
    error = null;
    try {
      const entries = await api.fs.listDir(dir);
      if (seq !== rootLoadSeq) return;
      rootEntries = visibleEntries(entries);
    } catch (e) {
      if (seq !== rootLoadSeq) return;
      error = e instanceof Error ? e.message : String(e);
      rootEntries = [];
    } finally {
      if (seq === rootLoadSeq) loading = false;
    }
  }

  let rootRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  onMount(() => {
    const dir = projectDir;
    if (!dir) return;
    void refreshRoot(dir);
    if (!isDesktop()) return;
    // Debounced (matches MediaPanel): the host already debounces
    // fs:folderChanged, this merges bursts while a refresh is in flight.
    const off = getPlatform().onFolderChanged(() => {
      if (rootRefreshTimer) clearTimeout(rootRefreshTimer);
      rootRefreshTimer = setTimeout(() => {
        rootRefreshTimer = null;
        void refreshRoot(dir);
      }, 500);
    });
    return () => {
      off();
      if (rootRefreshTimer) {
        clearTimeout(rootRefreshTimer);
        rootRefreshTimer = null;
      }
    };
  });

  /** Always refetches — no permanent cache (UX review M9: re-expanding a
   *  folder must reflect create/rename/delete since it was last open). */
  async function loadChildren(dir: string): Promise<void> {
    loadingPaths = new Set(loadingPaths).add(dir);
    const nextErrors = { ...errorByPath };
    delete nextErrors[dir];
    errorByPath = nextErrors;
    try {
      const entries = await api.fs.listDir(dir);
      childrenByPath = { ...childrenByPath, [dir]: visibleEntries(entries) };
    } catch (e) {
      errorByPath = {
        ...errorByPath,
        [dir]: e instanceof Error ? e.message : String(e),
      };
    } finally {
      const next = new Set(loadingPaths);
      next.delete(dir);
      loadingPaths = next;
    }
  }

  function toggleFolder(entry: Entry): void {
    const next = new Set(expanded);
    if (next.has(entry.path)) {
      next.delete(entry.path);
    } else {
      next.add(entry.path);
      void loadChildren(entry.path);
    }
    expanded = next;
  }

  /** Refresh the one directory a create/rename/delete just affected: the
   *  root listing if it's the project root, an immediate refetch if it's an
   *  expanded folder, or just an invalidation (next expand refetches) if
   *  it's currently collapsed. */
  async function afterMutateDir(dir: string): Promise<void> {
    if (!projectDir) return;
    if (dir === projectDir) {
      await refreshRoot(projectDir);
    } else if (expanded.has(dir)) {
      await loadChildren(dir);
    } else {
      childrenByPath = invalidateDir(childrenByPath, dir);
    }
  }

  // ── Create (new chapter / new folder) ─────────────────────────────────────
  type CreateKind = "file" | "folder";
  let creating = $state<{ dir: string; kind: CreateKind } | null>(null);
  let createValue = $state("");
  let createBusy = $state(false);
  let createError = $state<string | null>(null);

  function startCreate(dir: string, kind: CreateKind): void {
    creating = { dir, kind };
    createValue = "";
    createError = null;
    renaming = null;
    deleteArmedPath = null;
    if (dir !== projectDir && !expanded.has(dir)) {
      const next = new Set(expanded);
      next.add(dir);
      expanded = next;
      void loadChildren(dir);
    }
  }

  function cancelCreate(): void {
    creating = null;
    createValue = "";
    createError = null;
  }

  /** Humanize a filename into a heading, e.g. "new-chapter.md" -> "New Chapter". */
  function humanizeTitle(fileName: string): string {
    const stem = fileName.replace(/\.[a-z0-9]+$/i, "");
    const words = stem.split(/[-_\s]+/).filter(Boolean);
    if (words.length === 0) return "New Chapter";
    return words.map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  }

  function chapterTemplate(fileName: string): string {
    return `# ${humanizeTitle(fileName)}\n\nWrite your chapter here.\n`;
  }

  async function commitCreate(): Promise<void> {
    if (!creating) return;
    const name = createValue.trim();
    if (!name) {
      createError = "Enter a name.";
      return;
    }
    createBusy = true;
    createError = null;
    const { dir, kind } = creating;
    try {
      if (kind === "file") {
        const fileName = EDITABLE_EXT.test(name) ? name : `${name}.md`;
        const result = await api.fs.createFile(dir, fileName, chapterTemplate(fileName));
        creating = null;
        await afterMutateDir(dir);
        onSelectFile?.(result.path);
      } else {
        await api.fs.createFolder(dir, name);
        creating = null;
        await afterMutateDir(dir);
      }
    } catch (e) {
      createError = e instanceof Error ? e.message : String(e);
    } finally {
      createBusy = false;
    }
  }

  // ── Rename ────────────────────────────────────────────────────────────────
  let renaming = $state<{ path: string; parentDir: string; isDir: boolean; originalName: string } | null>(null);
  let renameValue = $state("");
  let renameBusy = $state(false);
  let renameError = $state<string | null>(null);

  function startRename(entry: Entry, parentDir: string): void {
    renaming = { path: entry.path, parentDir, isDir: entry.isDir, originalName: entry.name };
    renameValue = entry.name;
    renameError = null;
    creating = null;
    deleteArmedPath = null;
  }

  function cancelRename(): void {
    renaming = null;
    renameValue = "";
    renameError = null;
  }

  async function commitRename(): Promise<void> {
    if (!renaming) return;
    const newName = renameValue.trim();
    if (!newName) {
      renameError = "Enter a name.";
      return;
    }
    if (newName === renaming.originalName) {
      renaming = null;
      return;
    }
    renameBusy = true;
    renameError = null;
    const { path: oldPath, parentDir, isDir } = renaming;
    try {
      if ((await onBeforeRename?.(oldPath)) === false) return;
      const result = await api.fs.renamePath(oldPath, newName);
      renaming = null;
      if (isDir) {
        const wasExpanded = expanded.has(oldPath);
        childrenByPath = invalidateSubtree(childrenByPath, oldPath);
        expanded = renameExpanded(expanded, oldPath, result.path);
        if (wasExpanded) void loadChildren(result.path);
      }
      onFileRenamed?.(oldPath, result.path);
      await afterMutateDir(parentDir);
    } catch (e) {
      renameError = e instanceof Error ? e.message : String(e);
    } finally {
      renameBusy = false;
    }
  }

  // ── Delete (two-step inline confirm — same pattern as AppearanceSection's
  // theme Remove, W4/M7) ─────────────────────────────────────────────────────
  let deleteArmedPath = $state<string | null>(null);
  let deleteBusy = $state<string | null>(null);
  let deleteError = $state<string | null>(null);

  function requestDelete(entry: Entry): void {
    creating = null;
    renaming = null;
    deleteError = null;
    deleteArmedPath = entry.path;
  }

  function cancelDelete(): void {
    deleteArmedPath = null;
    deleteError = null;
  }

  async function commitDelete(entry: Entry, parentDir: string): Promise<void> {
    if (!projectDir) return;
    deleteArmedPath = null;
    deleteBusy = entry.path;
    deleteError = null;
    try {
      if ((await onBeforeDelete?.(entry.path)) === false) return;
      await api.fs.deletePath(entry.path, projectDir);
      if (entry.isDir) {
        childrenByPath = invalidateSubtree(childrenByPath, entry.path);
        expanded = collapseDir(expanded, entry.path);
      }
      onFileDeleted?.(entry.path);
      await afterMutateDir(parentDir);
    } catch (e) {
      deleteError = e instanceof Error ? e.message : String(e);
    } finally {
      deleteBusy = null;
    }
  }

  let anyBusy = $derived(createBusy || renameBusy || deleteBusy !== null);

  function autofocusInput(node: HTMLInputElement): void {
    node.focus();
    node.select();
  }
</script>

{#snippet createRow(dir: string, depth: number)}
  {#if creating && creating.dir === dir}
    <li>
      <div class="tree-row editing" style="padding-left: {8 + depth * 14}px">
        <Icon name={creating.kind === "folder" ? "folder" : "file-text"} size={creating.kind === "folder" ? 13 : 15} />
        <input
          class="inline-input"
          type="text"
          bind:value={createValue}
          use:autofocusInput
          disabled={createBusy}
          placeholder={creating.kind === "folder" ? "Folder name" : "Chapter name"}
          aria-label={creating.kind === "folder" ? "New folder name" : "New chapter name"}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitCreate();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelCreate();
            }
          }}
        />
        <div class="row-actions">
          <button
            class="inline-btn"
            onclick={() => void commitCreate()}
            disabled={createBusy}
            aria-label={creating.kind === "folder" ? "Create folder" : "Create chapter"}
          >
            <Icon name="plus" size={13} />
          </button>
          <button class="inline-btn" onclick={cancelCreate} disabled={createBusy} aria-label="Cancel">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      {#if createError}
        <p class="file-tree-msg file-tree-error" role="alert" style="padding-left: {8 + depth * 14}px">
          {createError}
        </p>
      {/if}
    </li>
  {/if}
{/snippet}

{#snippet node(entry: Entry, depth: number, parentDir: string)}
  <li>
    {#if renaming?.path === entry.path}
      <div class="tree-row editing" style="padding-left: {8 + depth * 14}px">
        <Icon name={entry.isDir ? "folder" : "file-text"} size={entry.isDir ? 13 : 15} />
        <input
          class="inline-input"
          type="text"
          bind:value={renameValue}
          use:autofocusInput
          disabled={renameBusy}
          aria-label={`New name for ${renaming.originalName}`}
          onkeydown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void commitRename();
            } else if (e.key === "Escape") {
              e.preventDefault();
              cancelRename();
            }
          }}
        />
        <div class="row-actions">
          <button class="inline-btn" onclick={() => void commitRename()} disabled={renameBusy} aria-label="Confirm rename">
            <Icon name="pen-line" size={13} />
          </button>
          <button class="inline-btn" onclick={cancelRename} disabled={renameBusy} aria-label="Cancel rename">
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      {#if renameError}
        <p class="file-tree-msg file-tree-error" role="alert" style="padding-left: {8 + depth * 14}px">
          {renameError}
        </p>
      {/if}
    {:else if deleteArmedPath === entry.path}
      <div class="tree-row" style="padding-left: {8 + depth * 14}px">
        <span class="row-confirm-msg" role="alert">Delete "{entry.name}"?</span>
        <div class="row-actions">
          <button
            class="inline-btn danger"
            onclick={() => void commitDelete(entry, parentDir)}
            disabled={deleteBusy === entry.path}
            aria-label={`Confirm delete ${entry.name}`}
          >
            <Icon name="trash" size={13} />
          </button>
          <button
            class="inline-btn"
            onclick={cancelDelete}
            disabled={deleteBusy === entry.path}
            aria-label={`Cancel deleting ${entry.name}`}
          >
            <Icon name="x" size={13} />
          </button>
        </div>
      </div>
      {#if deleteError}
        <p class="file-tree-msg file-tree-error" role="alert" style="padding-left: {8 + depth * 14}px">
          {deleteError}
        </p>
      {/if}
    {:else if entry.isDir}
      <div class="tree-row">
        <button
          class="file-item folder"
          style="padding-left: {8 + depth * 14}px"
          onclick={() => toggleFolder(entry)}
          title={entry.path}
          aria-expanded={expanded.has(entry.path)}
        >
          <Icon name={expanded.has(entry.path) ? "chevron-down" : "chevron-right"} />
          <Icon name="folder" />
          <span class="file-name">{entry.name}</span>
        </button>
        <div class="row-actions">
          <button
            class="inline-btn"
            onclick={() => startCreate(entry.path, "folder")}
            disabled={anyBusy}
            title="New folder here"
            aria-label={`New folder inside ${entry.name}`}
          >
            <Icon name="plus" size={13} />
          </button>
          <button
            class="inline-btn"
            onclick={() => startRename(entry, parentDir)}
            disabled={anyBusy}
            title="Rename"
            aria-label={`Rename ${entry.name}`}
          >
            <Icon name="pen-line" size={13} />
          </button>
          <button
            class="inline-btn"
            onclick={() => requestDelete(entry)}
            disabled={anyBusy}
            title="Delete"
            aria-label={`Delete ${entry.name}`}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
      {#if expanded.has(entry.path)}
        {#if loadingPaths.has(entry.path)}
          {@render createRow(entry.path, depth + 1)}
          <p class="file-tree-msg" style="padding-left: {8 + (depth + 1) * 14}px">Loading…</p>
        {:else if errorByPath[entry.path]}
          {@render createRow(entry.path, depth + 1)}
          <p class="file-tree-msg file-tree-error" role="alert" style="padding-left: {8 + (depth + 1) * 14}px">
            {errorByPath[entry.path]}
          </p>
        {:else if (childrenByPath[entry.path] ?? []).length === 0 && creating?.dir !== entry.path}
          <p class="file-tree-msg" style="padding-left: {8 + (depth + 1) * 14}px">Empty</p>
        {:else}
          <ul class="file-list nested">
            {@render createRow(entry.path, depth + 1)}
            {#each childrenByPath[entry.path] ?? [] as child (child.path)}
              {@render node(child, depth + 1, entry.path)}
            {/each}
          </ul>
        {/if}
      {/if}
    {:else}
      <div class="tree-row">
        <button
          class="file-item"
          class:active={entry.path === selectedPath}
          style="padding-left: {8 + depth * 14}px"
          onclick={() => onSelectFile?.(entry.path)}
          title={entry.path}
          aria-current={entry.path === selectedPath ? "true" : undefined}
        >
          <Icon name="file-text" />
          <span class="file-name">{entry.name}</span>
        </button>
        <div class="row-actions">
          <button
            class="inline-btn"
            onclick={() => startRename(entry, parentDir)}
            disabled={anyBusy}
            title="Rename"
            aria-label={`Rename ${entry.name}`}
          >
            <Icon name="pen-line" size={13} />
          </button>
          <button
            class="inline-btn"
            onclick={() => requestDelete(entry)}
            disabled={anyBusy}
            title="Delete"
            aria-label={`Delete ${entry.name}`}
          >
            <Icon name="trash" size={13} />
          </button>
        </div>
      </div>
    {/if}
  </li>
{/snippet}

<nav class="file-tree" aria-label="Project files">
  {#if projectDir}
    <div class="tree-toolbar">
      <button
        class="tree-toolbar-btn"
        onclick={() => startCreate(projectDir!, "file")}
        disabled={anyBusy}
      >
        <Icon name="plus" size={13} /> New chapter
      </button>
      <button
        class="tree-toolbar-btn"
        onclick={() => startCreate(projectDir!, "folder")}
        disabled={anyBusy}
      >
        <Icon name="plus" size={13} /> New folder
      </button>
    </div>
  {/if}
  {#if loading && rootEntries.length === 0 && creating?.dir !== projectDir}
    <p class="file-tree-msg">Loading…</p>
  {:else if error}
    <p class="file-tree-msg file-tree-error" role="alert">{error}</p>
  {:else if rootEntries.length === 0 && creating?.dir !== projectDir}
    <p class="file-tree-msg">No editable files in this folder. Use "New chapter" above to add one.</p>
  {:else}
    <ul class="file-list">
      {@render createRow(projectDir ?? "", 0)}
      {#each rootEntries as entry (entry.path)}
        {@render node(entry, 0, projectDir ?? "")}
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .file-tree {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    background: var(--app-surface);
    border-right: 1px solid var(--app-border);
    font-size: 13px;
  }
  .tree-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    padding: 8px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }
  .tree-toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    flex: 1 1 auto;
    justify-content: center;
    padding: 5px 6px;
    background: transparent;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    color: var(--app-text-secondary);
    font-size: 11px;
    font-weight: 600;
    cursor: pointer;
    min-height: 26px;
  }
  .tree-toolbar-btn:hover {
    background: var(--app-control-hover-bg);
    color: var(--app-text);
  }
  .tree-toolbar-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .tree-toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .file-tree-msg {
    margin: 0;
    padding: 12px;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .file-tree-error {
    color: var(--app-error-text);
  }
  .file-list {
    list-style: none;
    margin: 0;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .file-list.nested {
    padding: 2px 0 0 0;
  }
  .tree-row {
    display: flex;
    align-items: center;
    gap: 4px;
  }
  .tree-row.editing {
    padding: 4px 8px 4px 0;
    gap: 6px;
  }
  .tree-row.editing :global(svg) {
    flex: 0 0 auto;
    width: 13px;
    height: 13px;
    color: var(--app-text-muted);
  }
  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    min-width: 0;
    padding: 6px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--app-text-secondary);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .file-item:hover {
    background: var(--app-control-hover-bg);
  }
  .file-item.folder {
    color: var(--app-text);
  }
  .file-item.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .file-item :global(svg) {
    flex: 0 0 auto;
  }
  .file-item.folder :global(svg:first-child) {
    color: var(--app-text-muted);
  }
  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* ── Row actions (rename/delete/new — UX review M9) ───────────────────── */
  .row-actions {
    display: flex;
    align-items: center;
    gap: 1px;
    flex: 0 0 auto;
    padding-right: 4px;
  }
  .inline-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    padding: 4px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--app-text-muted);
    cursor: pointer;
    /* WCAG 2.5.8: minimum target size 24×24px */
    min-width: 24px;
    min-height: 24px;
  }
  .inline-btn:hover {
    background: var(--app-control-hover-bg);
    color: var(--app-text-secondary);
  }
  .inline-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .inline-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .inline-btn.danger:hover {
    color: var(--app-error-text);
  }

  /* ── Inline create/rename input ───────────────────────────────────────── */
  .inline-input {
    flex: 1 1 auto;
    min-width: 0;
    padding: 3px 6px;
    background: var(--app-surface);
    border: 1px solid var(--app-accent-border);
    border-radius: 4px;
    color: var(--app-text);
    font-size: 12px;
    font-family: inherit;
  }
  .inline-input:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }

  /* ── Inline delete confirm (mirrors AppearanceSection's theme Remove) ─── */
  .row-confirm-msg {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--app-error-text);
    font-size: 12px;
    font-weight: 600;
  }
</style>

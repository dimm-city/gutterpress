<script lang="ts">
  /**
   * FileTree (#38) — the in-app editor's left sidebar.
   *
   * Browsable project tree: lists folders AND editable files, and lets the
   * author expand any subfolder to reach files nested anywhere in the project
   * (e.g. `themes/<id>/theme.css`, `styles/print.css`, `css/…`). Folder
   * children are loaded lazily on first expand via `platform.listDir`, which is
   * implemented on BOTH adapters (Electron + the File System Access WebAdapter),
   * so the tree works on every device — desktop and web/PWA alike. There is no
   * `isDesktop()` gate; the parent only mounts this when a folder project is
   * open (`sourceMode === "folder"`).
   *
   * The root load runs in `onMount`; the parent wraps this in `{#key projectDir}`
   * so switching projects remounts the tree (no `$effect`). Folder expansion is
   * a plain event handler.
   */
  import { onMount } from "svelte";
  import { getPlatform } from "$lib/platform";
  import Icon from "$lib/components/Icon.svelte";

  let {
    projectDir,
    selectedPath = null,
    onSelectFile,
  }: {
    projectDir: string | null;
    selectedPath?: string | null;
    onSelectFile?: (path: string) => void;
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

  onMount(() => {
    const dir = projectDir;
    if (!dir) return;
    loading = true;
    error = null;
    let cancelled = false;
    getPlatform()
      .listDir(dir)
      .then((entries) => {
        if (cancelled) return;
        rootEntries = visibleEntries(entries);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        error = e instanceof Error ? e.message : String(e);
        rootEntries = [];
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });

  async function loadChildren(dir: string): Promise<void> {
    if (childrenByPath[dir]) return;
    loadingPaths = new Set(loadingPaths).add(dir);
    const nextErrors = { ...errorByPath };
    delete nextErrors[dir];
    errorByPath = nextErrors;
    try {
      const entries = await getPlatform().listDir(dir);
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
</script>

{#snippet node(entry: Entry, depth: number)}
  {#if entry.isDir}
    <li>
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
      {#if expanded.has(entry.path)}
        {#if loadingPaths.has(entry.path)}
          <p class="file-tree-msg" style="padding-left: {8 + (depth + 1) * 14}px">Loading…</p>
        {:else if errorByPath[entry.path]}
          <p class="file-tree-msg file-tree-error" role="alert" style="padding-left: {8 + (depth + 1) * 14}px">
            {errorByPath[entry.path]}
          </p>
        {:else if (childrenByPath[entry.path] ?? []).length === 0}
          <p class="file-tree-msg" style="padding-left: {8 + (depth + 1) * 14}px">Empty</p>
        {:else}
          <ul class="file-list nested">
            {#each childrenByPath[entry.path]! as child (child.path)}
              {@render node(child, depth + 1)}
            {/each}
          </ul>
        {/if}
      {/if}
    </li>
  {:else}
    <li>
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
    </li>
  {/if}
{/snippet}

<nav class="file-tree" aria-label="Project files">
  {#if loading}
    <p class="file-tree-msg">Loading…</p>
  {:else if error}
    <p class="file-tree-msg file-tree-error" role="alert">{error}</p>
  {:else if rootEntries.length === 0}
    <p class="file-tree-msg">No editable files in this folder.</p>
  {:else}
    <ul class="file-list">
      {#each rootEntries as entry (entry.path)}
        {@render node(entry, 0)}
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
    background: var(--app-surface, var(--app-bg));
    border-right: 1px solid var(--app-border);
    font-size: 13px;
  }
  .file-tree-msg {
    margin: 0;
    padding: 12px;
    color: var(--app-text-faint);
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
  .file-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
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
    width: 15px;
    height: 15px;
  }
  .file-item.folder :global(svg:first-child) {
    width: 13px;
    height: 13px;
    color: var(--app-text-faint);
  }
  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

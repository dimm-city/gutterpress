<script lang="ts">
  /**
   * FileTree (#38) — the in-app editor's left sidebar.
   *
   * Lists the editable text files in the open project's root directory
   * (single level for the MVP — no recursive subdirectory expansion). The
   * richer chapter/document navigation (#42) will replace or extend this; the
   * component API is deliberately minimal: a `projectDir` prop in, an
   * `onSelectFile(path)` callback out.
   */
  import { getPlatform, isDesktop } from "$lib/platform";
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

  type FileEntry = { name: string; path: string };

  // Editable text file extensions surfaced in the tree (MVP scope per the issue).
  const EDITABLE_EXT = /\.(md|markdown|yaml|yml|css|txt)$/i;

  let files = $state<FileEntry[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    const dir = projectDir;
    if (!dir || !isDesktop()) {
      files = [];
      error = null;
      return;
    }
    loading = true;
    error = null;
    let cancelled = false;
    getPlatform()
      .listDir(dir)
      .then((entries) => {
        if (cancelled) return;
        files = entries
          .filter((e) => !e.isDir && EDITABLE_EXT.test(e.name))
          .map((e) => ({ name: e.name, path: e.path }))
          .sort((a, b) => a.name.localeCompare(b.name));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        error = e instanceof Error ? e.message : String(e);
        files = [];
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<nav class="file-tree" aria-label="Project files">
  <div class="file-tree-header">Files</div>
  {#if loading}
    <p class="file-tree-msg">Loading…</p>
  {:else if error}
    <p class="file-tree-msg file-tree-error" role="alert">{error}</p>
  {:else if files.length === 0}
    <p class="file-tree-msg">No editable files in this folder.</p>
  {:else}
    <ul class="file-list">
      {#each files as file (file.path)}
        <li>
          <button
            class="file-item"
            class:active={file.path === selectedPath}
            onclick={() => onSelectFile?.(file.path)}
            title={file.path}
            aria-current={file.path === selectedPath ? "true" : undefined}
          >
            <Icon name="file-text" />
            <span class="file-name">{file.name}</span>
          </button>
        </li>
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
  .file-tree-header {
    padding: 8px 12px;
    font-size: 10px;
    font-weight: 600;
    letter-spacing: 0.09em;
    text-transform: uppercase;
    color: var(--app-text-faint);
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
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
  .file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

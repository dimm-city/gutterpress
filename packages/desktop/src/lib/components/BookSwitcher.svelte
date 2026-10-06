<script lang="ts">
  /**
   * BookSwitcher — quiet toggle+list disclosure for switching the active
   * book inside a multi-book repo. Shown ONLY when there is more than one book
   * (the parent guards with `books.length > 1`; the caller decides visibility).
   *
   * Presentational: the parent owns `books`/`activeBookDir` (from
   * ProjectSessionController) and re-opens the project at the chosen book's
   * folder — the same full open path a fresh folder-open uses ("session
   * identity pinned to repoRoot", switching is a full retarget).
   *
   * A minimal disclosure: a toggle and an absolutely-positioned list, with no
   * outside-click handling.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProjectBookEntry } from "$lib/routes/project-session-controller.svelte";

  let {
    books,
    activeBookDir,
    onSelect,
  }: {
    books: ProjectBookEntry[];
    activeBookDir: string | null;
    onSelect: (path: string) => void;
  } = $props();

  let open = $state(false);

  let activeTitle = $derived(books.find((b) => b.path === activeBookDir)?.title ?? "");

  function choose(path: string) {
    open = false;
    if (path !== activeBookDir) onSelect(path);
  }
</script>

<div class="book-switcher">
  <!-- Plain disclosure of tab-navigable buttons — deliberately NOT
       listbox/menu roles, which promise arrow-key/roving-focus interactions
       this minimal widget doesn't implement (PR #92). -->
  <button
    type="button"
    class="book-switcher-toggle"
    onclick={() => (open = !open)}
    aria-expanded={open}
    title="Switch book"
  >
    <Icon name="folder" size={13} />
    <span class="book-switcher-title">{activeTitle}</span>
    <Icon name={open ? "chevron-up" : "chevron-down"} size={12} />
  </button>
  {#if open}
    <ul class="book-switcher-list" aria-label="Books in this folder">
      {#each books as book (book.path)}
        <li>
          <button
            type="button"
            class="book-switcher-option"
            class:active={book.path === activeBookDir}
            aria-current={book.path === activeBookDir ? "true" : undefined}
            onclick={() => choose(book.path)}
          >
            {book.title}
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .book-switcher {
    position: relative;
    flex-shrink: 0;
  }
  .book-switcher-toggle {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 2px 6px;
    border: none;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
    border-radius: 3px;
    font-size: 11px;
    max-width: 160px;
  }
  .book-switcher-toggle:hover {
    color: var(--app-text);
    background: var(--app-surface-hover);
  }
  .book-switcher-toggle:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }
  .book-switcher-title {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .book-switcher-list {
    position: absolute;
    bottom: 100%;
    left: 0;
    margin: 0 0 4px;
    padding: 4px;
    list-style: none;
    min-width: 160px;
    max-height: 40vh;
    overflow-y: auto;
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 6px;
    box-shadow: 0 -4px 16px var(--app-shadow-md);
    z-index: var(--app-z-popover);
  }
  .book-switcher-option {
    display: block;
    width: 100%;
    text-align: left;
    padding: 5px 8px;
    border: none;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
    border-radius: 4px;
    font-size: 12px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .book-switcher-option:hover {
    background: var(--app-surface-hover);
  }
  .book-switcher-option:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .book-switcher-option.active {
    color: var(--app-text);
    font-weight: 600;
  }
</style>

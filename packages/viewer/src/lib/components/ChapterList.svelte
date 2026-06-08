<script lang="ts">
  /**
   * ChapterList (#42) — the author-facing chapter / document navigator.
   *
   * Unlike FileTree (#38, an IDE-style flat file list), this is a *chapter list*
   * in the spirit of iA Writer's navigator: the project's `.md` files rendered
   * as friendly display names (leading `NN-` ordering prefixes and the `.md`
   * extension stripped) and sorted by filename, with `.css` stylesheets in a
   * separate "Stylesheets" section below so they never clutter the chapters.
   *
   * The component API is minimal: a `projectDir` prop in and an optional
   * `onSelectFile(path)` callback out. It re-reads the directory whenever
   * `projectDir` changes via a `$effect`. In the preview-only viewer the
   * callback may be omitted — clicking is then a no-op and the list still
   * renders for orientation. On narrow viewports the parent renders this inside
   * a bottom-sheet drawer (see +page.svelte); the component itself is layout-
   * agnostic.
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

  type Doc = { name: string; path: string; display: string };

  let chapters = $state<Doc[]>([]);
  let stylesheets = $state<Doc[]>([]);
  let loading = $state(false);
  let error = $state<string | null>(null);

  /** Join a directory and a filename with the directory's own separator. */
  function joinPath(dir: string, name: string): string {
    const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
    return dir.endsWith(sep) ? `${dir}${name}` : `${dir}${sep}${name}`;
  }

  /** "01-intro.md" → "Intro"; "the-setting.md" → "The Setting". */
  function displayName(filename: string): string {
    const base = filename.replace(/\.(md|css)$/i, "");
    const stripped = base.replace(/^\d+[-_.]\s*/, "");
    const words = stripped.replace(/[-_]+/g, " ").trim();
    if (!words) return base;
    return words
      .split(/\s+/)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");
  }

  $effect(() => {
    const dir = projectDir;
    if (!dir || !isDesktop()) {
      chapters = [];
      stylesheets = [];
      error = null;
      return;
    }
    loading = true;
    error = null;
    let cancelled = false;
    getPlatform()
      .listProjectFiles(dir)
      .then((result) => {
        if (cancelled) return;
        chapters = result.md.map((name) => ({
          name,
          path: joinPath(dir, name),
          display: displayName(name),
        }));
        stylesheets = result.css.map((name) => ({
          name,
          path: joinPath(dir, name),
          display: displayName(name),
        }));
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        error = e instanceof Error ? e.message : String(e);
        chapters = [];
        stylesheets = [];
      })
      .finally(() => {
        if (!cancelled) loading = false;
      });
    return () => {
      cancelled = true;
    };
  });
</script>

<nav class="chapter-list" aria-label="Chapters">
  <div class="cl-header">Chapters</div>
  {#if loading}
    <p class="cl-msg">Loading…</p>
  {:else if error}
    <p class="cl-msg cl-error" role="alert">{error}</p>
  {:else if chapters.length === 0}
    <p class="cl-msg">No chapters in this folder.</p>
  {:else}
    <ul class="cl-items">
      {#each chapters as doc (doc.path)}
        <li>
          <button
            class="cl-item"
            class:active={doc.path === selectedPath}
            onclick={() => onSelectFile?.(doc.path)}
            title={doc.name}
            aria-current={doc.path === selectedPath ? "true" : undefined}
          >
            <Icon name="file-text" />
            <span class="cl-name">{doc.display}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if stylesheets.length > 0}
    <div class="cl-header cl-header-sub">Stylesheets</div>
    <ul class="cl-items">
      {#each stylesheets as doc (doc.path)}
        <li>
          <button
            class="cl-item cl-item-css"
            class:active={doc.path === selectedPath}
            onclick={() => onSelectFile?.(doc.path)}
            title={doc.name}
            aria-current={doc.path === selectedPath ? "true" : undefined}
          >
            <Icon name="palette" />
            <span class="cl-name">{doc.display}</span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}
</nav>

<style>
  .chapter-list {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    background: var(--app-surface, var(--app-bg));
    border-right: 1px solid var(--app-border);
    font-size: 13px;
  }
  .cl-header {
    padding: 8px 12px;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--app-text-muted);
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
  }
  .cl-header-sub {
    margin-top: 8px;
    border-top: 1px solid var(--app-border);
  }
  .cl-msg {
    margin: 0;
    padding: 12px;
    color: var(--app-text-faint);
    font-size: 12px;
    line-height: 1.5;
  }
  .cl-error {
    color: var(--app-error-text);
  }
  .cl-items {
    list-style: none;
    margin: 0;
    padding: 4px;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cl-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 7px 8px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    color: var(--app-text-secondary);
    font-size: 13px;
    font-weight: 500;
    text-align: left;
    cursor: pointer;
  }
  .cl-item:hover {
    background: var(--app-control-hover-bg);
  }
  .cl-item.active {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
  .cl-item-css {
    color: var(--app-text-muted);
  }
  .cl-item :global(svg) {
    flex: 0 0 auto;
    width: 15px;
    height: 15px;
  }
  .cl-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
</style>

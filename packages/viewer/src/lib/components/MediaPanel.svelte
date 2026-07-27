<script lang="ts">
  /**
   * MediaPanel (#47) — the Media tab of the editor sidebar.
   *
   * Thumbnail grid of every image under the open project, with a detail view
   * (dimensions / file size / DPI / color space / alpha + plain-language
   * print-readiness notes), insert-at-cursor, drag-to-editor, and an
   * "Add images…" importer.
   *
   * Host work — listing, thumbnails (generated AND cached host-side so
   * multi-MB originals never reach the renderer), inspection, and file
   * copies — goes through `api.media.*`/`api.dialog.*` server routes, the
   * default seam (CLAUDE.md §8); `getPlatform().onFolderChanged` is used only
   * for the live folder-changed push stream, one of the seam's narrower
   * classes. Renderer-side thumbnail state is bounded (THUMB_LIMIT) so a huge
   * project can't balloon memory.
   */
  import { onMount } from "svelte";
  import { getPlatform, isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { MediaImageEntry, MediaImageDetails } from "$lib/platform/dtos";
  import {
    buildPrintWarnings,
    defaultAltText,
    describeColorSpace,
    formatBytes,
    imageMarkdown,
    type MediaWarning,
  } from "$lib/media";
  import Icon from "$lib/components/Icon.svelte";

  let {
    projectDir,
    canInsert = false,
    onInsert,
    sidebarEmbedded = true,
  }: {
    projectDir: string | null;
    /** True when a markdown file is open in the editor (enables Insert). */
    canInsert?: boolean;
    onInsert?: (payload: { src: string; alt: string }) => void;
    sidebarEmbedded?: boolean;
  } = $props();

  /** Max thumbnails held in renderer state (small host-generated data URLs). */
  const THUMB_LIMIT = 400;
  /** Parallel thumbnail requests in flight. */
  const THUMB_CONCURRENCY = 4;

  let images = $state<MediaImageEntry[]>([]);
  let thumbs = $state<Record<string, string | null>>({});
  let loading = $state(false);
  let error = $state<string | null>(null);
  let selected = $state<MediaImageEntry | null>(null);
  let details = $state<MediaImageDetails | null>(null);
  let detailsLoading = $state(false);
  let importBusy = $state(false);
  let notice = $state<string | null>(null);

  let loadSeq = 0;

  async function loadThumbnails(list: MediaImageEntry[], seq: number): Promise<void> {
    const queue = list.slice(0, THUMB_LIMIT);
    let next = 0;
    const worker = async () => {
      while (next < queue.length && seq === loadSeq) {
        const entry = queue[next++];
        try {
          const url = await api.media.thumbnail(entry.path);
          if (seq !== loadSeq) return;
          thumbs[entry.relPath] = url;
        } catch {
          if (seq !== loadSeq) return;
          thumbs[entry.relPath] = null;
        }
      }
    };
    await Promise.all(
      Array.from({ length: THUMB_CONCURRENCY }, () => worker()),
    );
  }

  async function refresh(): Promise<void> {
    const dir = projectDir;
    if (!dir || !isDesktop()) {
      images = [];
      thumbs = {};
      return;
    }
    const seq = ++loadSeq;
    loading = true;
    error = null;
    try {
      const list = await api.media.listImages(dir);
      if (seq !== loadSeq) return;
      images = list;
      thumbs = {}; // bounded: rebuilt per load, never accumulates across loads
      // Keep the detail view alive across a refresh when the file still exists.
      if (selected) {
        const still = list.find((e) => e.relPath === selected!.relPath);
        selected = still ?? null;
        if (!still) details = null;
      }
      void loadThumbnails(list, seq);
    } catch (e: unknown) {
      if (seq !== loadSeq) return;
      error = e instanceof Error ? e.message : String(e);
      images = [];
      thumbs = {};
    } finally {
      if (seq === loadSeq) loading = false;
    }
  }

  // Load on mount + refresh on watcher pushes (debounced — the host already
  // debounces fs:folderChanged; one extra renderer-side guard merges bursts
  // while a refresh is in flight).
  // The parent wraps this component in {#key projectDir} so onMount fires fresh
  // whenever projectDir changes, providing the same re-subscription behaviour.
  let refreshTimer: ReturnType<typeof setTimeout> | null = null;
  onMount(() => {
    selected = null;
    details = null;
    notice = null;
    void refresh();
    if (!projectDir || !isDesktop()) return;
    const off = getPlatform().onFolderChanged(() => {
      if (refreshTimer) clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        void refresh();
      }, 500);
    });
    return () => {
      off();
      if (refreshTimer) {
        clearTimeout(refreshTimer);
        refreshTimer = null;
      }
    };
  });

  // L7: rapid tile clicks each kick off an `api.media.inspect` call; without
  // a sequence guard an earlier click's response can resolve AFTER a later
  // click's and overwrite `details`/`selected` with the wrong image's
  // DPI/print-readiness data. Same pattern `refresh()`'s `loadSeq` already
  // uses for thumbnail loads — a dedicated counter here since selection and
  // thumbnail-loading are independent concerns.
  let selectSeq = 0;

  async function select(entry: MediaImageEntry): Promise<void> {
    const seq = ++selectSeq;
    selected = entry;
    details = null;
    detailsLoading = true;
    try {
      const result = await api.media.inspect(entry.path);
      if (seq !== selectSeq) return;
      details = result;
    } catch {
      if (seq !== selectSeq) return;
      details = null;
    } finally {
      if (seq === selectSeq) detailsLoading = false;
    }
  }

  function extOf(name: string): string {
    return name.slice(name.lastIndexOf(".") + 1).toLowerCase();
  }

  function insertSelected(): void {
    if (!selected) return;
    onInsert?.({ src: selected.relPath, alt: defaultAltText(selected.name) });
  }

  function onDragStart(event: DragEvent, entry: MediaImageEntry): void {
    // CodeMirror accepts plain-text drops natively — dragging a tile into the
    // editor inserts the markdown at the drop position with zero editor code.
    event.dataTransfer?.setData(
      "text/plain",
      imageMarkdown(entry.relPath, defaultAltText(entry.name)),
    );
  }

  async function importImages(): Promise<void> {
    const dir = projectDir;
    if (!dir) return;
    importBusy = true;
    notice = null;
    try {
      const picked = await api.dialog.pickImageFiles();
      if (picked.length === 0) return;
      // Destination policy + path math live in the ONE host-side import
      // route (UX review M10) — same one the editor toolbar's Insert Image
      // dialog calls — so this panel does zero path/fs logic of its own.
      let destName: string | null = null;
      for (const src of picked) {
        const result = await api.media.importImage(dir, src);
        destName ??= result.src.includes("/") ? result.src.slice(0, result.src.indexOf("/")) : null;
      }
      notice = destName
        ? `Added ${picked.length} image${picked.length === 1 ? "" : "s"} to ${destName}/.`
        : `Added ${picked.length} image${picked.length === 1 ? "" : "s"}.`;
      await refresh();
    } catch (e: unknown) {
      notice = null;
      error = e instanceof Error ? e.message : "Could not add the images.";
    } finally {
      importBusy = false;
    }
  }

  const warnings = $derived.by((): MediaWarning[] => {
    if (!selected || detailsLoading) return [];
    return buildPrintWarnings(details, extOf(selected.name));
  });
</script>

<div class="media-panel">
  {#if selected}
    {@const sel = selected}
    <div class="media-header">
      <button class="back-btn" onclick={() => { selected = null; details = null; }}>
        <Icon name="chevron-left" /> All images
      </button>
    </div>
    <div class="media-detail">
      <div class="detail-thumb">
        {#if thumbs[sel.relPath]}
          <img src={thumbs[sel.relPath]} alt={sel.name} />
        {:else}
          <Icon name="image" size={40} />
        {/if}
      </div>
      <h3 class="detail-name" title={sel.relPath}>{sel.name}</h3>
      <p class="detail-path">{sel.relPath}</p>

      {#if detailsLoading}
        <p class="media-msg">Reading image details…</p>
      {:else}
        <dl class="detail-meta">
          {#if details?.info}
            <dt>Dimensions</dt>
            <dd>{details.info.width} × {details.info.height} px</dd>
            <dt>Resolution</dt>
            <dd>{details.info.xDpi} DPI</dd>
            <dt>Color</dt>
            <dd>{describeColorSpace(details.info.colorSpace)}</dd>
            <dt>Transparency</dt>
            <dd>{details.info.hasAlpha ? "Yes" : "No"}</dd>
          {/if}
          <dt>File size</dt>
          <dd>{formatBytes(details?.fileSize ?? sel.size)}</dd>
        </dl>

        <ul class="warnings">
          {#each warnings as w (w.text)}
            <li class={`warning ${w.level}`}>
              <Icon
                name={w.level === "warn" ? "triangle-alert" : w.level === "ok" ? "circle-check" : "info"}
              />
              <span>{w.text}</span>
            </li>
          {/each}
        </ul>
      {/if}

      <div class="detail-actions">
        <button
          class="primary insert-btn app-btn-primary"
          onclick={insertSelected}
          disabled={!canInsert}
          title={canInsert
            ? "Insert into the open document at the cursor"
            : "Open a markdown file in the editor to insert"}
          aria-describedby={!canInsert ? "insert-hint" : undefined}
        >
          Insert into document
        </button>
        {#if !canInsert}
          <p id="insert-hint" class="insert-hint">
            Open a markdown file in the editor to insert images.
          </p>
        {/if}
        <button class="ghost-btn" onclick={() => api.shell.showInFolder(sel.path).catch(() => {})}>
          Show in folder
        </button>
      </div>
    </div>
  {:else}
    <div class="media-header">
      <span class="media-title">Media</span>
      <div class="media-header-actions">
        <button
          class="icon-mini"
          onclick={() => void refresh()}
          title="Refresh"
          aria-label="Refresh image list"
        >
          <Icon name="refresh-cw" size={13} />
        </button>
      </div>
    </div>
    <div class="media-toolbar">
      <button class="primary add-btn app-btn-primary" onclick={() => void importImages()} disabled={importBusy}>
        {importBusy ? "Adding…" : "Add images…"}
      </button>
    </div>
    {#if notice}
      <p class="media-msg media-notice" role="status">{notice}</p>
    {/if}
    {#if loading && images.length === 0}
      <p class="media-msg">Looking for images…</p>
    {:else if error}
      <p class="media-msg media-error" role="alert">{error}</p>
    {:else if images.length === 0}
      <p class="media-msg">
        No images in this project yet. Use “Add images…” to copy some in.
      </p>
    {:else}
      <ul class="media-grid">
        {#each images as entry (entry.relPath)}
          <li>
            <button
              class="media-tile"
              onclick={() => void select(entry)}
              title={`${entry.relPath} — ${formatBytes(entry.size)}`}
              draggable="true"
              ondragstart={(e) => onDragStart(e, entry)}
            >
              <span class="tile-thumb">
                {#if thumbs[entry.relPath]}
                  <img src={thumbs[entry.relPath]} alt={entry.name} loading="lazy" />
                {:else}
                  <Icon name="image" size={22} />
                {/if}
              </span>
              <span class="tile-name">{entry.name}</span>
            </button>
          </li>
        {/each}
      </ul>
    {/if}
  {/if}
</div>

<style>
  .media-panel {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 0;
    overflow-y: auto;
    background: var(--app-surface);
    border-right: 1px solid var(--app-border);
    font-size: 13px;
  }
  .media-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 8px 12px;
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
    min-height: 32px;
  }
  .media-title {
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--app-text);
  }
  .icon-mini {
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
    min-width: 26px;
    min-height: 26px;
  }
  .icon-mini:hover {
    background: var(--app-control-hover-bg);
    color: var(--app-text-secondary);
  }
  .icon-mini:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .media-toolbar {
    padding: 8px 12px 0;
    flex-shrink: 0;
  }
  .add-btn {
    width: 100%;
    padding: 6px 8px;
    font-size: 12px;
  }
  /* Accent buttons — colors come from the shared .app-btn-primary recipe
     (theme.css); only geometry lives here. */
  .primary {
    border-width: 1px;
    border-style: solid;
    border-radius: 6px;
    cursor: pointer;
  }
  .primary:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .media-msg {
    margin: 0;
    padding: 12px;
    color: var(--app-text-muted);
    font-size: 12px;
    line-height: 1.5;
  }
  .media-notice {
    color: var(--app-text-secondary);
    padding-bottom: 0;
  }
  .media-error {
    color: var(--app-error-text);
  }
  .media-grid {
    list-style: none;
    margin: 0;
    padding: 8px;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
    gap: 6px;
  }
  .media-tile {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    gap: 4px;
    width: 100%;
    padding: 4px;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 6px;
    cursor: pointer;
    color: var(--app-text-secondary);
  }
  .media-tile:hover {
    /* surface-hover, not control-hover-bg: muted/faint text inside the tile
       must stay ≥4.5:1 during hover (judge gate round 3: 4.19:1 on #444444). */
    background: var(--app-surface-hover);
    border-color: var(--app-border);
  }
  .tile-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    aspect-ratio: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: 4px;
    /* surface-sunken, not control-hover-bg: this is a PERSISTENT container
       fill (not a hover tint), and the faint placeholder icon inside must
       stay ≥4.5:1 (judge gate round 3: 3.64:1 on #444444 dark). */
    background: var(--app-surface-sunken);
    color: var(--app-text-muted);
  }
  .tile-thumb img {
    width: 100%;
    height: 100%;
    object-fit: cover;
    display: block;
  }
  .tile-name {
    font-size: 10px;
    line-height: 1.3;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    text-align: center;
  }
  /* ── Detail view ── */
  .back-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-height: 26px;
    padding: 4px 6px;
    background: transparent;
    border: none;
    border-radius: 4px;
    color: var(--app-text-secondary);
    font-size: 12px;
    cursor: pointer;
  }
  .back-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .back-btn:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .media-detail {
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    min-width: 0;
  }
  .detail-thumb {
    display: flex;
    align-items: center;
    justify-content: center;
    min-height: 90px;
    max-height: 160px;
    overflow: hidden;
    border-radius: 6px;
    /* surface-sunken for the same contrast reason as .tile-thumb above. */
    background: var(--app-surface-sunken);
    color: var(--app-text-muted);
  }
  .detail-thumb img {
    max-width: 100%;
    max-height: 160px;
    object-fit: contain;
    display: block;
  }
  .detail-name {
    margin: 0;
    font-size: 13px;
    font-weight: 600;
    overflow-wrap: anywhere;
  }
  .detail-path {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-muted);
    overflow-wrap: anywhere;
  }
  .detail-meta {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 2px 10px;
    margin: 0;
    font-size: 12px;
  }
  .detail-meta dt {
    color: var(--app-text-muted);
  }
  .detail-meta dd {
    margin: 0;
    color: var(--app-text-secondary);
  }
  .warnings {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .warning {
    display: flex;
    gap: 6px;
    align-items: flex-start;
    font-size: 11px;
    line-height: 1.45;
    color: var(--app-text-secondary);
  }
  .warning :global(svg) {
    flex: 0 0 auto;
    margin-top: 1px;
  }
  .warning.warn :global(svg) {
    color: var(--app-warning-text);
  }
  .warning.ok :global(svg) {
    color: var(--app-success-text);
  }
  .warning.info :global(svg) {
    color: var(--app-text-muted);
  }
  .detail-actions {
    display: flex;
    flex-direction: column;
    gap: 6px;
    margin-top: 4px;
  }
  .insert-btn {
    padding: 6px 8px;
    font-size: 12px;
  }
  .ghost-btn {
    padding: 5px 8px;
    font-size: 12px;
    background: transparent;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .ghost-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .insert-hint {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-muted);
    line-height: 1.4;
  }
</style>

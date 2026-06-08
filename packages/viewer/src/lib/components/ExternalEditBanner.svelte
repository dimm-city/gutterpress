<script lang="ts">
  /**
   * ExternalEditBanner (#44) — a non-blocking banner shown above the editor when
   * the open file is modified on disk by another process while the buffer has
   * unsaved changes. Never silently overwrites: the author picks Reload (adopt
   * the disk version, discarding in-memory edits) or Keep mine (overwrite disk
   * on the next save). Not a modal — editing stays available.
   */
  import Icon from "$lib/components/Icon.svelte";

  let {
    fileName,
    onReload,
    onKeepMine,
  }: {
    fileName: string;
    onReload: () => void;
    onKeepMine: () => void;
  } = $props();
</script>

<div class="ext-banner" role="alert" aria-live="polite">
  <span class="ext-icon"><Icon name="refresh-cw" /></span>
  <span class="ext-msg">
    <strong>{fileName}</strong> was changed outside print-md.
  </span>
  <span class="ext-actions">
    <button class="ext-btn ext-btn-primary" onclick={onReload}>Reload</button>
    <button class="ext-btn" onclick={onKeepMine}>Keep mine</button>
  </span>
</div>

<style>
  .ext-banner {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 12px;
    background: var(--app-warning-bg, #4a3a10);
    border-bottom: 1px solid var(--app-warning-border, var(--app-border));
    color: var(--app-warning-text, var(--app-text));
    font-size: 13px;
    flex: 0 0 auto;
  }
  .ext-icon {
    display: inline-flex;
    flex: 0 0 auto;
  }
  .ext-icon :global(svg) {
    width: 15px;
    height: 15px;
  }
  .ext-msg {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .ext-actions {
    flex: 0 0 auto;
    display: flex;
    gap: 6px;
  }
  .ext-btn {
    padding: 4px 10px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-control-bg, transparent);
    color: var(--app-text);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .ext-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .ext-btn-primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
</style>

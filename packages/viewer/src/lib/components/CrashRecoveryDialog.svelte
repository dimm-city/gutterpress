<script lang="ts">
  /**
   * CrashRecoveryDialog (#44) — shown on launch when crash-recovery snapshots
   * are found for the opened project (an unclean exit left unsaved edits). The
   * author chooses Restore (load the recovered text into the editor; it saves on
   * the next debounce) or Discard (delete the sidecar only — never the real
   * file). One dialog covers all pending entries; the author resolves each.
   */
  import Icon from "$lib/components/Icon.svelte";

  export interface RecoveryItem {
    filePath: string;
    recoveryPath: string;
    fileName: string;
    savedAt: number;
  }

  let {
    items,
    onRestore,
    onDiscard,
    onDismiss,
  }: {
    items: RecoveryItem[];
    onRestore: (item: RecoveryItem) => void;
    onDiscard: (item: RecoveryItem) => void;
    onDismiss: () => void;
  } = $props();

  function when(ms: number): string {
    try {
      return new Date(ms).toLocaleString();
    } catch {
      return "";
    }
  }
</script>

{#if items.length > 0}
  <div
    class="cr-backdrop"
    role="dialog"
    aria-modal="true"
    aria-labelledby="cr-title"
  >
    <div class="cr-dialog">
      <header class="cr-head">
        <span class="cr-icon"><Icon name="file-text" /></span>
        <h2 id="cr-title">Unsaved changes recovered</h2>
      </header>
      <p class="cr-lede">
        We found unsaved changes from your last session. Restore them into the
        editor, or discard the recovery snapshot.
      </p>
      <ul class="cr-list">
        {#each items as item (item.filePath)}
          <li class="cr-item">
            <div class="cr-item-info">
              <span class="cr-name">{item.fileName}</span>
              <span class="cr-time">{when(item.savedAt)}</span>
            </div>
            <div class="cr-item-actions">
              <button class="cr-btn cr-btn-primary" onclick={() => onRestore(item)}>
                Restore
              </button>
              <button class="cr-btn" onclick={() => onDiscard(item)}>Discard</button>
            </div>
          </li>
        {/each}
      </ul>
      <footer class="cr-foot">
        <button class="cr-btn" onclick={onDismiss}>Decide later</button>
      </footer>
    </div>
  </div>
{/if}

<style>
  .cr-backdrop {
    position: fixed;
    inset: 0;
    z-index: 1000;
    display: grid;
    place-items: center;
    background: rgba(0, 0, 0, 0.5);
    padding: 24px;
  }
  .cr-dialog {
    width: min(520px, 100%);
    max-height: 80vh;
    overflow: auto;
    background: var(--app-surface, var(--app-bg));
    border: 1px solid var(--app-border);
    border-radius: 12px;
    padding: 20px;
    color: var(--app-text);
    box-shadow: 0 12px 40px rgba(0, 0, 0, 0.4);
  }
  .cr-head {
    display: flex;
    align-items: center;
    gap: 10px;
    margin-bottom: 8px;
  }
  .cr-icon :global(svg) {
    width: 18px;
    height: 18px;
  }
  .cr-head h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 700;
  }
  .cr-lede {
    margin: 0 0 16px;
    font-size: 13px;
    line-height: 1.5;
    color: var(--app-text-secondary);
  }
  .cr-list {
    list-style: none;
    margin: 0 0 16px;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cr-item {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 10px 12px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
  }
  .cr-item-info {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .cr-name {
    font-weight: 600;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .cr-time {
    font-size: 11px;
    color: var(--app-text-faint);
  }
  .cr-item-actions {
    flex: 0 0 auto;
    display: flex;
    gap: 6px;
  }
  .cr-foot {
    display: flex;
    justify-content: flex-end;
  }
  .cr-btn {
    padding: 6px 12px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-control-bg, transparent);
    color: var(--app-text);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .cr-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .cr-btn-primary {
    background: linear-gradient(to bottom, var(--app-accent-hover), var(--app-accent));
    border-color: var(--app-accent-border);
    color: var(--app-accent-text);
  }
</style>

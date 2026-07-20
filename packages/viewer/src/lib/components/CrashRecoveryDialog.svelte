<script lang="ts">
  /**
   * CrashRecoveryDialog (#44) — shown on launch when crash-recovery snapshots
   * are found for the opened project (an unclean exit left unsaved edits). The
   * author chooses Restore (load the recovered text into the editor; it saves on
   * the next debounce) or Discard (delete the sidecar only — never the real
   * file). One dialog covers all pending entries; the author resolves each.
   *
   * UX review M38: this dialog is the writer-facing surface for the CRASH-DRAFT
   * subsystem — a different concept from the sync-repair "recovery" flows
   * (RecoveryConfirmDialog/RecoveryGuidanceDialog/RecoveryOverlay). The two
   * subsystems share the word "recovery" internally (this file's name,
   * `electron/recovery.ts`, the `RecoveryItem`/`recoveryPath` identifiers
   * below) but writer-facing copy in THIS dialog must stay inside the
   * "unsaved changes" vocabulary and never say "recovery" — see the naming-map
   * comments at `electron/recovery.ts` / `electron/recovery-bridge.ts` for the
   * full two-domain split.
   *
   * M12 fix (dialog-system migration pilot): adopts the shared `dialogBehavior`
   * action (Escape → "Decide later", ARIA contract owned by the action on the
   * dialog element itself, focus trap + initial focus + focus restore), adds a
   * recovered-vs-on-disk "Compare versions" disclosure per item (mirrors
   * ConflictChoicesDialog's compare pattern) so the writer can see what they're
   * about to restore or discard, and makes Discard two-step (an inline confirm
   * swap on the button, matching the "blind destructive action" fix).
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { dialogBehavior } from "$lib/dialog";

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

  // ── "Compare versions" preview (M12) ───────────────────────────────────────
  // Track which items' disclosure is expanded (path → boolean).
  let previewExpanded = $state<Record<string, boolean>>({});
  /**
   * Memoised preview text (path → result). "loading"/"error" are transient
   * states; the success case carries both texts so the writer can see what
   * they're about to restore or discard before choosing. `onDisk: null` means
   * there is no saved copy on disk yet (e.g. a brand-new file that crashed
   * before its first save) — the pane shows a placeholder instead of an error.
   */
  type RecoveryPreview = { recovered: string; onDisk: string | null };
  let previewCache = $state<Record<string, RecoveryPreview | "loading" | "error">>({});

  /**
   * Toggle the "Compare versions" disclosure for one recovery entry. On first
   * expand, lazily fetches the recovered sidecar text and the current on-disk
   * text and memoises the result so re-toggling doesn't re-fetch (mirrors
   * ConflictChoicesDialog.togglePreview).
   */
  async function togglePreview(item: RecoveryItem) {
    const wasExpanded = previewExpanded[item.filePath] ?? false;
    previewExpanded = { ...previewExpanded, [item.filePath]: !wasExpanded };

    if (wasExpanded || item.filePath in previewCache) return;
    previewCache = { ...previewCache, [item.filePath]: "loading" };
    try {
      const recovered = await api.fs.readFile(item.recoveryPath);
      let onDisk: string | null = null;
      try {
        onDisk = await api.fs.readFile(item.filePath);
      } catch {
        // No on-disk copy (new/never-saved file, or it moved) — not a preview
        // failure, just nothing to compare against.
        onDisk = null;
      }
      previewCache = { ...previewCache, [item.filePath]: { recovered, onDisk } };
    } catch {
      previewCache = { ...previewCache, [item.filePath]: "error" };
    }
  }

  // ── Two-step Discard (M12) ─────────────────────────────────────────────────
  // The first click arms an inline confirm on the SAME button instead of
  // immediately firing the destructive action; a second click while armed
  // confirms. Each item's armed state is independent.
  let confirmingDiscard = $state<Record<string, boolean>>({});

  function requestDiscard(item: RecoveryItem) {
    if (confirmingDiscard[item.filePath]) {
      confirmingDiscard = { ...confirmingDiscard, [item.filePath]: false };
      onDiscard(item);
    } else {
      confirmingDiscard = { ...confirmingDiscard, [item.filePath]: true };
    }
  }

  /**
   * Cancelling puts the Discard button back to its unarmed label. The button
   * itself is one persistent element (its label/class just toggle on `armed`)
   * so a first click never loses focus, but the "Cancel" button that appears
   * alongside it while armed IS removed from the DOM on click — without
   * this, focus would drop to <body>. Explicitly return it to the Discard
   * button so the dialog's focus never lands somewhere unexpected.
   */
  function cancelDiscard(item: RecoveryItem, event: MouseEvent) {
    confirmingDiscard = { ...confirmingDiscard, [item.filePath]: false };
    const row = (event.currentTarget as HTMLElement).closest(".cr-item-actions");
    queueMicrotask(() => row?.querySelector<HTMLButtonElement>(".cr-btn-discard")?.focus());
  }
</script>

{#if items.length > 0}
  <div class="cr-backdrop" onclick={onDismiss} role="presentation"></div>

  <div
    class="cr-dialog"
    use:dialogBehavior={{ onClose: onDismiss, labelledBy: "cr-title" }}
  >
    <header class="cr-head">
      <span class="cr-icon"><Icon name="file-text" /></span>
      <h2 id="cr-title">Unsaved changes found</h2>
    </header>
    <p class="cr-lede">
      The app kept a temporary emergency copy of edits that weren't saved when it
      closed unexpectedly. Restore them into the editor, or discard them. This is
      separate from your previous versions.
    </p>
    <ul class="cr-list">
      {#each items as item (item.filePath)}
        {@const expanded = previewExpanded[item.filePath] ?? false}
        {@const preview = previewCache[item.filePath]}
        {@const armed = confirmingDiscard[item.filePath] ?? false}
        <li class="cr-item">
          <div class="cr-item-row">
            <div class="cr-item-info">
              <span class="cr-name">{item.fileName}</span>
              <span class="cr-time">{when(item.savedAt)}</span>
            </div>
            <div class="cr-item-actions">
              <button class="cr-btn cr-btn-primary" onclick={() => onRestore(item)}>
                Restore
              </button>
              <!-- Single persistent Discard button (not a pair of separate
                   buttons swapped conditionally) so arming the confirm state
                   never loses focus — only the label/class change in place. -->
              <button
                class="cr-btn cr-btn-discard"
                class:cr-btn-danger={armed}
                onclick={() => requestDiscard(item)}
              >
                {armed ? "Really discard? This can't be undone" : "Discard"}
              </button>
              {#if armed}
                <button class="cr-btn" onclick={(e) => cancelDiscard(item, e)}>Cancel</button>
              {/if}
            </div>
          </div>

          <!-- "Compare versions" disclosure (M12) — recovered vs on-disk text,
               so the writer can see what they're restoring/discarding. -->
          <div class="cr-preview-disclosure">
            <button
              class="cr-disclosure-btn"
              aria-expanded={expanded}
              onclick={() => togglePreview(item)}
            >
              <span class="cr-disclosure-arrow" aria-hidden="true">{expanded ? "▾" : "▸"}</span>
              Compare versions
            </button>
            {#if expanded}
              <div class="cr-preview-panes">
                {#if preview === "loading"}
                  <p class="cr-preview-loading" aria-live="polite">Loading preview…</p>
                {:else if preview === "error" || !preview}
                  <p class="cr-preview-unavailable">No preview available for this file.</p>
                {:else}
                  <div class="cr-pane-row">
                    <div class="cr-preview-pane" aria-label="Your unsaved version">
                      <div class="cr-pane-label">Your unsaved changes</div>
                      <pre class="cr-pane-content">{preview.recovered}</pre>
                    </div>
                    <div class="cr-preview-pane" aria-label="Version on disk">
                      <div class="cr-pane-label">Currently on disk</div>
                      {#if preview.onDisk === null}
                        <p class="cr-pane-empty">No saved version on disk yet.</p>
                      {:else}
                        <pre class="cr-pane-content">{preview.onDisk}</pre>
                      {/if}
                    </div>
                  </div>
                {/if}
              </div>
            {/if}
          </div>
        </li>
      {/each}
    </ul>
    <footer class="cr-foot">
      <button class="cr-btn" onclick={onDismiss}>Decide later</button>
    </footer>
  </div>
{/if}

<style>
  .cr-backdrop {
    position: fixed;
    inset: 0;
    z-index: var(--app-z-modal);
    background: rgba(0, 0, 0, 0.5);
  }
  /* Dialog is now a sibling of the backdrop (not a child), so the dialog
     element itself can own the ARIA dialog role/aria-modal via the shared
     action (M12) instead of the backdrop owning them — matches the
     ConflictChoicesDialog/HelpDialog centering pattern. */
  .cr-dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    z-index: calc(var(--app-z-modal) + 1);
    width: min(520px, calc(100% - 48px));
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
    flex-direction: column;
    gap: 8px;
    padding: 10px 12px;
    border: 1px solid var(--app-border);
    border-radius: 8px;
  }
  .cr-item-row {
    display: flex;
    align-items: center;
    gap: 12px;
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
    color: var(--app-text-muted);
  }
  .cr-item-actions {
    flex: 0 0 auto;
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
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
  /* Armed "really discard?" confirm button (M12 two-step Discard). */
  .cr-btn-danger {
    background: var(--app-error-bg);
    border-color: var(--app-error-border);
    color: var(--app-error-text);
  }
  .cr-btn-danger:hover {
    background: var(--app-error-border);
  }

  /* "Compare versions" disclosure — recovered vs on-disk preview panes (M12) */
  .cr-preview-disclosure {
    display: flex;
    flex-direction: column;
    gap: 8px;
  }
  .cr-disclosure-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    background: transparent;
    border: 1px solid var(--app-border);
    border-radius: 5px;
    color: var(--app-text-muted);
    font-size: 11px;
    cursor: pointer;
    padding: 3px 8px;
    align-self: flex-start;
    line-height: 1.5;
  }
  .cr-disclosure-btn:hover {
    color: var(--app-text);
    background: var(--app-control-hover-bg);
  }
  .cr-disclosure-arrow {
    font-size: 10px;
  }
  .cr-preview-panes {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }
  .cr-pane-row {
    display: flex;
    gap: 8px;
  }
  .cr-preview-pane {
    flex: 1 1 0;
    min-width: 0;
    display: flex;
    flex-direction: column;
    border: 1px solid var(--app-border);
    border-radius: 5px;
    overflow: hidden;
  }
  .cr-pane-label {
    font-size: 10px;
    font-weight: 600;
    color: var(--app-text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    padding: 4px 8px;
    background: var(--app-surface-sunken, var(--app-bg));
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
  }
  .cr-pane-content {
    margin: 0;
    padding: 8px;
    font-family: var(--app-font-mono);
    font-size: 11px;
    line-height: 1.5;
    overflow-y: auto;
    max-height: 200px;
    background: var(--app-surface-sunken, var(--app-bg));
    color: var(--app-text-secondary);
    white-space: pre-wrap;
    word-break: break-word;
  }
  .cr-preview-loading,
  .cr-preview-unavailable,
  .cr-pane-empty {
    margin: 0;
    font-size: 11px;
    color: var(--app-text-muted);
    padding: 4px 0;
  }
  .cr-pane-empty {
    padding: 8px;
  }
</style>

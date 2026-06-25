<script lang="ts">
  /**
   * OperationLogDialog — a modal showing the sync/recovery operation log.
   *
   * Displays the timestamped log lines written by the lib's operation-log.ts
   * during sync, recovery, and snapshot operations. The log helps the user
   * (or support) understand what steps ran and where things went wrong.
   *
   * PWA-clean (CLAUDE.md §8 / ADR 0004): uses `getPlatform().readLogFile()` —
   * no direct fs/Node access. The log is fetched from the host on open.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";

  let {
    open = $bindable(false),
    logFilePath,
    triggerEl,
  }: {
    open?: boolean;
    /** Absolute path to the log file (from SyncStatus.logFile). */
    logFilePath?: string | null;
    triggerEl?: HTMLButtonElement | undefined;
  } = $props();

  let dialogEl = $state<HTMLDivElement | undefined>(undefined);
  let logContent = $state<string>("");
  let loading = $state<boolean>(false);
  let error = $state<string>("");

  // Loads the log when the dialog opens (the {#if open} node mounts) and cancels
  // on close (the action's destroy) — no $effect.
  function onOpen(_node: HTMLElement) {
    if (!logFilePath) return;
    loading = true;
    error = "";
    logContent = "";
    queueMicrotask(() => dialogEl?.focus());

    let cancelled = false;
    (async () => {
      try {
        const content = await getPlatform().readLogFile(logFilePath);
        if (cancelled) return;
        if (content === null) error = "The log file could not be found.";
        else logContent = content;
      } catch (e) {
        if (cancelled) return;
        error = e instanceof Error ? e.message : String(e);
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return { destroy() { cancelled = true; } };
  }

  function close() {
    open = false;
    triggerEl?.focus();
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
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

  async function copyLog() {
    if (!logContent) return;
    try {
      await navigator.clipboard.writeText(logContent);
    } catch {
      // Clipboard API unavailable — silently ignore
    }
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    use:onOpen
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="log-title"
    tabindex="-1"
    onkeydown={trapFocus}
  >
    <header class="dialog-header">
      <h2 id="log-title">
        <Icon name="file-text" size={16} />
        Operation log
      </h2>
      <button
        class="close"
        onclick={close}
        title="Close (Esc)"
        aria-label="Close"
      ><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      {#if loading}
        <div class="loading">Loading log…</div>
      {:else if error}
        <div class="error-msg">{error}</div>
      {:else if logContent}
        <pre class="log-pre">{logContent}</pre>
      {:else}
        <div class="empty-msg">No log entries recorded.</div>
      {/if}
    </div>

    <footer class="actions">
      {#if logContent}
        <button class="ghost small" onclick={copyLog}>
          Copy log
        </button>
      {/if}
      <button class="ghost" onclick={close}>Close</button>
    </footer>
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
    background: var(--app-backdrop);
    z-index: 1000;
  }

  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(720px, 94vw);
    max-height: 80vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
    flex-shrink: 0;
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 16px;
    font-weight: 600;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    color: var(--app-text);
  }

  .close {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 28px;
    min-height: 28px;
  }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .loading,
  .empty-msg,
  .error-msg {
    padding: 24px;
    text-align: center;
    font-size: 13px;
    color: var(--app-text-muted);
  }

  .error-msg {
    color: var(--app-error, #c0392b);
  }

  .log-pre {
    margin: 0;
    padding: 12px 14px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    border-radius: 6px;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 55vh;
    overflow-y: auto;
    user-select: text;
  }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    flex-shrink: 0;
    padding: 14px 18px;
    border-top: 1px solid var(--app-border-subtle);
    background: var(--app-surface);
  }

  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }

  .ghost {
    background: transparent;
    color: var(--app-text-muted);
    border: 1px solid var(--app-border);
    cursor: pointer;
    border-radius: 4px;
  }
  .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .ghost:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .small {
    padding: 4px 10px;
    font-size: 11px;
    border-radius: 5px;
  }
</style>

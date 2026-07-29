<script lang="ts">
  /**
   * OperationLogDialog — a modal showing the sync/recovery operation log.
   *
   * Displays the timestamped log lines written by the lib's operation-log.ts
   * during sync, recovery, and snapshot operations. The log helps the user
   * (or support) understand what steps ran and where things went wrong.
   *
   * PWA-clean (CLAUDE.md §8 / ADR 0004): uses `api.log.read()` —
   * no direct fs/Node access. The log is fetched from the host on open.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import { dialogBehavior } from "$lib/dialog";
  import { friendlyHostError } from "$lib/errors";

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

  let logContent = $state<string>("");
  let loading = $state<boolean>(false);
  let error = $state<string>("");

  function loadLog(_el: HTMLElement) {
    if (!logFilePath) return;
    loading = true;
    error = "";
    logContent = "";

    let cancelled = false;
    (async () => {
      try {
        const content = await api.log.read(logFilePath);
        if (cancelled) return;
        if (content === null) {
          error = "The log file could not be found.";
        } else {
          logContent = content;
        }
      } catch (e) {
        if (cancelled) return;
        error = friendlyHostError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) loading = false;
      }
    })();

    return { destroy() { cancelled = true; } };
  }

  function close() {
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    open = false;
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
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div
    class="dlg-shell"
    use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "log-title", focusContainer: true }}
    use:loadLog
  >
    <header class="dlg-header">
      <h2 id="log-title">
        <Icon name="file-text" size={16} />
        Operation log
      </h2>
      <button
        class="dlg-close"
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

    <footer class="dlg-actions">
      {#if logContent}
        <button class="dlg-ghost small" onclick={copyLog}>
          Copy log
        </button>
      {/if}
      <button class="dlg-ghost" onclick={close}>Close</button>
    </footer>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  .dlg-shell {
    width: min(720px, 94vw);
    max-height: 80vh;
  }
  .dlg-header h2 {
    color: var(--app-text);
  }

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
    color: var(--app-error-text);
  }

  .log-pre {
    margin: 0;
    padding: 12px 14px;
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border-subtle);
    border-radius: 6px;
    font-family: var(--app-font-mono);
    font-size: 12px;
    line-height: 1.5;
    color: var(--app-text-secondary);
    white-space: pre-wrap;
    word-break: break-all;
    max-height: 55vh;
    overflow-y: auto;
    user-select: text;
  }

</style>

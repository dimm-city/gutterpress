<script lang="ts">
  /**
   * LogsPanel — the start screen's Logs tab: the app's diagnostic logs,
   * readable in place and one click away from the clipboard, so a writer can
   * paste them into a chat/issue when something needs investigating. Read-only
   * by design — the host's `log/list` + `log/read` routes are confined to the
   * fs-guard's read-only roots (userData/logs).
   *
   * PWA-clean (§8 / ADR 0004): all host work through `api.log.*`.
   */
  import { onMount } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { api } from "$lib/api";
  import type { LogFileEntry } from "$lib/platform/dtos";

  let files = $state<LogFileEntry[]>([]);
  let selectedPath = $state<string | null>(null);
  let content = $state<string>("");
  let loading = $state(true);
  let reading = $state(false);
  let copied = $state(false);
  let errorMessage = $state<string | null>(null);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function loadList(selectFirst = true) {
    loading = true;
    errorMessage = null;
    try {
      files = await api.log.list();
      if (selectFirst) {
        const keep = files.find((f) => f.path === selectedPath);
        const target = keep ?? files[0];
        if (target) await select(target.path);
        else {
          selectedPath = null;
          content = "";
        }
      }
    } catch {
      errorMessage = "The logs couldn't be listed right now.";
    } finally {
      loading = false;
    }
  }

  async function select(path: string) {
    selectedPath = path;
    reading = true;
    try {
      content = (await api.log.read(path)) ?? "";
    } catch {
      content = "";
      errorMessage = "That log couldn't be read right now.";
    } finally {
      reading = false;
    }
  }

  async function copyAll() {
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 2000);
    } catch {
      errorMessage = "Couldn't copy — select the text and copy it manually.";
    }
  }

  function sizeLabel(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  onMount(() => {
    void loadList();
    return () => {
      if (copyTimer) clearTimeout(copyTimer);
    };
  });
</script>

<div class="logs-panel">
  <p class="logs-lede">
    These are Gutterpress's diagnostic logs — what the app did while checking
    for updates, syncing, saving versions, and repairing. When something needs
    investigating, copy a log and paste it into your message. Logs never
    contain your sign-in details.
  </p>

  <div class="logs-toolbar">
    <label class="file-label" for="logs-file-select">Log file</label>
    <select
      id="logs-file-select"
      class="file-select"
      disabled={loading || files.length === 0}
      value={selectedPath ?? ""}
      onchange={(e) => void select((e.currentTarget as HTMLSelectElement).value)}
    >
      {#each files as f (f.path)}
        <option value={f.path}>
          {f.name} — {sizeLabel(f.sizeBytes)}, {new Date(f.modifiedAt).toLocaleString()}
        </option>
      {/each}
    </select>
    <button
      class="toolbar-btn"
      onclick={() => void loadList()}
      disabled={loading}
      title="Reload the log list"
    >
      <Icon name="refresh-cw" size={14} /> Refresh
    </button>
    <button
      class="toolbar-btn primary"
      onclick={() => void copyAll()}
      disabled={!content || reading}
      title="Copy the whole log to the clipboard"
    >
      <Icon name={copied ? "check" : "files"} size={14} />
      {copied ? "Copied" : "Copy log"}
    </button>
  </div>

  {#if errorMessage}
    <p class="logs-error" role="alert">{errorMessage}</p>
  {/if}

  {#if loading}
    <p class="logs-empty" aria-live="polite">Loading logs…</p>
  {:else if files.length === 0}
    <p class="logs-empty">
      No logs yet — they appear once a project has synced, saved a version, or
      been repaired.
    </p>
  {:else}
    <textarea
      class="logs-content"
      readonly
      spellcheck="false"
      aria-label="Log contents"
      value={reading ? "Loading…" : content || "This log is empty."}
    ></textarea>
  {/if}
</div>

<style>
  .logs-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    min-height: 0;
    flex: 1 1 auto;
  }

  .logs-lede {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--app-text-secondary);
  }

  .logs-toolbar {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-wrap: wrap;
  }
  .file-label {
    font-size: 12px;
    color: var(--app-text-muted);
  }
  .file-select {
    flex: 1 1 240px;
    min-width: 0;
    padding: 5px 8px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-sunken);
    color: var(--app-text);
  }
  .file-select:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 1px;
  }

  .toolbar-btn {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    padding: 5px 10px;
    font-size: 12px;
    border-radius: 6px;
    border: 1px solid var(--app-border);
    background: var(--app-surface-sunken);
    color: var(--app-text);
    cursor: pointer;
    white-space: nowrap;
  }
  .toolbar-btn:hover:not(:disabled) {
    background: var(--app-surface-hover);
  }
  .toolbar-btn:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }
  .toolbar-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .toolbar-btn.primary {
    border-color: var(--app-accent-border);
  }

  .logs-error {
    margin: 0;
    padding: 8px 12px;
    border-radius: 6px;
    background: var(--app-error-bg);
    border: 1px solid var(--app-error-border);
    color: var(--app-error-text);
    font-size: 12px;
  }

  .logs-empty {
    margin: 0;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .logs-content {
    flex: 1 1 auto;
    min-height: 260px;
    resize: vertical;
    padding: 10px;
    font-family: var(--app-font-mono);
    font-size: 11px;
    line-height: 1.5;
    border-radius: 6px;
    border: 1px solid var(--app-border-subtle);
    background: var(--app-surface-sunken);
    color: var(--app-text-secondary);
    white-space: pre;
    overflow: auto;
  }
</style>

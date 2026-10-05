<script lang="ts">
  /**
   * ReportProblemPanel — Troubleshooting → Report a problem. Builds the
   * diagnostic bundle (system details, a summary of the open book's manifest,
   * the tail of the app log), shows it in full so the author knows exactly
   * what they are sharing, and offers two ways out: copy it, or copy it AND
   * open a prefilled GitHub issue in the browser (the log tail is too long
   * for a URL, so the issue form asks them to paste it). Nothing is sent by
   * the app itself.
   *
   * PWA-clean (§8): all host work through `api.report.bundle` / `api.shell`.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { isDesktop } from "$lib/platform";
  import type { ProblemReport } from "$lib/platform/dtos";

  let { projectDir = null }: { projectDir?: string | null } = $props();

  let bundle = $state<ProblemReport | null>(null);
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  async function load() {
    loading = true;
    errorMessage = null;
    try {
      if (!isDesktop()) {
        errorMessage = "Problem reports are only available in the desktop app.";
        return;
      }
      bundle = await api.report.bundle(projectDir);
    } catch (e) {
      errorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  async function copy(): Promise<boolean> {
    if (!bundle) return false;
    try {
      await navigator.clipboard.writeText(bundle.report);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1500);
      return true;
    } catch {
      errorMessage = "The report couldn't be copied. Select the text below and copy it yourself.";
      return false;
    }
  }

  async function openIssue() {
    if (!bundle) return;
    await copy();
    try {
      await api.shell.openExternal(bundle.issueUrl);
    } catch {
      errorMessage = "The browser couldn't be opened. Visit github.com/dimm-city/gutterpress/issues/new and paste the report.";
    }
  }

  onMount(() => {
    void load();
    return () => {
      if (copyTimer) clearTimeout(copyTimer);
    };
  });
</script>

<div class="report">
  <p class="intro">
    Found a bug? Everything below is what we need to look into it: your app and system versions,
    how this book is set up (not its text), and the app's recent log. Review it, then copy it or open a
    GitHub issue with it filled in. Nothing is sent until you submit the issue.
  </p>

  {#if loading}
    <p class="status">Gathering details…</p>
  {:else if errorMessage}
    <p class="status error" role="alert">{errorMessage}</p>
  {/if}

  {#if bundle}
    <textarea class="bundle" readonly rows="18" aria-label="Problem report" value={bundle.report}></textarea>
    <div class="actions">
      <button class="ghost" onclick={() => void copy()}>{copied ? "Copied!" : "Copy report"}</button>
      <button class="app-btn-primary primary" onclick={() => void openIssue()} title="Copies the report, then opens a GitHub issue form with the details filled in">
        Open GitHub issue
      </button>
    </div>
    <p class="hint">
      The issue form needs a free GitHub account. The log section is copied for you — paste it into the form's
      "App log" field. No account? Copy the report and send it to us another way.
    </p>
  {:else if !loading && !errorMessage}
    <button class="ghost" onclick={() => void load()}>Retry</button>
  {/if}
</div>

<style>
  .report { font-size: 13px; color: var(--app-text-secondary); }
  .intro { margin: 0 0 14px; font-size: 12px; color: var(--app-text-muted); }
  .status { margin: 8px 0; }
  .status.error { color: var(--app-error-text); }
  .bundle {
    width: 100%;
    box-sizing: border-box;
    resize: vertical;
    padding: 10px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-sunken);
    color: var(--app-text-secondary);
    font-family: var(--app-font-mono);
    font-size: 11px;
    line-height: 1.5;
    white-space: pre;
  }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 12px 0 0;
  }
  .ghost {
    background: transparent;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
  .primary {
    padding: 5px 12px; font-size: 12px; border-radius: 6px;
    border-width: 1px; border-style: solid; cursor: pointer;
  }
  .hint { margin: 10px 0 0; font-size: 11px; color: var(--app-text-muted); }
</style>

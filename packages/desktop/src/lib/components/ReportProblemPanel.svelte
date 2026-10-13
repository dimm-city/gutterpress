<script lang="ts">
  /**
   * ReportProblemPanel — Troubleshooting → Report a problem. Asks the author
   * the bug form's questions (summary, what happened, what they expected,
   * steps), shows the details the app adds itself (system, a summary of the
   * open book's manifest, the tail of the app log) so they see exactly what
   * they share, then copies everything and opens the GitHub issue form with
   * every field filled in — the log keeps its newest lines that fit the link.
   * Screenshots and files are the one thing a link cannot carry; the panel
   * says where they go. Nothing is sent by the app itself.
   *
   * PWA-clean (§8): all host work through `api.report.bundle` / `api.shell`.
   */
  import { onMount } from "svelte";
  import { api } from "$lib/api";
  import { buildIssueUrl, reportText } from "$lib/issue-report";
  import type { ProblemReport } from "$lib/platform/dtos";

  let { projectDir = null }: { projectDir?: string | null } = $props();

  let bundle = $state<ProblemReport | null>(null);
  let loading = $state(true);
  let errorMessage = $state<string | null>(null);
  let copied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  let title = $state("");
  let whatHappened = $state("");
  let expected = $state("");
  let steps = $state("");
  let answers = $derived({ title, whatHappened, expected, steps });
  let issue = $derived(bundle ? buildIssueUrl(answers, bundle) : null);

  async function load() {
    loading = true;
    errorMessage = null;
    try {
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
      await navigator.clipboard.writeText(reportText(answers, bundle.report));
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
    if (!issue) return;
    await copy();
    try {
      await api.shell.openExternal(issue.url);
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
    Found a bug? Answer a few questions, and the app fills in the rest of the GitHub issue for you: your app and
    system versions, how this book is set up (not its text), and the app's recent log. Nothing is sent until you
    submit the issue on GitHub.
  </p>

  <div class="fields">
    <label>
      <span class="label">Short summary</span>
      <input type="text" bind:value={title} placeholder="PDF export stops at 40%" />
    </label>
    <label>
      <span class="label">What happened? <span class="req">(needed)</span></span>
      <span class="help">What went wrong? Include any error message, word for word.</span>
      <textarea rows="3" bind:value={whatHappened}></textarea>
    </label>
    <label>
      <span class="label">What did you expect?</span>
      <textarea rows="2" bind:value={expected}></textarea>
    </label>
    <label>
      <span class="label">Steps to reproduce</span>
      <span class="help">The fewest steps that show the problem, starting from opening the app.</span>
      <textarea rows="3" bind:value={steps} placeholder={"1. Open …\n2. Click …\n3. See …"}></textarea>
    </label>
  </div>

  {#if loading}
    <p class="status">Gathering details…</p>
  {:else if errorMessage}
    <p class="status error" role="alert">{errorMessage}</p>
  {/if}

  {#if bundle}
    <details class="added">
      <summary>Added for you: system, book setup and app log</summary>
      <textarea class="bundle" readonly rows="14" aria-label="Problem report" value={bundle.report}></textarea>
    </details>

    <div class="next">
      <p class="next-title">On GitHub, before you press "Create":</p>
      <ol>
        <li>Sign in. The issue form needs a free GitHub account.</li>
        <li>
          Add screenshots or files in <strong>Screenshots or files</strong>: drag them into the box. A picture of
          the problem, or a small sample that shows it (one chapter, the image, a zipped cut-down book), helps the
          most. The app can't attach files for you; remove anything private first.
        </li>
        <li>Check the answers and the title, then create the issue.</li>
      </ol>
      {#if issue?.logTrimmed}
        <p class="note">
          The log was too long for the link, so its earliest lines were left out. The full report is copied to your
          clipboard when the form opens; paste it into <strong>App log</strong> if you want to include all of it.
        </p>
      {/if}
    </div>

    <div class="actions">
      <button class="ghost" onclick={() => void copy()}>{copied ? "Copied!" : "Copy report"}</button>
      <button
        class="app-btn-primary primary"
        onclick={() => void openIssue()}
        disabled={!whatHappened.trim()}
        title={whatHappened.trim() ? "Copies the report, then opens the GitHub issue form with everything filled in" : "Say what happened first"}
      >
        Open GitHub issue
      </button>
    </div>
    <p class="hint">No GitHub account? Copy the report and send it to us another way.</p>
  {:else if !loading && !errorMessage}
    <button class="ghost" onclick={() => void load()}>Retry</button>
  {/if}
</div>

<style>
  .report { font-size: 13px; color: var(--app-text-secondary); }
  .intro { margin: 0 0 14px; font-size: 12px; color: var(--app-text-muted); }
  .fields { display: flex; flex-direction: column; gap: 10px; margin-bottom: 12px; }
  .fields label { display: flex; flex-direction: column; gap: 3px; }
  .label { font-size: 12px; font-weight: 500; color: var(--app-text); }
  .req { font-weight: 400; color: var(--app-text-muted); }
  .help { font-size: 11px; color: var(--app-text-muted); }
  .fields input,
  .fields textarea {
    box-sizing: border-box;
    width: 100%;
    padding: 6px 8px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-sunken);
    color: var(--app-text);
    font: inherit;
    font-size: 12px;
    resize: vertical;
  }
  .status { margin: 8px 0; }
  .status.error { color: var(--app-error-text); }
  .added { margin: 4px 0 12px; }
  .added summary { cursor: pointer; font-size: 12px; color: var(--app-info-text); }
  .bundle {
    width: 100%;
    box-sizing: border-box;
    margin-top: 8px;
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
  .next { font-size: 12px; color: var(--app-text-muted); }
  .next-title { margin: 0 0 4px; color: var(--app-text-secondary); }
  .next ol { margin: 0; padding-left: 20px; }
  .next li { margin-bottom: 4px; }
  .note { margin: 8px 0 0; }
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
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .hint { margin: 10px 0 0; font-size: 11px; color: var(--app-text-muted); }
</style>

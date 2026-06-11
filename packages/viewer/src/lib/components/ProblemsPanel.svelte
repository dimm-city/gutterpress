<script lang="ts">
  /**
   * ProblemsPanel (#28) — a bottom strip (VS Code-style) listing the project's
   * lint findings: file, line, plain-language message, and the originating
   * check. Entirely presentational: the page owns the data (refreshed on each
   * live-preview rebuild) and the click-to-open navigation.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProblemEntry } from "$lib/platform/contract";
  import { friendlySource, groupProblems, problemCounts } from "$lib/problems";

  let {
    problems,
    loading = false,
    onSelect,
    onClose,
  }: {
    problems: ProblemEntry[];
    loading?: boolean;
    onSelect?: (problem: ProblemEntry) => void;
    onClose?: () => void;
  } = $props();

  let groups = $derived(groupProblems(problems));
  let counts = $derived(problemCounts(problems));

  const SEVERITY_ICON = {
    error: "circle-x",
    warning: "triangle-alert",
    info: "info",
  } as const;
  const SEVERITY_LABEL = {
    error: "Error",
    warning: "Warning",
    info: "Note",
  } as const;
</script>

<section class="problems-panel" aria-label="Problems">
  <header class="panel-header">
    <h2 class="panel-title">Problems</h2>
    {#if counts.badge > 0}
      <span class="panel-counts">
        {#if counts.errors > 0}
          <span class="count error-count">
            <Icon name="circle-x" size={13} />
            {counts.errors}
          </span>
        {/if}
        {#if counts.warnings > 0}
          <span class="count warning-count">
            <Icon name="triangle-alert" size={13} />
            {counts.warnings}
          </span>
        {/if}
      </span>
    {/if}
    {#if loading}
      <span class="panel-status" role="status">Checking…</span>
    {/if}
    <span class="header-spacer"></span>
    <button
      class="close-btn"
      onclick={() => onClose?.()}
      title="Close problems panel"
      aria-label="Close problems panel"
    >
      <Icon name="x" size={14} />
    </button>
  </header>

  <div class="panel-body">
    {#if problems.length === 0}
      <div class="empty-state" role="status">
        <span class="empty-icon"><Icon name="circle-check" size={18} /></span>
        <p class="empty-text">
          {loading ? "Checking your project…" : "No problems found — your project looks good!"}
        </p>
      </div>
    {:else}
      <ul class="group-list">
        {#each groups as group (group.file)}
          <li class="group">
            <div class="group-file" title={group.filePath ?? group.file}>
              <Icon name="file-text" size={13} />
              <span class="group-file-name">{group.file}</span>
              <span class="group-count">{group.entries.length}</span>
            </div>
            <ul class="entry-list">
              {#each group.entries as entry, i (i)}
                <li>
                  <button
                    class="entry"
                    class:clickable={!!entry.filePath}
                    onclick={() => entry.filePath && onSelect?.(entry)}
                    disabled={!entry.filePath}
                    title={entry.filePath
                      ? "Open this file at the problem"
                      : undefined}
                  >
                    <span class="entry-severity sev-{entry.severity}">
                      <Icon name={SEVERITY_ICON[entry.severity]} size={14} />
                      <span class="sr-only">{SEVERITY_LABEL[entry.severity]}:</span>
                    </span>
                    <span class="entry-message">{entry.message}</span>
                    <span class="entry-source">{friendlySource(entry.source)}</span>
                    {#if entry.line}
                      <span class="entry-line">line {entry.line}</span>
                    {/if}
                  </button>
                </li>
              {/each}
            </ul>
          </li>
        {/each}
      </ul>
    {/if}
  </div>
</section>

<style>
  .problems-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    max-height: 32vh;
    min-height: 0;
    border-top: 1px solid var(--app-border);
    background: var(--app-surface-raised);
    color: var(--app-text);
  }

  .panel-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 6px 12px;
    border-bottom: 1px solid var(--app-border);
    flex-shrink: 0;
  }
  .panel-title {
    margin: 0;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--app-text-secondary);
  }
  .panel-counts {
    display: inline-flex;
    align-items: center;
    gap: 10px;
    font-size: 12px;
    font-variant-numeric: tabular-nums;
  }
  .count {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }
  .error-count { color: var(--app-error-text); }
  .warning-count { color: var(--app-warning-text); }
  .panel-status {
    font-size: 11px;
    color: var(--app-text-faint);
  }
  .header-spacer { flex: 1; }
  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    padding: 3px 5px;
    cursor: pointer;
  }
  .close-btn:hover {
    background: var(--app-control-hover-bg);
    color: var(--app-text);
  }

  .panel-body {
    overflow-y: auto;
    min-height: 0;
  }

  /* Empty state — friendly, icon + color (not color-only) */
  .empty-state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
  }
  .empty-icon {
    display: inline-flex;
    color: var(--app-success-text, #2e7d32);
  }
  .empty-text {
    margin: 0;
    font-size: 13px;
    color: var(--app-text-secondary);
  }

  .group-list,
  .entry-list {
    list-style: none;
    margin: 0;
    padding: 0;
  }
  .group { padding: 4px 0; }
  .group-file {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 4px 12px 2px;
    font-size: 12px;
    font-weight: 650;
    color: var(--app-text-secondary);
  }
  .group-file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .group-count {
    flex: 0 0 auto;
    font-weight: 500;
    font-size: 11px;
    color: var(--app-text-faint);
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 999px;
    padding: 0 7px;
    line-height: 16px;
  }

  .entry {
    display: flex;
    align-items: baseline;
    gap: 8px;
    width: 100%;
    text-align: left;
    background: transparent;
    border: none;
    border-radius: 0;
    padding: 4px 12px 4px 28px;
    font-size: 13px;
    color: var(--app-text);
    cursor: default;
    white-space: normal;
  }
  .entry.clickable { cursor: pointer; }
  .entry.clickable:hover {
    background: var(--app-control-hover-bg);
  }
  .entry:disabled { opacity: 1; cursor: default; }

  .entry-severity {
    flex: 0 0 auto;
    display: inline-flex;
    align-self: center;
  }
  .sev-error { color: var(--app-error-text); }
  .sev-warning { color: var(--app-warning-text); }
  .sev-info { color: var(--app-info-text); }

  .entry-message {
    flex: 1 1 auto;
    min-width: 0;
    line-height: 1.4;
    overflow-wrap: anywhere;
  }
  .entry-source {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--app-text-muted);
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 4px;
    padding: 1px 6px;
    align-self: center;
  }
  .entry-line {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--app-text-faint);
    font-variant-numeric: tabular-nums;
    align-self: center;
  }

  .sr-only {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }
</style>

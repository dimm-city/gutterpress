<script lang="ts">
  /**
   * ProblemsPanel (#28) — the list of the project's lint findings (VS Code-
   * style): file, line, plain-language message, and the originating check.
   * Entirely presentational: the page owns the data (refreshed on each
   * live-preview rebuild) and the click-to-open navigation.
   *
   * This is the LIST only. The toggle lives in the StatusBar, because it has to
   * sit between that bar's other items — while the list needs a row of its own
   * above the bar, in normal flow, so that opening it pushes the workspace up
   * instead of covering the left panel and the editor (#307). Renders nothing
   * visible while collapsed.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import {
    closesPanelOnEscape,
    closesPanelOnSelect,
    friendlySource,
    groupProblems,
    problemCounts,
    problemsSummary,
    splitProblemMessage,
  } from "$lib/problems";

  let {
    problems,
    loading = false,
    open = $bindable(false),
    onSelect,
    error = null,
    compact = false,
  }: {
    problems: ProblemEntry[];
    loading?: boolean;
    /** Whether the panel body is expanded. */
    open?: boolean;
    onSelect?: (problem: ProblemEntry) => void;
    /**
     * Set when the lint API call itself failed (network/host/hooks-not-
     * registered error), as distinct from a clean run that found zero
     * problems. Rendered as a neutral row — NOT the green "all clear" state
     * — so a broken checker is never mistaken for a validated project (#28,
     * M5).
     */
    error?: string | null;
    /**
     * L9: below 820px (the app's single-pane layout) the list has no room to
     * grow out of the bar — it is presented as a full-viewport sheet instead
     * (see `.problems-panel.compact` below), with its own Close button.
     */
    compact?: boolean;
  } = $props();

  let groups = $derived(groupProblems(problems));

  /**
   * L9 regression fix: in compact mode the expanded body is a full-viewport
   * sheet that visually covers the toggle in the bar below it, so the toggle's
   * own collapse click can no longer reach it (the sheet intercepts the
   * click). Selecting a problem should also return the writer to the
   * now-unobscured editor rather than leaving the sheet open on top of it.
   */
  function selectEntry(entry: ProblemEntry) {
    onSelect?.(entry);
    if (closesPanelOnSelect(compact)) open = false;
  }

  /** Escape closes the compact overlay in place — there is otherwise no
   *  dismiss path once the toggle strip is covered (see selectEntry above). */
  function handleWindowKeydown(e: KeyboardEvent) {
    if (closesPanelOnEscape(compact, open, e.key)) {
      open = false;
    }
  }

  // Polite live region: announce error/warning counts when lint completes.
  let lintAnnouncement = $derived.by<string>(() => {
    if (loading) return "";
    if (error) return "Problems: we couldn't check your project this time";
    const summary = problemsSummary(problemCounts(problems));
    return summary ? `Problems: ${summary}` : "";
  });

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

<svelte:window onkeydown={handleWindowKeydown} />

<!-- Polite live region: announces error/warning counts when lint completes -->
<div role="status" aria-live="polite" aria-atomic="true" class="sr-only">{lintAnnouncement}</div>

<section
  class="problems-panel"
  class:expanded={open}
  class:compact
  aria-label="Problems"
>
  <!-- Panel body — shown only when expanded. The StatusBar's toggle controls it
       (aria-controls="problems-body"). -->
  <div
    id="problems-body"
    class="panel-body"
    role="region"
    aria-label="Problems list"
    aria-hidden={!open}
  >
    {#if compact}
      <!-- L9: the compact overlay has no other reachable dismiss control
           (see selectEntry/handleWindowKeydown above) — give it one directly. -->
      <div class="panel-body-bar">
        <span class="panel-body-bar-title">Problems</span>
        <button
          class="panel-close-btn"
          onclick={() => (open = false)}
          aria-label="Close problems panel"
          title="Close problems panel"
        >
          <Icon name="x" size={15} />
          Close
        </button>
      </div>
    {/if}
    {#if error}
      <div class="empty-state" role="status">
        <span class="empty-icon neutral-icon"><Icon name="info" size={18} /></span>
        <p class="empty-text">{error}</p>
      </div>
    {:else if problems.length === 0}
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
                {@const parts = splitProblemMessage(entry.message)}
                <li>
                  {#if entry.filePath}
                    <button
                      class="entry clickable"
                      onclick={() => selectEntry(entry)}
                      title="Open this file at the problem"
                    >
                      <span class="entry-severity sev-{entry.severity}">
                        <Icon name={SEVERITY_ICON[entry.severity]} size={14} />
                        <span class="sr-only">{SEVERITY_LABEL[entry.severity]}:</span>
                      </span>
                      <span class="entry-message">{parts.text}</span>
                      {#if parts.code}<span class="entry-code">{parts.code}</span>{/if}
                      <span class="entry-source">{friendlySource(entry.source)}</span>
                      {#if entry.line}
                        <span class="entry-line">line {entry.line}</span>
                      {/if}
                    </button>
                  {:else}
                    <div class="entry non-clickable">
                      <span class="entry-severity sev-{entry.severity}">
                        <Icon name={SEVERITY_ICON[entry.severity]} size={14} />
                        <span class="sr-only">{SEVERITY_LABEL[entry.severity]}:</span>
                      </span>
                      <span class="entry-message">{parts.text}</span>
                      {#if parts.code}<span class="entry-code">{parts.code}</span>{/if}
                      <span class="entry-source">{friendlySource(entry.source)}</span>
                    </div>
                  {/if}
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
  /* In normal flow, directly above the status bar: opening the list makes the
     workspace above it shorter instead of drawing over it (#307). The section
     holds only the body, so collapsed it takes no space at all. */
  .problems-panel {
    flex-shrink: 0;
    color: var(--app-text);
  }
  /* Body only shown when expanded */
  .problems-panel .panel-body {
    display: none;
    overflow-y: auto;
    min-height: 0;
    max-height: 32vh;
    background: var(--app-surface-raised);
    border-top: 1px solid var(--app-border);
  }
  .problems-panel.expanded .panel-body {
    display: block;
  }

  /* L9: below 820px there is no room for a row of its own — the list becomes a
     full-viewport sheet (below the toolbar, above everything else short of app
     dialogs). The toggle in the status bar stays where it is, under the sheet. */
  .problems-panel.compact .panel-body {
    position: fixed;
    top: 56px;
    right: 0;
    bottom: 0;
    left: 0;
    max-height: none;
    z-index: var(--app-z-sheet);
  }

  /* ── Panel body ──────────────────────────────────────────────────────────── */
  /* L9: compact-only header bar with an always-reachable close control. Sticky
     (not static) so it stays visible at the top of the overlay while the
     problems list beneath it scrolls. */
  .panel-body-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 10px 12px;
    background: var(--app-surface-raised);
    border-bottom: 1px solid var(--app-border);
  }
  .panel-body-bar-title {
    font-size: 13px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--app-text-secondary);
  }
  .panel-close-btn {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    padding: 6px 10px;
    border: 1px solid var(--app-border-strong);
    border-radius: 4px;
    background: transparent;
    color: var(--app-text);
    font-size: 12px;
    cursor: pointer;
  }
  .panel-close-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .panel-close-btn:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }

  .empty-state {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 14px 16px;
  }
  .empty-icon {
    display: inline-flex;
    color: var(--app-success-text);
  }
  /* Neutral (NOT green) — a lint-runner failure is not a validated all-clear. */
  .neutral-icon {
    color: var(--app-text-secondary);
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
    font-weight: 600;
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
    /* muted (not faint): faint on the control background is 4.25:1 in dark
       mode — below AA. Muted clears 4.9:1 (2026-06 judge gate, round 3). */
    color: var(--app-text-muted);
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
  .entry.clickable:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .entry.non-clickable { cursor: default; }

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
    /* MUST use --app-text-secondary here, NOT muted/faint.
       Muted/faint text on a control-hover surface (#e4e4e7 light / #333333 dark)
       fails WCAG AA. Never use muted or faint colors directly on interactive hover rows. */
    color: var(--app-text-secondary);
    background: var(--app-control-bg);
    border: 1px solid var(--app-control-border);
    border-radius: 4px;
    padding: 1px 6px;
    align-self: center;
  }
  .entry-line {
    flex: 0 0 auto;
    font-size: 11px;
    color: var(--app-text-muted);
    font-variant-numeric: tabular-nums;
    align-self: center;
  }

  /* M32: the rule code (e.g. "MD013/line-length") is a demoted suffix, not
     part of the headline — small, muted, monospace, never competing with
     .entry-message for attention. */
  .entry-code {
    flex: 0 0 auto;
    font-size: 11px;
    font-family: var(--app-font-mono);
    color: var(--app-text-muted);
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

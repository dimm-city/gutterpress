<script lang="ts">
  /**
   * ProblemsPanel (#28) — the list of the project's lint findings (VS Code-
   * style): file, line, plain-language message, and the originating check.
   * Entirely presentational: the page owns the data (refreshed on each
   * live-preview rebuild) and the click-to-open navigation.
   *
   * This is the LIST only. The toggle is the editor toolbar's Problems badge;
   * the page renders this list at the bottom of the editor pane, in normal
   * flow, so opening it shortens the editor and never covers the preview —
   * problems are an editing concern. Renders nothing visible while collapsed.
   *
   * A plain disclosure, like the editor toolbar's popups: the page moves
   * focus into the list on open (`focusList`), and Escape / Close hand focus
   * back to the toggle. No focus trap — it is a panel, not a modal.
   */
  import Icon from "$lib/components/Icon.svelte";
  import Spinner from "$lib/components/Spinner.svelte";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import {
    closesPanelOnEscape,
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
    toggleEl = null,
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
     * — so a broken checker is never mistaken for a validated project (#28).
     */
    error?: string | null;
    /** The toolbar badge that opens this list — Escape and Close return focus here. */
    toggleEl?: HTMLButtonElement | null;
  } = $props();

  let groups = $derived(groupProblems(problems));
  let bodyEl = $state<HTMLDivElement | null>(null);

  /**
   * Move focus into the list just opened: its first entry, or — when it only
   * shows a message — the body itself (tabindex="-1"), so the next Tab or
   * Escape acts on the list rather than on whatever was behind it. Called by
   * the StatusBar right after it opens the list.
   */
  export function focusList() {
    (bodyEl?.querySelector<HTMLElement>(".entry.clickable") ?? bodyEl)?.focus();
  }

  /** Close the list and hand focus back to the toggle that opened it. */
  function closeToToggle() {
    open = false;
    toggleEl?.focus();
  }

  function selectEntry(entry: ProblemEntry) {
    onSelect?.(entry);
  }

  /** Escape from inside the list closes it (and only from inside, so an
   *  unrelated Escape elsewhere never collapses it). */
  function handleWindowKeydown(e: KeyboardEvent) {
    const focusInside = !!bodyEl && bodyEl.contains(e.target as Node | null);
    if (closesPanelOnEscape(open, e.key, focusInside)) {
      closeToToggle();
    }
  }

  // Polite live region: announce error/warning counts when lint completes.
  let lintAnnouncement = $derived.by<string>(() => {
    if (loading) return "";
    if (error) return "Problems: we couldn't check your book this time";
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
  aria-label="Problems"
>
  <!-- Panel body — shown only when expanded. The StatusBar's toggle controls it
       (aria-controls="problems-body"). tabindex="-1": focusList() lands here
       when the list shows only a message, so Escape still works. -->
  <div
    bind:this={bodyEl}
    id="problems-body"
    class="panel-body"
    role="region"
    aria-label="Problems list"
    aria-hidden={!open}
    tabindex="-1"
  >
    <!-- A close control in the panel's own top-right corner, so it can be
         dismissed from where the writer is looking. -->
    <div class="panel-body-bar">
      <span class="panel-body-bar-title">Problems</span>
      <button
        class="panel-close-btn"
        onclick={closeToToggle}
        aria-label="Close problems panel"
        title="Close problems panel (Esc)"
      >
        <Icon name="x" size={15} />
      </button>
    </div>
    {#if error}
      <div class="empty-state" role="status">
        <span class="empty-icon neutral-icon"><Icon name="info" size={18} /></span>
        <p class="empty-text">{error}</p>
      </div>
    {:else if problems.length === 0}
      <div class="empty-state" role="status">
        <span class="empty-icon">
          {#if loading}<Spinner size={16} />{:else}<Icon name="circle-check" size={18} />{/if}
        </span>
        <p class="empty-text">
          {loading ? "Checking your book…" : "No problems found — your book looks good!"}
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
  /* In normal flow at the bottom of the editor pane: opening the list makes
     the editor above it shorter instead of drawing over anything (#307). The
     section holds only the body, so collapsed it takes no space at all. */
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
  /* Keyboard focus on the body itself (a message-only list): show it. */
  .problems-panel .panel-body:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }

  /* ── Panel body ──────────────────────────────────────────────────────────── */
  /* Header bar with the close control. Sticky (not static) so it stays
     visible at the top while the problems list beneath it scrolls. */
  .panel-body-bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    position: sticky;
    top: 0;
    z-index: 1;
    padding: 6px 8px 6px 12px;
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
    justify-content: center;
    padding: 4px;
    min-width: 28px;
    min-height: 28px;
    border: 1px solid transparent;
    border-radius: 4px;
    background: transparent;
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .panel-close-btn:hover {
    background: var(--app-control-hover-bg);
    color: var(--app-text);
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
  /* Neutral (NOT green) — a check-runner failure is not a validated all-clear. */
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

  /* The rule code (e.g. "MD013/line-length") is a demoted suffix, not
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

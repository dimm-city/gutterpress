<script lang="ts">
  /**
   * ProblemsPanel (#28) — a bottom strip (VS Code-style) listing the project's
   * lint findings: file, line, plain-language message, and the originating
   * check. Entirely presentational: the page owns the data (refreshed on each
   * live-preview rebuild) and the click-to-open navigation.
   *
   * The panel owns its own toggle strip (the top border strip is always
   * visible; clicking it expands/collapses the body). The toggle does NOT
   * live in the navbar any more.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import {
    closesPanelOnEscape,
    closesPanelOnSelect,
    friendlySource,
    groupProblems,
    problemCounts,
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
     * L9: below 820px the host (StatusBar) has no room for the "Problems"
     * label/status text — this shrinks the toggle strip to an icon + count
     * badge (an explicit aria-label carries what the hidden text used to
     * convey) while leaving the expand/collapse behavior untouched. The host
     * is responsible for presenting the expanded body as an overlay in this
     * mode; this component only changes the toggle strip's content.
     */
    compact?: boolean;
  } = $props();

  let groups = $derived(groupProblems(problems));
  let counts = $derived(problemCounts(problems));

  /**
   * L9 regression fix: in compact mode the expanded body is presented by the
   * host (StatusBar) as a full-viewport overlay that visually covers the
   * toggle strip below it, so the strip's own collapse click can no longer
   * reach it (the overlay intercepts the click). Selecting a problem should
   * also return the writer to the now-unobscured editor rather than leaving
   * the overlay open on top of it.
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
    if (problems.length === 0) return "";
    const e = counts.errors;
    const w = counts.warnings;
    const parts: string[] = [];
    if (e > 0) parts.push(`${e} ${e === 1 ? "error" : "errors"}`);
    if (w > 0) parts.push(`${w} ${w === 1 ? "warning" : "warnings"}`);
    return parts.length > 0 ? `Problems: ${parts.join(", ")}` : "";
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
  <!-- Toggle strip — always visible at the bottom edge.
       Uses a <button> with aria-expanded so screen readers announce state. -->
  <button
    class="toggle-strip"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-controls="problems-body"
    title={open ? "Collapse problems panel" : "Expand problems panel"}
    aria-label={compact
      ? `Problems${loading ? ": checking" : error ? ": couldn't check" : counts.badge > 0 ? `: ${counts.badge} ${counts.badge === 1 ? "issue" : "issues"}` : ": none"}`
      : undefined}
  >
    <span class="strip-left">
      <Icon name={error ? "info" : counts.badge > 0 ? "triangle-alert" : "circle-check"} size={13} />
      <span class="strip-title">Problems</span>
      {#if counts.badge > 0}
        <span class="strip-counts">
          {#if counts.errors > 0}
            <span class="strip-count error-count">
              <Icon name="circle-x" size={12} />
              {counts.errors}
            </span>
          {/if}
          {#if counts.warnings > 0}
            <span class="strip-count warning-count">
              <Icon name="triangle-alert" size={12} />
              {counts.warnings}
            </span>
          {/if}
        </span>
      {/if}
      {#if loading}
        <span class="strip-status" role="status">Checking…</span>
      {:else if error}
        <span class="strip-status" role="status">Couldn't check</span>
      {/if}
    </span>
    <span class="strip-chevron" aria-hidden="true">
      <Icon name={open ? "chevron-down" : "chevron-up"} size={13} />
    </span>
  </button>

  <!-- Panel body — shown only when expanded -->
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
  .problems-panel {
    display: flex;
    flex-direction: column;
    flex-shrink: 0;
    background: var(--app-surface-raised);
    color: var(--app-text);
    border-top: 1px solid var(--app-border);
  }
  /* Body only shown when expanded */
  .problems-panel .panel-body {
    display: none;
    overflow-y: auto;
    min-height: 0;
    max-height: 32vh;
  }
  .problems-panel.expanded .panel-body {
    display: block;
  }

  /* ── Toggle strip ──────────────────────────────────────────────────────── */
  .toggle-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 5px 12px;
    background: transparent;
    border: none;
    border-bottom: 1px solid transparent;
    cursor: pointer;
    font-size: 12px;
    color: var(--app-text-secondary);
    text-align: left;
    min-height: 30px;
    gap: 8px;
  }
  .expanded .toggle-strip {
    border-bottom-color: var(--app-border);
  }
  .toggle-strip:hover {
    background: var(--app-control-hover-bg);
  }
  .toggle-strip:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .strip-left {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 1;
    min-width: 0;
  }
  .strip-title {
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.4px;
    color: var(--app-text-secondary);
  }
  .strip-counts {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-variant-numeric: tabular-nums;
  }
  .strip-count {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    font-size: 11px;
  }
  .error-count { color: var(--app-error-text); }
  .warning-count { color: var(--app-warning-text); }
  .strip-status { font-size: 11px; color: var(--app-text-faint); }
  .strip-chevron {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    color: var(--app-text-faint);
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
    color: var(--app-success-text, #2e7d32);
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
    color: var(--app-text-faint);
    font-variant-numeric: tabular-nums;
    align-self: center;
  }

  /* M32: the rule code (e.g. "MD013/line-length") is a demoted suffix, not
     part of the headline — small, muted, monospace, never competing with
     .entry-message for attention. */
  .entry-code {
    flex: 0 0 auto;
    font-size: 11px;
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    color: var(--app-text-faint);
    align-self: center;
  }

  /* L9: compact mode (host below 820px) shrinks the toggle strip to an icon
     + count badge — the "Problems" label and loading/error status text would
     not fit, and are still carried by the button's aria-label. */
  .problems-panel.compact .strip-title,
  .problems-panel.compact .strip-status {
    display: none;
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

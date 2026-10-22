<script lang="ts">
  /**
   * VersionCompareView — one file at an earlier version beside the file as
   * it is in the book now (#408), lines aligned and changed lines marked.
   * The columns are "That version" and "Current": the words the Versions
   * view and the preview bar use, never a bare Then/Now. Read-only:
   * nothing here edits, and nothing is merged. The rows arrive aligned from
   * the host (`api.vcs.compareFile`), so this is layout only.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { CompareRow } from "$lib/api";

  let {
    path,
    versionLabel,
    rows,
    binary = false,
    onBack,
  }: {
    /** The file, repo-relative, as the version card listed it. */
    path: string;
    /** The version's row title and time, for the left column's heading. */
    versionLabel: string;
    rows: CompareRow[];
    /** A picture or other file that has no text to show. */
    binary?: boolean;
    onBack: () => void;
  } = $props();

  const isCss = $derived(/\.css$/i.test(path));
  const changed = $derived(rows.filter((r) => r.changed).length);
</script>

<div class="compare-view">
  <header class="compare-header">
    <button class="back" onclick={onBack}><Icon name="chevron-left" size={14} /> Versions</button>
    <h2 title={path}>{path}</h2>
  </header>
  {#if binary}
    <p class="muted">This file is a picture or another kind of file that has no text to show side by side.</p>
  {:else}
    <p class="muted">{changed === 0 ? "No lines differ." : `${changed} ${changed === 1 ? "line differs" : "lines differ"}.`}</p>
    <div class="columns" class:mono={isCss} role="table" aria-label="That version beside the current file">
      <div class="col-head" role="columnheader">That version — {versionLabel}</div>
      <div class="col-head" role="columnheader">Current</div>
      {#each rows as row, i (i)}
        <div class="cell" class:changed={row.changed} class:gap={row.then === null} role="cell">{row.then ?? ""}</div>
        <div class="cell" class:changed={row.changed} class:gap={row.now === null} role="cell">{row.now ?? ""}</div>
      {/each}
    </div>
  {/if}
</div>

<style>
  .compare-view { display: flex; flex-direction: column; gap: 10px; height: 100%; overflow: auto; background: var(--app-bg); color: var(--app-text-secondary); }
  .compare-header { position: sticky; top: 0; z-index: 1; padding: 12px 16px; border-bottom: 1px solid var(--app-border); background: var(--app-surface-raised); display: flex; align-items: center; gap: 12px; }
  h2 { margin: 0; font-size: 14px; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .back { display: inline-flex; align-items: center; gap: 4px; background: transparent; color: var(--app-text-muted); border: 1px solid var(--app-border); border-radius: 5px; padding: 4px 8px; font-size: 12px; cursor: pointer; flex: 0 0 auto; }
  .back:hover { background: var(--app-control-hover-bg); }
  .muted { margin: 0 16px; color: var(--app-text-muted); font-size: 12px; }
  .columns { display: grid; grid-template-columns: 1fr 1fr; gap: 0 8px; margin: 0 16px 16px; font-size: 12px; line-height: 1.45; }
  .columns.mono { font-family: var(--app-font-mono); }
  .col-head { position: sticky; top: 45px; padding: 4px 8px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); background: var(--app-bg); border-bottom: 1px solid var(--app-border); }
  .cell { padding: 1px 8px; white-space: pre-wrap; overflow-wrap: anywhere; border-left: 3px solid transparent; min-height: 1.45em; }
  /* A line that changed: marked on both sides so the eye finds the pair. */
  .cell.changed { background: var(--app-warning-bg); border-left-color: var(--app-warning-border); color: var(--app-text); }
  /* The other side has no line here. */
  .cell.gap { background: var(--app-surface-sunken); border-left-color: var(--app-border); }
</style>

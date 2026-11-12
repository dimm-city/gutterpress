<script module lang="ts">
  import type { DiffMode } from "#lib/editor/version-diff.ts";

  /** The layout last chosen, kept for the rest of the session. */
  let lastMode: DiffMode = "inline";
</script>

<script lang="ts">
  /**
   * VersionCompareView — one text file of a version, compared (#408). By
   * default it shows what the version changed: the file before it beside
   * the file in it, the comparison the Changed files list counts. "Compared
   * with your book now" shows the version beside the file as it is now.
   * The host sends the two texts (`api.vcs.compareFile`); the diff itself
   * is @codemirror/merge (#lib/editor/version-diff.ts), Inline or Side by
   * side, opened at the first change, with "Change 2 of 5" to step through
   * them (Alt+Down / Alt+Up). Read-only: nothing here edits, nothing is merged.
   */
  import { onMount } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import { api, type CompareBase } from "#lib/api.ts";
  import { friendlyHostError } from "#lib/errors.ts";
  import { mountVersionDiff } from "#lib/editor/version-diff.ts";

  let {
    projectDir,
    id,
    path,
    onBack,
  }: {
    projectDir: string;
    /** The version. */
    id: string;
    /** The file, repo-relative, as the version's Changed files listed it. */
    path: string;
    onBack: () => void;
  } = $props();

  let base = $state<CompareBase>("previous");
  let mode = $state<DiffMode>(lastMode);
  let texts = $state<{ binary: true } | { binary: false; before: string; after: string } | null>(null);
  let failed = $state<string | null>(null);
  let count = $state(0);
  let index = $state(0);
  let goTo: (i: number) => void = () => {};

  /** The two texts are identical: nothing to step through. */
  const same = $derived(!!texts && !texts.binary && texts.before === texts.after);
  const labels = $derived(
    base === "previous" ? { before: "Before", after: "After · this version" } : { before: "This version", after: "Your book now" },
  );

  /** The latest request; an answer to an earlier one is dropped. */
  let asked = 0;
  async function load(next: CompareBase): Promise<void> {
    base = next;
    const mine = ++asked;
    try {
      const result = await api.vcs.compareFile(projectDir, id, path, next);
      if (mine !== asked) return;
      texts = result;
      failed = null;
    } catch (e) {
      if (mine === asked) failed = friendlyHostError(e instanceof Error ? e.message : String(e));
    }
  }
  onMount(() => void load("previous"));

  function setMode(next: DiffMode): void {
    mode = next;
    lastMode = next;
  }

  function step(by: number): void {
    if (count === 0) return;
    index = Math.min(count - 1, Math.max(0, index + by));
    goTo(index);
  }

  function onKeydown(e: KeyboardEvent): void {
    if (!e.altKey || e.ctrlKey || e.metaKey || (e.key !== "ArrowDown" && e.key !== "ArrowUp")) return;
    e.preventDefault();
    step(e.key === "ArrowDown" ? 1 : -1);
  }

  /** The diff editor(s), rebuilt when the texts or the layout change, opened at the first change. */
  function diffView(node: HTMLElement, params: { before: string; after: string; mode: DiffMode }) {
    let diff = mountVersionDiff(node, { ...params, path });
    const opened = () => {
      count = diff.count;
      index = 0;
      goTo = diff.goTo;
      diff.goTo(0);
    };
    opened();
    return {
      update(next: { before: string; after: string; mode: DiffMode }) {
        diff.destroy();
        diff = mountVersionDiff(node, { ...next, path });
        opened();
      },
      destroy: () => diff.destroy(),
    };
  }
</script>

<svelte:window onkeydown={onKeydown} />

<div class="compare-view">
  <div class="bar" role="toolbar" aria-label="Compare this file">
    <button class="back" onclick={onBack}><Icon name="chevron-left" size={14} /> Changed files</button>
    <h2 title={path}>{path}</h2>
    <div class="seg" role="group" aria-label="Compare">
      <button class:active={base === "previous"} aria-pressed={base === "previous"} onclick={() => void load("previous")}>What this version changed</button>
      <button class:active={base === "current"} aria-pressed={base === "current"} onclick={() => void load("current")}>Compared with your book now</button>
    </div>
    {#if texts && !texts.binary && !same}
      <div class="seg" role="group" aria-label="Layout">
        <button class:active={mode === "inline"} aria-pressed={mode === "inline"} onclick={() => setMode("inline")}>Inline</button>
        <button class:active={mode === "split"} aria-pressed={mode === "split"} onclick={() => setMode("split")}>Side by side</button>
      </div>
      <div class="nav">
        <span class="count" aria-live="polite">{count === 0 ? "No changes" : `Change ${index + 1} of ${count}`}</span>
        <button class="icon" onclick={() => step(-1)} disabled={index <= 0} aria-label="Previous change" title="Previous change (Alt+Up)"><Icon name="chevron-up" size={15} /></button>
        <button class="icon" onclick={() => step(1)} disabled={index >= count - 1} aria-label="Next change" title="Next change (Alt+Down)"><Icon name="chevron-down" size={15} /></button>
      </div>
    {/if}
  </div>

  {#if failed}
    <p class="note error" role="alert">Couldn't compare this file. {failed}</p>
  {:else if texts?.binary}
    <p class="note">This file is a picture or another kind of file that has no text to compare.</p>
  {:else if same}
    <p class="note">{base === "previous" ? "This version left this file as it was." : "This file is the same in your book now."}</p>
  {:else if texts}
    <div class="labels" class:split={mode === "split"}>
      {#if mode === "split"}
        <span>{labels.before}</span><span>{labels.after}</span>
      {:else}
        <span><i class="swatch removed"></i>{labels.before}</span><span><i class="swatch added"></i>{labels.after}</span>
      {/if}
    </div>
    <div class="diff" use:diffView={{ before: texts.before, after: texts.after, mode }}></div>
  {/if}
</div>

<style>
  .compare-view { flex: 1; min-height: 0; display: flex; flex-direction: column; color: var(--app-text-secondary); }
  .bar {
    display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px;
    padding: 8px 20px; background: var(--app-surface); border-bottom: 1px solid var(--app-border);
  }
  h2 { flex: 1 1 120px; min-width: 0; margin: 0; font-size: 13px; font-weight: 600; color: var(--app-text); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { font: inherit; font-size: 12.5px; cursor: pointer; }
  button:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
  .back {
    display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; padding: 4px 8px 4px 4px;
    border: 1px solid var(--app-border); border-radius: 5px; background: transparent; color: var(--app-text-secondary);
  }
  .back:hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .seg { display: inline-flex; flex: 0 0 auto; padding: 2px; border: 1px solid var(--app-control-border); border-radius: 6px; background: var(--app-control-bg); }
  .seg button { padding: 3px 9px; border: 0; border-radius: 4px; background: transparent; color: var(--app-text-muted); }
  .seg button:not(.active):hover { background: var(--app-control-hover-bg); color: var(--app-text); }
  .seg button.active { background: var(--app-accent-subtle); color: var(--app-text); font-weight: 600; }
  .nav { display: inline-flex; align-items: center; gap: 2px; flex: 0 0 auto; }
  .count { min-width: 92px; margin-right: 4px; font-size: 12.5px; text-align: right; color: var(--app-text-secondary); font-variant-numeric: tabular-nums; }
  .icon { display: inline-flex; padding: 4px; border: 1px solid var(--app-border); border-radius: 5px; background: transparent; color: var(--app-text-secondary); }
  .icon:hover:not(:disabled) { background: var(--app-control-hover-bg); color: var(--app-text); }
  .icon:disabled { opacity: 0.45; cursor: default; }
  .labels {
    display: flex; gap: 16px; padding: 4px 20px; font-size: 11.5px; font-weight: 600; color: var(--app-text-muted);
    background: var(--app-surface); border-bottom: 1px solid var(--app-border-subtle);
  }
  /* Over each editor of the side-by-side layout. */
  .labels.split { display: grid; grid-template-columns: 1fr 1fr; }
  .labels span { display: inline-flex; align-items: center; gap: 6px; }
  .swatch { width: 10px; height: 10px; border-radius: 2px; }
  .swatch.removed { background: var(--app-diff-removed-word); border: 1px solid var(--app-diff-removed-mark); }
  .swatch.added { background: var(--app-diff-added-word); border: 1px solid var(--app-diff-added-mark); }
  .diff { flex: 1; min-height: 0; display: flex; flex-direction: column; }
  .diff > :global(.cm-editor) { flex: 1; min-height: 0; }
  /* Side by side: the merge view is the one scroller for both editors. */
  .diff > :global(.cm-mergeView) { flex: 1; min-height: 0; overflow-y: auto; }
  .note { margin: 0; padding: 14px 20px; font-size: 12.5px; color: var(--app-text-muted); }
  .note.error { color: var(--app-error-text); }
</style>

<script lang="ts">
  /**
   * TwoVersionsPanel — shown above the editor when the open file still holds
   * passages with two versions after a sync (#407). Each passage is shown as
   * two plain-text columns, *Your version* and *Online version*, with one
   * button per choice. Nothing here touches a file: every choice is handed
   * back to the page, which applies it as ONE undoable edit in the editor
   * below, so the usual save, preview reload and Problems refresh follow.
   *
   * Entirely presentational, like ExternalEditBanner: the page owns the
   * block list (derived from the live buffer, so a choice makes its passage
   * disappear from here at once) and the write path. Renders nothing when
   * `blocks` is empty — the page does not mount it then.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { TwoVersionsBlock, TwoVersionsChoice } from "$lib/editor/two-versions";

  let {
    blocks,
    fileName,
    isCss = false,
    onChoose,
    onChooseAll,
    onReveal,
  }: {
    blocks: TwoVersionsBlock[];
    /** The open file's name as the author knows it (project-relative). */
    fileName: string;
    /** A stylesheet's two sides read better in the editor's monospace font. */
    isCss?: boolean;
    onChoose: (block: TwoVersionsBlock, choice: TwoVersionsChoice) => void;
    onChooseAll: (choice: TwoVersionsChoice) => void;
    /** Scroll the editor to the passage's first marker line (1-based). */
    onReveal?: (line: number) => void;
  } = $props();

  // Expanded by default: the panel exists to be acted on. Collapsing only
  // hides the list while the author edits around it; the header stays.
  let open = $state(true);

  const isMac = typeof navigator !== "undefined" && /Mac/i.test(navigator.userAgent);
  const modKey = isMac ? "Cmd" : "Ctrl";

  /** Display text for one side: the merge's trailing line break is not content. */
  function sideText(s: string): string {
    return s.replace(/\r?\n$/, "");
  }
</script>

<section class="tv-panel" aria-label="Two versions of this file">
  <div class="tv-head">
    <span class="tv-icon"><Icon name="columns-2" size={15} /></span>
    <span class="tv-msg">
      <strong>{fileName}</strong>
      {#if blocks.length === 1}
        has a passage with two versions — yours and the online copy. Keep the one you want.
      {:else}
        has {blocks.length} passages with two versions — yours and the online copy. Keep the one you want in each.
      {/if}
    </span>
    {#if blocks.length > 1}
      <span class="tv-all">
        <span class="tv-all-label">For all {blocks.length}:</span>
        <button class="tv-btn tv-btn-neutral" onclick={() => onChooseAll("yours")}>Keep yours</button>
        <button class="tv-btn tv-btn-neutral" onclick={() => onChooseAll("online")}>Keep online</button>
      </span>
    {/if}
    <button
      class="tv-toggle"
      aria-expanded={open}
      aria-controls="two-versions-list"
      title={open ? "Hide the passages" : "Show the passages"}
      onclick={() => (open = !open)}
    >
      <Icon name={open ? "chevron-up" : "chevron-down"} size={15} />
    </button>
  </div>
  {#if open}
    <ol id="two-versions-list" class="tv-list">
      {#each blocks as block, i (block.from)}
        <li class="tv-block">
          <div class="tv-block-head">
            <span class="tv-block-title">
              {blocks.length > 1 ? `Passage ${i + 1} of ${blocks.length}` : "The passage"}
            </span>
            {#if onReveal}
              <button class="tv-link" onclick={() => onReveal?.(block.line)}>Show in the text</button>
            {/if}
          </div>
          <div class="tv-columns">
            <div class="tv-col">
              <div class="tv-col-label">Your version</div>
              {#if sideText(block.yours)}
                <pre class="tv-text" class:mono={isCss}>{sideText(block.yours)}</pre>
              {:else}
                <p class="tv-empty">Nothing — your copy has no text here.</p>
              {/if}
            </div>
            <div class="tv-col">
              <div class="tv-col-label">Online version</div>
              {#if sideText(block.online)}
                <pre class="tv-text" class:mono={isCss}>{sideText(block.online)}</pre>
              {:else}
                <p class="tv-empty">Nothing — the online copy has no text here.</p>
              {/if}
            </div>
          </div>
          <div class="tv-block-actions">
            <button class="tv-btn tv-btn-neutral" onclick={() => onChoose(block, "yours")}>Keep yours</button>
            <button class="tv-btn tv-btn-neutral" onclick={() => onChoose(block, "online")}>Keep online</button>
            <button class="tv-btn tv-btn-neutral" onclick={() => onChoose(block, "both")}>Keep both</button>
          </div>
        </li>
      {/each}
    </ol>
    <p class="tv-hint">Changed your mind? Undo ({modKey}+Z) in the text brings both versions back.</p>
  {/if}
</section>

<style>
  .tv-panel {
    display: flex;
    flex-direction: column;
    flex: 0 1 auto;
    min-height: 0;
    /* The list scrolls inside a bounded panel; the editor keeps the rest. */
    max-height: 50%;
    background: var(--app-surface);
    border-bottom: 1px solid var(--app-border);
    font-size: 13px;
    color: var(--app-text);
  }
  .tv-head {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 8px 10px;
    padding: 8px 12px;
    background: var(--app-warning-bg);
    border-bottom: 1px solid var(--app-warning-border);
    color: var(--app-warning-text);
    flex: 0 0 auto;
  }
  .tv-icon {
    display: inline-flex;
    flex: 0 0 auto;
  }
  .tv-msg {
    flex: 1 1 16rem;
    min-width: 0;
  }
  .tv-all {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    flex: 0 0 auto;
  }
  .tv-all-label {
    font-size: 12px;
  }
  .tv-toggle {
    display: inline-flex;
    align-items: center;
    padding: 4px;
    border: 1px solid transparent;
    border-radius: 6px;
    background: transparent;
    color: inherit;
    cursor: pointer;
    flex: 0 0 auto;
  }
  .tv-toggle:hover {
    background: var(--app-control-hover-bg);
  }
  .tv-list {
    list-style: none;
    margin: 0;
    padding: 0;
    overflow: auto;
    min-height: 0;
  }
  .tv-block {
    padding: 10px 12px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .tv-block-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 6px;
  }
  .tv-block-title {
    font-weight: 600;
    color: var(--app-text-secondary);
    font-size: 12px;
  }
  .tv-link {
    padding: 0;
    border: 0;
    background: none;
    color: var(--app-link);
    font-size: 12px;
    cursor: pointer;
  }
  .tv-link:hover {
    color: var(--app-link-hover);
    text-decoration: underline;
  }
  .tv-columns {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
  }
  .tv-col {
    /* Two columns side by side at the default editor-pane width (about
       460px with the left panel open); one under the other when the pane
       is narrower than two columns. */
    flex: 1 1 13rem;
    min-width: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }
  .tv-col-label {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--app-text-muted);
  }
  .tv-text,
  .tv-empty {
    margin: 0;
    padding: 8px 10px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-sunken);
    /* Prose wraps like it does in the editor; nothing scrolls sideways. */
    white-space: pre-wrap;
    overflow-wrap: anywhere;
    font: inherit;
    line-height: 1.45;
  }
  .tv-text.mono {
    font-family: var(--app-font-mono);
    font-size: 12px;
  }
  .tv-empty {
    color: var(--app-text-muted);
    font-style: italic;
  }
  .tv-block-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 6px;
    margin-top: 8px;
  }
  /* Geometry only — colors come from .tv-btn-neutral (mirrors ExternalEditBanner). */
  .tv-btn {
    padding: 4px 10px;
    border-width: 1px;
    border-style: solid;
    border-radius: 6px;
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
  }
  .tv-btn-neutral {
    background: var(--app-control-bg);
    border-color: var(--app-border);
    color: var(--app-text);
  }
  .tv-btn-neutral:hover {
    background: var(--app-control-hover-bg);
  }
  .tv-hint {
    margin: 0;
    padding: 6px 12px 8px;
    font-size: 12px;
    color: var(--app-text-muted);
    flex: 0 0 auto;
  }
</style>

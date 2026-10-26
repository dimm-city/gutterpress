<script lang="ts">
  /**
   * TwoVersionsPanel — one decision at a time (#407).
   *
   * After a sync kept two versions of a passage, the file holds both inside
   * marker lines. This card sits above the editor and asks ONE question
   * about ONE passage: which version to keep. Three buttons answer it; a
   * count with arrows moves to the other passages; the editor (and, through
   * it, the preview's two rendered boxes) scrolls to the passage in question
   * as the card changes, so the comparison happens where the text already
   * is. The two texts are available behind "Compare the text" for an author
   * who wants them in the card, and nothing else is shown.
   *
   * Nothing here touches a file: a choice is handed to the page, which
   * applies it as ONE undoable edit and confirms it with a toast that offers
   * Undo. The page owns the block list (derived from the live buffer, so a
   * settled passage leaves at once and the card moves on to the next).
   */
  import { onMount, tick } from "svelte";
  import Icon from "#lib/components/Icon.svelte";
  import {
    differOnlyInSpacing,
    markDifferences,
    type TwoVersionsBlock,
    type TwoVersionsChoice,
  } from "#lib/editor/two-versions.ts";

  let {
    blocks,
    isCss = false,
    onChoose,
    onReveal,
    onSettled,
  }: {
    blocks: TwoVersionsBlock[];
    /** A stylesheet: "rule" instead of "passage", texts stacked and unwrapped. */
    isCss?: boolean;
    onChoose: (block: TwoVersionsBlock, choice: TwoVersionsChoice) => void;
    /** Scroll the editor to the passage's first marker line (1-based), without taking focus. */
    onReveal?: (line: number) => void;
    /** The last passage was settled: the page puts focus back in the editor. */
    onSettled?: () => void;
  } = $props();

  let current = $state(0);
  let compareOpen = $state(false);
  let firstButton = $state<HTMLButtonElement | null>(null);

  // The list shrinks as passages are settled; the card stays on the same
  // position, which is now the next passage.
  const index = $derived(Math.min(current, Math.max(0, blocks.length - 1)));
  const block = $derived(blocks[index]);
  const noun = $derived(isCss ? "rule" : "passage");

  /** Display text for one side: the merge's trailing line break is not content. */
  function sideText(s: string): string {
    return s.replace(/\r?\n$/, "");
  }

  // Two texts that look the same are the hard case: say so when only
  // spacing differs, and mark the words that differ when the compare is open.
  const spacingOnly = $derived(!!block && differOnlyInSpacing(block.yours, block.online));
  const runs = $derived.by(() =>
    compareOpen && block ? markDifferences(sideText(block.yours), sideText(block.online)) : null,
  );

  /**
   * Button labels that say what will happen. When one side is empty (the
   * passage was removed there), "Keep yours" would delete it — say so — and
   * "Keep both" would be the same as keeping the other side.
   */
  function labelsFor(b: TwoVersionsBlock): { yours: string; online: string; both: boolean } {
    const yoursEmpty = sideText(b.yours) === "";
    const onlineEmpty = sideText(b.online) === "";
    if (yoursEmpty && !onlineEmpty) return { yours: "Delete it", online: "Keep the online text", both: false };
    if (onlineEmpty && !yoursEmpty) return { yours: "Keep your text", online: "Delete it", both: false };
    return { yours: "Keep yours", online: "Keep online", both: true };
  }

  function reveal(): void {
    const b = blocks[index];
    if (b) onReveal?.(b.line);
  }

  function go(delta: number): void {
    if (blocks.length < 2) return;
    current = (index + delta + blocks.length) % blocks.length;
    reveal();
  }

  async function choose(choice: TwoVersionsChoice): Promise<void> {
    const b = block;
    if (!b) return;
    onChoose(b, choice);
    await tick();
    if (blocks.length === 0) {
      onSettled?.();
      return;
    }
    current = index;
    reveal();
    firstButton?.focus();
  }

  onMount(reveal);
</script>

<section class="tv-panel" aria-label="Two versions of this {noun}">
  {#if block}
    {@const labels = labelsFor(block)}
    <p class="tv-question" role="status" aria-live="polite">
      <span class="tv-icon"><Icon name="columns-2" size={15} /></span>
      <span class="tv-question-text">
        This {noun} was changed both here and online. Which version do you want to keep?
      </span>
      {#if blocks.length > 1}
        <span class="tv-nav">
          <span class="tv-count">{index + 1} of {blocks.length}</span>
          <button class="tv-arrow" aria-label="Previous {noun}" title="Previous {noun}" onclick={() => go(-1)}>
            <Icon name="chevron-left" size={14} />
          </button>
          <button class="tv-arrow" aria-label="Next {noun}" title="Next {noun}" onclick={() => go(1)}>
            <Icon name="chevron-right" size={14} />
          </button>
        </span>
      {/if}
    </p>
    {#if spacingOnly}
      <p class="tv-note">The two versions differ only in spacing or line breaks — either one reads the same.</p>
    {/if}
    <div class="tv-actions">
      <button class="tv-btn" bind:this={firstButton} onclick={() => void choose("yours")}>{labels.yours}</button>
      <button class="tv-btn" onclick={() => void choose("online")}>{labels.online}</button>
      {#if labels.both}
        <button class="tv-btn" onclick={() => void choose("both")} title="Keep both texts, yours first">Keep both</button>
      {/if}
      <button class="tv-link" aria-expanded={compareOpen} onclick={() => (compareOpen = !compareOpen)}>
        {compareOpen ? "Hide the text" : "Compare the text"}
        <Icon name={compareOpen ? "chevron-up" : "chevron-down"} size={13} />
      </button>
    </div>
    {#if compareOpen}
      <div class="tv-columns" class:stacked={isCss}>
        <div class="tv-col">
          <div class="tv-col-label" id="tv-yours">Your version</div>
          {#if sideText(block.yours)}
            <!-- One line: inside <pre>, whitespace between runs would be text. -->
            <pre class="tv-text" class:mono={isCss} aria-labelledby="tv-yours">{#each runs?.yours ?? [] as run}{#if run.changed}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}</pre>
          {:else}
            <p class="tv-empty" aria-labelledby="tv-yours">Nothing — your version has no text here.</p>
          {/if}
        </div>
        <div class="tv-col">
          <div class="tv-col-label" id="tv-online">Online version</div>
          {#if sideText(block.online)}
            <pre class="tv-text" class:mono={isCss} aria-labelledby="tv-online">{#each runs?.online ?? [] as run}{#if run.changed}<mark>{run.text}</mark>{:else}{run.text}{/if}{/each}</pre>
          {:else}
            <p class="tv-empty" aria-labelledby="tv-online">Nothing — the online version has no text here.</p>
          {/if}
        </div>
      </div>
    {/if}
  {/if}
</section>

<style>
  .tv-panel {
    display: flex;
    flex-direction: column;
    gap: 10px;
    flex: 0 0 auto;
    max-height: 60%;
    overflow: auto;
    padding: 10px 12px 12px;
    background: var(--app-surface-raised);
    border-bottom: 1px solid var(--app-border);
    font-size: 13px;
    color: var(--app-text);
  }
  /* The count and arrows drop under the question when the pane is narrow,
     rather than squeezing it into a four-line column. */
  .tv-question {
    display: flex;
    flex-wrap: wrap;
    align-items: flex-start;
    gap: 6px 8px;
    margin: 0;
    line-height: 1.4;
  }
  .tv-icon {
    display: inline-flex;
    flex: 0 0 auto;
    margin-top: 1px;
    color: var(--app-accent);
  }
  .tv-question-text {
    flex: 1 1 14rem;
    min-width: 0;
  }
  .tv-nav {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    margin-left: auto;
    white-space: nowrap;
  }
  .tv-count {
    margin-right: 4px;
    font-size: 12px;
    color: var(--app-text-muted);
  }
  .tv-arrow {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-control-bg);
    color: var(--app-text-secondary);
    cursor: pointer;
  }
  .tv-arrow:hover {
    background: var(--app-control-hover-bg);
  }
  .tv-actions {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 8px;
  }
  /* 32px pointer targets (UX contract) and a visible focus ring. */
  .tv-btn {
    min-height: 32px;
    padding: 5px 14px;
    border: 1px solid var(--app-border-strong);
    border-radius: 6px;
    background: var(--app-control-bg);
    color: var(--app-text);
    font-size: 13px;
    font-weight: 600;
    cursor: pointer;
  }
  .tv-btn:hover {
    background: var(--app-control-hover-bg);
  }
  .tv-btn:focus-visible,
  .tv-link:focus-visible,
  .tv-arrow:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: 2px;
  }
  .tv-link {
    display: inline-flex;
    align-items: center;
    gap: 2px;
    min-height: 32px;
    margin-left: auto;
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
  .tv-columns.stacked {
    flex-direction: column;
  }
  /* Stacked, each text takes its own height; the basis is for columns only. */
  .tv-columns.stacked .tv-col {
    flex: 0 0 auto;
  }
  .tv-col {
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
    padding: 6px 10px;
    border: 1px solid var(--app-border);
    border-radius: 6px;
    background: var(--app-surface-sunken);
    font: inherit;
    line-height: 1.45;
    /* About ten lines, then the column scrolls: the whole text is in the
       editor below and rendered in the preview. */
    max-height: calc(1.45em * 10 + 12px);
    overflow: auto;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  /* The words only this side has. */
  .tv-text mark {
    background: var(--app-warning-bg);
    color: inherit;
    border-bottom: 2px solid var(--app-warning-border);
    border-radius: 2px;
  }
  .tv-note {
    margin: 0;
    font-size: 12px;
    color: var(--app-text-secondary);
  }
  /* Stylesheet rules keep their lines; the column scrolls sideways. */
  .tv-text.mono {
    font-family: var(--app-font-mono);
    font-size: 12px;
    white-space: pre;
    overflow-wrap: normal;
  }
  .tv-empty {
    color: var(--app-text-muted);
    font-style: italic;
  }
</style>

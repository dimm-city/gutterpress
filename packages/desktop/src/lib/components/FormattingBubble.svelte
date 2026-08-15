<script lang="ts">
  /**
   * FormattingBubble — floating inline-format toolbar for the inline-editing
   * surface (ADR 0010, Phase 4). Appears above a non-collapsed selection
   * inside an editable block; the four verbs delegate to the frame's
   * `applyInlineFormat` (execCommand-backed, so native undo covers them and
   * the edit module's autosync picks the change up like any typed edit).
   *
   * Presentational only: position/visibility/active-format state arrives via
   * props from +page.svelte's `editSelection` handler. `pointerdown` is
   * prevented so clicking a button never steals the frame's selection.
   * App design tokens only (tools/check-app-tokens.mjs).
   */
  export interface BubbleState {
    visible: boolean;
    /** Workspace-relative coordinates of the selection's first rect. */
    x: number;
    y: number;
    formats: { strong: boolean; em: boolean; s: boolean; code: boolean };
  }

  import Icon from "$lib/components/Icon.svelte";

  let {
    state,
    onFormat,
  }: {
    state: BubbleState;
    onFormat: (format: "bold" | "italic" | "strike" | "code") => void;
  } = $props();

  const buttons = [
    { format: "bold", label: "Bold", key: "strong", icon: "bold" },
    { format: "italic", label: "Italic", key: "em", icon: "italic" },
    { format: "strike", label: "Strikethrough", key: "s", icon: "strikethrough" },
    { format: "code", label: "Inline code", key: "code", icon: "code" },
  ] as const;
</script>

{#if state.visible}
  <div
    class="bubble"
    role="toolbar"
    tabindex="-1"
    aria-label="Text formatting"
    style:left="{state.x}px"
    style:top="{state.y}px"
    onpointerdown={(e) => e.preventDefault()}
  >
    {#each buttons as b (b.format)}
      <button
        type="button"
        class="verb"
        class:active={state.formats[b.key]}
        aria-label={b.label}
        aria-pressed={state.formats[b.key]}
        title={b.label}
        onclick={() => onFormat(b.format)}
      ><Icon name={b.icon} size={14} /></button>
    {/each}
  </div>
{/if}

<style>
  /* App design tokens only — same set the sibling ContextMenu uses
     (tools/check-app-tokens.mjs). */
  .bubble {
    position: fixed;
    transform: translate(-50%, calc(-100% - 8px));
    display: flex;
    gap: 2px;
    padding: 3px;
    border-radius: 7px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    box-shadow: var(--app-shadow-lg);
    z-index: var(--app-z-menu);
  }
  .verb {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 26px;
    height: 26px;
    padding: 0 6px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
  }
  .verb:hover {
    background: var(--app-control-hover-bg);
  }
  .verb:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .verb.active {
    background: var(--app-control-hover-bg);
    color: var(--app-accent-text);
  }
</style>

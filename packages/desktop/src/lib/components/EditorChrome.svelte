<script lang="ts">
  /**
   * The rich editor's inline chrome: a `/` command menu and a selection
   * toolbar, floating over the editing surface.
   *
   * Both follow `ContextMenu.svelte`, NOT `dialogBehavior`. A menu attached to
   * a caret is not a modal: `dialogBehavior` would stamp `role="dialog"` and
   * `aria-modal="true"` on it, which hides the author's own text from a screen
   * reader while the menu is open — precisely wrong here. `dialog.ts` records
   * the same exception for the toolbar's popovers.
   *
   * So the roles are earned rather than claimed: the slash menu implements the
   * full roving-focus keyboard model and therefore takes `role="menu"`; the
   * bubble is `role="toolbar"` with a single tab stop and arrow keys between
   * buttons, per the ARIA toolbar pattern the UX contract requires.
   *
   * Positioning is `flipClamp()` from `$lib/flip-clamp`, fed coordinates
   * the editor reports in the FRAME's viewport plus the frame's own rect —
   * the same translation `BlockEditOverlay` does for the preview.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { flipClamp } from "$lib/flip-clamp";
  import {
    filterSlashItems,
    type ChromeAnchor,
    type SlashItem,
  } from "$lib/editor/rich-chrome.svelte";

  let {
    anchor,
    onRunSlash,
    onFormat,
    onClose,
  }: {
    /** Where and what to show, already translated into app coordinates. */
    anchor: ChromeAnchor | null;
    onRunSlash: (item: SlashItem) => void;
    onFormat: (action: "bold" | "italic" | "strikethrough" | "code" | "link") => void;
    onClose: () => void;
  } = $props();

  const SLASH_W = 260;
  const SLASH_H = 300;
  const BUBBLE_W = 210;
  const BUBBLE_H = 40;

  let active = $state(0);

  let items = $derived(anchor?.kind === "slash" ? filterSlashItems(anchor.query ?? "") : []);

  let placed = $derived.by(() => {
    if (!anchor) return { x: 0, y: 0 };
    const slash = anchor.kind === "slash";
    return flipClamp(
      { x: anchor.x, y: anchor.y },
      slash ? SLASH_W : BUBBLE_W,
      slash ? SLASH_H : BUBBLE_H,
      anchor.workspace,
      !slash,
    );
  });

  // The filtered list changes as the author types; keep the highlight in range
  // without an effect (banned) — `$derived` reads it, the handlers write it.
  let index = $derived(Math.min(active, Math.max(0, items.length - 1)));

  function onKeydown(e: KeyboardEvent): void {
    if (!anchor) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if (anchor.kind !== "slash" || items.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      active = (index + 1) % items.length;
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      active = (index - 1 + items.length) % items.length;
    } else if (e.key === "Home") {
      e.preventDefault();
      active = 0;
    } else if (e.key === "End") {
      e.preventDefault();
      active = items.length - 1;
    } else if (e.key === "Enter" || e.key === "Tab") {
      e.preventDefault();
      const item = items[index];
      if (item) onRunSlash(item);
    }
  }

  const FORMATS = [
    { id: "bold", icon: "bold", label: "Bold" },
    { id: "italic", icon: "italic", label: "Italic" },
    { id: "strikethrough", icon: "strikethrough", label: "Strikethrough" },
    { id: "code", icon: "code", label: "Inline code" },
    { id: "link", icon: "link", label: "Link" },
  ] as const;

  /** ARIA toolbar pattern: one tab stop, arrows move between buttons. */
  function onToolbarKeydown(e: KeyboardEvent): void {
    const buttons = [
      ...(e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>("button"),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      const next = e.key === "ArrowRight" ? at + 1 : at - 1;
      buttons[(next + buttons.length) % buttons.length]?.focus();
    }
  }
</script>

<svelte:window onkeydown={onKeydown} />

{#if anchor?.kind === "slash"}
  <!-- role="menu" is earned: full roving focus, Home/End, Escape. -->
  <div
    class="gp-slash"
    role="menu"
    aria-label="Insert block"
    style="left: {placed.x}px; top: {placed.y}px; width: {SLASH_W}px; max-height: {SLASH_H}px;"
  >
    {#if items.length === 0}
      <p class="gp-empty">No blocks match “{anchor.query}”</p>
    {:else}
      {#each items as item, i (item.id)}
        <button
          type="button"
          role="menuitem"
          class="gp-slash-item"
          class:active={i === index}
          onmousedown={(e) => {
            // mousedown, not click: click would blur the editor first and the
            // command would run against a lost selection.
            e.preventDefault();
            onRunSlash(item);
          }}
          onmouseenter={() => (active = i)}
        >
          <span class="gp-slash-label">{item.label}</span>
          <span class="gp-slash-detail">{item.detail}</span>
        </button>
      {/each}
    {/if}
  </div>
{:else if anchor?.kind === "selection"}
  <!-- ARIA toolbar pattern: the container is programmatically focusable
       (tabindex="-1", NOT a tab stop) and the roving tabindex lives on the
       buttons, so Tab enters the toolbar once and arrows move within it. -->
  <div
    class="gp-bubble"
    role="toolbar"
    tabindex="-1"
    aria-label="Format selection"
    style="left: {placed.x}px; top: {placed.y}px;"
    onkeydown={onToolbarKeydown}
  >
    {#each FORMATS as f, i (f.id)}
      <button
        type="button"
        aria-label={f.label}
        title={f.label}
        tabindex={i === 0 ? 0 : -1}
        onmousedown={(e) => {
          e.preventDefault();
          onFormat(f.id);
        }}
      >
        <Icon name={f.icon} size={15} />
      </button>
    {/each}
  </div>
{/if}

<style>
  .gp-slash,
  .gp-bubble {
    position: fixed;
    z-index: var(--app-z-menu);
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    box-shadow: var(--app-shadow-lg);
  }

  .gp-slash {
    overflow-y: auto;
    padding: 4px;
  }
  .gp-slash-item {
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 1px;
    width: 100%;
    padding: 6px 9px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text);
    text-align: left;
    cursor: pointer;
  }
  .gp-slash-item.active {
    background: var(--app-surface-hover);
  }
  .gp-slash-label {
    font-size: 13px;
  }
  .gp-slash-detail {
    font-size: 11px;
    color: var(--app-text-muted);
  }
  .gp-empty {
    margin: 0;
    padding: 10px;
    font-size: 12px;
    color: var(--app-text-muted);
  }

  .gp-bubble {
    display: flex;
    gap: 1px;
    padding: 3px;
  }
  .gp-bubble button {
    display: grid;
    place-items: center;
    /* SC 2.5.8 target size: 24px is the floor for inline controls. */
    min-width: 28px;
    min-height: 28px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--app-text);
    cursor: pointer;
  }
  .gp-bubble button:hover {
    background: var(--app-surface-hover);
  }

  .gp-slash-item:focus-visible,
  .gp-bubble button:focus-visible {
    outline: 2px solid var(--app-accent);
    outline-offset: -2px;
  }
  @media (prefers-contrast: more) {
    .gp-slash-item:focus-visible,
    .gp-bubble button:focus-visible {
      outline-width: 3px;
    }
  }
</style>

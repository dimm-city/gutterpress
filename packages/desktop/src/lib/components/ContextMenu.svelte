<script lang="ts">
  /**
   * ContextMenu — presentational right-click/`Shift+F10` menu for the preview
   * pane (inline-editing plan §4.1–4.2). All open/position/item state lives on
   * the injected `ContextMenuController`; this component only renders it and
   * handles the DOM-level concerns a controller shouldn't own: focus
   * management, arrow-key navigation, and outside-click detection.
   *
   * ARIA `role="menu"` with `role="menuitem"` children, arrow-key + Home/End
   * navigation, `Escape` closes, and focus returns to whatever had it before
   * the menu opened. App design tokens only — no hardcoded colors
   * (`npm run lint` enforces this via `tools/check-app-tokens.mjs`).
   */
  import type { ContextMenuController, ContextMenuItem } from "$lib/routes/context-menu-controller.svelte";
  import { onMount } from "svelte";

  let { controller }: { controller: ContextMenuController } = $props();

  let menuEl = $state<HTMLDivElement | undefined>(undefined);
  let previouslyFocused: HTMLElement | null = null;

  function itemButtons(): HTMLButtonElement[] {
    if (!menuEl) return [];
    return Array.from(menuEl.querySelectorAll<HTMLButtonElement>("[role='menuitem']"));
  }

  function focusIndex(i: number): void {
    const els = itemButtons();
    if (els.length === 0) return;
    const clamped = ((i % els.length) + els.length) % els.length;
    els[clamped]?.focus();
  }

  function focusFirstEnabled(): void {
    const els = itemButtons();
    const idx = els.findIndex((el) => !el.disabled);
    focusIndex(idx === -1 ? 0 : idx);
  }

  function onKeydown(e: KeyboardEvent): void {
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        controller.close();
        break;
      case "ArrowDown": {
        e.preventDefault();
        const els = itemButtons();
        const cur = els.indexOf(document.activeElement as HTMLButtonElement);
        focusIndex(cur + 1);
        break;
      }
      case "ArrowUp": {
        e.preventDefault();
        const els = itemButtons();
        const cur = els.indexOf(document.activeElement as HTMLButtonElement);
        focusIndex(cur - 1);
        break;
      }
      case "Home":
        e.preventDefault();
        focusIndex(0);
        break;
      case "End":
        e.preventDefault();
        focusIndex(itemButtons().length - 1);
        break;
    }
  }

  async function activate(item: ContextMenuItem): Promise<void> {
    if (!item.enabled) return;
    await controller.runItem(item);
  }

  // Outside click/mousedown dismissal (plan §4.2). `justOpened`-flag guard
  // (`controller.wasJustOpened()`) mirrors EditorToolbar.svelte's outside-
  // click popover handling.
  function onWindowMousedown(e: MouseEvent): void {
    if (!controller.open || controller.wasJustOpened()) return;
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(".context-menu")) controller.close();
  }

  function onWindowBlur(): void {
    controller.close();
  }

  onMount(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    if (menuEl) {
      const rect = menuEl.getBoundingClientRect();
      controller.reportMenuSize(rect.width, rect.height);
    }
    requestAnimationFrame(focusFirstEnabled);
    return () => {
      previouslyFocused?.focus?.();
    };
  });
</script>

<svelte:window onmousedown={onWindowMousedown} onblur={onWindowBlur} />

{#if controller.open}
  <div
    bind:this={menuEl}
    class="context-menu"
    role="menu"
    aria-label="Block actions"
    tabindex="-1"
    style="left: {controller.x}px; top: {controller.y}px;"
    onkeydown={onKeydown}
  >
    {#each controller.items as item (item.id)}
      <button
        type="button"
        role="menuitem"
        class="context-menu-item"
        disabled={!item.enabled}
        title={item.disabledReason}
        aria-disabled={!item.enabled}
        onclick={() => activate(item)}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}

<style>
  .context-menu {
    position: fixed;
    z-index: var(--app-z-menu);
    display: flex;
    flex-direction: column;
    min-width: 200px;
    max-width: 320px;
    padding: 4px;
    background: var(--app-surface);
    border: 1px solid var(--app-border);
    border-radius: 8px;
    box-shadow: 0 8px 24px var(--app-shadow-lg);
  }
  .context-menu-item {
    display: block;
    width: 100%;
    padding: 7px 10px;
    border: none;
    background: transparent;
    color: var(--app-text);
    font: inherit;
    text-align: left;
    border-radius: 5px;
    cursor: pointer;
  }
  .context-menu-item:hover:not(:disabled) {
    background: var(--app-control-hover-bg);
  }
  .context-menu-item:focus-visible {
    outline: 2px solid var(--app-focus-ring);
    outline-offset: -2px;
  }
  .context-menu-item:disabled {
    color: var(--app-text-muted);
    cursor: default;
  }
</style>

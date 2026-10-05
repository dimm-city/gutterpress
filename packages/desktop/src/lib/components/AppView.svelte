<script lang="ts">
  /**
   * AppView — the one full-window layer every "do this task" screen opens
   * in: Book settings, Publish, Where your work is kept. It mirrors the start
   * screen's frame — the same fade, the same centred top-biased column, the
   * same close control — so moving from the workspace into any task and back
   * feels like one app. The view covers the workspace completely: the writer
   * sees only the task in front of them.
   *
   * Behaviour comes from `dialogBehavior`: role=dialog + aria-modal, Escape
   * closes, focus is trapped inside and handed back to the opener on close.
   * The layer moves itself under <body>, so a stacking context in whatever
   * opened it (the status bar's z-index) can never clip or bury it. The
   * parent mounts it inside an `{#if open}` block; the fade plays both ways.
   *
   * PWA-clean (§8): no host code.
   */
  import { fade } from "svelte/transition";
  import type { ComponentProps, Snippet } from "svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { dialogBehavior } from "$lib/dialog";

  type IconName = ComponentProps<typeof Icon>["name"];

  let {
    title,
    icon,
    measure = 660,
    onClose,
    triggerEl,
    initialFocus,
    class: className = "",
    actions,
    children,
  }: {
    title: string;
    icon?: IconName;
    /** Width of the reading column, in px (the start screen's 660). */
    measure?: number;
    onClose: () => void;
    /** The control that opened the view, for focus restore on close. */
    triggerEl?: HTMLElement | null;
    /** Selector of the control to focus on open; the layer itself otherwise. */
    initialFocus?: string;
    class?: string;
    /** Extra header controls, rendered before the close button. */
    actions?: Snippet;
    children: Snippet;
  } = $props();

  const titleId = `app-view-title-${nextId++}`;

  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  // The outroing layer must not eat clicks: focus and inert lift from the
  // workspace at once, but the fading section stays in the DOM for 180ms.
  function onOutroStart(e: Event) {
    (e.currentTarget as HTMLElement).style.pointerEvents = "none";
  }
</script>

<script module lang="ts">
  let nextId = 0;
</script>

<section
  class="app-view {className}"
  use:portal
  use:dialogBehavior={{
    onClose,
    triggerEl,
    labelledBy: titleId,
    ...(initialFocus ? { initialFocus } : { focusContainer: true }),
  }}
  transition:fade={{ duration: 180 }}
  onoutrostart={onOutroStart}
>
  <div class="view-col" style:--view-measure="{measure}px">
    <header class="view-head">
      <h1 class="view-title" id={titleId}>
        {#if icon}<Icon name={icon} size={18} />{/if}{title}
      </h1>
      <div class="view-head-right">
        {@render actions?.()}
        <button type="button" class="view-close" onclick={onClose} title="Close and return to your book (Esc)" aria-label="Close this screen">
          <Icon name="x" size={16} />
        </button>
      </div>
    </header>
    {@render children()}
  </div>
</section>

<style>
  /* Frame, column and close control match WelcomeLanding's `.landing` /
     `.landing-col` / `.brand-icon-btn` — keep the two in step. */
  .app-view {
    position: fixed;
    inset: 0;
    z-index: var(--app-z-sheet);
    background: var(--app-bg);
    overflow-y: auto;
    display: flex;
    justify-content: center;
    align-items: flex-start;
    outline: none;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
    color: var(--app-text);
  }
  .view-col {
    width: min(var(--view-measure), calc(100% - 32px));
    flex-shrink: 0;
    display: flex;
    flex-direction: column;
    gap: 22px;
    padding: clamp(28px, 10vh, 110px) 0 32px;
  }
  .view-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }
  .view-title {
    margin: 0;
    display: inline-flex;
    align-items: center;
    gap: 8px;
    font-size: 20px;
    font-weight: 700;
    color: var(--app-text);
    letter-spacing: -0.3px;
  }
  .view-head-right {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .view-close {
    background: none;
    border: 0;
    padding: 4px;
    border-radius: 6px;
    color: var(--app-text-secondary);
    cursor: pointer;
    display: inline-flex;
  }
  .view-close:hover { color: var(--app-text); background: var(--app-control-hover-bg); }
  .view-close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 1px; }
</style>

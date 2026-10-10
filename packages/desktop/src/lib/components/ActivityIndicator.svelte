<script lang="ts">
  import { fade } from "svelte/transition";
  import type { ActivityStage } from "$lib/loading/activity-stage";
  import Spinner from "./Spinner.svelte";

  /**
   * The app's ONE loading indicator, in two forms that share a visual language
   * (raised card, shared spinner, optional determinate bar, polite status text):
   *
   *   kind="overlay" — a centred card over a translucent scrim; for the wait
   *                    the author is blocked on (opening a book, first layout).
   *   kind="pill"    — a compact corner pill that never blocks; for hot-reload
   *                    updates and the PDF export.
   *
   * anchor="pane" positions against the nearest position:relative ancestor
   * (the preview pane); anchor="app" positions against the window (overlay:
   * below the toolbar; pill: bottom-right corner).
   *
   * The caller passes the stage that is ON SCREEN (already delayed and held for
   * a minimum time by ActivityGate — this component does no timing) or null.
   * The live region is mounted even when idle so a screen reader is already
   * listening when the first stage arrives. Only the label is announced; the
   * detail (a package name, a running page count) is visual so a long layout
   * does not flood the reader.
   */
  let {
    stage,
    kind = "overlay",
    anchor = "pane",
    fadeOut = true,
    onCancel,
    cancelLabel = "Cancel",
    cancelDisabled = false,
  }: {
    stage: ActivityStage | null;
    kind?: "overlay" | "pill";
    anchor?: "pane" | "app";
    /** false skips the fade-out: used when another instance takes over the same stage. */
    fadeOut?: boolean;
    onCancel?: (() => void) | undefined;
    cancelLabel?: string;
    cancelDisabled?: boolean;
  } = $props();

  const big = $derived(kind === "overlay");
  const ratio = $derived(
    stage?.progress ? Math.min(1, Math.max(0, stage.progress.value / stage.progress.total)) : 0,
  );

  /** Svelte's JS transitions ignore the CSS reduced-motion guard, so honour it here. */
  function ms(duration: number): number {
    const reduce = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;
    return reduce ? 0 : duration;
  }
</script>

<div class="region {kind} anchor-{anchor}" role="status" aria-live="polite">
  {#if stage}
    <div
      class="layer"
      in:fade={{ duration: ms(120) }}
      out:fade={{ duration: ms(fadeOut ? 300 : 0) }}
    >
      <div class="card">
        <Spinner size={big ? 40 : 14} />
        <div class="text">
          <p class="label">{stage.label}</p>
          {#if big || stage.detail}
            <p class="detail" aria-hidden="true">{stage.detail ?? ""}</p>
          {/if}
        </div>
        {#if stage.progress}
          <div class="bar" aria-hidden="true"><div class="fill" style:transform="scaleX({ratio})"></div></div>
        {:else if big}
          <div class="bar-slot"></div>
        {/if}
        {#if onCancel}
          <button class="cancel" onclick={onCancel} disabled={cancelDisabled}>{cancelLabel}</button>
        {/if}
      </div>
    </div>
  {/if}
</div>

<style>
  /* The region is a transparent, input-transparent box. Nothing here may
     swallow wheel or pointer input meant for the content underneath: in the
     pane the preview iframe stays live beneath the scrim, and blocking it is
     what once made "scrolling in the desktop completely broken while
     everything else works" (the scroll-dead-preview regression). Only the
     Cancel button opts back in. */
  .region {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 10;
  }
  .region.anchor-app {
    position: fixed;
  }
  /* Window-level overlay: below the toolbar, below every dialog (1000+). */
  .region.overlay.anchor-app {
    top: 56px;
    z-index: var(--app-z-overlay);
  }
  .region.pill.anchor-pane {
    z-index: 9;
  }
  /* Above the start screen (--app-z-sheet): a live export's progress and
     Cancel must stay reachable when the workspace empties and the landing
     returns. Still below dialogs. */
  .region.pill.anchor-app {
    z-index: calc(var(--app-z-sheet) + 50);
  }

  .layer {
    position: absolute;
    inset: 0;
    display: flex;
  }
  .overlay .layer {
    align-items: center;
    justify-content: center;
    /* TRANSLUCENT on purpose — must never be fully opaque. The preview iframe
       underneath is cross-origin, and Chromium render-throttles a cross-origin
       iframe with no visible pixels (own opacity:0 OR fully covered by an
       opaque element) to ~1fps. That was the 0.4.1 slow-render regression:
       ~1 page/sec instead of ~30 on a 287-page book. The scrim dims the layout
       shuffle without hiding the iframe. */
    background: var(--app-overlay);
    backdrop-filter: blur(2px);
  }
  /* Pills sit in a corner and cover nothing: the layer itself is only a
     positioning box. Below the preview toolbar, whose zoom menu is on that side. */
  .pill.anchor-pane .layer {
    justify-content: flex-end;
    align-items: flex-start;
    padding: 44px 12px 0 0;
  }
  .pill.anchor-app .layer {
    justify-content: flex-end;
    align-items: flex-end;
    /* Clear of the status bar along the bottom edge. */
    padding: 0 16px 44px 0;
  }

  .card {
    position: relative;
    display: flex;
    align-items: center;
    gap: 10px;
    box-sizing: border-box;
    max-width: min(420px, calc(100% - 24px));
    background: var(--app-surface-raised);
    border: 1px solid var(--app-border);
    box-shadow: 0 4px 16px var(--app-shadow-md);
    color: var(--app-text);
    font-size: 13px;
    overflow: hidden;
  }
  .overlay .card {
    flex-direction: column;
    gap: 14px;
    width: 280px;
    padding: 24px 24px 20px;
    border-radius: 12px;
    text-align: center;
  }
  .pill .card {
    padding: 7px 12px;
    border-radius: 999px;
  }

  .text {
    min-width: 0;
  }
  .label,
  .detail {
    margin: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .label {
    color: var(--app-text);
    white-space: nowrap;
  }
  .detail {
    color: var(--app-text-muted);
    font-size: 12px;
    white-space: nowrap;
    /* Held even when empty so a stage with no detail does not resize the card. */
    min-height: 1.4em;
    line-height: 1.4;
  }
  .pill .detail {
    display: none;
  }
  .overlay .text {
    width: 100%;
  }

  .bar,
  .bar-slot {
    height: 4px;
  }
  .overlay .bar,
  .overlay .bar-slot {
    width: 100%;
  }
  .bar {
    background: var(--app-spinner-track);
    border-radius: 2px;
    overflow: hidden;
  }
  /* In a pill the bar is a hairline along its lower edge: no extra height. */
  .pill .bar {
    position: absolute;
    left: 0;
    right: 0;
    bottom: 0;
    height: 3px;
    border-radius: 0;
  }
  .fill {
    height: 100%;
    background: var(--app-spinner-head);
    transform-origin: left center;
    transition: transform 0.25s ease-out;
  }

  .cancel {
    pointer-events: auto;
    background: transparent;
    border: 1px solid var(--app-border-strong);
    color: var(--app-text-secondary);
    border-radius: 999px;
    padding: 4px 12px;
    font-size: 12px;
    cursor: pointer;
  }
  .cancel:hover:not(:disabled) {
    background: var(--app-scrim-strong);
    border-color: var(--app-control-hover-border);
  }
  .cancel:disabled {
    opacity: 0.6;
    cursor: default;
  }
</style>

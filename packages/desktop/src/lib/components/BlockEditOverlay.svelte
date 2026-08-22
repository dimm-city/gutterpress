<script lang="ts">
  /**
   * BlockEditOverlay — click-to-edit block overlay for the paginated preview
   * (inline-editing plan §5, PR 5). Opens ONLY from the context menu's "Edit
   * this block" item (menu-only entry — double-click was considered and
   * rejected for v1: it conflicts with text-selection habits, plan §5.1).
   *
   * All open/position/dismissal-event state lives on the injected
   * `BlockOverlayController`; this component owns the things a controller
   * shouldn't: the live CodeMirror 6 view (an INPUT WIDGET ONLY — content
   * discarded on cancel; on commit the mutation flows through the SAME commit
   * engine as every other menu action, `commit-engine.ts` — the widget itself
   * never writes anything), the IME composition guard, and the focus
   * trap/restore discipline the app's existing dialogs use
   * (`$lib/dialog.ts`'s `dialogBehavior`/`trapFocus`).
   *
   * A second, INDEPENDENT `EditorView` here does NOT violate
   * `MarkdownEditor.svelte`'s "ONE EditorView" doctrine (UX review M8): that
   * rule forbids recreating the MAIN editor's view on a file switch (which
   * used to discard undo/selection/scroll on every chapter change) — it is
   * not an app-wide "only one EditorView instance may ever exist" rule. This
   * view is a disposable, purpose-built input surface: mounted fresh each
   * time the overlay opens (this component is rendered `{#if controller.open}`
   * by +page.svelte, mirroring ContextMenu.svelte), destroyed on close, with
   * no undo history or file identity of its own to preserve across opens.
   *
   * NEVER patches the paginated preview DOM for instant feedback.
   * `.gp-strip` is a live CSS multicol container
   * (`column-fill:auto`, fixed column width) — overflowing content does not
   * visibly overlap; it spills into invisible columns thousands of pixels to
   * the side (`getClientRects().length > 1`, spike-verified). That failure is
   * SILENT, which is why v1 renders no optimistic patch at all: the settled-
   * write -> chapter-splice pipeline (driven by the commit engine's flush) is
   * the only thing that ever updates the paginated DOM. See
   * docs/adr/0009-inline-editing-source-ranges.md.
   */
  import { EditorView, keymap } from "@codemirror/view";
  import { EditorState } from "@codemirror/state";
  import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
  import { markdown } from "@codemirror/lang-markdown";
  import { syntaxHighlighting, HighlightStyle } from "@codemirror/language";
  import { tags as t } from "@lezer/highlight";
  import { onMount } from "svelte";
  import type { BlockOverlayController } from "$lib/routes/block-overlay-controller.svelte";

  let { controller }: { controller: BlockOverlayController } = $props();

  let host = $state<HTMLDivElement | undefined>(undefined);
  let view: EditorView | null = null;
  let composing = false;
  let previouslyFocused: HTMLElement | null = null;

  /**
   * Commit the CURRENT editor text. Exported so +page.svelte can call it when
   * a dialog opens over the workspace (plan §5.1 dismissal: "opening a dialog
   * commits") — the controller has no access to the live CM document itself,
   * only this component does.
   */
  export function commitNow(): void {
    if (!view) return;
    void controller.commit(view.state.doc.toString(), { duringComposition: composing });
  }

  function cancelNow(): void {
    controller.cancel();
  }

  // Minimal, theme-aware syntax palette — a SEPARATE, scoped copy of
  // MarkdownEditor.svelte's `--cm-*` custom properties (under an `--ovcm-`
  // prefix to avoid ambiguity about which component owns which copy). Those
  // are declared `.editor-wrap`-scoped there ("this file is their only
  // consumer" per its own header comment), and MarkdownEditor may not even be
  // mounted when this overlay opens — the editor pane is `{#if}`-unmounted
  // whenever closed (plan §4.9). Kept intentionally small: no gutter/bracket/
  // lint tokens, because this view has none of those features.
  const overlayHighlight = HighlightStyle.define([
    {
      tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6],
      color: "var(--ovcm-heading)",
      fontWeight: "700",
    },
    { tag: t.strong, color: "var(--ovcm-strong)", fontWeight: "700" },
    { tag: t.emphasis, color: "var(--ovcm-em)", fontStyle: "italic" },
    { tag: t.strikethrough, textDecoration: "line-through" },
    { tag: [t.link, t.url], color: "var(--ovcm-link)", textDecoration: "underline" },
    { tag: t.quote, color: "var(--ovcm-quote)", fontStyle: "italic" },
    { tag: [t.processingInstruction, t.meta, t.contentSeparator, t.list, t.labelName], color: "var(--ovcm-marker)" },
    { tag: [t.monospace], color: "var(--ovcm-code)" },
    { tag: [t.string, t.special(t.string)], color: "var(--ovcm-string)" },
  ]);

  const overlayTheme = EditorView.theme({
    "&": { height: "100%", fontSize: "13px", backgroundColor: "transparent", color: "var(--ovcm-text)" },
    ".cm-scroller": { fontFamily: "var(--app-font-mono)", lineHeight: "1.5", overflow: "auto" },
    ".cm-content": { caretColor: "var(--app-accent)", padding: "8px 10px" },
    "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": {
      backgroundColor: "var(--ovcm-selection)",
    },
    "&.cm-focused": { outline: "none" },
  });

  function buildState(doc: string): EditorState {
    return EditorState.create({
      doc,
      extensions: [
        history(),
        markdown(),
        syntaxHighlighting(overlayHighlight, { fallback: true }),
        overlayTheme,
        EditorView.lineWrapping,
        keymap.of([
          { key: "Escape", run: () => { cancelNow(); return true; } },
          { key: "Mod-Enter", run: () => { commitNow(); return true; } },
          // Focus trap (plan §5.6, "same discipline as existing dialogs"):
          // this view is the overlay's only focusable descendant, so
          // swallowing Tab/Shift-Tab keeps focus inside it — the practical
          // form "trap Tab within the overlay" takes when there is nothing
          // else in the overlay to Tab to (mirrors $lib/dialog.ts's
          // `trapFocus`, which cycles among focusable descendants when there
          // ARE more than one).
          { key: "Tab", run: () => true },
          { key: "Shift-Tab", run: () => true },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.domEventHandlers({
          compositionstart: () => {
            composing = true;
          },
          compositionend: () => {
            composing = false;
          },
          blur: () => {
            // IME guard (plan §5.6): a mid-composition blur must not commit —
            // some IME candidate-window interactions transiently blur the CM
            // DOM node. `commitNow()` passes the current `composing` flag
            // through to the controller, which no-ops rather than commits.
            commitNow();
          },
        }),
      ],
    });
  }

  onMount(() => {
    previouslyFocused = document.activeElement as HTMLElement | null;
    if (!host) return;
    view = new EditorView({ state: buildState(controller.initialText), parent: host });
    requestAnimationFrame(() => view?.focus());
    return () => {
      view?.destroy();
      view = null;
      // Defense-in-depth (plan §5.1/§5.6): ALWAYS issue setEditMask(false),
      // regardless of how this component unmounts. commit()/cancel() already
      // tore the mask down through the controller (teardown() is idempotent
      // then — nothing is captured anymore, so this is a harmless no-op); this
      // call is what matters for a path that skips both, e.g. a project
      // switch or an error unmount removing this component out from under an
      // still-open overlay. NOT relying on "the iframe reload clears masks
      // anyway" — that is true for a splice/swap, not for this SPA-side path.
      controller.teardown();
      previouslyFocused?.focus?.();
    };
  });
</script>

<svelte:window onblur={commitNow} />

<div
  class="block-edit-overlay"
  style="left: {controller.x}px; top: {controller.y}px; width: {controller.width}px; height: {controller.height}px; max-height: {controller.maxHeight}px;"
>
  <div class="block-edit-overlay-host" bind:this={host} role="group" aria-label="Edit block source"></div>
  <div class="block-edit-overlay-hint" aria-hidden="true">Ctrl/Cmd+Enter to save · Esc to cancel</div>
</div>

<style>
  .block-edit-overlay {
    position: absolute;
    z-index: var(--app-z-menu);
    display: flex;
    flex-direction: column;
    min-height: 96px;
    min-width: 220px;
    background: var(--app-surface-raised);
    border: 2px solid var(--app-accent);
    border-radius: 6px;
    box-shadow: 0 10px 30px var(--app-shadow-lg);
    overflow: hidden;
  }
  .block-edit-overlay-host {
    flex: 1;
    min-height: 0;
    overflow: auto;
  }
  .block-edit-overlay-hint {
    flex-shrink: 0;
    padding: 3px 8px;
    font-size: 10px;
    color: var(--app-text-muted);
    border-top: 1px solid var(--app-border-subtle);
    background: var(--app-surface);
  }

  /* ── Overlay-scoped CodeMirror syntax palette ────────────────────────────
     A SEPARATE, small copy of MarkdownEditor.svelte's `--cm-*` tokens (see
     this file's header) — scoped to .block-edit-overlay, no :global, no
     :root leakage, same light-dark() values so the overlay stays visually
     consistent with the main editor in both themes. */
  .block-edit-overlay {
    --ovcm-text: light-dark(#1f2328, #d8dee9);
    --ovcm-heading: light-dark(#6639ba, #c8a8ff);
    --ovcm-strong: light-dark(#1f2328, #f2f4f8);
    --ovcm-em: light-dark(#1f2328, #d8dee9);
    --ovcm-link: light-dark(#0969da, #5cb3ff);
    --ovcm-quote: light-dark(#57606a, #9aa5b1);
    --ovcm-marker: light-dark(#6e7781, #8195b5);
    --ovcm-code: light-dark(#953800, #f0cf94);
    --ovcm-string: light-dark(#0a7d33, #b6dc9c);
    --ovcm-selection: light-dark(rgba(9, 105, 218, 0.18), rgba(92, 179, 255, 0.28));
  }
</style>

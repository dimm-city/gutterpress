<script lang="ts">
  /**
   * SaveStatusDialog — the status bar's "Where your work is kept" modal.
   *
   * Explains, for a writer who has never heard of git, the three separate
   * things that all sound like "saved": Saving (your edits, on this computer),
   * Versions (restore points you can go back to) and Online backup (a copy of
   * those versions online). Each section says what it is, what is true right
   * now, and offers the one action that helps. The words come from the pure
   * `saveStatusCopy` mapping (`$lib/save-status`) — this component only renders
   * them, so it holds no state logic of its own.
   *
   * Mounted fresh per open ({#if} in StatusBar); `dialogBehavior` owns
   * ARIA/Escape/focus-trap/focus-restore. It portals to <body>: the status bar
   * is its own stacking context (z-index) and would otherwise trap the
   * backdrop below the toolbar's menus. PWA-clean (§8): props only.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { dialogBehavior } from "$lib/dialog";
  import type {
    SaveStatusActionId,
    SaveStatusCopy,
    SaveStatusTone,
  } from "$lib/save-status";

  let {
    copy,
    triggerEl,
    onAction,
    onClose,
  }: {
    copy: SaveStatusCopy;
    /** The status-bar button that opened the dialog, for focus restore. */
    triggerEl?: HTMLElement | undefined;
    onAction: (id: SaveStatusActionId) => void;
    onClose: () => void;
  } = $props();

  /** Move the node under <body> so no ancestor stacking context clips it. */
  function portal(node: HTMLElement) {
    document.body.appendChild(node);
    return { destroy: () => node.remove() };
  }

  const TONE_ICON: Record<SaveStatusTone, "circle-check" | "info" | "triangle-alert" | "circle-x" | "refresh-cw"> = {
    ok: "circle-check",
    info: "info",
    warn: "triangle-alert",
    error: "circle-x",
    pending: "refresh-cw",
  };

  const SECTIONS: Array<{
    key: keyof SaveStatusCopy;
    title: string;
    icon: "save" | "history" | "cloud-upload";
  }> = [
    { key: "saving", title: "Saving", icon: "save" },
    { key: "versions", title: "Versions", icon: "history" },
    { key: "online", title: "Online backup", icon: "cloud-upload" },
  ];
</script>

<div use:portal>
  <div class="dlg-backdrop" onclick={onClose} role="presentation"></div>
  <div
    class="dlg-shell save-dialog"
    use:dialogBehavior={{ onClose, triggerEl, labelledBy: "save-dialog-title" }}
  >
    <header class="dlg-header">
      <h2 id="save-dialog-title">Where your work is kept</h2>
      <button class="dlg-close" onclick={onClose} title="Close (Esc)" aria-label="Close"><Icon name="x" size={14} /></button>
    </header>

    <div class="dlg-body">
      {#each SECTIONS as sec (sec.key)}
        {@const s = copy[sec.key]}
        <section class="block" aria-labelledby="save-dialog-{sec.key}">
          <h3 id="save-dialog-{sec.key}"><Icon name={sec.icon} size={13} /> {sec.title}</h3>
          <p class="explain">{s.explain}</p>
          <p class="state tone-{s.tone}" aria-live="polite">
            <span class="state-icon" class:spin={s.tone === "pending"}><Icon name={TONE_ICON[s.tone]} size={13} /></span>
            <span class="state-text">
              <span class="state-line">{s.status}</span>
              {#if s.detail}<span class="state-detail">{s.detail}</span>{/if}
            </span>
          </p>
          {#if s.note}<p class="note">{s.note}</p>{/if}
          {#if s.actions.length > 0}
            <div class="actions">
              {#each s.actions as a (a.id)}
                <button
                  class={a.primary ? "app-btn-primary btn" : "dlg-ghost small btn"}
                  disabled={a.disabled}
                  onclick={() => onAction(a.id)}
                >{a.label}</button>
              {/each}
            </div>
          {/if}
        </section>
      {/each}
    </div>

    <footer class="dlg-actions">
      <button class="dlg-ghost" onclick={onClose}>Close</button>
    </footer>
  </div>
</div>

<style>
  @import "$lib/styles/dialog-shell.css";

  .save-dialog { width: min(520px, 94vw); }
  .dlg-body {
    display: flex;
    flex-direction: column;
    gap: 10px;
    padding: 12px 16px 14px;
    overflow-y: auto;
  }

  .block {
    border: 1px solid var(--app-border);
    border-radius: 8px;
    padding: 10px 12px 11px;
    display: flex;
    flex-direction: column;
    gap: 5px;
  }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--app-text-muted);
  }
  p { margin: 0; }
  .explain { font-size: 12px; line-height: 1.45; color: var(--app-text-muted); }

  .state {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 13px;
    line-height: 1.4;
    color: var(--app-text);
  }
  .state-icon { display: inline-flex; margin-top: 2px; flex-shrink: 0; }
  .state-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .state-line { font-weight: 600; }
  .state-detail { font-size: 12px; font-weight: 400; color: var(--app-text-secondary); }
  .tone-ok .state-icon { color: var(--app-success-text); }
  .tone-info .state-icon { color: var(--app-info-text); }
  .tone-warn .state-icon { color: var(--app-warning-text); }
  .tone-error .state-icon { color: var(--app-error-text); }
  .tone-pending .state-icon { color: var(--app-text-muted); }
  .spin :global(svg) { animation: save-dlg-spin 0.8s linear infinite; }
  @keyframes save-dlg-spin { to { transform: rotate(360deg); } }

  .note { font-size: 11.5px; line-height: 1.4; color: var(--app-text-muted); }

  .actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 3px; }
  .btn {
    padding: 5px 12px;
    font-size: 12px;
    border-radius: 5px;
    border-width: 1px;
    border-style: solid;
    cursor: pointer;
  }
  .btn:disabled { opacity: 0.45; cursor: default; }
</style>

<script lang="ts">
  /**
   * SaveStatusView — the status bar's "Where your work is kept" screen, a
   * full task view (AppView) like Book settings and Publish.
   *
   * Explains, for a writer who has never heard of git, the three separate
   * things that all sound like "saved": Saving (your edits, on this computer),
   * Versions (restore points you can go back to) and Online backup (a copy of
   * your book kept online). A one-line summary answers "is my work safe?"; each
   * section leads with what is true right now, then says what the thing is,
   * then offers the one action that helps. The words come from the pure
   * `saveStatusCopy` mapping (`$lib/save-status`) — this component only renders
   * them, so it holds no state logic of its own.
   *
   * Mounted fresh per open ({#if} in StatusBar); AppView owns the frame,
   * Escape, focus trap and focus restore (initial focus: the primary action,
   * else the layer itself). One visually-hidden `role="status"` region
   * announces the dynamic lines; the visible text carries no live-region of
   * its own.
   * PWA-clean (§8): props only.
   */
  import Icon from "$lib/components/Icon.svelte";
  import AppView from "$lib/components/AppView.svelte";
  import type { SaveStatusActionId, SaveStatusCopy, SaveStatusTone } from "$lib/save-status";

  let {
    copy,
    triggerEl,
    onAction,
    onClose,
  }: {
    copy: SaveStatusCopy;
    /** The status-bar button that opened the view, for focus restore. */
    triggerEl?: HTMLElement | undefined;
    onAction: (id: SaveStatusActionId) => void;
    onClose: () => void;
  } = $props();

  // Shape, not only colour, tells the tones apart: a neutral circle-i, an arrow
  // where an action is suggested.
  const TONE_ICON: Record<SaveStatusTone, "circle-check" | "info" | "arrow-right" | "triangle-alert" | "circle-x" | "refresh-cw"> = {
    ok: "circle-check",
    neutral: "info",
    action: "arrow-right",
    warn: "triangle-alert",
    error: "circle-x",
    pending: "refresh-cw",
  };

  const SECTIONS: Array<{
    key: "saving" | "versions" | "online";
    title: string;
    icon: "save" | "history" | "cloud-upload";
  }> = [
    { key: "saving", title: "Saving", icon: "save" },
    { key: "versions", title: "Versions", icon: "history" },
    { key: "online", title: "Online backup", icon: "cloud-upload" },
  ];

  // What a screen reader hears when the state changes: the summary plus each
  // section's current line — one region, so nothing is announced twice.
  let announcement = $derived(
    [
      copy.summary.text,
      ...SECTIONS.map((s) => `${s.title}: ${copy[s.key].status}${copy[s.key].notice ? ` ${copy[s.key].notice}` : ""}`),
    ].join(" "),
  );
</script>

<AppView title="Where your work is kept" icon="save" onClose={onClose} {triggerEl} initialFocus=".app-btn-primary:not(:disabled)">
  <div class="view-body">
    <div class="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>

    <p class="summary tone-{copy.summary.tone}">
      <span class="state-icon" class:spin={copy.summary.tone === "pending"}>
        <Icon name={TONE_ICON[copy.summary.tone]} size={15} />
      </span>
      {copy.summary.text}
    </p>

    {#each SECTIONS as sec (sec.key)}
      {@const s = copy[sec.key]}
      <section class="block" aria-labelledby="save-dialog-{sec.key}">
        <h3 id="save-dialog-{sec.key}"><Icon name={sec.icon} size={13} /> {sec.title}</h3>
        <p class="state tone-{s.tone}">
          <span class="state-icon" class:spin={s.tone === "pending"}><Icon name={TONE_ICON[s.tone]} size={13} /></span>
          <span class="state-text">
            <span class="state-line">{s.status}</span>
            {#if s.detail}<span class="state-detail">{s.detail}</span>{/if}
          </span>
        </p>
        {#if s.alert}
          <p class="alert tone-warn"><span class="state-icon"><Icon name="triangle-alert" size={13} /></span>{s.alert}</p>
        {/if}
        <p class="explain">{s.explain}</p>
        {#if s.note}<p class="note">{s.note}</p>{/if}
        {#if s.notice}<p class="notice">{s.notice}</p>{/if}
        {#if s.actions.length > 0}
          <div class="section-actions">
            {#each s.actions as a (a.id)}
              <button
                class={a.primary ? "app-btn app-btn-primary" : "app-btn app-btn-ghost"}
                disabled={a.disabled}
                onclick={() => onAction(a.id)}
              >{a.label}</button>
            {/each}
          </div>
        {/if}
      </section>
    {/each}
  </div>
</AppView>

<style>
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  .view-body {
    display: flex;
    flex-direction: column;
  }

  .summary {
    display: flex;
    align-items: center;
    gap: 8px;
    margin: 10px 0 2px;
    font-size: 14px;
    font-weight: 600;
    color: var(--app-text);
  }

  /* Plain sections separated by a hairline — no cards. */
  .block {
    display: flex;
    flex-direction: column;
    gap: 5px;
    padding: 12px 0;
    border-top: 1px solid var(--app-border-subtle);
  }
  .block:first-of-type { margin-top: 8px; }
  h3 {
    margin: 0;
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 13px;
    font-weight: 600;
    color: var(--app-text);
  }
  p { margin: 0; }

  .state, .alert {
    display: flex;
    align-items: flex-start;
    gap: 7px;
    font-size: 13px;
    line-height: 1.4;
    color: var(--app-text);
  }
  .alert { font-size: 12px; color: var(--app-text-secondary); }
  .state-icon { display: inline-flex; margin-top: 2px; flex-shrink: 0; }
  .summary .state-icon { margin-top: 0; }
  .state-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
  .state-line { font-weight: 600; }
  .state-detail { font-size: 12px; font-weight: 400; color: var(--app-text-secondary); }
  /* Green = safe, muted = nothing set up, blue only where an action is suggested. */
  .tone-ok .state-icon { color: var(--app-success-text); }
  .tone-neutral .state-icon { color: var(--app-text-muted); }
  .tone-action .state-icon { color: var(--app-info-text); }
  .tone-warn .state-icon { color: var(--app-warning-text); }
  .tone-error .state-icon { color: var(--app-error-text); }
  .tone-pending .state-icon { color: var(--app-text-muted); }
  .spin :global(svg) { animation: save-dlg-spin 0.8s linear infinite; }
  @keyframes save-dlg-spin { to { transform: rotate(360deg); } }

  .explain { font-size: 12px; line-height: 1.45; color: var(--app-text-secondary); }
  .notice { font-size: 12px; line-height: 1.4; font-weight: 600; color: var(--app-text); }
  .note { font-size: 12px; line-height: 1.4; color: var(--app-text-muted); }

  .section-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    padding: 4px 0 0;
  }
</style>

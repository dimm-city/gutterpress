<script lang="ts">
  /**
   * PublishWizard — a front-and-centre, step-by-step publishing flow opened from
   * the main toolbar's Publish button. It replaces the old "last section of
   * Project settings" surface (which a non-technical author had to scroll to
   * find) with a guided wizard: choose where to publish → set up each
   * destination (reusing saved connections automatically, or connecting/
   * changing the key here) → publish.
   *
   * ZERO new backend: it drives the existing PublishSectionController
   * (api.publish.*), so provider discovery, verify-before-store connect,
   * per-project manifest settings, dry-run readiness, and structured results
   * are all reused. Credentials remain stored securely on this computer by the
   * host (safeStorage) and are shared across a user's projects — the wizard
   * simply surfaces that reuse and lets the author change the key per project.
   *
   * PWA-clean + $effect-free (CLAUDE.md §8): all host work is through the
   * injected controller; load happens onMount (the parent mounts this fresh via
   * {#if}); step/selection are plain local state driven by event handlers.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { onMount } from "svelte";
  import { dialogBehavior } from "$lib/dialog";
  import { friendlyPublishError } from "$lib/errors";
  import type { PublishProviderCard } from "$lib/platform/contract";
  import type { PublishSectionController } from "$lib/routes/publish-section-controller.svelte";

  let {
    controller,
    triggerEl,
    onClose,
  }: {
    controller: PublishSectionController;
    triggerEl?: HTMLButtonElement | undefined;
    onClose?: () => void;
  } = $props();

  type Step = 1 | 2 | 3;
  let step = $state<Step>(1);
  let selected = $state<Set<string>>(new Set());

  const cards = $derived(controller.publishCards);
  const selectedCards = $derived(cards.filter((c) => selected.has(c.id)));
  // Direct-upload destinations still needing a key block the Publish step.
  const blockedCards = $derived(selectedCards.filter((c) => c.credentialRequired && !c.connected));

  onMount(() => {
    step = 1;
    selected = new Set();
    void controller.loadPublish();
  });

  function close() {
    onClose?.();
  }

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    selected = next;
  }

  function draftValue(card: PublishProviderCard, key: string): string {
    return controller.publishConfigDrafts[card.id]?.[key] ?? card.config[key] ?? "";
  }

  async function publishAll() {
    // Sequential — the controller serializes on publishBusyId (one long
    // butler/swa upload at a time); awaiting each keeps results ordered.
    for (const card of selectedCards) {
      if (card.credentialRequired && !card.connected) continue; // skip un-set-up direct targets
      await controller.runPublish(card.id, false);
    }
  }

  const STEP_TITLES: Record<Step, string> = {
    1: "Where do you want to publish?",
    2: "Set up your destinations",
    3: "Publish",
  };
</script>

<div class="dlg-backdrop" onclick={close} role="presentation"></div>

<div class="dlg-shell wizard" use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "publish-wizard-title" }}>
  <header class="dlg-header">
    <div class="title-wrap">
      <Icon name="cloud-upload" size={18} />
      <h2 id="publish-wizard-title">Publish your book</h2>
    </div>
    <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
  </header>

  <!-- Step indicator -->
  <ol class="steps" aria-label="Publishing steps">
    {#each [1, 2, 3] as n (n)}
      <li class:done={step > n} class:current={step === n}>
        <span class="step-dot">{n}</span>
        <span class="step-label">{STEP_TITLES[n as Step]}</span>
      </li>
    {/each}
  </ol>

  <div class="wizard-body">
    {#if controller.publishError}
      {@const err = friendlyPublishError(controller.publishError)}
      <p class="error" role="alert">{err.summary}</p>
      {#if err.details}
        <details class="status-raw"><summary>Show details</summary><pre>{err.details}</pre></details>
      {/if}
    {/if}

    {#if step === 1}
      <!-- ── Step 1: choose destination(s) ──────────────────────────────── -->
      <p class="lede">Pick one or more places to send your finished book. You can publish to several at once.</p>
      {#if cards.length === 0}
        <p class="muted">Loading destinations…</p>
      {:else}
        <ul class="dest-list">
          {#each cards as card (card.id)}
            <li>
              <label class="dest">
                <input type="checkbox" checked={selected.has(card.id)} onchange={() => toggle(card.id)} />
                <span class="dest-main">
                  <span class="dest-name">{card.label}</span>
                  <span class="dest-desc">{card.description}</span>
                </span>
                <span class="dest-meta">
                  <span class="badge">{card.kind === "api" ? "direct upload" : "guided"}</span>
                  <span class="badge subtle">{card.format}</span>
                  {#if card.credentialRequired}
                    <span class={`status ${card.connected ? "ok" : "off"}`}>
                      {#if card.connected}<Icon name="circle-check" size={12} /> Connected{:else}Needs a key{/if}
                    </span>
                  {:else}
                    <span class="status ok">No account needed</span>
                  {/if}
                </span>
              </label>
            </li>
          {/each}
        </ul>
      {/if}
    {:else if step === 2}
      <!-- ── Step 2: set up each selected destination ───────────────────── -->
      <p class="lede">
        Your saved connections are reused automatically. Add or change a key here to
        publish this project — keys are stored securely on this computer, never in your
        project folder.
      </p>
      {#each selectedCards as card (card.id)}
        {@const busy = controller.publishBusyId === card.id}
        <section class="setup-card">
          <h3>{card.label}</h3>

          {#if card.fields.length > 0}
            <div class="fields">
              {#each card.fields as field (field.key)}
                <label class="field">
                  <span>{field.label}</span>
                  <input
                    class="input"
                    type="text"
                    placeholder={field.placeholder ?? ""}
                    value={draftValue(card, field.key)}
                    oninput={(e) => controller.setPublishConfigDraft(card.id, field.key, e.currentTarget.value)}
                  />
                </label>
              {/each}
              <button class="ghost small" onclick={() => controller.savePublishConfig(card.id)} disabled={busy}>Save settings</button>
            </div>
          {/if}

          {#if card.credentialRequired}
            {#if card.connected}
              <div class="conn ok">
                <span><Icon name="circle-check" size={13} /> Connected — reusing your saved key.</span>
                <button class="ghost small" onclick={() => controller.disconnectPublish(card.id)} disabled={busy}>Use a different key</button>
              </div>
            {:else}
              <div class="conn">
                {#if card.hint}<p class="hint">{card.hint}</p>{/if}
                <div class="add-row">
                  <input
                    class="input"
                    type="password"
                    placeholder="Paste API key"
                    value={controller.publishTokenDrafts[card.id] ?? ""}
                    oninput={(e) => controller.setPublishTokenDraft(card.id, e.currentTarget.value)}
                    onkeydown={(e) => { if (e.key === "Enter") controller.connectPublish(card.id); }}
                  />
                  <button class="primary small" onclick={() => controller.connectPublish(card.id)} disabled={busy}>Connect</button>
                </div>
                {#if card.tokenUrl}
                  <button class="link" onclick={() => controller.openPublishUrl(card.tokenUrl!)}>Create an API key <Icon name="external-link" size={12} /></button>
                {/if}
              </div>
            {/if}
          {:else}
            <p class="muted">No account or key needed — we'll prepare an upload package with step-by-step instructions.</p>
          {/if}
        </section>
      {/each}
    {:else}
      <!-- ── Step 3: publish ────────────────────────────────────────────── -->
      <p class="lede">
        Publishing uses your project's latest build output. If you've changed the book,
        use <strong>Save PDF</strong> first, then publish.
      </p>
      {#if blockedCards.length > 0}
        <p class="warn" role="alert">
          <Icon name="triangle-alert" size={13} />
          {blockedCards.map((c) => c.label).join(", ")} still {blockedCards.length === 1 ? "needs" : "need"} a key —
          go back to set {blockedCards.length === 1 ? "it" : "them"} up, or publish the others.
        </p>
      {/if}
      {#each selectedCards as card (card.id)}
        {@const busy = controller.publishBusyId === card.id}
        {@const needsConnect = card.credentialRequired && !card.connected}
        {@const result = controller.publishResults[card.id]}
        <section class="publish-card">
          <div class="pc-head">
            <span class="dest-name">{card.label}</span>
            <div class="pc-actions">
              <button class="ghost small" onclick={() => controller.runPublish(card.id, true)} disabled={busy}>Check readiness</button>
              <button
                class="primary small"
                onclick={() => controller.runPublish(card.id, false)}
                disabled={busy || needsConnect}
                title={needsConnect ? "Connect first — this destination needs a key." : undefined}
              >
                {#if busy}<Icon name="refresh-cw" size={13} /> Publishing…{:else}Publish{/if}
              </button>
            </div>
          </div>

          {#if result}
            {@const outcome = result.outcome}
            <div class={`result ${result.ok ? "ok" : "failed"}`} role="status">
              {#if result.issues.length > 0}
                <ul class="issues">
                  {#each result.issues as issue (issue.id)}
                    <li class={issue.severity}>
                      {#if issue.severity === "info"}<Icon name="info" size={12} />{:else}<Icon name="triangle-alert" size={12} />{/if}
                      {issue.message}
                    </li>
                  {/each}
                </ul>
              {/if}
              {#if !result.ok}
                {@const runErr = friendlyPublishError(result.error ?? "Publish failed.")}
                <p class="error">{runErr.summary}</p>
                {#if runErr.details}<details class="status-raw"><summary>Show details</summary><pre>{runErr.details}</pre></details>{/if}
              {:else if !outcome}
                <p class="success-line"><Icon name="circle-check" size={13} /> Ready to publish.</p>
              {:else if outcome.kind === "published"}
                <p class="success-line"><Icon name="circle-check" size={13} /> {outcome.detail ?? "Published."}</p>
                {#if outcome.url}
                  {@const url = outcome.url}
                  <button class="link" onclick={() => controller.openPublishUrl(url)}>View it online <Icon name="external-link" size={12} /></button>
                {/if}
                {#if outcome.followUp?.length}
                  <ol class="checklist">{#each outcome.followUp as s, i (i)}<li>{s}</li>{/each}</ol>
                {/if}
              {:else}
                <p class="success-line"><Icon name="circle-check" size={13} /> {outcome.detail ?? "Upload package prepared."}</p>
                <p class="hint">Package folder: <code>{outcome.packageDir}</code></p>
                <button class="primary small" onclick={() => controller.openPublishUrl(outcome.openUrl)}>Open upload page <Icon name="external-link" size={12} /></button>
                <ol class="checklist">{#each outcome.checklist as s, i (i)}<li>{s}</li>{/each}</ol>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    {/if}
  </div>

  <footer class="wizard-footer">
    {#if step > 1}
      <button class="ghost" onclick={() => (step = (step - 1) as Step)}>Back</button>
    {:else}
      <button class="ghost" onclick={close}>Cancel</button>
    {/if}
    <div class="spacer"></div>
    {#if step === 1}
      <button class="primary" onclick={() => (step = 2)} disabled={selected.size === 0}>Next</button>
    {:else if step === 2}
      <button class="primary" onclick={() => (step = 3)}>Next</button>
    {:else}
      <button
        class="primary"
        onclick={publishAll}
        disabled={controller.publishBusyId !== null || selectedCards.every((c) => c.credentialRequired && !c.connected)}
        title="Publish to every ready destination"
      >
        Publish to all
      </button>
      <button class="ghost" onclick={close}>Done</button>
    {/if}
  </footer>
</div>

<style>
  @import "$lib/styles/dialog-shell.css";
  @import "$lib/styles/config-section-shared.css";

  .wizard { width: min(560px, calc(100vw - 32px)); max-height: calc(100vh - 64px); display: flex; flex-direction: column; }
  .title-wrap { display: inline-flex; align-items: center; gap: 8px; }
  .title-wrap h2 { margin: 0; }

  .steps { list-style: none; display: flex; gap: 4px; margin: 0; padding: 10px 16px; border-bottom: 1px solid var(--app-border); }
  .steps li { display: flex; align-items: center; gap: 6px; flex: 1; min-width: 0; font-size: 11px; color: var(--app-text-faint); }
  .steps li.current { color: var(--app-text); font-weight: 600; }
  .steps li.done { color: var(--app-text-muted); }
  .step-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--app-border-strong); font-size: 11px; flex-shrink: 0; }
  .steps li.current .step-dot { background: var(--app-accent); color: var(--app-accent-text); border-color: var(--app-accent-border); }
  .steps li.done .step-dot { background: var(--app-control-hover-bg); }
  .step-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .wizard-body { padding: 14px 16px; overflow-y: auto; display: flex; flex-direction: column; gap: 12px; }
  .lede { margin: 0; font-size: 12px; color: var(--app-text-secondary); line-height: 1.5; }

  .dest-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .dest { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-control-bg); cursor: pointer; }
  .dest:hover { border-color: var(--app-border-strong); }
  .dest input { margin-top: 2px; }
  .dest-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .dest-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .dest-desc { font-size: 11px; color: var(--app-text-muted); }
  .dest-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 10px; flex-shrink: 0; }
  .badge { padding: 1px 6px; border-radius: 10px; background: var(--app-control-hover-bg); color: var(--app-text-muted); }
  .badge.subtle { background: transparent; }
  .status { display: inline-flex; align-items: center; gap: 3px; }
  .status.ok { color: var(--app-success-text, #3fb950); }
  .status.off { color: var(--app-text-faint); }

  .setup-card, .publish-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-control-bg); }
  .setup-card h3, .pc-head .dest-name { margin: 0; font-size: 13px; }
  .fields { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .field { display: flex; flex-direction: column; gap: 3px; width: 100%; font-size: 11px; color: var(--app-text-muted); }
  .conn { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .conn.ok { flex-direction: row; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; color: var(--app-success-text, #3fb950); }
  .conn.ok span { display: inline-flex; align-items: center; gap: 4px; }

  .pc-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pc-actions { display: flex; gap: 6px; }
  .warn { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--app-warning-text, #d29922); }

  .result { border-top: 1px solid var(--app-border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .issues .error { color: var(--app-error-text); }
  .issues .warning { color: var(--app-warning-text, #d29922); }
  .issues .info { color: var(--app-text-muted); }
  .success-line { margin: 0; font-size: 12px; color: var(--app-success-text, #3fb950); display: inline-flex; align-items: center; gap: 4px; }
  .checklist { margin: 0; padding-left: 18px; font-size: 11px; color: var(--app-text-muted); line-height: 1.5; }
  .result code { font-size: 10px; word-break: break-all; }
  button.link { background: none; border: none; padding: 0; font-size: 11px; color: var(--app-focus-ring); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }

  .wizard-footer { display: flex; align-items: center; gap: 8px; padding: 12px 16px; border-top: 1px solid var(--app-border); }
  .wizard-footer .spacer { flex: 1; }
</style>

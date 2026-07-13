<script lang="ts">
  /**
   * PublishWizard — front-and-centre publishing flow opened from the toolbar
   * Publish button (replaces the old crammed Project-settings section).
   *
   * Flow is DYNAMIC: [choose destinations] → one setup step PER selected
   * destination → [publish]. No long scrolling form — each destination gets its
   * own focused step.
   *
   * Chrome + form controls follow the shared dialog conventions
   * (dialog-shell.css `.dlg-*`, `.field` inputs, `.dlg-primary`/`.dlg-ghost`
   * buttons) exactly like NewProjectWizard, so it matches the rest of the app.
   *
   * ZERO new backend: it drives the existing PublishSectionController
   * (api.publish.*). Credentials stay in the host store (safeStorage) and are
   * reused across projects; the wizard surfaces connection status and lets the
   * author connect/change a key inline.
   *
   * PWA-clean + $effect-free (CLAUDE.md §8): host work goes through the injected
   * controller; the parent mounts this fresh via {#if} so load runs in onMount;
   * step/selection are plain local state driven by event handlers.
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

  // 0 = choose; 1..N = setup step for selectedCards[i-1]; N+1 = publish.
  let stepIndex = $state(0);
  let selected = $state<Set<string>>(new Set());
  // Per-provider: is the "add another account" connect form open?
  let addingAccount = $state<Record<string, boolean>>({});

  const ADD = "__add_account__";
  function showAddForm(card: PublishProviderCard): boolean {
    return addingAccount[card.id] === true || card.savedAccounts.length === 0;
  }
  function onAccountSelect(card: PublishProviderCard, value: string) {
    if (value === ADD) {
      addingAccount = { ...addingAccount, [card.id]: true };
    } else {
      addingAccount = { ...addingAccount, [card.id]: false };
      void controller.selectCredential(card.id, value);
    }
  }
  async function doConnect(card: PublishProviderCard) {
    await controller.connectPublish(card.id);
    // Collapse the add form only on success (keep it open, with the error, so
    // the author can fix the key).
    if (!controller.publishError) addingAccount = { ...addingAccount, [card.id]: false };
  }

  const cards = $derived(controller.publishCards);
  const selectedCards = $derived(cards.filter((c) => selected.has(c.id)));
  const totalSteps = $derived(selectedCards.length + 2);
  const stepKind = $derived(
    stepIndex === 0 ? "choose" : stepIndex >= totalSteps - 1 ? "publish" : "setup",
  );
  const currentCard = $derived(
    stepKind === "setup" ? (selectedCards[stepIndex - 1] ?? null) : null,
  );
  const stepLabels = $derived([
    "Choose",
    ...selectedCards.map((c) => c.label),
    "Publish",
  ]);
  const blockedCards = $derived(
    selectedCards.filter((c) => c.credentialRequired && !c.connected),
  );

  onMount(() => {
    stepIndex = 0;
    selected = new Set();
    void controller.loadPublish();
  });

  function close() {
    onClose?.();
  }
  function next() {
    stepIndex = Math.min(stepIndex + 1, totalSteps - 1);
  }
  function back() {
    stepIndex = Math.max(stepIndex - 1, 0);
  }
  function toggle(id: string) {
    const nextSet = new Set(selected);
    if (nextSet.has(id)) nextSet.delete(id);
    else nextSet.add(id);
    selected = nextSet;
  }
  function draftValue(card: PublishProviderCard, key: string): string {
    return controller.publishConfigDrafts[card.id]?.[key] ?? card.config[key] ?? "";
  }
  async function publishAll() {
    for (const card of selectedCards) {
      if (card.credentialRequired && !card.connected) continue;
      await controller.runPublish(card.id, false);
    }
  }
</script>

<div class="dlg-backdrop" onclick={close} role="presentation"></div>

<div class="dlg-shell wizard" use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "publish-wizard-title" }}>
  <header class="dlg-header">
    <h2 id="publish-wizard-title"><Icon name="cloud-upload" size={18} /> Publish your book</h2>
    <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
  </header>

  <!-- Dynamic step indicator: Choose → each destination → Publish -->
  <ol class="steps" aria-label="Publishing steps">
    {#each stepLabels as label, i (i)}
      <li class:done={stepIndex > i} class:current={stepIndex === i}>
        <span class="step-dot">{stepIndex > i ? "✓" : i + 1}</span>
        <span class="step-label">{label}</span>
      </li>
    {/each}
  </ol>

  <div class="dialog-body">
    {#if controller.publishError}
      {@const err = friendlyPublishError(controller.publishError)}
      <p class="error" role="alert">{err.summary}</p>
      {#if err.details}
        <details class="status-raw"><summary>Show details</summary><pre>{err.details}</pre></details>
      {/if}
    {/if}

    {#if stepKind === "choose"}
      <p class="lead">Pick one or more places to send your finished book. Each one gets its own quick setup step.</p>
      {#if cards.length === 0}
        <p class="muted">Loading destinations…</p>
      {:else}
        <ul class="dest-list">
          {#each cards as card (card.id)}
            <li>
              <label class="dest" class:selected={selected.has(card.id)}>
                <input type="checkbox" checked={selected.has(card.id)} onchange={() => toggle(card.id)} />
                <span class="dest-main">
                  <span class="dest-name">{card.label}</span>
                  <span class="dest-desc">{card.description}</span>
                </span>
                <span class="dest-meta">
                  <span class="badge">{card.kind === "api" ? "direct upload" : "guided"}</span>
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
    {:else if stepKind === "setup" && currentCard}
      {@const card = currentCard}
      {@const busy = controller.publishBusyId === card.id}
      <p class="lead">Set up <strong>{card.label}</strong>. Saved connections are reused automatically — you only enter a key once.</p>

      {#if card.fields.length > 0}
        {#each card.fields as field (field.key)}
          <label class="field" for={`pw-${card.id}-${field.key}`}>
            <span>{field.label}</span>
            <input
              id={`pw-${card.id}-${field.key}`}
              type="text"
              placeholder={field.placeholder ?? ""}
              value={draftValue(card, field.key)}
              oninput={(e) => controller.setPublishConfigDraft(card.id, field.key, e.currentTarget.value)}
            />
          </label>
        {/each}
        <button class="dlg-ghost self-start" onclick={() => controller.savePublishConfig(card.id)} disabled={busy}>Save settings</button>
      {/if}

      {#if card.credentialRequired}
        {#if card.savedAccounts.length > 0}
          <label class="field" for={`pw-${card.id}-account`}>
            <span>Account</span>
            <select
              id={`pw-${card.id}-account`}
              value={showAddForm(card) ? ADD : card.selectedAccount}
              onchange={(e) => onAccountSelect(card, e.currentTarget.value)}
              disabled={busy}
            >
              {#each card.savedAccounts as acc (acc.account)}
                <option value={acc.account}>{acc.account ? acc.label : "Default account"}</option>
              {/each}
              <option value={ADD}>＋ Add another account…</option>
            </select>
          </label>
        {/if}

        {#if showAddForm(card)}
          <!-- Connect a new (named or default) account. -->
          {#if card.hint}<span class="field-hint">{card.hint}</span>{/if}
          {#if card.savedAccounts.length > 0}
            <label class="field" for={`pw-${card.id}-accname`}>
              <span>Name this account <em class="optional">(optional — e.g. "Studio")</em></span>
              <input
                id={`pw-${card.id}-accname`}
                type="text"
                placeholder="Leave blank for your default"
                value={controller.publishAccountDrafts[card.id] ?? ""}
                oninput={(e) => controller.setPublishAccountDraft(card.id, e.currentTarget.value)}
              />
            </label>
          {/if}
          <label class="field" for={`pw-${card.id}-key`}>
            <span>API key</span>
            <div class="key-row">
              <input
                id={`pw-${card.id}-key`}
                type="password"
                placeholder="Paste API key"
                value={controller.publishTokenDrafts[card.id] ?? ""}
                oninput={(e) => controller.setPublishTokenDraft(card.id, e.currentTarget.value)}
                onkeydown={(e) => { if (e.key === "Enter") doConnect(card); }}
              />
              <button class="dlg-primary" onclick={() => doConnect(card)} disabled={busy}>Connect</button>
            </div>
            {#if card.tokenUrl}
              <button class="link" onclick={() => controller.openPublishUrl(card.tokenUrl!)}>Create an API key <Icon name="external-link" size={12} /></button>
            {/if}
          </label>
        {:else if card.connected}
          <div class="conn-ok">
            <span><Icon name="circle-check" size={14} /> Connected — reusing your saved key.</span>
            <button class="dlg-ghost" onclick={() => controller.disconnectPublish(card.id, card.selectedAccount || undefined)} disabled={busy}>Remove this key</button>
          </div>
        {:else}
          <p class="warn"><Icon name="triangle-alert" size={13} /> This account's key isn't saved yet — add it, or pick another account.</p>
        {/if}
      {:else}
        <p class="muted">No account or key needed — we'll prepare an upload package with step-by-step instructions.</p>
      {/if}
    {:else}
      <!-- Publish step -->
      <p class="lead">
        Publishing uses your project's latest build output. If you've changed the book,
        use <strong>Save PDF</strong> first, then publish.
      </p>
      {#if blockedCards.length > 0}
        <p class="warn" role="alert">
          <Icon name="triangle-alert" size={14} />
          {blockedCards.map((c) => c.label).join(", ")} still {blockedCards.length === 1 ? "needs" : "need"} a key — go back to set {blockedCards.length === 1 ? "it" : "them"} up, or publish the others.
        </p>
      {/if}
      {#each selectedCards as card (card.id)}
        {@const busy = controller.publishBusyId === card.id}
        {@const needsConnect = card.credentialRequired && !card.connected}
        {@const result = controller.publishResults[card.id]}
        <section class="pub-row">
          <div class="pub-head">
            <span class="dest-name">{card.label}</span>
            <div class="pub-actions">
              <button class="dlg-ghost" onclick={() => controller.runPublish(card.id, true)} disabled={busy}>Check readiness</button>
              <button
                class="dlg-primary"
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
                <p class="muted small">Package folder: <code>{outcome.packageDir}</code></p>
                <button class="dlg-primary" onclick={() => controller.openPublishUrl(outcome.openUrl)}>Open upload page <Icon name="external-link" size={12} /></button>
                <ol class="checklist">{#each outcome.checklist as s, i (i)}<li>{s}</li>{/each}</ol>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    {/if}

    <footer class="dlg-actions">
      {#if stepIndex > 0}
        <button class="dlg-ghost" onclick={back}>Back</button>
      {:else}
        <button class="dlg-ghost" onclick={close}>Cancel</button>
      {/if}
      <div class="spacer"></div>
      {#if stepKind === "choose"}
        <button class="dlg-primary" onclick={next} disabled={selected.size === 0}>Next</button>
      {:else if stepKind === "setup"}
        <button class="dlg-primary" onclick={next}>Next</button>
      {:else}
        <button
          class="dlg-primary"
          onclick={publishAll}
          disabled={controller.publishBusyId !== null || selectedCards.every((c) => c.credentialRequired && !c.connected)}
        >
          Publish to all
        </button>
        <button class="dlg-ghost" onclick={close}>Done</button>
      {/if}
    </footer>
  </div>
</div>

<style>
  @import "$lib/styles/dialog-shell.css";

  .wizard { width: min(560px, 94vw); max-height: 84vh; }
  .dlg-header h2 { color: var(--app-text); }

  .steps { list-style: none; display: flex; gap: 4px; margin: 0; padding: 10px 16px; border-bottom: 1px solid var(--app-border-subtle); overflow-x: auto; }
  .steps li { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-faint); white-space: nowrap; flex-shrink: 0; }
  .steps li.current { color: var(--app-text); font-weight: 600; }
  .steps li.done { color: var(--app-text-muted); }
  .step-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--app-border-strong); font-size: 11px; }
  .steps li.current .step-dot { background: var(--app-accent); color: var(--app-accent-text); border-color: var(--app-accent-border); }
  .steps li.done .step-dot { background: var(--app-surface-hover); }

  .dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 14px; overflow-y: auto; flex: 1; }
  .lead { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .muted { color: var(--app-text-muted); font-size: 12px; margin: 0; }
  .muted.small { font-size: 11px; }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .warn { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--app-warning-text, #d29922); }

  /* Fields match NewProjectWizard / the shared dialog form language. */
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  .field-hint { font-weight: 400 !important; color: var(--app-text-faint) !important; font-size: 11px !important; }
  .field input {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
    width: 100%;
  }
  .field input:focus { outline: none; border-color: var(--app-focus-ring); }
  .field select {
    background: var(--app-surface-sunken);
    border: 1px solid var(--app-border);
    color: var(--app-text-secondary);
    padding: 8px 10px;
    border-radius: 6px;
    font-size: 14px;
    width: 100%;
  }
  .field select:focus { outline: none; border-color: var(--app-focus-ring); }
  .optional { font-style: italic; color: var(--app-text-faint); font-weight: 400; }
  .key-row { display: flex; gap: 8px; }
  .key-row input { flex: 1; min-width: 0; }
  .self-start { align-self: flex-start; }

  .dest-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .dest { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); cursor: pointer; }
  .dest:hover { background: var(--app-surface-hover); }
  .dest.selected { border-color: var(--app-focus-ring); background: var(--app-surface-hover); }
  .dest input { margin-top: 2px; flex-shrink: 0; }
  .dest-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .dest-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .dest-desc { font-size: 11px; color: var(--app-text-faint); line-height: 1.35; }
  .dest-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 10px; flex-shrink: 0; }
  .badge { padding: 1px 6px; border-radius: 10px; background: var(--app-surface); border: 1px solid var(--app-border); color: var(--app-text-muted); }
  .status { display: inline-flex; align-items: center; gap: 3px; }
  .status.ok { color: var(--app-success-text, #3fb950); }
  .status.off { color: var(--app-text-faint); }

  .conn-ok { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--app-success-text, #3fb950); }
  .conn-ok span { display: inline-flex; align-items: center; gap: 6px; }

  .pub-row { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .pub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pub-actions { display: flex; gap: 6px; }
  .result { border-top: 1px solid var(--app-border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .issues .error { color: var(--app-error-text); }
  .issues .warning { color: var(--app-warning-text, #d29922); }
  .issues .info { color: var(--app-text-muted); }
  .success-line { margin: 0; font-size: 12px; color: var(--app-success-text, #3fb950); display: inline-flex; align-items: center; gap: 4px; }
  .checklist { margin: 0; padding-left: 18px; font-size: 11px; color: var(--app-text-muted); line-height: 1.5; }
  .result code { font-size: 10px; word-break: break-all; }

  .status-raw summary { cursor: pointer; color: var(--app-text-muted); font-size: 12px; }
  .status-raw pre { margin: 6px 0 0; padding: 8px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px; font-size: 11px; white-space: pre-wrap; overflow: auto; }

  button.link { background: none; border: none; padding: 0; font-size: 11px; color: var(--app-focus-ring); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }

  /* In-flow footer inside the scrolling body (matches NewProjectWizard). */
  .dlg-actions { display: flex; align-items: center; gap: 8px; padding: 14px 0 0; margin-top: 4px; }
  .dlg-actions .spacer { flex: 1; }
</style>

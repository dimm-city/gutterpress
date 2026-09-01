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
  import { dialogBehavior, requestInlineConfirm, cancelInlineConfirm, type InlineConfirmState } from "$lib/dialog";
  import { friendlyPublishError } from "$lib/errors";
  import {
    groupPreflight,
    preflightHeaderLevel,
    preflightCounts,
    categoryLabel,
    entersPreflightForward,
    type PreflightRow,
  } from "$lib/preflight";
  import type { ProblemEntry } from "$lib/platform/dtos";
  import type { PublishProviderCard } from "$lib/platform/contract";
  import type { PublishSectionController } from "$lib/routes/publish-section-controller.svelte";
  import { displayedFormat } from "$lib/publish-format-choice";

  let {
    controller,
    triggerEl,
    onClose,
    onNavigate,
  }: {
    controller: PublishSectionController;
    triggerEl?: HTMLButtonElement | undefined;
    onClose?: () => void;
    /** Reveal a preflight finding in the editor (the "Go to" affordance). The
     *  parent closes this modal wizard and delegates to the shared
     *  Problems-panel navigation (`openProblem`). */
    onNavigate?: (entry: ProblemEntry) => void;
  } = $props();

  // 0 = choose; 1..N = setup step for selectedCards[i-1]; N+1 = preflight;
  // N+2 = publish.
  let stepIndex = $state(0);
  let selected = $state<Set<string>>(new Set());
  // Preflight override (#105): the author may publish past blocking errors, but
  // only after an explicit inline confirmation.
  let publishAnyway = $state(false);
  let overrideConfirm = $state<InlineConfirmState>({});
  // Per-provider: is the "add another account" connect form open?
  let addingAccount = $state<Record<string, boolean>>({});
  // Per-provider: is the inline "New folder…" name form open (#221 D9)?
  let addingFolder = $state<Record<string, boolean>>({});
  // Per-provider in-flight optimistic format pick (#221 C8) — see
  // `displayedFormat`'s doc comment for why this needs to be a real, directly-
  // read $state rather than deriving `checked` from controller state alone.
  let pendingFormat = $state<Record<string, "pdf" | "html">>({});

  const ADD = "__add_account__";
  const NEW_FOLDER = "__new_folder__";
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
  /** Choose the format for a multi-format card (#221 C8). Sets the optimistic
   *  pick immediately so the click feels instant, then ALWAYS clears it once
   *  `selectFormat` settles — on success the controller's own format now
   *  matches what was picked; on failure this is what stops the radio from
   *  staying visually checked on an option that was never actually saved. */
  async function chooseFormat(card: PublishProviderCard, fmt: "pdf" | "html") {
    pendingFormat = { ...pendingFormat, [card.id]: fmt };
    try {
      await controller.selectFormat(card.id, fmt);
    } finally {
      const rest = { ...pendingFormat };
      delete rest[card.id];
      pendingFormat = rest;
    }
  }

  async function doConnect(card: PublishProviderCard) {
    await controller.connectPublish(card.id);
    // Collapse the add form only on success (keep it open, with the error, so
    // the author can fix the key).
    if (!controller.publishError) addingAccount = { ...addingAccount, [card.id]: false };
  }

  function onDestinationSelect(card: PublishProviderCard, value: string) {
    if (value === NEW_FOLDER) {
      addingFolder = { ...addingFolder, [card.id]: true };
      return;
    }
    addingFolder = { ...addingFolder, [card.id]: false };
    const destination = (controller.publishDestinations[card.id] ?? []).find((d) => d.id === value);
    if (destination) void controller.selectDestination(card.id, destination);
  }

  async function doCreateDestination(card: PublishProviderCard) {
    await controller.createNewDestination(card.id);
    // Collapse the inline form only on success (keep it open, with the
    // error, so the author can fix the name).
    if (!controller.publishError) addingFolder = { ...addingFolder, [card.id]: false };
  }

  const cards = $derived(controller.publishCards);
  const selectedCards = $derived(cards.filter((c) => selected.has(c.id)));
  const totalSteps = $derived(selectedCards.length + 3);
  // Publish is the strict last index; preflight sits one before it.
  const stepKind = $derived(
    stepIndex === 0
      ? "choose"
      : stepIndex === totalSteps - 1
        ? "publish"
        : stepIndex === totalSteps - 2
          ? "preflight"
          : "setup",
  );
  const currentCard = $derived(
    stepKind === "setup" ? (selectedCards[stepIndex - 1] ?? null) : null,
  );
  const stepLabels = $derived([
    "Choose",
    ...selectedCards.map((c) => c.label),
    "Preflight",
    "Publish",
  ]);
  const blockedCards = $derived(
    selectedCards.filter((c) => c.credentialRequired && !c.connected),
  );

  // ── Preflight gate (#105) ───────────────────────────────────────────────────
  // A blocking ERROR disables Publish by default; the author may override with an
  // explicit confirmation. Warnings/info never block. Not-yet-run also blocks
  // (the author is prompted to run it).
  const preflightErrorCount = $derived(
    controller.preflightRows.filter((r) => r.severity === "error").length,
  );
  const preflightMissing = $derived(!controller.preflightRan);
  // An infrastructure failure (route/host error) clears the rows and sets
  // preflightError; it must NOT read as "all clear", so it keeps the gate closed.
  const preflightErrored = $derived(controller.preflightError !== null);
  const preflightBlocks = $derived(
    controller.preflightRan && preflightErrorCount > 0 && !publishAnyway,
  );
  /** Publish actions are disabled while preflight hasn't run, errored, or blocks. */
  const publishGated = $derived(preflightMissing || preflightErrored || preflightBlocks);

  onMount(() => {
    stepIndex = 0;
    selected = new Set();
    void controller.loadPublish();
  });

  function close() {
    onClose?.();
  }
  /** Entering a step may need to react (no $effect — driven by these
   *  step-change event handlers, CLAUDE.md §8): a FORWARD entry into the
   *  Preflight step runs its checks; a connected setup step with a folder
   *  picker (#221 D9) loads it, so revisiting the step after connecting (or
   *  coming back to it) shows current folders without a manual refresh.
   *  `direction` matters ONLY for the preflight rerun (C4 hardening) —
   *  stepping BACK into Preflight from Publish must not re-run it and
   *  silently clear an override the author already granted; see
   *  `entersPreflightForward`'s doc comment for the full story. */
  function enterStep(target: number, direction: "forward" | "back") {
    stepIndex = target;
    if (entersPreflightForward(direction, target, totalSteps)) runPreflightNow();
    const card = selectedCards[target - 1];
    if (card?.connected && card.destinations) void controller.loadDestinations(card.id);
  }
  function next() {
    enterStep(Math.min(stepIndex + 1, totalSteps - 1), "forward");
  }
  function back() {
    enterStep(Math.max(stepIndex - 1, 0), "back");
  }
  function runPreflightNow() {
    // Re-running invalidates any prior "publish anyway" override.
    publishAnyway = false;
    overrideConfirm = cancelInlineConfirm(overrideConfirm, "override");
    void controller.runPreflight(selectedCards.map((c) => c.id));
  }
  function requestPublishAnyway() {
    const { state, confirmed } = requestInlineConfirm(overrideConfirm, "override");
    overrideConfirm = state;
    if (confirmed) publishAnyway = true;
  }
  function goTo(row: PreflightRow) {
    const loc = row.location;
    if (!loc?.filePath) return;
    onNavigate?.({
      filePath: loc.filePath,
      file: loc.file,
      line: loc.line,
      column: loc.column,
      severity: row.severity,
      message: row.message,
      source: row.id,
    });
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
    if (publishGated) return; // preflight gate (belt-and-braces with the disabled state)
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
      <li class:done={stepIndex > i} class:current={stepIndex === i} aria-current={stepIndex === i ? "step" : undefined}>
        <!-- The check Icon is aria-hidden (like every Icon); the sr-only text
             keeps the completed state announced now that the old "✓" text
             glyph is gone. -->
        <span class="step-dot">{#if stepIndex > i}<Icon name="check" size={12} /><span class="dlg-sr-only">Completed:</span>{:else}{i + 1}{/if}</span>
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

      {#if card.formats && card.formats.length > 1}
        {@const chosenFormat = displayedFormat(pendingFormat[card.id], controller.effectiveFormat(card))}
        <fieldset class="field fmt-choice">
          <legend>What to publish</legend>
          <ul class="dest-list">
            {#each card.formats as fmt (fmt)}
              <li>
                <label class="dest" class:selected={chosenFormat === fmt}>
                  <input
                    type="radio"
                    name={`pw-${card.id}-format`}
                    checked={chosenFormat === fmt}
                    onchange={() => chooseFormat(card, fmt)}
                    disabled={busy}
                  />
                  <span class="dest-main">
                    <span class="dest-name">{fmt === "pdf" ? "PDF" : "Website (HTML export)"}</span>
                    <span class="dest-desc">
                      {fmt === "pdf"
                        ? "Upload the finished PDF file."
                        : "Zip the website export into one file. Drive delivers files, not live sites — use Azure Static Web Apps to publish it as one."}
                    </span>
                  </span>
                </label>
              </li>
            {/each}
          </ul>
        </fieldset>
      {/if}

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
              <option value={ADD}>Add another account…</option>
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
          {#if card.connectKind === "oauth"}
            <!-- No key to paste — an interactive browser consent flow instead
                 (#221 D10). controller.googleAuthUrls[card.id] is set for the
                 whole attempt (busy === true throughout), so its presence is
                 what distinguishes "waiting for the browser" from "not yet
                 started". -->
            {@const authUrl = controller.googleAuthUrls[card.id]}
            {#if busy && authUrl}
              <p class="oauth-waiting">
                <Icon name="refresh-cw" size={13} />
                Waiting for your browser — choose your Google account and click Allow.
              </p>
              <div class="key-row">
                <button class="link" onclick={() => controller.reopenGoogleAuthUrl(card.id)}>
                  Open the sign-in page again <Icon name="external-link" size={12} />
                </button>
                <button class="dlg-ghost" onclick={() => controller.cancelGoogleOAuth(card.id)}>Cancel</button>
              </div>
            {:else}
              <button
                class="dlg-primary app-btn-primary dlg-primary-inline self-start"
                onclick={() => controller.connectGoogleOAuth(card.id)}
                disabled={busy}
              >
                Connect Google Drive
              </button>
            {/if}
          {:else}
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
                <button class="dlg-primary app-btn-primary dlg-primary-inline" onclick={() => doConnect(card)} disabled={busy}>Connect</button>
              </div>
              {#if card.tokenUrl}
                <button class="link" onclick={() => controller.openPublishUrl(card.tokenUrl!)}>Create an API key <Icon name="external-link" size={12} /></button>
              {/if}
            </label>
          {/if}
        {:else if card.connected}
          {@const savedLabel = card.savedAccounts.find((a) => a.account === card.selectedAccount)?.label}
          <div class="conn-ok">
            <span>
              <Icon name="circle-check" size={14} />
              {#if card.connectKind === "oauth" && savedLabel}Connected — {savedLabel}.{:else}Connected — reusing your saved key.{/if}
            </span>
            <button class="dlg-ghost" onclick={() => controller.disconnectPublish(card.id, card.selectedAccount || undefined)} disabled={busy}>Remove this key</button>
          </div>
          {#if card.destinations}
            {@const destBusy = controller.destinationsBusyId[card.id] === true}
            {@const dests = controller.publishDestinations[card.id] ?? []}
            {@const currentFolderId = card.config.folderId ?? ""}
            <label class="field" for={`pw-${card.id}-folder`}>
              <span>{card.destinations.label}</span>
              <select
                id={`pw-${card.id}-folder`}
                value={addingFolder[card.id] ? NEW_FOLDER : currentFolderId}
                onchange={(e) => onDestinationSelect(card, e.currentTarget.value)}
                disabled={destBusy || busy}
              >
                <option value="">{destBusy ? "Loading folders…" : "Choose a folder…"}</option>
                {#each dests as d (d.id)}
                  <option value={d.id}>{d.title}</option>
                {/each}
                {#if card.destinations.canCreate}
                  <option value={NEW_FOLDER}>New folder…</option>
                {/if}
              </select>
            </label>
            {#if addingFolder[card.id]}
              <div class="key-row">
                <input
                  type="text"
                  placeholder="Folder name"
                  value={controller.newDestinationDrafts[card.id] ?? ""}
                  oninput={(e) => controller.setNewDestinationDraft(card.id, e.currentTarget.value)}
                  onkeydown={(e) => { if (e.key === "Enter") doCreateDestination(card); }}
                />
                <button class="dlg-primary app-btn-primary dlg-primary-inline" onclick={() => doCreateDestination(card)} disabled={busy}>Create</button>
              </div>
            {/if}
            {#if controller.destinationsError[card.id]}<p class="error">{controller.destinationsError[card.id]}</p>{/if}
            <p class="field-hint">Or type a folder name directly in the {card.destinations.label.toLowerCase()} field above — it's created at your Drive's root the first time you publish.</p>
          {/if}
        {:else}
          <p class="warn"><Icon name="triangle-alert" size={13} /> This account {card.connectKind === "oauth" ? "isn't connected yet — connect it" : "'s key isn't saved yet — add it"}, or pick another account.</p>
        {/if}
      {:else}
        <p class="muted">No account or key needed — we'll prepare an upload package with step-by-step instructions.</p>
      {/if}
    {:else if stepKind === "preflight"}
      {@const level = preflightHeaderLevel(controller.preflightRows)}
      {@const counts = preflightCounts(controller.preflightRows)}
      <p class="lead">A quick readiness check of your content, images, and fonts before you publish.</p>

      <div class="pf-head">
        <span class={`pf-status pf-${level}`}>
          <Icon
            name={controller.preflightBusy
              ? "refresh-cw"
              : level === "error"
                ? "circle-x"
                : level === "warning"
                  ? "triangle-alert"
                  : "circle-check"}
            size={16}
          />
          <span>
            {#if controller.preflightBusy}
              Checking your book…
            {:else if !controller.preflightRan}
              Not checked yet.
            {:else if controller.preflightError}
              Couldn’t run the checks — please try Re-run.
            {:else if level === "error"}
              {counts.errors} {counts.errors === 1 ? "problem" : "problems"} to fix before publishing.
            {:else if level === "warning"}
              Looks publishable — {counts.warnings} {counts.warnings === 1 ? "thing" : "things"} to review.
            {:else}
              All clear — ready to publish.
            {/if}
          </span>
        </span>
        <button class="dlg-ghost" onclick={runPreflightNow} disabled={controller.preflightBusy}>
          <Icon name="refresh-cw" size={13} /> Re-run
        </button>
      </div>

      {#if controller.preflightError}
        <p class="error" role="alert">{controller.preflightError}</p>
      {/if}

      {#if controller.preflightRan && !controller.preflightBusy && !controller.preflightError}
        {#if controller.preflightRows.length === 0}
          <p class="success-line"><Icon name="circle-check" size={13} /> No problems found in your content, images, or fonts.</p>
        {:else}
          {#each groupPreflight(controller.preflightRows) as group (group.category)}
            <section class="pf-group">
              <h3 class="pf-group-title">{categoryLabel(group.category)}</h3>
              <ul class="pf-list">
                {#each group.rows as row, i (row.id + "|" + i)}
                  <li class={`pf-row sev-${row.severity}`}>
                    <Icon
                      name={row.severity === "error" ? "circle-x" : row.severity === "warning" ? "triangle-alert" : "info"}
                      size={13}
                    />
                    <div class="pf-body">
                      <p class="pf-msg">{row.message}</p>
                      <div class="pf-meta">
                        <span class="pf-source">{row.label}</span>
                        {#if row.provider}<span class="pf-provider">{row.provider}</span>{/if}
                        {#if row.code}<code class="pf-code">{row.code}</code>{/if}
                        {#if row.location?.file}
                          <span class="pf-loc">{row.location.file}{#if row.location.line}:{row.location.line}{/if}</span>
                        {/if}
                      </div>
                    </div>
                    {#if row.fixable === "navigate"}
                      <button class="dlg-ghost pf-goto" onclick={() => goTo(row)}>Go to</button>
                    {/if}
                  </li>
                {/each}
              </ul>
            </section>
          {/each}
        {/if}
      {/if}

      <p class="muted small">
        <Icon name="info" size={12} /> Print-quality PDF checks (page size, ink coverage, embedded fonts) run automatically when you export — no PDF is built here.
      </p>
    {:else}
      <!-- Publish step -->
      <p class="lead">
        Publishing uses your project's latest build output. If you've changed the book,
        use <strong>Export</strong> first, then publish.
      </p>
      {#if preflightMissing}
        <p class="warn" role="alert">
          <Icon name="triangle-alert" size={14} />
          Readiness hasn't run yet. <button class="link" onclick={back}>Go back to check</button> before publishing.
        </p>
      {:else if preflightErrorCount > 0}
        <p class="warn" role="alert">
          <Icon name="triangle-alert" size={14} />
          Preflight found {preflightErrorCount} {preflightErrorCount === 1 ? "problem" : "problems"} that
          {preflightErrorCount === 1 ? "blocks" : "block"} publishing.
          {#if publishAnyway}
            <span class="muted">Override on — publishing enabled.</span>
          {:else}
            <button class="link" onclick={requestPublishAnyway}>
              {overrideConfirm["override"] ? "Really publish anyway?" : "Publish anyway"}
            </button>
          {/if}
        </p>
      {/if}
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
                class="dlg-primary app-btn-primary dlg-primary-inline"
                onclick={() => controller.runPublish(card.id, false)}
                disabled={busy || needsConnect || publishGated}
                title={needsConnect
                  ? "Connect first — this destination needs a key."
                  : preflightMissing
                    ? "Run the readiness check first."
                    : preflightBlocks
                      ? "Preflight found blocking problems — fix them or choose Publish anyway."
                      : undefined}
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
                <button class="dlg-primary app-btn-primary dlg-primary-inline" onclick={() => controller.openPublishUrl(outcome.openUrl)}>Open upload page <Icon name="external-link" size={12} /></button>
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
        <button class="dlg-primary app-btn-primary" onclick={next} disabled={selected.size === 0}>Next</button>
      {:else if stepKind === "setup"}
        <button class="dlg-primary app-btn-primary" onclick={next}>Next</button>
      {:else if stepKind === "preflight"}
        <button class="dlg-primary app-btn-primary" onclick={next} disabled={controller.preflightBusy}>Next</button>
      {:else}
        <button
          class="dlg-primary app-btn-primary"
          onclick={publishAll}
          disabled={controller.publishBusyId !== null || publishGated || selectedCards.every((c) => c.credentialRequired && !c.connected)}
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
  .steps li { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-muted); white-space: nowrap; flex-shrink: 0; }
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
  .warn { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--app-warning-text); }

  /* Fields match NewProjectWizard / the shared dialog form language. */
  .field { display: flex; flex-direction: column; gap: 6px; }
  .field > span { font-size: 12px; color: var(--app-text-muted); font-weight: 500; }
  /* The hint sits OUTSIDE any .field wrapper (it precedes the label), so no
     higher-specificity label rule competes — no !important needed. */
  .field-hint { font-weight: 400; color: var(--app-text-muted); font-size: 11px; }
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
  .optional { font-style: italic; color: var(--app-text-muted); font-weight: 400; }
  .key-row { display: flex; gap: 8px; }
  /* In-body primary buttons (Connect / Publish / Open upload page) sit outside
     the .dlg-actions footer, so they restate its geometry; colors come from
     .app-btn-primary. */
  .dlg-primary-inline {
    padding: 6px 14px; font-size: 13px; border-radius: 4px;
    border-width: 1px; border-style: solid; cursor: pointer;
  }
  .key-row input { flex: 1; min-width: 0; }
  .self-start { align-self: flex-start; }

  /* Format choice (#221 phase 3, D8) reuses the .dest-list row language —
     border/margin reset since it's a <fieldset>, not the .field <label>. */
  .fmt-choice { border: none; margin: 0; padding: 0; }
  .fmt-choice legend { font-size: 12px; color: var(--app-text-muted); font-weight: 500; padding: 0; margin: 0 0 6px; }
  .dest-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .dest { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); cursor: pointer; }
  .dest:hover { background: var(--app-surface-hover); }
  .dest.selected { border-color: var(--app-focus-ring); background: var(--app-surface-hover); }
  .dest input { margin-top: 2px; flex-shrink: 0; }
  .dest-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .dest-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .dest-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  .dest-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 10px; flex-shrink: 0; }
  .badge { padding: 1px 6px; border-radius: 10px; background: var(--app-surface); border: 1px solid var(--app-border); color: var(--app-text-muted); }
  .status { display: inline-flex; align-items: center; gap: 3px; }
  .status.ok { color: var(--app-success-text); }
  .status.off { color: var(--app-text-muted); }

  .conn-ok { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--app-success-text); }
  .conn-ok span { display: inline-flex; align-items: center; gap: 6px; }

  .oauth-waiting { display: flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--app-text-secondary); }

  .pub-row { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .pub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .pub-actions { display: flex; gap: 6px; }
  .result { border-top: 1px solid var(--app-border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .issues .error { color: var(--app-error-text); }
  .issues .warning { color: var(--app-warning-text); }
  .issues .info { color: var(--app-text-muted); }
  .success-line { margin: 0; font-size: 12px; color: var(--app-success-text); display: inline-flex; align-items: center; gap: 4px; }
  .checklist { margin: 0; padding-left: 18px; font-size: 11px; color: var(--app-text-muted); line-height: 1.5; }
  .result code { font-size: 10px; word-break: break-all; }

  .status-raw summary { cursor: pointer; color: var(--app-text-muted); font-size: 12px; }
  .status-raw pre { margin: 6px 0 0; padding: 8px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px; font-size: 11px; white-space: pre-wrap; overflow: auto; }

  button.link { background: none; border: none; padding: 0; font-size: 11px; color: var(--app-focus-ring); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }

  /* In-flow footer inside the scrolling body (matches NewProjectWizard). */
  .dlg-actions { display: flex; align-items: center; gap: 8px; padding: 14px 0 0; margin-top: 4px; }
  .dlg-actions .spacer { flex: 1; }

  /* ── Preflight step (#105) ────────────────────────────────────────────── */
  .pf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .pf-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
  .pf-status.pf-error { color: var(--app-error-text); }
  .pf-status.pf-warning { color: var(--app-warning-text); }
  .pf-status.pf-ok { color: var(--app-success-text); }

  .pf-group { display: flex; flex-direction: column; gap: 6px; }
  .pf-group-title { margin: 0; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); font-weight: 600; }
  .pf-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .pf-row { display: flex; align-items: flex-start; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .pf-row.sev-error { color: var(--app-error-text); }
  .pf-row.sev-warning { color: var(--app-warning-text); }
  .pf-row.sev-info { color: var(--app-info-text); }
  .pf-body { display: flex; flex-direction: column; gap: 3px; flex: 1; min-width: 0; }
  .pf-msg { margin: 0; font-size: 12px; color: var(--app-text); }
  .pf-meta { display: flex; align-items: center; flex-wrap: wrap; gap: 6px; font-size: 10px; }
  .pf-source { padding: 1px 6px; border-radius: 10px; background: var(--app-control-bg); color: var(--app-text-secondary); }
  .pf-provider { padding: 1px 6px; border-radius: 10px; background: var(--app-surface); border: 1px solid var(--app-border); color: var(--app-text-muted); }
  .pf-code { font-family: var(--app-font-mono); color: var(--app-text-muted); }
  .pf-loc { color: var(--app-text-muted); }
  .pf-goto { flex-shrink: 0; align-self: flex-start; font-size: 11px; padding: 4px 8px; }
</style>

<script lang="ts">
  /**
   * PublishWizard — the app's Publish view (ADR 0012 §6), opened from the
   * toolbar's Publish button. Three steps:
   *
   *   1. Targets — the book's targets (shared with everyone who has the book),
   *      each showing the file it receives or a format to pick, ticked when
   *      this person sends it; add or remove targets for the book.
   *   2. Set up — accounts and settings for the targets being sent.
   *   3. Publish — the lib's one publish run, the same one
   *      `gutterpress publish` runs: one layout of the book, each file made
   *      once and checked against each target's rules, then sent. Progress as
   *      the run reports it, and a result per target.
   *
   * It names no target and builds, checks or sends nothing itself: it reads
   * the cards and the run's result, and asks the controller.
   *
   * Accounts are managed on the Accounts page; the view lists a target's saved
   * accounts, lets the person pick one for this book, and adds or replaces one
   * with the Accounts page's own form (PublishKeyForm). Which account they use,
   * a folder outside the book, a Drive folder of their own (#452), and which
   * targets they send are theirs: the host keeps those on this computer.
   *
   * PWA-clean + $effect-free (CLAUDE.md §8): the parent mounts this fresh via
   * {#if}, so loading runs in onMount; step state is plain local state driven
   * by event handlers.
   */
  import Icon from "#lib/components/Icon.svelte";
  import AppView from "#lib/components/AppView.svelte";
  import PublishKeyForm from "#lib/components/PublishKeyForm.svelte";
  import { replaceHint } from "#lib/accounts.ts";
  import { onMount } from "svelte";
  import type { ProblemEntry } from "#lib/platform/dtos.ts";
  import type { PublishBookResult, PublishProviderCard } from "#lib/platform/contract.ts";
  import type { PublishSectionController } from "#lib/routes/publish-section-controller.svelte.ts";
  import { isPathAtOrUnder, joinPath } from "#lib/platform/paths.ts";

  type TargetResult = PublishBookResult["targets"][number];
  type Finding = PublishBookResult["sourceFindings"][number];

  let {
    controller,
    projectDir,
    pickFolder,
    onShowInFolder,
    triggerEl,
    onClose,
    onNavigate,
    onManageAccounts,
    onReviewProblems,
  }: {
    controller: PublishSectionController;
    projectDir: string;
    /** Native folder dialog for a folder setting; null when closed. */
    pickFolder: (defaultPath: string) => Promise<string | null>;
    onShowInFolder: (path: string) => void;
    triggerEl?: HTMLButtonElement | undefined;
    onClose?: () => void;
    /** Reveal a finding in the editor (the "Go to" affordance). */
    onNavigate?: (entry: ProblemEntry) => void;
    /** Open the Accounts page (over this one) to see, replace or remove an account. */
    onManageAccounts?: () => void;
    /** Close this view and open the Problems list (the run's findings). */
    onReviewProblems?: () => void;
  } = $props();

  const STEPS = ["Targets", "Set up", "Publish"] as const;
  let stepIndex = $state(0);
  const FORMAT_NAMES: Record<PublishProviderCard["format"], string> = {
    pdf: "PDF",
    pdfx: "PDF/X for print",
    html: "Website",
  };
  const FINDINGS_SHOWN = 5;

  // Per target: which account form is open — adding another account, or
  // replacing the key (or sign-in) of the selected one.
  let accountForm = $state<Record<string, "add" | "edit" | undefined>>({});
  // Per target: is the inline "New folder…" name form open (#221)?
  let addingFolder = $state<Record<string, boolean>>({});
  const ADD = "__add_account__";
  const NONE = "__no_account__";
  const NEW_FOLDER = "__new_folder__";

  const cards = $derived(controller.publishCards);
  const bookCards = $derived(controller.bookTargets);
  const otherCards = $derived(cards.filter((c) => !c.inBook));
  const sending = $derived(controller.sendingTargets);
  const needsAccount = (c: PublishProviderCard) => c.credentialRequired && !c.connected;
  const hasSetup = (c: PublishProviderCard) =>
    c.fields.length > 0 || c.credentialRequired || c.kind === "plugin" || !!c.destinations;
  const setupCards = $derived(sending.filter(hasSetup));
  const needsSetup = $derived(sending.filter(needsAccount));
  const result = $derived(controller.result);
  const running = $derived(controller.running);
  const lastProgress = $derived(controller.progress.at(-1)?.message ?? "Starting…");
  const busy = $derived(running || controller.publishBusyId !== null);

  onMount(() => {
    void controller.loadPublish();
  });

  function close() {
    // A run is stopped with Stop, not by leaving.
    if (running) return;
    onClose?.();
  }

  /** The path to show: relative to the book when it is inside it. */
  function displayPath(absPath: string): string {
    if (!projectDir || !isPathAtOrUnder(absPath, projectDir)) return absPath;
    return absPath.slice(projectDir.length).replace(/^[\\/]+/, "").replace(/\\/g, "/") || ".";
  }
  const isAbsolute = (p: string) => /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(p);
  const inBookPath = (p: string) => (isAbsolute(p) ? p : joinPath(projectDir, p));

  // ── Steps ───────────────────────────────────────────────────────────────────
  /** Entering Set up loads each connected target's folder list (#221), so it is current. */
  function enterStep(target: number) {
    stepIndex = target;
    if (STEPS[target] !== "Set up") return;
    for (const card of setupCards) if (card.connected && card.destinations) void controller.loadDestinations(card.id);
  }
  /** Leaving Set up saves what was typed there; false (stay) when that fails. */
  async function saveStep(): Promise<boolean> {
    if (STEPS[stepIndex] !== "Set up") return true;
    for (const card of setupCards) {
      if (Object.keys(controller.publishConfigDrafts[card.id] ?? {}).length === 0) continue;
      await controller.savePublishConfig(card.id);
      if (controller.publishError) return false;
    }
    return true;
  }
  async function next() {
    if (await saveStep()) enterStep(Math.min(stepIndex + 1, STEPS.length - 1));
  }
  async function back() {
    if (await saveStep()) enterStep(Math.max(stepIndex - 1, 0));
  }

  // ── Set up ──────────────────────────────────────────────────────────────────
  function draftValue(card: PublishProviderCard, key: string): string {
    return controller.publishConfigDrafts[card.id]?.[key] ?? card.config[key] ?? "";
  }
  async function chooseFolder(card: PublishProviderCard, key: string, placeholder = "") {
    const picked = await pickFolder(inBookPath(draftValue(card, key) || placeholder || "."));
    if (picked) controller.setPublishConfigDraft(card.id, key, picked);
  }
  function showAddForm(card: PublishProviderCard): boolean {
    return accountForm[card.id] === "add" || card.savedAccounts.length === 0;
  }
  function onAccountSelect(card: PublishProviderCard, value: string) {
    accountForm = { ...accountForm, [card.id]: value === ADD ? "add" : undefined };
    if (value !== ADD) void controller.selectCredential(card.id, value);
  }
  /** The form saved an account: this book uses it. */
  async function accountSaved(card: PublishProviderCard, account: string) {
    accountForm = { ...accountForm, [card.id]: undefined };
    await controller.selectCredential(card.id, account);
  }
  function closeAccountForm(card: PublishProviderCard) {
    accountForm = { ...accountForm, [card.id]: undefined };
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
  /** Folders that share a name are told apart by their place in the list
   *  (most recently changed first), so a person can choose among them (#452). */
  function folderLabel(dests: { id: string; title: string }[], i: number): string {
    const same = dests.filter((d) => d.title === dests[i]!.title);
    return same.length > 1 ? `${dests[i]!.title} (${same.indexOf(dests[i]!) + 1})` : dests[i]!.title;
  }
  async function doCreateDestination(card: PublishProviderCard) {
    await controller.createNewDestination(card.id);
    // Collapse the inline form only on success (keep it open, with the error).
    if (!controller.publishError) addingFolder = { ...addingFolder, [card.id]: false };
  }

  // ── Publish ─────────────────────────────────────────────────────────────────
  const resultFor = (id: string): TargetResult | undefined => result?.targets.find((t) => t.id === id);
  const problems = (findings: Finding[]) => findings.filter((f) => f.severity !== "info");
  function goTo(f: Finding) {
    if (!f.file) return;
    onNavigate?.({
      filePath: inBookPath(f.file),
      file: f.file,
      line: f.line,
      column: f.column,
      severity: f.severity,
      message: f.message,
      source: f.checkId,
    });
  }
  /** Go back to a target's setup. */
  function setUp() {
    enterStep(STEPS.indexOf("Set up"));
  }
</script>

<AppView class="wizard" title="Publish your book" icon="cloud-upload" onClose={close} {triggerEl}>
  <ol class="steps" aria-label="Publishing steps">
    {#each STEPS as label, i (label)}
      {@const attention = label === "Set up" && stepIndex > i && needsSetup.length > 0}
      <li class:done={stepIndex > i && !attention} class:attention class:current={stepIndex === i} aria-current={stepIndex === i ? "step" : undefined}>
        <span class="step-dot">
          {#if attention}<Icon name="triangle-alert" size={12} /><span class="sr-only">Needs setup:</span>
          {:else if stepIndex > i}<Icon name="check" size={12} /><span class="sr-only">Completed:</span>
          {:else}{i + 1}{/if}
        </span>
        <span class="step-label">{label}</span>
      </li>
    {/each}
  </ol>

  <div class="dialog-body">
    {#if controller.publishError}
      <p class="error" role="alert">{controller.publishError}</p>
    {/if}

    {#if STEPS[stepIndex] === "Targets"}
      <p class="lead">
        Where this book goes. The book's targets are saved with it, so everyone who has the book sees them; which ones
        you send is up to you.
      </p>
      {#if cards.length === 0}
        <p class="muted">Loading targets…</p>
      {:else}
        {#if bookCards.length === 0}
          <p class="muted">This book has no targets yet. Add one below.</p>
        {:else}
          <ul class="dest-list">
            {#each bookCards as card (card.id)}
              <li class="dest" class:selected={card.sending}>
                <input
                  id={`pw-send-${card.id}`}
                  type="checkbox"
                  checked={card.sending}
                  disabled={busy}
                  onchange={() => controller.setSending(card.id, !card.sending)}
                />
                <span class="dest-main">
                  <label class="dest-name" for={`pw-send-${card.id}`}>{card.label}</label>
                  <span class="dest-desc">{card.description}</span>
                  {#if card.formats && card.formats.length > 1}
                    <label class="file-pick">
                      <span>File</span>
                      <select
                        value={controller.effectiveFormat(card)}
                        disabled={busy}
                        onchange={(e) => controller.selectFormat(card.id, e.currentTarget.value as PublishProviderCard["format"])}
                      >
                        {#each card.formats as f (f)}<option value={f}>{FORMAT_NAMES[f]}</option>{/each}
                      </select>
                    </label>
                  {:else}
                    <span class="dest-desc">File: {FORMAT_NAMES[card.format]}</span>
                  {/if}
                </span>
                <span class="dest-meta">
                  {#if card.experimental}<span class="badge">Experimental</span>{/if}
                  {#if card.credentialRequired}
                    <span class={`status ${card.connected ? "ok" : "off"}`}>
                      {#if card.connected}<Icon name="circle-check" size={12} /> Connected{:else if card.connectKind === "oauth"}Needs sign-in{:else}Needs a key{/if}
                    </span>
                  {/if}
                  <button class="link" onclick={() => controller.setInBook(card.id, false)} disabled={busy}>Remove from book</button>
                </span>
              </li>
            {/each}
          </ul>
        {/if}

        {#if otherCards.length > 0}
          <section class="add-targets" aria-label="Add a target">
            <h3 class="section-title">Add a target</h3>
            <ul class="dest-list">
              {#each otherCards as card (card.id)}
                <li class="dest other">
                  <span class="dest-main">
                    <span class="dest-name">{card.label}</span>
                    <span class="dest-desc">{card.description}</span>
                  </span>
                  <button class="app-btn app-btn-ghost small" onclick={() => controller.setInBook(card.id, true)} disabled={busy}>Add</button>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        <label class="setting">
          <input type="checkbox" checked={!controller.skipChecks} onchange={(e) => (controller.skipChecks = !e.currentTarget.checked)} />
          <span class="dest-main">
            <span class="setting-title">Check the files before sending (recommended)</span>
            <span class="dest-desc">Checks your book, then each file against the rules of each target it goes to. A target whose file breaks its rules is held back until you send it anyway.</span>
          </span>
        </label>
      {/if}
    {:else if STEPS[stepIndex] === "Set up"}
      {#if setupCards.length === 0}
        <p class="lead">{sending.length === 0 ? "No targets are ticked to send." : "Nothing to set up: the targets you send need no account or settings."}</p>
      {:else}
        <p class="lead">
          Accounts are saved on this computer and used by every book, so you connect each one once. Settings are saved with
          the book when you go on, so your team shares them.
        </p>
      {/if}
      {#each setupCards as card (card.id)}
        {@const cardBusy = controller.publishBusyId === card.id}
        <section class="pub-row" aria-label={card.label}>
          <h3 class="dest-name">{card.label}</h3>
          {#if card.kind === "plugin"}<p class="muted">{card.description}</p>{/if}

          {#each card.fields as field (field.key)}
            <label class="field" for={`pw-${card.id}-${field.key}`}>
              <span>{field.label}</span>
              <span class="key-row">
                <input
                  id={`pw-${card.id}-${field.key}`}
                  type="text"
                  placeholder={field.placeholder ?? ""}
                  value={draftValue(card, field.key)}
                  oninput={(e) => controller.setPublishConfigDraft(card.id, field.key, e.currentTarget.value)}
                />
                {#if field.kind === "folder"}
                  <button class="app-btn app-btn-ghost" onclick={() => chooseFolder(card, field.key, field.placeholder)} disabled={cardBusy}>Choose…</button>
                {/if}
              </span>
            </label>
            {#if field.kind === "folder" && !isPathAtOrUnder(inBookPath(draftValue(card, field.key) || field.placeholder || "."), projectDir)}
              <p class="field-hint">Outside your book, so it is yours alone: saved on this computer only, and confirmed in a dialog each time you publish.</p>
            {/if}
          {/each}

          {#if card.credentialRequired}
            {#if card.savedAccounts.length > 0}
              <label class="field" for={`pw-${card.id}-account`}>
                <span>Account</span>
                <select
                  id={`pw-${card.id}-account`}
                  value={showAddForm(card) ? ADD : card.connected ? card.selectedAccount : NONE}
                  onchange={(e) => onAccountSelect(card, e.currentTarget.value)}
                  disabled={cardBusy}
                >
                  {#if !card.connected}<option value={NONE} disabled>Choose an account…</option>{/if}
                  {#each card.savedAccounts as acc (acc.account)}
                    <option value={acc.account}>{acc.account ? acc.label : "Default account"}</option>
                  {/each}
                  <option value={ADD}>Add another account…</option>
                </select>
              </label>
              <span class="field-hint">
                The account this book uses is saved on this computer only, so it never changes anyone else's copy of the book.
                {#if onManageAccounts}<button class="link" onclick={onManageAccounts}>Manage accounts</button>{/if}
              </span>
            {/if}

            {#key card.id}
              {#if showAddForm(card)}
                <!-- Add an account with the Accounts page's own form; this book then uses it. -->
                <PublishKeyForm
                  provider={card}
                  askAccount={card.savedAccounts.length > 0}
                  saved={card.savedAccounts.map((a) => ({ provider: card, account: a.account, label: a.label }))}
                  checkValue={card.checkField ? draftValue(card, card.checkField.key) : ""}
                  takeFocus={accountForm[card.id] === "add"}
                  onConnected={(account) => accountSaved(card, account)}
                  onCancel={card.savedAccounts.length > 0 ? () => closeAccountForm(card) : undefined}
                />
              {:else if accountForm[card.id] === "edit"}
                <PublishKeyForm
                  provider={card}
                  account={card.selectedAccount}
                  hint={replaceHint(card)}
                  checkValue={card.checkField ? draftValue(card, card.checkField.key) : ""}
                  submitLabel="Save"
                  takeFocus
                  onConnected={(account) => accountSaved(card, account)}
                  onCancel={() => closeAccountForm(card)}
                />
              {:else if !card.connected}
                <p class="warn"><Icon name="triangle-alert" size={13} /> Pick one of your accounts above, or add another, to send here.</p>
              {:else}
                {@const savedLabel = card.savedAccounts.find((a) => a.account === card.selectedAccount)?.label}
                <div class="conn-ok">
                  <span>
                    <Icon name="circle-check" size={14} />
                    {#if card.connectKind === "oauth" && savedLabel}Connected — {savedLabel}.{:else}Connected — reusing your saved key.{/if}
                  </span>
                  <button class="app-btn app-btn-ghost" onclick={() => (accountForm = { ...accountForm, [card.id]: "edit" })} disabled={cardBusy}>
                    {card.connectKind === "oauth" ? "Sign in again…" : "Replace key…"}
                  </button>
                </div>
                {#if card.destinations}
                  {@const destBusy = controller.destinationsBusyId[card.id] === true}
                  {@const dests = controller.publishDestinations[card.id] ?? []}
                  {@const prompt = controller.destinationPrompt(card.id)}
                  {@const pending = controller.pendingDestination[card.id]}
                  {@const destState = controller.publishDestinationStatus[card.id]?.state}
                  {#if prompt.message}
                    <p class={destState === "unreachable" ? "warn" : "field-hint"}>
                      {#if destState === "unreachable"}<Icon name="triangle-alert" size={13} />{/if}
                      {prompt.message}
                    </p>
                  {/if}
                  <label class="field" for={`pw-${card.id}-folder`}>
                    <span>{card.destinations.label}</span>
                    <select
                      id={`pw-${card.id}-folder`}
                      value={addingFolder[card.id] ? NEW_FOLDER : (pending?.id ?? prompt.selected)}
                      onchange={(e) => onDestinationSelect(card, e.currentTarget.value)}
                      disabled={destBusy || cardBusy}
                    >
                      <option value="">{destBusy ? "Loading folders…" : "Choose a folder…"}</option>
                      {#each dests as d, i (d.id)}
                        <option value={d.id}>{folderLabel(dests, i)}</option>
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
                      <button class="app-btn app-btn-primary" onclick={() => doCreateDestination(card)} disabled={cardBusy}>Create</button>
                    </div>
                  {/if}
                  {#if pending}
                    <!-- Changing the book's folder is the team's destination (#452 case 7): say so before saving. -->
                    <p class="warn" role="alert"><Icon name="triangle-alert" size={13} /> This changes the folder for everyone who publishes this book.</p>
                    <div class="key-row">
                      <button class="app-btn app-btn-primary" onclick={() => controller.confirmBookDestination(card.id)} disabled={cardBusy}>Change it for everyone</button>
                      <button class="app-btn app-btn-ghost" onclick={() => controller.cancelBookDestination(card.id)}>Cancel</button>
                    </div>
                  {/if}
                  {#if prompt.canUseBook || prompt.canChooseOwn}
                    <div class="key-row">
                      {#if prompt.canUseBook}<button class="link" onclick={() => controller.useBookDestination(card.id)} disabled={cardBusy}>Use the book's folder</button>{/if}
                      {#if prompt.canChooseOwn}<button class="link" onclick={() => controller.chooseOwnDestination(card.id)} disabled={cardBusy}>Use a different folder just for me</button>{/if}
                    </div>
                  {/if}
                  {#if controller.destinationsError[card.id]}<p class="error">{controller.destinationsError[card.id]}</p>{/if}
                  {#if destState === "unset" || destState === "by-name"}
                    <p class="field-hint">Or type a folder name directly in the {card.destinations.label.toLowerCase()} field above — it's created at your Drive's root the first time you publish.</p>
                  {/if}
                {/if}
              {/if}
            {/key}
          {:else if card.kind === "plugin"}
            <p class="muted">
              An experimental add-on from your book's extensions. It handles its own sign-in; its settings live in your
              book's manifest, in the <code>{card.id.startsWith("@") ? `"${card.id}"` : card.id}</code> entry under <code>publish:</code>.
            </p>
          {/if}
        </section>
      {/each}
    {:else}
      <!-- Publish: the one run, and a result per target -->
      {#if sending.length === 0}
        <p class="lead">No targets are ticked to send. <button class="link" onclick={() => enterStep(0)}>Choose targets</button></p>
      {:else if !result && !running}
        <p class="lead">
          Your book is laid out once, each file is made from that layout{controller.skipChecks ? "" : " and checked against the rules of each target it goes to"},
          then sent to {sending.map((c) => c.label).join(", ")}.
        </p>
      {/if}

      {#if running}
        <p class="progress-line" role="status"><Icon name="refresh-cw" size={13} /> {lastProgress}</p>
      {:else if result?.failure}
        {@const f = result.failure}
        {#if f.code === "CANCELED"}
          <p class="muted" role="status">Stopped. Nothing more was sent.</p>
        {:else}
          <div class="result failed" role="alert">
            <p class="error">{f.message}</p>
            {#if f.detail}<details class="status-raw"><summary>Show details</summary><pre>{f.detail}</pre></details>{/if}
            {#if f.code === "TOO_WIDE"}
              <button class="app-btn app-btn-ghost" onclick={() => controller.publish({ allowShrink: true })}>Build anyway</button>
            {/if}
            <p class="muted small">The app log has the full error: Troubleshooting &gt; Logs on the start screen.</p>
          </div>
        {/if}
      {/if}

      {#if result && problems(result.sourceFindings).length > 0}
        {@const found = problems(result.sourceFindings)}
        <section class="pub-row" aria-label="Your book">
          <h3 class="dest-name">Your book</h3>
          {@render findingList(found)}
          {#if onReviewProblems}<button class="link self-start" onclick={onReviewProblems}>Review all in Problems</button>{/if}
        </section>
      {/if}

      {#each sending as card (card.id)}
        {@const t = resultFor(card.id)}
        <section class="pub-row" aria-label={card.label}>
          <div class="pub-head">
            <span class="dest-name">{card.label}</span>
            {#if running && controller.progress.at(-1)?.target === card.id}<span class="muted small">{lastProgress}</span>{/if}
          </div>
          {#if !t}
            {#if needsAccount(card)}
              <p class="muted">Needs an account to send; its file is still made. <button class="link" onclick={setUp}>Set it up</button></p>
            {:else if !running}
              <p class="muted">Ready.</p>
            {/if}
          {:else}
            <div class={`result ${t.status === "failed" || t.status === "held" ? "failed" : "ok"}`} role="status">
              {#if t.status === "sent"}
                <p class="success-line"><Icon name="circle-check" size={13} /> {t.outcome?.kind === "published" && t.outcome.detail ? t.outcome.detail : "Sent."}</p>
                {#if t.outcome?.kind === "published"}
                  {@const out = t.outcome}
                  {#if out.url}<button class="link" onclick={() => controller.openPublishUrl(out.url!)}>View it online <Icon name="external-link" size={12} /></button>{/if}
                  {#if out.followUp?.length}<ol class="checklist">{#each out.followUp as s, i (i)}<li>{s}</li>{/each}</ol>{/if}
                {/if}
              {:else if t.status === "prepared" && t.outcome?.kind === "guided"}
                {@const out = t.outcome}
                <p class="success-line"><Icon name="circle-check" size={13} /> {out.detail ?? "Upload package ready."}</p>
                <p class="muted small">
                  Package folder: <code class="path">{displayPath(out.packageDir)}</code>
                  <button class="link" onclick={() => onShowInFolder(out.packageDir)}>Show in folder</button>
                </p>
                <button class="app-btn app-btn-primary self-start" onclick={() => controller.openPublishUrl(out.openUrl)}>Open upload page <Icon name="external-link" size={12} /></button>
                <ol class="checklist">{#each out.checklist as s, i (i)}<li>{s}</li>{/each}</ol>
              {:else if t.status === "checked"}
                <p class="success-line"><Icon name="circle-check" size={13} /> Checked: ready to send.</p>
              {:else if t.status === "held"}
                <p class="warn"><Icon name="triangle-alert" size={13} /> {t.failure?.message}</p>
                {@render findingList(t.findings.filter((f) => f.severity === "error"))}
                <button class="app-btn app-btn-ghost self-start" onclick={() => controller.publish({ targets: [t.id], sendAnyway: [t.id] })} disabled={busy}>Send anyway</button>
              {:else if t.status === "not-connected"}
                <p class="muted">Not sent: connect an account to send it. <button class="link" onclick={setUp}>Set it up</button></p>
              {:else if t.status === "failed" && t.failure}
                <p class="error">{t.failure.message}</p>
                {#if t.failure.detail}<details class="status-raw"><summary>Show details</summary><pre>{t.failure.detail}</pre></details>{/if}
                <button class="app-btn app-btn-ghost self-start" onclick={() => controller.publish({ targets: [t.id] })} disabled={busy}>Try again</button>
              {:else}
                <p class="muted">Not sent.</p>
              {/if}
              {#if t.status !== "held" && problems(t.findings).length > 0}
                {@render findingList(problems(t.findings))}
              {/if}
              {#if t.issues.some((i) => i.severity !== "error")}
                <!-- What sending noticed (an error is already in its failure). -->
                <ul class="issues">
                  {#each t.issues.filter((i) => i.severity !== "error") as issue (issue.id)}
                    <li class={issue.severity}><Icon name="triangle-alert" size={12} /><span>{issue.message}</span></li>
                  {/each}
                </ul>
              {/if}
              {#if t.file}
                {@const file = t.file}
                <p class="muted small">File: <code class="path">{displayPath(file)}</code> <button class="link" onclick={() => onShowInFolder(file)}>Show in folder</button></p>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    {/if}

    <footer class="view-actions">
      {#if stepIndex > 0}
        <button class="app-btn app-btn-ghost" onclick={back} disabled={running}>Back</button>
      {:else}
        <button class="app-btn app-btn-ghost" onclick={close}>Cancel</button>
      {/if}
      <div class="spacer"></div>
      {#if stepIndex < STEPS.length - 1}
        <button class="app-btn app-btn-primary" onclick={next} disabled={busy}>Next</button>
      {:else if running}
        <button class="app-btn app-btn-ghost" onclick={controller.cancel}>Stop</button>
      {:else}
        <button class="app-btn app-btn-ghost" onclick={() => controller.publish({ checkOnly: true })} disabled={busy || sending.length === 0}>Check only</button>
        {@const done = !!result?.ok && controller.published}
        <button class={`app-btn ${done ? "app-btn-ghost" : "app-btn-primary"}`} onclick={() => controller.publish()} disabled={busy || sending.length === 0}>
          {controller.published ? "Publish again" : "Publish"}
        </button>
        <button class={`app-btn ${done ? "app-btn-primary" : "app-btn-ghost"}`} onclick={close}>Done</button>
      {/if}
    </footer>
  </div>
</AppView>

{#snippet findingList(found: Finding[])}
  <ul class="issues">
    {#each found.slice(0, FINDINGS_SHOWN) as f, i (f.checkId + i)}
      <li class={f.severity}>
        <Icon name={f.severity === "error" ? "circle-x" : "triangle-alert"} size={12} />
        <span>{f.message}{#if f.detail}{" "}<span class="muted">{f.detail}</span>{/if}{#if f.page}{" "}<span class="muted">(page {f.page})</span>{/if}</span>
        {#if f.file && f.line && onNavigate}<button class="link" onclick={() => goTo(f)}>Go to</button>{/if}
      </li>
    {/each}
    {#if found.length > FINDINGS_SHOWN}<li class="muted">And {found.length - FINDINGS_SHOWN} more{onReviewProblems ? " in Problems" : ""}.</li>{/if}
  </ul>
{/snippet}

<style>
  .sr-only { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0; }

  .steps { list-style: none; display: flex; gap: 4px; margin: 0; padding: 0 0 10px; border-bottom: 1px solid var(--app-border-subtle); overflow-x: auto; }
  .steps li { display: flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-muted); white-space: nowrap; flex-shrink: 0; }
  .steps li.current { color: var(--app-text); font-weight: 600; }
  .steps li.done { color: var(--app-text-muted); }
  .step-dot { display: inline-flex; align-items: center; justify-content: center; width: 20px; height: 20px; border-radius: 50%; border: 1px solid var(--app-border-strong); font-size: 11px; }
  .steps li.current .step-dot { background: var(--app-accent); color: var(--app-accent-text); border-color: var(--app-accent-border); }
  .steps li.done .step-dot { background: var(--app-surface-hover); }
  .steps li.attention { color: var(--app-warning-text); }
  .steps li.attention .step-dot { border-color: currentColor; }

  .dialog-body { display: flex; flex-direction: column; gap: 14px; color: var(--app-text-secondary); }
  .lead { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .muted { color: var(--app-text-muted); font-size: 12px; margin: 0; }
  .muted.small { font-size: 11px; }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .warn { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 12px; color: var(--app-warning-text); }

  /* Fields match PublishKeyForm, which shares these steps. */
  .field { display: flex; flex-direction: column; gap: 6px; max-width: 420px; }
  .field > span { font-size: 13px; color: var(--app-text); font-weight: 600; }
  /* The hint sits OUTSIDE any .field wrapper (it precedes the label), so no
     higher-specificity label rule competes — no !important needed. */
  .field-hint { font-weight: 400; color: var(--app-text-muted); font-size: 11px; }
  .field input,
  .field select {
    padding: 7px 9px;
    font-size: 13px;
    width: 100%;
    box-sizing: border-box;
  }
  .key-row { display: flex; gap: 8px; }
  .key-row input { flex: 1; min-width: 0; }
  .self-start { align-self: flex-start; }

  /* The one checkbox setting (the checks) under the Targets step. */
  .setting { display: flex; align-items: flex-start; gap: 10px; padding: 2px 1px; cursor: pointer; }
  .setting input { margin-top: 2px; flex-shrink: 0; }
  .setting-title { font-size: 12.5px; font-weight: 500; color: var(--app-text-secondary); }
  .dialog-body code { font-size: 11px; word-break: break-all; }
  /* Paths break at their separators where they can, not mid-word. */
  .dialog-body code.path { word-break: normal; overflow-wrap: anywhere; }
  .dest-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }
  .dest { display: flex; align-items: flex-start; gap: 10px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .dest:hover { background: var(--app-surface-hover); }
  .dest.selected { border-color: var(--app-focus-ring); background: var(--app-surface-hover); }
  .dest input { margin-top: 2px; flex-shrink: 0; }
  .dest-main { display: flex; flex-direction: column; gap: 2px; flex: 1; min-width: 0; }
  .dest-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
  label.dest-name { cursor: pointer; }
  .dest-desc { font-size: 11px; color: var(--app-text-muted); line-height: 1.35; }
  .dest-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 3px; font-size: 10px; flex-shrink: 0; }
  .badge { padding: 1px 6px; border-radius: 10px; background: var(--app-surface); border: 1px solid var(--app-border); color: var(--app-text-muted); }
  .status { display: inline-flex; align-items: center; gap: 3px; }
  .status.ok { color: var(--app-success-text); }
  .status.off { color: var(--app-text-muted); }

  .conn-ok { display: flex; align-items: center; justify-content: space-between; gap: 10px; font-size: 13px; color: var(--app-success-text); }
  .conn-ok span { display: inline-flex; align-items: center; gap: 6px; }

  .pub-row { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .pub-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
  .result { border-top: 1px solid var(--app-border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .issues .error { color: var(--app-error-text); }
  .issues .warning { color: var(--app-warning-text); }
  .issues .info { color: var(--app-text-muted); }
  .success-line { margin: 0; font-size: 12px; color: var(--app-success-text); display: inline-flex; align-items: center; gap: 4px; }
  .checklist { margin: 0; padding-left: 18px; font-size: 11px; color: var(--app-text-muted); line-height: 1.5; }

  .status-raw summary { cursor: pointer; color: var(--app-text-muted); font-size: 12px; }
  .status-raw pre { margin: 6px 0 0; padding: 8px; background: var(--app-surface-sunken); border: 1px solid var(--app-border); border-radius: 6px; font-size: 11px; white-space: pre-wrap; overflow: auto; }

  .app-btn.small { font-size: 11px; padding: 4px 8px; }
  button.link { background: none; border: none; padding: 0; font-size: 11px; color: var(--app-focus-ring); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }

  /* Pinned to the bottom of the view, so Next/Publish stays in reach on a long step. */
  .view-actions { position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 14px 0; margin-top: 4px; border-top: 1px solid var(--app-border-subtle); background: var(--app-bg); }
  .view-actions .spacer { flex: 1; }

  /* ── Targets and results ───────────────────────────────────────────── */
  .dest.other { align-items: center; cursor: default; }
  .file-pick { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; color: var(--app-text-muted); margin-top: 4px; }
  .file-pick select { font-size: 12px; padding: 3px 6px; }
  .section-title { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.04em; color: var(--app-text-muted); font-weight: 600; }
  .pub-row h3.dest-name { margin: 0; }
  .progress-line { display: inline-flex; align-items: center; gap: 6px; margin: 0; font-size: 13px; color: var(--app-text); }
  .issues li { display: flex; align-items: flex-start; gap: 6px; }
</style>

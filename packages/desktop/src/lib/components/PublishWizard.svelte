<script lang="ts">
  /**
   * PublishWizard — front-and-centre publishing flow opened from the toolbar
   * Publish button.
   *
   * Flow is DYNAMIC (`wizardSteps`): [format] → [choose destinations] → one
   * setup step PER online destination → [check, only when the author asked
   * for checks] → [save/publish]. No long scrolling form — each destination
   * gets its own focused step.
   *
   * The first destination is always "A folder on this computer" (the lib's
   * `local` provider), chosen on the Choose step: Publish BUILDS the book
   * there first, then uploads that artifact to every other selected
   * destination. So a publish with no online destination is exactly a plain
   * export, and an online publish never depends on a stale build.
   *
   * Opens in the shared AppView layer like Book setup; form controls and
   * the `.app-btn-*` buttons follow the rest of the app.
   *
   * No backend of its own: it drives PublishSectionController
   * (api.publish.*). Accounts are managed on the Accounts page; the wizard
   * lists the provider's saved accounts, lets the author pick one for this
   * book, and adds or replaces one in place with the Accounts page's own form
   * (PublishKeyForm). The team decides where the book is published, so the
   * destinations ticked and each one's settings are saved in the book's
   * manifest, and a teammate who opens the book finds them ready: they only
   * connect their own account. Which account they use, a folder outside the
   * book, and a Drive folder of their own when the book's is out of their
   * reach (#452) are theirs: the host keeps those in private settings on this
   * computer.
   *
   * PWA-clean + $effect-free (CLAUDE.md §8): host work goes through the injected
   * controller; the parent mounts this fresh via {#if} so load runs in onMount;
   * step/selection are plain local state driven by event handlers.
   */
  import Icon from "#lib/components/Icon.svelte";
  import AppView from "#lib/components/AppView.svelte";
  import PublishKeyForm from "#lib/components/PublishKeyForm.svelte";
  import { replaceHint } from "#lib/accounts.ts";
  import { onMount } from "svelte";
  import { requestInlineConfirm, cancelInlineConfirm, type InlineConfirmState } from "#lib/dialog.ts";
  import { friendlyPublishError, type PdfErrorExplanation } from "#lib/errors.ts";
  import {
    groupPreflight,
    preflightHeaderLevel,
    preflightCounts,
    categoryLabel,
    entersPreflightForward,
    type PreflightRow,
  } from "#lib/preflight.ts";
  import type { ProblemEntry } from "#lib/platform/dtos.ts";
  import type { PublishProviderCard } from "#lib/platform/contract.ts";
  import type { PublishSectionController } from "#lib/routes/publish-section-controller.svelte.ts";
  import type { BuildToResult } from "#lib/export/export-controller.svelte.ts";
  import { isPathAtOrUnder, joinPath } from "#lib/platform/paths.ts";
  import { wizardSteps, displayPath, isCommandLineTip } from "#lib/publish-wizard.ts";

  /** The lib's "A folder on this computer" provider id. */
  const LOCAL = "local";
  const LOCAL_DEFAULT_DIR = "dist";

  let {
    controller,
    projectDir,
    buildArtifact,
    pickFolder,
    onShowInFolder,
    triggerEl,
    onClose,
    onNavigate,
    onManageAccounts,
    onReviewProblems,
    progress = null,
    onCancelBuild,
    canCancelBuild = false,
    saveWarning = null,
    buildFailure = null,
  }: {
    controller: PublishSectionController;
    projectDir: string;
    /** Build the book into `dir` (ExportController.buildTo): resolves with the
     *  artifact path and what the PDF checks found, or null when
     *  canceled/failed (already toasted). */
    buildArtifact: (opts: { format: "pdf" | "html"; dir: string; validate: boolean }) => Promise<BuildToResult | null>;
    /** The running build's progress words (ExportController.pdfProgress). */
    progress?: string | null;
    onCancelBuild?: () => void;
    canCancelBuild?: boolean;
    /** Why the last build could not start (the book is still loading, a tool is missing). */
    saveWarning?: string | null;
    /** Why the last build failed (ExportController.failure), until the next one starts. */
    buildFailure?: PdfErrorExplanation | null;
    /** Close the wizard and open the Problems list (the saved PDF's findings). */
    onReviewProblems?: () => void;
    /** Native folder dialog for the local destination; null when canceled. */
    pickFolder: (defaultPath: string) => Promise<string | null>;
    onShowInFolder: (path: string) => void;
    triggerEl?: HTMLButtonElement | undefined;
    onClose?: () => void;
    /** Reveal a preflight finding in the editor (the "Go to" affordance). The
     *  parent closes this modal wizard and delegates to the shared
     *  Problems-panel navigation (`openProblem`). */
    onNavigate?: (entry: ProblemEntry) => void;
    /** Open the Accounts page (over this one) to see, replace or remove an account. */
    onManageAccounts?: () => void;
  } = $props();

  // An index into `steps` (wizardSteps).
  let stepIndex = $state(0);
  // The local folder is always selected: it is where the book gets built.
  let selected = $state<Set<string>>(new Set([LOCAL]));
  let format = $state<"pdf" | "html">("pdf");
  let validate = $state(false);
  // The artifact the Publish step built (the PDF file or the website folder).
  let builtArtifact = $state<string | null>(null);
  // How many problems the checks found in the saved PDF (only when asked).
  let pdfFindings = $state(0);
  let publishing = $state(false);
  // A build was started from this view: only then is `buildFailure` this view's to show.
  let buildTried = $state(false);
  // Preflight groups showing every row, not just the first few.
  let expandedGroups = $state<Set<string>>(new Set());
  const GROUP_PREVIEW = 5;
  // Preflight override (#105): the author may publish past blocking errors, but
  // only after an explicit inline confirmation.
  let publishAnyway = $state(false);
  let overrideConfirm = $state<InlineConfirmState>({});
  // Per-provider: which account form is open — adding another account, or
  // replacing the key (or sign-in) of the selected one. PublishKeyForm is the
  // Accounts page's own form.
  let accountForm = $state<Record<string, "add" | "edit" | undefined>>({});
  // Per-provider: is the inline "New folder…" name form open (#221)?
  let addingFolder = $state<Record<string, boolean>>({});
  const ADD = "__add_account__";
  const NONE = "__no_account__";
  const NEW_FOLDER = "__new_folder__";
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
    // Collapse the inline form only on success (keep it open, with the
    // error, so the author can fix the name).
    if (!controller.publishError) addingFolder = { ...addingFolder, [card.id]: false };
  }

  const cards = $derived(controller.publishCards);
  const localCard = $derived(cards.find((c) => c.id === LOCAL) ?? null);
  /** Destinations that can take the chosen format (the local folder takes both). One that can't is hidden, not unticked: it stays the team's choice. */
  const visibleCards = $derived(
    cards.filter((c) => c.id === LOCAL || c.format === format || (c.formats ?? []).includes(format)),
  );
  const selectedCards = $derived(visibleCards.filter((c) => selected.has(c.id)));
  const onlineCards = $derived(selectedCards.filter((c) => c.id !== LOCAL));
  /** The local folder, absolute: `publish.local.dir` (relative to the book) or the default. */
  const localDir = $derived.by(() => {
    const dir = (localCard?.config.dir ?? "").trim() || LOCAL_DEFAULT_DIR;
    return /^(\/|[A-Za-z]:[\\/]|\\\\)/.test(dir) ? dir : joinPath(projectDir, dir);
  });
  /** A folder outside the book is the author's own: kept on this computer, not in the book. */
  const localOutside = $derived(!isPathAtOrUnder(localDir, projectDir));
  const steps = $derived(wizardSteps(onlineCards, validate));
  const step = $derived(steps[Math.min(stepIndex, steps.length - 1)]!);
  const stepKind = $derived(step.kind);
  const isLast = $derived(stepIndex >= steps.length - 1);
  const cardFor = (s: (typeof steps)[number]) =>
    s.kind === "setup" ? (onlineCards.find((c) => c.id === s.cardId) ?? null) : null;
  const currentCard = $derived(cardFor(step));
  const needsAccount = (c: PublishProviderCard) => c.credentialRequired && !c.connected;
  /** Online destinations the Publish step skips (no account yet), and the ones it sends to. */
  const blockedCards = $derived(onlineCards.filter(needsAccount));
  const readyCards = $derived(onlineCards.filter((c) => !needsAccount(c)));
  const formatName = $derived(format === "pdf" ? "PDF" : "website");
  /** What the last button does: Publish only when it will send the book somewhere. */
  const action = $derived(readyCards.length > 0 ? "Publish" : "Save");
  /** The built artifact is saved: the wizard is finished unless the author wants more. */
  const finished = $derived(builtArtifact !== null && !publishing);

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
  /** When the author asked for checks, Publish waits for them: disabled while
   *  they haven't run, errored, or block. Without checks nothing is gated. */
  const publishGated = $derived(validate && (preflightMissing || preflightErrored || preflightBlocks));

  onMount(() => {
    stepIndex = 0;
    selected = new Set([LOCAL]);
    // The destinations the team ticked for this book (saved in its manifest).
    void controller.loadPublish().then(() => {
      selected = new Set([LOCAL, ...controller.tickedDestinations]);
    });
  });

  async function chooseLocalFolder() {
    const picked = await pickFolder(localDir);
    if (!picked) return;
    controller.setPublishConfigDraft(LOCAL, "dir", picked);
    await controller.savePublishConfig(LOCAL);
  }

  function close() {
    // A build in progress is canceled from its own row, not by leaving.
    if (publishing) return;
    onClose?.();
  }
  /** Entering a step may need to react (no $effect — driven by these
   *  step-change event handlers, CLAUDE.md §8): a FORWARD entry into the
   *  Check step runs its checks; a connected setup step with a folder
   *  picker (#221) loads it, so revisiting the step after connecting (or
   *  coming back to it) shows current folders without a manual refresh.
   *  `direction` matters ONLY for the preflight rerun —
   *  stepping BACK into Check from Publish must not re-run it and
   *  silently clear an override the author already granted; see
   *  `entersPreflightForward`'s doc comment for the full story. */
  function enterStep(target: number, direction: "forward" | "back") {
    stepIndex = target;
    const s = steps[target];
    if (entersPreflightForward(direction, s?.kind)) runPreflightNow();
    const card = s ? cardFor(s) : null;
    if (card?.connected && card.destinations) void controller.loadDestinations(card.id);
    // A destination that takes both formats (gdrive) follows the wizard's
    // format choice — written to its manifest setting like any other pick.
    if (card?.formats && controller.effectiveFormat(card) !== format) {
      void controller.selectFormat(card.id, format);
    }
  }
  /** Leaving a step saves what was chosen on it; false (stay) when that fails. */
  async function saveStep(): Promise<boolean> {
    if (stepKind === "choose") {
      const shown = visibleCards.filter((c) => c.id !== LOCAL);
      return controller.saveDestinations(Object.fromEntries(shown.map((c) => [c.id, selected.has(c.id)])));
    }
    if (currentCard && Object.keys(controller.publishConfigDrafts[currentCard.id] ?? {}).length > 0) {
      await controller.savePublishConfig(currentCard.id);
      return !controller.publishError;
    }
    return true;
  }
  async function next() {
    if (!(await saveStep())) return;
    enterStep(Math.min(stepIndex + 1, steps.length - 1), "forward");
  }
  async function back() {
    if (!(await saveStep())) return;
    enterStep(Math.max(stepIndex - 1, 0), "back");
  }
  /** Jump to a destination's setup step (from the Publish step's "Set it up"). */
  function setUp(card: PublishProviderCard) {
    const target = steps.findIndex((s) => s.kind === "setup" && s.cardId === card.id);
    if (target >= 0) enterStep(target, "back");
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
    if (id === LOCAL) return; // always on: it is where the book gets built
    const nextSet = new Set(selected);
    if (nextSet.has(id)) nextSet.delete(id);
    else nextSet.add(id);
    selected = nextSet;
  }
  function draftValue(card: PublishProviderCard, key: string): string {
    return controller.publishConfigDrafts[card.id]?.[key] ?? card.config[key] ?? "";
  }
  /** Build into the local folder, then send that artifact everywhere else. */
  async function publishAll() {
    if (publishGated || publishing) return; // preflight gate (belt-and-braces with the disabled state)
    publishing = true;
    buildTried = true;
    builtArtifact = null;
    pdfFindings = 0;
    try {
      const built = await buildArtifact({ format, dir: localDir, validate });
      if (!built) return;
      builtArtifact = built.path;
      pdfFindings = built.findings.filter((f) => f.severity !== "info").length;
      for (const card of readyCards) {
        await controller.runPublish(card.id, false, built.path);
      }
    } finally {
      publishing = false;
    }
  }
</script>

<AppView class="wizard" title="Publish your book" icon="cloud-upload" onClose={close} {triggerEl}>

  <!-- Dynamic step indicator: Choose → each destination → Publish -->
  <ol class="steps" aria-label="Publishing steps">
    {#each steps as s, i (i)}
      {@const card = cardFor(s)}
      {@const attention = stepIndex > i && card !== null && needsAccount(card)}
      <li class:done={stepIndex > i && !attention} class:attention class:current={stepIndex === i} aria-current={stepIndex === i ? "step" : undefined}>
        <!-- Icons are aria-hidden (like every Icon); the sr-only text keeps
             the state announced. A passed destination without an account is
             not done: it is skipped when publishing. -->
        <span class="step-dot">
          {#if attention}<Icon name="triangle-alert" size={12} /><span class="sr-only">Needs setup:</span>
          {:else if stepIndex > i}<Icon name="check" size={12} /><span class="sr-only">Completed:</span>
          {:else}{i + 1}{/if}
        </span>
        <span class="step-label">{s.label}</span>
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

    {#if stepKind === "format"}
      <p class="lead">What to make of your book.</p>
      <ul class="dest-list">
        <li>
          <label class="dest" class:selected={format === "pdf"}>
            <input type="radio" name="pw-format" value="pdf" checked={format === "pdf"} onchange={() => (format = "pdf")} />
            <span class="dest-main">
              <span class="dest-name">PDF</span>
              <span class="dest-desc">Print-ready PDF using your book's page settings. (Ctrl+Shift+E saves one directly.)</span>
            </span>
          </label>
        </li>
        <li>
          <label class="dest" class:selected={format === "html"}>
            <input type="radio" name="pw-format" value="html" checked={format === "html"} onchange={() => (format = "html")} />
            <span class="dest-main">
              <span class="dest-name">Website</span>
              <span class="dest-desc">A folder with a standalone book.html you can share or host anywhere.</span>
            </span>
          </label>
        </li>
      </ul>
      <label class="setting">
        <input type="checkbox" bind:checked={validate} />
        <span class="dest-main">
          <span class="setting-title">Check my book before saving</span>
          <span class="dest-desc">
            Adds a Check step that looks over your content, images and fonts{#if format === "pdf"}, and checks the
            saved PDF's page size, margins and fonts{/if}. Slower, but catches print problems early. Unticked, no checks run.
          </span>
        </span>
      </label>
    {:else if stepKind === "choose"}
      <p class="lead">Your {formatName} is saved to a folder on this computer first. Pick any other places to send it; each one gets its own quick setup step. Your choice is saved with the book, so everyone who has it sees the same places.</p>
      {#if cards.length === 0}
        <p class="muted">Loading destinations…</p>
      {:else}
        <ul class="dest-list">
          {#each visibleCards as card (card.id)}
            <li>
              <label class="dest" class:selected={selected.has(card.id)}>
                <input type="checkbox" checked={selected.has(card.id)} disabled={card.id === LOCAL} onchange={() => toggle(card.id)} />
                <span class="dest-main">
                  <span class="dest-name">{card.label}</span>
                  {#if card.id === LOCAL}
                    <span class="dest-desc"><code class="path">{displayPath(localDir, projectDir)}</code></span>
                    {#if localOutside}
                      <span class="dest-desc">Outside your book, so it is yours alone: saved on this computer only, and confirmed in a dialog each time.</span>
                    {/if}
                  {:else}
                    <span class="dest-desc">{card.description}</span>
                  {/if}
                </span>
                <span class="dest-meta">
                  {#if card.id === LOCAL}
                    <button class="app-btn app-btn-ghost small" onclick={chooseLocalFolder} disabled={controller.publishBusyId === LOCAL}>Change…</button>
                  {:else}
                  <span class="badge">{card.experimental ? "Experimental" : card.kind === "api" ? "direct upload" : "guided"}</span>
                  {#if card.credentialRequired}
                    <span class={`status ${card.connected ? "ok" : "off"}`}>
                      {#if card.connected}<Icon name="circle-check" size={12} /> Connected{:else if card.connectKind === "oauth"}Needs sign-in{:else}Needs a key{/if}
                    </span>
                  {:else if card.kind !== "plugin"}
                    <span class="status ok">No account needed</span>
                  {/if}
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
      {#if card.kind === "plugin"}
        <p class="lead">Set up <strong>{card.label}</strong>: {card.description}</p>
      {:else if card.credentialRequired}
        <p class="lead">
          Set up <strong>{card.label}</strong>. Your accounts are saved on this computer and used by every book, so you only connect once.
          {#if !card.connected}To publish here, connect your own account; the book's settings are shared with your team.{/if}
        </p>
      {:else}
        <p class="lead">Set up <strong>{card.label}</strong>. These settings are saved with the book, so your team shares them.</p>
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
        <p class="field-hint">Saved with the book when you go to the next step.</p>
      {/if}

      {#if card.credentialRequired}
        {#if card.savedAccounts.length > 0}
          <label class="field" for={`pw-${card.id}-account`}>
            <span>Account</span>
            <select
              id={`pw-${card.id}-account`}
              value={showAddForm(card) ? ADD : card.connected ? card.selectedAccount : NONE}
              onchange={(e) => onAccountSelect(card, e.currentTarget.value)}
              disabled={busy}
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
              store={draftValue(card, "shop")}
              takeFocus={accountForm[card.id] === "add"}
              onConnected={(account) => accountSaved(card, account)}
              onCancel={card.savedAccounts.length > 0 ? () => closeAccountForm(card) : undefined}
            />
          {:else if accountForm[card.id] === "edit"}
            <PublishKeyForm
              provider={card}
              account={card.selectedAccount}
              hint={replaceHint(card)}
              store={draftValue(card, "shop")}
              submitLabel="Save"
              takeFocus
              onConnected={(account) => accountSaved(card, account)}
              onCancel={() => closeAccountForm(card)}
            />
          {:else if !card.connected}
            <p class="warn"><Icon name="triangle-alert" size={13} /> Pick one of your accounts above, or add another, to publish here.</p>
          {:else}
            {@const savedLabel = card.savedAccounts.find((a) => a.account === card.selectedAccount)?.label}
            <div class="conn-ok">
              <span>
                <Icon name="circle-check" size={14} />
                {#if card.connectKind === "oauth" && savedLabel}Connected — {savedLabel}.{:else}Connected — reusing your saved key.{/if}
              </span>
              <button class="app-btn app-btn-ghost" onclick={() => (accountForm = { ...accountForm, [card.id]: "edit" })} disabled={busy}>
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
                  disabled={destBusy || busy}
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
                  <button class="app-btn app-btn-primary" onclick={() => doCreateDestination(card)} disabled={busy}>Create</button>
                </div>
              {/if}
              {#if pending}
                <!-- Changing the book's folder is the team's destination (#452 case 7): say so before saving. -->
                <p class="warn" role="alert"><Icon name="triangle-alert" size={13} /> This changes the folder for everyone who publishes this book.</p>
                <div class="key-row">
                  <button class="app-btn app-btn-primary" onclick={() => controller.confirmBookDestination(card.id)} disabled={busy}>Change it for everyone</button>
                  <button class="app-btn app-btn-ghost" onclick={() => controller.cancelBookDestination(card.id)}>Cancel</button>
                </div>
              {/if}
              {#if prompt.canUseBook || prompt.canChooseOwn}
                <div class="key-row">
                  {#if prompt.canUseBook}<button class="link" onclick={() => controller.useBookDestination(card.id)} disabled={busy}>Use the book's folder</button>{/if}
                  {#if prompt.canChooseOwn}<button class="link" onclick={() => controller.chooseOwnDestination(card.id)} disabled={busy}>Use a different folder just for me</button>{/if}
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
      {:else}
        <p class="muted">No account or key needed — we'll prepare an upload package with step-by-step instructions.</p>
      {/if}
    {:else if stepKind === "check"}
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
              {counts.warnings} {counts.warnings === 1 ? "thing" : "things"} to review before publishing.
            {:else}
              No problems in your content, images, or fonts.
            {/if}
          </span>
        </span>
        <button class="app-btn app-btn-ghost" onclick={runPreflightNow} disabled={controller.preflightBusy}>
          <Icon name="refresh-cw" size={13} /> Re-run
        </button>
      </div>

      {#if controller.preflightError}
        <p class="error" role="alert">{controller.preflightError}</p>
      {/if}

      {#if controller.preflightRan && !controller.preflightBusy && !controller.preflightError}
        {#if controller.preflightRows.length > 0}
          {#each groupPreflight(controller.preflightRows) as group (group.category)}
            {@const all = expandedGroups.has(group.category)}
            {@const rows = all ? group.rows : group.rows.slice(0, GROUP_PREVIEW)}
            <section class="pf-group">
              <h3 class="pf-group-title">{categoryLabel(group.category)} <span class="pf-count">({group.rows.length})</span></h3>
              <ul class="pf-list">
                {#each rows as row, i (row.id + "|" + i)}
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
                      <button class="app-btn app-btn-ghost pf-goto" onclick={() => goTo(row)}>Go to</button>
                    {/if}
                  </li>
                {/each}
              </ul>
              {#if group.rows.length > GROUP_PREVIEW}
                <button
                  class="link self-start"
                  onclick={() => {
                    const nextSet = new Set(expandedGroups);
                    if (all) nextSet.delete(group.category);
                    else nextSet.add(group.category);
                    expandedGroups = nextSet;
                  }}
                >{all ? "Show fewer" : `Show all ${group.rows.length}`}</button>
              {/if}
            </section>
          {/each}
        {/if}
      {/if}

      {#if blockedCards.length > 0}
        <p class="warn">
          <Icon name="triangle-alert" size={13} />
          {blockedCards.map((c) => c.label).join(", ")} {blockedCards.length === 1 ? "isn't" : "aren't"} set up yet, so {blockedCards.length === 1 ? "it is" : "they are"} skipped when publishing.
        </p>
      {/if}
      {#if format === "pdf"}
        <p class="muted small">
          <Icon name="info" size={12} /> No PDF is built yet. Page size, safe margins, embedded fonts, and PDF/X (when qpdf and Ghostscript are installed) are checked on the saved PDF in the next step.
        </p>
      {/if}
    {:else}
      <!-- Save / Publish step -->
      <p class="lead">
        Your book is built fresh as a {formatName} into
        <code class="path">{displayPath(localDir, projectDir)}</code>{#if readyCards.length > 0}, then sent to {readyCards.map((c) => c.label).join(", ")}{/if}.
      </p>
      {#if validate && preflightMissing}
        <p class="warn" role="alert">
          <Icon name="triangle-alert" size={14} />
          Readiness hasn't run yet. <button class="link" onclick={back}>Go back to check</button> before publishing.
        </p>
      {:else if validate && preflightErrorCount > 0}
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
      <section class="pub-row">
        <div class="pub-head">
          <span class="dest-name">A folder on this computer</span>
          {#if publishing && !builtArtifact}
            <span class="muted small progress" role="status"><Icon name="refresh-cw" size={13} /> {progress ?? "Building…"}</span>
            {#if onCancelBuild}<button class="app-btn app-btn-ghost small" onclick={onCancelBuild} disabled={!canCancelBuild}>Cancel</button>{/if}
          {/if}
        </div>
        {#if saveWarning && !publishing && !builtArtifact}
          <p class="warn" role="alert"><Icon name="triangle-alert" size={13} /> {saveWarning}</p>
        {/if}
        {#if buildTried && buildFailure?.summary && !publishing && !builtArtifact}
          <!-- Stays until the next build: a build can fail after many minutes, with nobody watching. -->
          <div class="result failed" role="alert">
            <p class="error">{buildFailure.summary}</p>
            {#if buildFailure.details}
              <details class="status-raw"><summary>Show details</summary><pre>{buildFailure.details}</pre></details>
            {/if}
            <p class="muted small">The app log has the full error: Troubleshooting &gt; Logs on the start screen.</p>
          </div>
        {/if}
        {#if builtArtifact}
          {@const artifact = builtArtifact}
          <div class="result ok" role="status">
            <p class="success-line"><Icon name="circle-check" size={13} /> Saved to <code class="path">{displayPath(artifact, projectDir)}</code></p>
            <button class="link" onclick={() => onShowInFolder(artifact)}>Show in folder</button>
            {#if validate && format === "pdf"}
              {#if pdfFindings > 0}
                <p class="warn">
                  <Icon name="triangle-alert" size={13} />
                  The PDF checks found {pdfFindings} {pdfFindings === 1 ? "problem" : "problems"}.
                  {#if onReviewProblems}<button class="link" onclick={onReviewProblems}>Review problems</button>{/if}
                </p>
              {:else}
                <p class="success-line"><Icon name="circle-check" size={13} /> The PDF checks found no problems.</p>
              {/if}
            {/if}
          </div>
        {/if}
      </section>
      {#each onlineCards as card (card.id)}
        {@const busy = controller.publishBusyId === card.id}
        {@const result = controller.publishResults[card.id]}
        <section class="pub-row">
          <div class="pub-head">
            <span class="dest-name">{card.label}</span>
            {#if busy}<span class="muted small"><Icon name="refresh-cw" size={13} /> Publishing…</span>{/if}
          </div>
          {#if needsAccount(card)}
            <p class="muted">
              Skipped: {card.connectKind === "oauth" ? "sign in" : "connect an account"} to publish here.
              {#if !publishing}<button class="link" onclick={() => setUp(card)}>Set it up</button>{/if}
            </p>
          {:else if result}
            {@const outcome = result.outcome}
            {@const issues = result.issues.filter((i) => !isCommandLineTip(i.id))}
            <div class={`result ${result.ok ? "ok" : "failed"}`} role="status">
              {#if issues.length > 0}
                <ul class="issues">
                  {#each issues as issue (issue.id)}
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
                <p class="muted small">
                  Package folder: <code class="path">{displayPath(outcome.packageDir, projectDir)}</code>
                  <button class="link" onclick={() => onShowInFolder(outcome.packageDir)}>Show in folder</button>
                </p>
                <button class="app-btn app-btn-primary" onclick={() => controller.openPublishUrl(outcome.openUrl)}>Open upload page <Icon name="external-link" size={12} /></button>
                <ol class="checklist">{#each outcome.checklist as s, i (i)}<li>{s}</li>{/each}</ol>
              {/if}
            </div>
          {/if}
        </section>
      {/each}
    {/if}

    <footer class="view-actions">
      {#if stepIndex > 0}
        <button class="app-btn app-btn-ghost" onclick={back} disabled={publishing}>Back</button>
      {:else}
        <button class="app-btn app-btn-ghost" onclick={close}>Cancel</button>
      {/if}
      <div class="spacer"></div>
      {#if !isLast}
        <button class="app-btn app-btn-primary" onclick={next} disabled={stepKind === "check" && controller.preflightBusy}>Next</button>
      {:else}
        <!-- Once saved, Done is the way on; saving again stays at hand. -->
        <button
          class={`app-btn ${finished ? "app-btn-ghost" : "app-btn-primary"}`}
          onclick={publishAll}
          disabled={publishing || controller.publishBusyId !== null || publishGated}
          title={!validate
            ? undefined
            : preflightMissing
              ? "Run the readiness check first."
              : preflightBlocks
                ? "The check found blocking problems — fix them or choose Publish anyway."
                : undefined}
        >
          {publishing ? `${action === "Publish" ? "Publishing" : "Saving"}…` : finished ? `${action} again` : action}
        </button>
        <button class={`app-btn ${finished ? "app-btn-primary" : "app-btn-ghost"}`} onclick={close} disabled={publishing}>Done</button>
      {/if}
    </footer>
  </div>
</AppView>

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

  /* The one checkbox setting (print-safety validation) under the Format step. */
  .setting { display: flex; align-items: flex-start; gap: 10px; padding: 2px 1px; cursor: pointer; }
  .setting input { margin-top: 2px; flex-shrink: 0; }
  .setting-title { font-size: 12.5px; font-weight: 500; color: var(--app-text-secondary); }
  .dialog-body code { font-size: 11px; word-break: break-all; }
  /* Paths break at their separators where they can, not mid-word. */
  .dialog-body code.path { word-break: normal; overflow-wrap: anywhere; }
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
  .progress { display: inline-flex; align-items: center; gap: 4px; margin-left: auto; }
  button.link { background: none; border: none; padding: 0; font-size: 11px; color: var(--app-focus-ring); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }

  /* Pinned to the bottom of the view, so Next/Publish stays in reach on a long step. */
  .view-actions { position: sticky; bottom: 0; display: flex; align-items: center; gap: 8px; padding: 14px 0; margin-top: 4px; border-top: 1px solid var(--app-border-subtle); background: var(--app-bg); }
  .view-actions .spacer { flex: 1; }

  /* ── Preflight step (#105) ────────────────────────────────────────────── */
  .pf-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
  .pf-status { display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 600; }
  .pf-status.pf-error { color: var(--app-error-text); }
  .pf-status.pf-warning { color: var(--app-warning-text); }
  .pf-status.pf-ok { color: var(--app-success-text); }

  .pf-group { display: flex; flex-direction: column; gap: 6px; }
  .pf-count { font-weight: 400; }
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
  .dialog-body .pf-goto { flex-shrink: 0; align-self: flex-start; font-size: 11px; padding: 4px 8px; }
</style>

<script lang="ts">
  /**
   * Publish section of ProjectConfigPanel (#35) — provider cards with
   * per-provider settings (rendered from each provider's declared
   * `fields` — the panel carries no provider knowledge of its own), connect
   * (API key → host credential store, redacted status back), preflight and
   * publish, and the run result (link / guided checklist + package folder).
   * Presentational: state and `api.publish.*` calls live in the composition
   * root; this child renders props and emits changes via callbacks. Token
   * drafts pass through to the host once on connect and are cleared by the
   * root — nothing secret is ever displayed.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { PublishProviderCard, PublishRunResult } from "$lib/api";
  import { friendlyPublishError } from "$lib/errors";

  let {
    publishError,
    cards,
    busyId,
    results,
    configDrafts,
    tokenDrafts,
    artifactDrafts,
    setConfigDraft,
    setTokenDraft,
    pickArtifact,
    saveConfig,
    connect,
    disconnect,
    run,
    openUrl,
  }: {
    publishError: string | null;
    cards: PublishProviderCard[];
    busyId: string | null;
    results: Record<string, PublishRunResult>;
    configDrafts: Record<string, Record<string, string>>;
    tokenDrafts: Record<string, string>;
    /** Explicit artifact path per provider (viewer exports go where the author chose). */
    artifactDrafts: Record<string, string>;
    setConfigDraft: (providerId: string, key: string, value: string) => void;
    setTokenDraft: (providerId: string, value: string) => void;
    pickArtifact: (card: PublishProviderCard) => void;
    saveConfig: (providerId: string) => void;
    connect: (providerId: string) => void;
    disconnect: (providerId: string) => void;
    run: (providerId: string, dryRun: boolean) => void;
    openUrl: (url: string) => void;
  } = $props();

  function draftValue(card: PublishProviderCard, key: string): string {
    return configDrafts[card.id]?.[key] ?? card.config[key] ?? "";
  }

  // M41 — a card whose provider needs a key must not offer an enabled
  // Publish button while that key isn't connected (trust-by-failure: the
  // click would just fail authentication). "Check readiness" (dry run) needs
  // no credential — preflight never calls authenticate — so it stays enabled.
  const CONNECT_FIRST_HINT = "Connect first — this provider needs an API key before you can publish.";
</script>

<section class="block">
  <div class="block-head">
    <h3>Publish</h3>
  </div>
  <p class="hint">
    Send your finished book to a platform. Build the PDF (or the HTML site for web
    hosting) first, then publish. API keys are stored securely on this computer —
    never in your project folder. “Check readiness” runs a dry run — it reports
    problems without publishing or changing anything.
  </p>
  {#if publishError}
    {@const publishErr = friendlyPublishError(publishError)}
    <p class="error" role="alert">{publishErr.summary}</p>
    {#if publishErr.details}
      <details class="status-raw">
        <summary>Show details</summary>
        <pre>{publishErr.details}</pre>
      </details>
    {/if}
  {/if}

  <ul class="publish-list">
    {#each cards as card (card.id)}
      {@const result = results[card.id]}
      {@const busy = busyId === card.id}
      {@const needsConnect = card.credentialRequired && !card.connected}
      <li class="publish-card">
        <div class="publish-head">
          <span class="publish-name">{card.label}</span>
          <span class="publish-meta">
            <span class="kind">{card.kind === "api" ? "direct upload" : "guided"}</span>
            <span class="kind">{card.format}</span>
            {#if card.credentialRequired}
              <span class={`status ${card.connected ? "ok" : "off"}`}>
                {#if card.connected}<Icon name="circle-check" size={12} /> Connected
                {:else}Not connected{/if}
              </span>
            {/if}
          </span>
        </div>
        <p class="rec-desc">{card.description}</p>

        {#if card.fields.length > 0}
          <div class="publish-fields">
            {#each card.fields as field (field.key)}
              <label class="publish-field">
                <span>{field.label}</span>
                <input
                  class="input"
                  type="text"
                  placeholder={field.placeholder ?? ""}
                  value={draftValue(card, field.key)}
                  oninput={(e) => setConfigDraft(card.id, field.key, e.currentTarget.value)}
                />
              </label>
            {/each}
            <button class="ghost small" onclick={() => saveConfig(card.id)} disabled={busy}>
              Save settings
            </button>
          </div>
        {/if}

        <div class="publish-field">
          <span>{card.format === "pdf" ? "PDF to publish" : "Website folder to publish"} (optional — defaults to the project's build output)</span>
          <div class="add-row">
            <input
              class="input"
              type="text"
              placeholder={card.format === "pdf" ? "…/book.pdf" : "…/dist"}
              value={artifactDrafts[card.id] ?? ""}
              readonly
            />
            <button class="ghost small" onclick={() => pickArtifact(card)} disabled={busy}>
              Choose…
            </button>
          </div>
        </div>

        {#if card.credentialRequired}
          {#if !card.connected}
            <div class="publish-connect">
              {#if card.hint}<p class="hint">{card.hint}</p>{/if}
              <div class="add-row">
                <input
                  class="input"
                  type="password"
                  placeholder="Paste API key"
                  value={tokenDrafts[card.id] ?? ""}
                  oninput={(e) => setTokenDraft(card.id, e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === "Enter") connect(card.id);
                  }}
                />
                <button class="primary small" onclick={() => connect(card.id)} disabled={busy}>
                  Connect
                </button>
              </div>
              {#if card.tokenUrl}
                <button class="link" onclick={() => openUrl(card.tokenUrl!)}>
                  Create an API key <Icon name="external-link" size={12} />
                </button>
              {/if}
            </div>
          {:else}
            <button class="ghost small" onclick={() => disconnect(card.id)} disabled={busy}>
              Disconnect
            </button>
          {/if}
        {/if}

        <div class="publish-actions">
          <button class="ghost small" onclick={() => run(card.id, true)} disabled={busy}>
            Check readiness
          </button>
          <button
            class="primary small"
            onclick={() => run(card.id, false)}
            disabled={busy || needsConnect}
            title={needsConnect ? CONNECT_FIRST_HINT : undefined}
            aria-label={needsConnect ? `Publish — ${CONNECT_FIRST_HINT}` : "Publish"}
          >
            {#if busy}<Icon name="refresh-cw" size={13} /> Publishing…{:else}Publish{/if}
          </button>
          {#if needsConnect}
            <span class="muted dim" title={CONNECT_FIRST_HINT}>Connect first</span>
          {/if}
        </div>

        {#if result}
          {@const outcome = result.outcome}
          <div class={`publish-result ${result.ok ? "ok" : "failed"}`} role="status">
            {#if result.issues.length > 0}
              <ul class="publish-issues">
                {#each result.issues as issue (issue.id)}
                  <li class={issue.severity}>
                    {#if issue.severity === "info"}<Icon name="info" size={12} />
                    {:else}<Icon name="triangle-alert" size={12} />{/if}
                    {issue.message}
                  </li>
                {/each}
              </ul>
            {/if}
            {#if !result.ok}
              {@const runErr = friendlyPublishError(result.error ?? "Publish failed.")}
              <p class="error">{runErr.summary}</p>
              {#if runErr.details}
                <details class="status-raw">
                  <summary>Show details</summary>
                  <pre>{runErr.details}</pre>
                </details>
              {/if}
            {:else if !outcome}
              <p class="success-line"><Icon name="circle-check" size={13} /> Ready to publish.</p>
            {:else if outcome.kind === "published"}
              <p class="success-line">
                <Icon name="circle-check" size={13} /> {outcome.detail ?? "Published."}
              </p>
              {#if outcome.url}
                {@const url = outcome.url}
                <button class="link" onclick={() => openUrl(url)}>
                  View it online <Icon name="external-link" size={12} />
                </button>
              {/if}
              {#if outcome.followUp?.length}
                <ol class="publish-checklist">
                  {#each outcome.followUp as step, i (i)}<li>{step}</li>{/each}
                </ol>
              {/if}
            {:else}
              <p class="success-line">
                <Icon name="circle-check" size={13} /> {outcome.detail ?? "Upload package prepared."}
              </p>
              <p class="hint">Package folder: <code>{outcome.packageDir}</code></p>
              <button class="primary small" onclick={() => openUrl(outcome.openUrl)}>
                Open upload page <Icon name="external-link" size={12} />
              </button>
              <ol class="publish-checklist">
                {#each outcome.checklist as step, i (i)}<li>{step}</li>{/each}
              </ol>
            {/if}
            {#if result.log?.length}
              <details class="status-raw">
                <summary>Show log</summary>
                <pre>{result.log.join("\n")}</pre>
              </details>
            {/if}
          </div>
        {/if}
      </li>
    {/each}
  </ul>
</section>

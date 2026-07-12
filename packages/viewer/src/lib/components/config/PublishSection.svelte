<script lang="ts">
  /**
   * Publish section of ProjectConfigPanel (#35) — provider cards with
   * per-provider settings (rendered from each provider's declared
   * `fields` — the panel carries no provider knowledge of its own), connect
   * (API key → host credential store, redacted status back), preflight and
   * publish, and the run result (link / guided checklist + package folder).
   * All state and `api.publish.*` calls live in `PublishSectionController`
   * (passed as the single `controller` prop, per the design-controller
   * pattern — see M14); this child renders the controller's rune fields and
   * calls its intent methods. Token drafts pass through to the host once on
   * connect and are cleared by the controller — nothing secret is ever
   * displayed.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type { PublishProviderCard } from "$lib/platform/contract";
  import { friendlyPublishError } from "$lib/errors";
  import type { PublishSectionController } from "$lib/routes/publish-section-controller.svelte";

  let { controller }: { controller: PublishSectionController } = $props();

  function draftValue(card: PublishProviderCard, key: string): string {
    return controller.publishConfigDrafts[card.id]?.[key] ?? card.config[key] ?? "";
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
  {#if controller.publishError}
    {@const publishErr = friendlyPublishError(controller.publishError)}
    <p class="error" role="alert">{publishErr.summary}</p>
    {#if publishErr.details}
      <details class="status-raw">
        <summary>Show details</summary>
        <pre>{publishErr.details}</pre>
      </details>
    {/if}
  {/if}

  <ul class="publish-list">
    {#each controller.publishCards as card (card.id)}
      {@const result = controller.publishResults[card.id]}
      {@const busy = controller.publishBusyId === card.id}
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
                  oninput={(e) => controller.setPublishConfigDraft(card.id, field.key, e.currentTarget.value)}
                />
              </label>
            {/each}
            <button class="ghost small" onclick={() => controller.savePublishConfig(card.id)} disabled={busy}>
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
              value={controller.publishArtifactDrafts[card.id] ?? ""}
              readonly
            />
            <button class="ghost small" onclick={() => controller.pickPublishArtifact(card)} disabled={busy}>
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
                  value={controller.publishTokenDrafts[card.id] ?? ""}
                  oninput={(e) => controller.setPublishTokenDraft(card.id, e.currentTarget.value)}
                  onkeydown={(e) => {
                    if (e.key === "Enter") controller.connectPublish(card.id);
                  }}
                />
                <button class="primary small" onclick={() => controller.connectPublish(card.id)} disabled={busy}>
                  Connect
                </button>
              </div>
              {#if card.tokenUrl}
                <button class="link" onclick={() => controller.openPublishUrl(card.tokenUrl!)}>
                  Create an API key <Icon name="external-link" size={12} />
                </button>
              {/if}
            </div>
          {:else}
            <button class="ghost small" onclick={() => controller.disconnectPublish(card.id)} disabled={busy}>
              Disconnect
            </button>
          {/if}
        {/if}

        <div class="publish-actions">
          <button class="ghost small" onclick={() => controller.runPublish(card.id, true)} disabled={busy}>
            Check readiness
          </button>
          <button
            class="primary small"
            onclick={() => controller.runPublish(card.id, false)}
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
                <button class="link" onclick={() => controller.openPublishUrl(url)}>
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
              <button class="primary small" onclick={() => controller.openPublishUrl(outcome.openUrl)}>
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

<style>
  @import "$lib/styles/config-section-shared.css";

  .publish-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 10px; }
  .publish-card { display: flex; flex-direction: column; gap: 8px; padding: 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-control-bg); }
  .publish-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
  .publish-name { font-size: 13px; font-weight: 600; color: var(--app-text); }
  .publish-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .status.off { color: var(--app-text-faint); }
  .publish-fields { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .publish-field { display: flex; flex-direction: column; gap: 3px; width: 100%; font-size: 11px; color: var(--app-text-muted); }
  .publish-connect { display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .publish-actions { display: flex; gap: 6px; }
  .publish-result { border-top: 1px solid var(--app-border); padding-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; }
  .publish-issues { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 3px; font-size: 11px; }
  .publish-issues .error { color: var(--app-error-text); }
  .publish-issues .warning { color: var(--app-warning-text, #d29922); }
  .publish-issues .info { color: var(--app-text-muted); }
  .success-line { margin: 0; font-size: 12px; color: var(--app-success-text, #3fb950); display: inline-flex; align-items: center; gap: 4px; }
  .publish-checklist { margin: 0; padding-left: 18px; font-size: 11px; color: var(--app-text-muted); line-height: 1.5; }
  .publish-result code { font-size: 10px; word-break: break-all; }
  button.link { background: none; border: none; padding: 0; font-size: 11px; color: var(--app-focus-ring); cursor: pointer; display: inline-flex; align-items: center; gap: 3px; }
</style>

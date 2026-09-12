<script lang="ts">
  /**
   * Features view of the Extensions surface (#243, #265): the extensions that
   * carry MARKDOWN — plus any entry that carries nothing recognizable (a
   * missing folder, an unparseable specifier), so nothing configured is ever
   * invisible — as one view over the ONE `extensions:` list the shared
   * `ExtensionsSectionController` owns; `LookSection` is the other view, over
   * the same list and the same verbs (an extension that carries both styles
   * and markdown is the same row in both). Toggle, remove, validate; turn on
   * a bundled feature; install from npm; add a plugin file or folder on disk
   * (referenced in place, never copied). `extensionStatus` /
   * `extensionSourceLabel` are pure helpers.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { extensionStatus, extensionSourceLabel } from "./config-helpers";
  import type { ExtensionsSectionController } from "$lib/routes/extensions-section-controller.svelte";

  let { controller }: { controller: ExtensionsSectionController } = $props();
</script>

<section class="block">
  <div class="block-head">
    <h3>Features</h3>
    <button class="ghost small" onclick={controller.validateExtensions} disabled={controller.validating} title="Re-check that each feature loads">
      <Icon name="refresh-cw" size={13} /> Re-check
    </button>
  </div>
  {#if controller.error}
    <p class="error" role="alert">{controller.error}</p>
  {/if}
  {#if controller.notice}
    <p class="notice" role="status">{controller.notice}</p>
  {/if}
  {#if controller.features.length === 0}
    <p class="muted">No features added yet. Turn one on below, or add your own further down.</p>
  {:else}
    <ul class="plugin-list">
      {#each controller.features as e (e.use)}
        {@const st = extensionStatus(e, controller.validation, controller.validating)}
        <li class:disabled={!e.enabled}>
          <div class="plugin-main">
            <span class="plugin-label">{e.label}</span>
            {#if e.label !== e.use}<span class="plugin-name">{e.use}</span>{/if}
            <span class="plugin-meta">
              <span class="kind">{extensionSourceLabel(e)}</span>
              {#if e.carries.styles}
                <span class="badge" title="This extension also carries a look — see the Look tab.">+ look</span>
              {/if}
              <span class={`status ${st.kind}`} class:stale-status={st.kind === "stale"}>
                {#if st.kind === "ok"}<Icon name="circle-check" size={12} />
                {:else if st.kind === "error"}<Icon name="triangle-alert" size={12} />
                {:else if st.kind === "checking"}<Icon name="refresh-cw" size={12} />
                {:else if st.kind === "stale"}<Icon name="circle-help" size={12} />{/if}
                {st.label}
              </span>
            </span>
            {#if st.detail}<p class="status-detail">{st.detail}</p>{/if}
            {#if st.raw}
              <details class="status-raw"><summary>Show details</summary><pre>{st.raw}</pre></details>
            {/if}
          </div>
          <button class="toggle" class:on={e.enabled} role="switch" aria-checked={e.enabled} aria-label={`${e.enabled ? "Disable" : "Enable"} ${e.label}`} disabled={controller.busy !== null} onclick={() => controller.toggle(e)}>
            <span class="knob"></span>
          </button>
          <button class="ghost icononly" onclick={() => controller.remove(e)} disabled={controller.busy !== null} title={e.kind === "npm" ? "Remove (deletes its downloaded copy)" : "Remove from this project"} aria-label={`Remove ${e.label}`}>
            <Icon name="trash" size={13} />
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if controller.availableRecommended.length > 0}
    <h4 class="subhead">Markdown features</h4>
    <p class="hint">Turn a feature on and it works instantly — these are built in, nothing to install.</p>
    <ul class="rec-list">
      {#each controller.availableRecommended as rec (rec.use)}
        <li>
          <div class="rec-main">
            <span class="rec-label">{rec.label}</span>
            <p class="rec-desc">{rec.description}</p>
            <span class="rec-pkg">{rec.use}</span>
          </div>
          <button class="primary small app-btn-primary" onclick={() => controller.addRecommended(rec)} disabled={controller.busy !== null}>Turn on</button>
        </li>
      {/each}
    </ul>
  {/if}

  <!-- Always-visible section (project settings has no collapsible sections). -->
  <div class="advanced">
    <h4 class="subhead">Install from npm</h4>
    <div class="add-row">
      <input class="input" type="text" aria-label="npm package name or exact version" placeholder="markdown-it-highlightjs or markdown-it-highlightjs@4.3.0" bind:value={controller.npmName} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
      <input class="input export-input" type="text" aria-label="named plugin export (optional)" placeholder="export (optional)" bind:value={controller.npmExport} onkeydown={(e) => { if (e.key === "Enter") controller.addNpm(); }} />
      <button class="primary small app-btn-primary" onclick={controller.addNpm} disabled={controller.busy !== null}>{controller.busy !== null && controller.busy === controller.npmName.trim() ? "Installing..." : "Install"}</button>
    </div>
    <p class="hint">Downloads from npm, verifies the registry hash, stores the package under <code>plugins/npm</code>, and pins the exact version in the manifest. For packages such as <code>markdown-it-emoji</code> that expose named plugin functions, enter the export name (for example <code>full</code>). Package install scripts are never run.</p>
    <p class="hint">Only install packages you trust. Features and their dependencies run with the app's full filesystem and network privileges.</p>
    <button class="ghost small full" onclick={controller.addLocal} disabled={controller.busy !== null}>
      <Icon name="folder" size={14} /> Add a plugin file or folder...
    </button>
    <p class="hint">A file or folder you pick is used where it is — nothing is copied into the project.</p>
  </div>
</section>

<style>
  @import "$lib/styles/config-section-shared.css";

  .plugin-list, .rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .plugin-list li, .rec-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .plugin-list li.disabled { opacity: 0.6; }
  .plugin-main, .rec-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .plugin-name { font-size: 12px; color: var(--app-text); font-family: var(--app-font-mono); word-break: break-all; }
  .plugin-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; flex-wrap: wrap; }
  .rec-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .rec-pkg { font-size: 10px; color: var(--app-text-muted); font-family: var(--app-font-mono); }

  .advanced { display: flex; flex-direction: column; gap: 6px; padding-top: 4px; }
  .export-input { max-width: 130px; }
  button.full { width: 100%; justify-content: center; }

  /* Friendly label (M33) — the lib's `label` (the recommended list's
     plain-language name for a bundled feature, an extension's declared name
     otherwise). The raw `use` (`.plugin-name`, monospace via the shared
     layer) only renders as a secondary line when it differs. */
  .plugin-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  /* Distinct from `.status.checking` (M34) — a stalled/failed check, not one
     in flight. A new class (not an override of `.status.error`) so it reads
     as its own state rather than reusing the error color. */
  .stale-status { color: var(--app-warning-text); }
</style>

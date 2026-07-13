<script lang="ts">
  /**
   * Plugins section of ProjectConfigPanel — the configured list + toggle +
   * validate, the recommended built-in features, and the advanced
   * add-by-name/local-path controls. All state and `api.plugin.*` calls live
   * in `PluginsSectionController` (passed as the single `controller` prop, per
   * the design-controller pattern — see M14); this child renders the
   * controller's rune fields and calls its intent methods. `pluginStatus` is a
   * pure helper. `copiedRef` (copy-to-clipboard feedback) is purely local,
   * ephemeral UI state with no host coupling — it stays in this component
   * rather than the controller.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { pluginStatus, pluginLabel } from "./config-helpers";
  import type { PluginsSectionController } from "$lib/routes/plugins-section-controller.svelte";

  let { controller }: { controller: PluginsSectionController } = $props();

  function isPluginConfigured(name: string): boolean {
    return controller.plugins.some((p) => p.ref === name);
  }

  // Copy-to-clipboard feedback for the "Not installed" install command (M33).
  // Keyed by ref so copying one row's command doesn't flash "Copied!" on another.
  let copiedRef = $state<string | null>(null);
  function copyInstallCommand(ref: string, command: string): void {
    navigator.clipboard.writeText(command).then(() => {
      copiedRef = ref;
      setTimeout(() => {
        if (copiedRef === ref) copiedRef = null;
      }, 1500);
    }).catch(() => {});
  }
</script>

<section class="block">
  <div class="block-head">
    <h3>Plugins</h3>
    <button class="ghost small" onclick={controller.validatePlugins} disabled={controller.pluginValidating} title="Re-check that each plugin loads">
      <Icon name="refresh-cw" size={13} /> Re-check
    </button>
  </div>
  {#if controller.pluginError}
    <p class="error" role="alert">{controller.pluginError}</p>
  {/if}
  {#if controller.plugins.length === 0}
    <p class="muted">No plugins configured yet. Pick a feature below, or add one via Advanced.</p>
  {:else}
    <ul class="plugin-list">
      {#each controller.plugins as entry (entry.ref)}
        {@const st = pluginStatus(entry, controller.validation, controller.pluginValidating)}
        {@const label = pluginLabel(entry, controller.recommended)}
        <li class:disabled={!entry.enabled}>
          <div class="plugin-main">
            <span class="plugin-label">{label}</span>
            {#if label !== entry.ref}<span class="plugin-name">{entry.ref}</span>{/if}
            <span class="plugin-meta">
              <span class="kind">{entry.kind === "local" ? "local file" : "npm"}</span>
              <span class={`status ${st.kind}`} class:stale-status={st.kind === "stale"}>
                {#if st.kind === "ok"}<Icon name="circle-check" size={12} />
                {:else if st.kind === "error"}<Icon name="triangle-alert" size={12} />
                {:else if st.kind === "checking"}<Icon name="refresh-cw" size={12} />
                {:else if st.kind === "stale"}<Icon name="circle-help" size={12} />{/if}
                {st.label}
              </span>
            </span>
            {#if st.detail}<p class="status-detail">{st.detail}</p>{/if}
            {#if st.installCommand}
              <div class="install-row">
                <code class="install-cmd">{st.installCommand}</code>
                <button type="button" class="ghost small" onclick={() => copyInstallCommand(entry.ref, st.installCommand ?? "")}>
                  {copiedRef === entry.ref ? "Copied!" : "Copy"}
                </button>
              </div>
              {#if st.guideHref}
                <a class="guide-link" href={st.guideHref} target="_blank" rel="noopener noreferrer">How to install a plugin →</a>
              {/if}
            {/if}
            {#if st.raw}
              <details class="status-raw"><summary>Show details</summary><pre>{st.raw}</pre></details>
            {/if}
          </div>
          <button class="toggle" class:on={entry.enabled} role="switch" aria-checked={entry.enabled} aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.ref}`} disabled={controller.pluginBusyRef === entry.ref} onclick={() => controller.togglePlugin(entry)}>
            <span class="knob"></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <h4 class="subhead">Markdown features</h4>
  <p class="hint">Turn a feature on and it works instantly — these are built in, nothing to install.</p>
  <ul class="rec-list">
    {#each controller.recommended as rec (rec.name)}
      <li>
        <div class="rec-main">
          <span class="rec-label">{rec.label ?? rec.name}</span>
          <p class="rec-desc">{rec.description}</p>
          <span class="rec-pkg">{rec.name}</span>
        </div>
        {#if isPluginConfigured(rec.name)}
          <span class="added"><Icon name="circle-check" size={12} /> On</span>
        {:else}
          <button class="primary small" onclick={() => controller.addRecommended(rec)} disabled={controller.pluginBusyRef !== null}>Turn on</button>
        {/if}
      </li>
    {/each}
  </ul>

  <details class="advanced">
    <summary>Advanced: add another plugin</summary>
    <div class="add-row">
      <input class="input" type="text" placeholder="npm package name (e.g. markdown-it-footnote)" bind:value={controller.npmName} onkeydown={(e) => { if (e.key === "Enter") controller.addNpmPlugin(); }} />
      <button class="primary small" onclick={controller.addNpmPlugin} disabled={controller.pluginBusyRef !== null}>Add</button>
    </div>
    <button class="ghost small full" onclick={controller.addLocalPlugin} disabled={controller.pluginBusyRef !== null}>
      <Icon name="folder" size={14} /> Import from local file or folder…
    </button>
    <p class="hint">A plugin added by name must already be installed in your project. Local files are referenced directly.</p>
  </details>
</section>

<style>
  @import "$lib/styles/config-section-shared.css";

  .plugin-list, .rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 5px; }
  .plugin-list li, .rec-list li { display: flex; align-items: center; gap: 8px; padding: 8px 10px; border: 1px solid var(--app-border); border-radius: 6px; background: var(--app-surface-sunken); }
  .plugin-list li.disabled { opacity: 0.6; }
  .plugin-main, .rec-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .plugin-name { font-size: 12px; color: var(--app-text); font-family: ui-monospace, monospace; word-break: break-all; }
  .plugin-meta { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .rec-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  .rec-pkg { font-size: 10px; color: var(--app-text-faint); font-family: ui-monospace, monospace; }
  .added { font-size: 11px; color: var(--app-text-faint); font-style: italic; }

  .toggle { flex-shrink: 0; width: 36px; height: 20px; border-radius: 10px; background: var(--app-border); border: 1px solid var(--app-border); position: relative; cursor: pointer; padding: 0; }
  .toggle.on { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  .toggle .knob { position: absolute; top: 1px; left: 1px; width: 16px; height: 16px; border-radius: 50%; background: #fff; transition: transform 0.15s; }
  .toggle.on .knob { transform: translateX(15px); }
  .toggle:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .toggle:disabled { opacity: 0.5; cursor: progress; }

  .advanced > summary { cursor: pointer; user-select: none; font-size: 12px; font-weight: 600; color: var(--app-text-muted); padding: 4px 0; list-style-position: inside; }
  button.full { width: 100%; justify-content: center; }

  /* Friendly label (M33) — a new class, own-scoped, so it doesn't have to
     fight the parent's `.plugin-name` monospace rule for specificity/order.
     The raw ref (still `.plugin-name`, still monospace via the shared
     layer) only renders as a secondary line when it differs from the label
     — i.e. for anything not on the recommended list. */
  .plugin-label { font-size: 12px; font-weight: 600; color: var(--app-text); }
  /* Distinct from `.status.checking` (M34) — a stalled/failed check, not one
     in flight. A new class (not an override of `.status.error`) so it reads
     as its own state rather than reusing the error color. */
  .stale-status { color: var(--app-warning-text, #b45309); }
  .install-row { display: flex; align-items: center; gap: 6px; margin-top: 2px; }
  .install-cmd {
    font-size: 11px;
    padding: 2px 6px;
    background: var(--app-control-bg);
    border: 1px solid var(--app-border);
    border-radius: 4px;
    color: var(--app-text);
  }
  .guide-link { font-size: 11px; margin-top: 2px; }
</style>

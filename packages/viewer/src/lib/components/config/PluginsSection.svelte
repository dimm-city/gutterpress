<script lang="ts">
  /**
   * Plugins section of ProjectConfigPanel — the configured list + toggle +
   * validate, the recommended built-in features, and the advanced
   * add-by-name/local-path controls. Presentational: plugin state and
   * `api.plugin.*` calls live in the composition root; this child renders props
   * and emits changes via callbacks. `pluginStatus` is a pure helper.
   */
  import Icon from "$lib/components/Icon.svelte";
  import type {
    ProjectPluginEntry,
    PluginValidationResult,
    RecommendedPlugin,
  } from "$lib/api";
  import { pluginStatus } from "./config-helpers";

  let {
    pluginError,
    plugins,
    recommended,
    validation,
    pluginValidating,
    pluginBusyRef,
    npmName = $bindable(""),
    validatePlugins,
    togglePlugin,
    addRecommended,
    addNpmPlugin,
    addLocalPlugin,
  }: {
    pluginError: string | null;
    plugins: ProjectPluginEntry[];
    recommended: RecommendedPlugin[];
    validation: Record<string, PluginValidationResult>;
    pluginValidating: boolean;
    pluginBusyRef: string | null;
    npmName: string;
    validatePlugins: () => void;
    togglePlugin: (entry: ProjectPluginEntry) => void;
    addRecommended: (rec: RecommendedPlugin) => void;
    addNpmPlugin: () => void;
    addLocalPlugin: () => void;
  } = $props();

  function isPluginConfigured(name: string): boolean {
    return plugins.some((p) => p.ref === name);
  }
</script>

<section class="block">
  <div class="block-head">
    <h3>Plugins</h3>
    <button class="ghost small" onclick={validatePlugins} disabled={pluginValidating} title="Re-check that each plugin loads">
      <Icon name="refresh-cw" size={13} /> Re-check
    </button>
  </div>
  {#if pluginError}
    <p class="error" role="alert">{pluginError}</p>
  {/if}
  {#if plugins.length === 0}
    <p class="muted">No plugins configured yet. Add one below, or pick a feature above.</p>
  {:else}
    <ul class="plugin-list">
      {#each plugins as entry (entry.ref)}
        {@const st = pluginStatus(entry, validation, pluginValidating)}
        <li class:disabled={!entry.enabled}>
          <div class="plugin-main">
            <span class="plugin-name">{entry.ref}</span>
            <span class="plugin-meta">
              <span class="kind">{entry.kind === "local" ? "local file" : "npm"}</span>
              <span class={`status ${st.kind}`}>
                {#if st.kind === "ok"}<Icon name="circle-check" size={12} />
                {:else if st.kind === "error"}<Icon name="triangle-alert" size={12} />
                {:else if st.kind === "checking"}<Icon name="refresh-cw" size={12} />{/if}
                {st.label}
              </span>
            </span>
            {#if st.detail}<p class="status-detail">{st.detail}</p>{/if}
            {#if st.raw}
              <details class="status-raw"><summary>Show details</summary><pre>{st.raw}</pre></details>
            {/if}
          </div>
          <button class="toggle" class:on={entry.enabled} role="switch" aria-checked={entry.enabled} aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.ref}`} disabled={pluginBusyRef === entry.ref} onclick={() => togglePlugin(entry)}>
            <span class="knob"></span>
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  <h4 class="subhead">Markdown features</h4>
  <p class="hint">Turn a feature on and it works instantly — these are built in, nothing to install.</p>
  <ul class="rec-list">
    {#each recommended as rec (rec.name)}
      <li>
        <div class="rec-main">
          <span class="rec-label">{rec.label ?? rec.name}</span>
          <p class="rec-desc">{rec.description}</p>
          <span class="rec-pkg">{rec.name}</span>
        </div>
        {#if isPluginConfigured(rec.name)}
          <span class="added"><Icon name="circle-check" size={12} /> On</span>
        {:else}
          <button class="primary small" onclick={() => addRecommended(rec)} disabled={pluginBusyRef !== null}>Turn on</button>
        {/if}
      </li>
    {/each}
  </ul>

  <details class="advanced">
    <summary>Advanced: add another plugin</summary>
    <div class="add-row">
      <input class="input" type="text" placeholder="npm package name (e.g. markdown-it-footnote)" value={npmName} oninput={(e) => (npmName = e.currentTarget.value)} onkeydown={(e) => { if (e.key === "Enter") addNpmPlugin(); }} />
      <button class="primary small" onclick={addNpmPlugin} disabled={pluginBusyRef !== null}>Add</button>
    </div>
    <button class="ghost small full" onclick={addLocalPlugin} disabled={pluginBusyRef !== null}>
      <Icon name="folder" size={14} /> Import from local file or folder…
    </button>
    <p class="hint">A plugin added by name must already be installed in your project. Local files are referenced directly.</p>
  </details>
</section>

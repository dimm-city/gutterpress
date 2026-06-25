<script lang="ts">
  /**
   * PluginManager (#30) — discover, enable/disable, import, and validate the
   * open project's markdown-it plugins.
   *
   * Architecture:
   * - All manifest read/write/toggle + load-test runs node-side in the host
   *   (shared lib `plugin-manager.ts`). The renderer reaches it through
   *   `getPlatform()` only (§8 / ADR 0004) — no Node/lib value import here.
   * - Per CLAUDE.md §5 the host NEVER auto-installs npm packages. "Add by npm
   *   name" and "Add recommended" only record a manifest entry; the validation
   *   pass flags whether each plugin resolves/loads (so the user is told when a
   *   package still needs `bun add` / `npm install`).
   * - Desktop-only in v1 (host file IO + module loading). The trigger is hidden
   *   on web; this dialog guards with the `projectDir` it is given.
   */
  import Icon from "$lib/components/Icon.svelte";
  import { getPlatform } from "$lib/platform";
  import type {
    ProjectPluginEntry,
    PluginValidationResult,
    RecommendedPlugin,
  } from "$lib/platform/contract";

  let {
    open = $bindable(false),
    projectDir,
  }: {
    open?: boolean;
    projectDir: string | null;
  } = $props();

  let triggerEl = $state<HTMLButtonElement | undefined>(undefined);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  let plugins = $state<ProjectPluginEntry[]>([]);
  let validation = $state<Record<string, PluginValidationResult>>({});
  let recommended = $state<RecommendedPlugin[]>([]);
  let loading = $state(false);
  let validating = $state(false);
  let error = $state<string | null>(null);
  let busyRef = $state<string | null>(null);

  // "Add by npm name" inline field.
  let npmName = $state("");

  /**
   * Open the dialog and load plugins + recommendations (a user gesture from the
   * parent trigger — no `$effect` on `open`, per the runes-mode rule).
   */
  export async function show(trigger?: HTMLButtonElement): Promise<void> {
    if (trigger) triggerEl = trigger;
    open = true;
    await refresh();
    queueMicrotask(() =>
      dialogEl?.querySelector<HTMLElement>("button, input")?.focus(),
    );
  }

  async function refresh() {
    if (!projectDir) {
      plugins = [];
      recommended = [];
      return;
    }
    error = null;
    loading = true;
    try {
      const [list, recs] = await Promise.all([
        getPlatform().listPlugins(projectDir),
        getPlatform().listRecommendedPlugins(),
      ]);
      plugins = list;
      recommended = recs;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
    await validate();
  }

  /** Load-test every configured plugin and index the results by ref. */
  async function validate() {
    if (!projectDir) return;
    validating = true;
    try {
      const results = await getPlatform().validatePlugins(projectDir);
      validation = Object.fromEntries(results.map((r) => [r.ref, r]));
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      validating = false;
    }
  }

  function close() {
    open = false;
    triggerEl?.focus();
  }

  async function toggle(entry: ProjectPluginEntry) {
    if (!projectDir) return;
    busyRef = entry.ref;
    error = null;
    try {
      await getPlatform().setPluginEnabled(projectDir, entry.ref, !entry.enabled);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyRef = null;
    }
  }

  async function importLocal() {
    if (!projectDir) return;
    error = null;
    try {
      const added = await getPlatform().importLocalPlugin(projectDir);
      if (added) await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
  }

  async function addNpm() {
    if (!projectDir) return;
    const name = npmName.trim();
    if (!name) {
      error = "Enter an npm package name (e.g. markdown-it-footnote).";
      return;
    }
    error = null;
    busyRef = name;
    try {
      await getPlatform().addNpmPlugin(projectDir, name);
      npmName = "";
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyRef = null;
    }
  }

  async function addRecommended(rec: RecommendedPlugin) {
    if (!projectDir) return;
    error = null;
    busyRef = rec.name;
    try {
      await getPlatform().addNpmPlugin(projectDir, rec.name);
      await refresh();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busyRef = null;
    }
  }

  /** True when this recommended plugin is already configured. */
  function isConfigured(name: string): boolean {
    return plugins.some((p) => p.ref === name);
  }

  /** Status for one configured plugin: ok / error / disabled / checking. */
  function statusOf(entry: ProjectPluginEntry): {
    label: string;
    kind: "ok" | "error" | "disabled" | "checking";
    detail?: string;
  } {
    if (!entry.enabled) return { label: "Disabled", kind: "disabled" };
    const v = validation[entry.ref];
    if (validating && !v) return { label: "Checking…", kind: "checking" };
    if (!v) return { label: "Checking…", kind: "checking" };
    if (v.ok) return { label: "Loads OK", kind: "ok" };
    // npm packages that don't resolve are the "needs install" case (§5).
    const needsInstall = entry.kind === "npm";
    return {
      label: needsInstall ? "Not installed" : "Error",
      kind: "error",
      detail: v.error,
    };
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div
    bind:this={dialogEl}
    class="dialog"
    role="dialog"
    aria-modal="true"
    aria-labelledby="plugin-manager-title"
    tabindex="-1"
  >
    <header class="dialog-header">
      <h2 id="plugin-manager-title">Plugins</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">
        <Icon name="x" size={16} />
      </button>
    </header>

    <div class="dialog-body">
      {#if error}
        <p class="error" role="alert">{error}</p>
      {/if}

      <!-- Installed / configured plugins -->
      <section class="block">
        <div class="block-head">
          <h3>This project</h3>
          <button
            class="ghost small"
            onclick={validate}
            disabled={validating || !projectDir}
            title="Re-check that each plugin loads"
          >
            <Icon name="refresh-cw" size={13} /> Re-check
          </button>
        </div>

        {#if loading}
          <p class="muted">Loading…</p>
        {:else if plugins.length === 0}
          <p class="muted">
            No plugins configured yet. Add one below, or pick from the
            recommended list.
          </p>
        {:else}
          <ul class="plugin-list">
            {#each plugins as entry (entry.ref)}
              {@const st = statusOf(entry)}
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
                  {#if st.detail}
                    <p class="status-detail">{st.detail}</p>
                  {/if}
                </div>
                <button
                  class="toggle"
                  class:on={entry.enabled}
                  role="switch"
                  aria-checked={entry.enabled}
                  aria-label={`${entry.enabled ? "Disable" : "Enable"} ${entry.ref}`}
                  disabled={busyRef === entry.ref}
                  onclick={() => toggle(entry)}
                >
                  <span class="knob"></span>
                </button>
              </li>
            {/each}
          </ul>
        {/if}
      </section>

      <!-- Import -->
      <section class="block">
        <h3>Add a plugin</h3>
        <div class="add-row">
          <input
            class="npm-input"
            type="text"
            placeholder="npm package name (e.g. markdown-it-footnote)"
            bind:value={npmName}
            onkeydown={(e) => { if (e.key === "Enter") addNpm(); }}
            autocomplete="off"
          />
          <button class="primary" onclick={addNpm} disabled={busyRef === npmName.trim() && !!npmName.trim()}>Add</button>
        </div>
        <button class="ghost full" onclick={importLocal} disabled={!projectDir}>
          <Icon name="folder" size={14} /> Import from local file or folder…
        </button>
        <p class="hint">
          Adding by name records the plugin in your manifest. print-md does not
          install packages for you — run <code>npm install &lt;name&gt;</code>
          (or <code>bun add</code>) in the project, then “Re-check”.
        </p>
      </section>

      <!-- Recommended -->
      <section class="block">
        <h3>Recommended</h3>
        <ul class="rec-list">
          {#each recommended as rec (rec.name)}
            <li>
              <div class="rec-main">
                <span class="plugin-name">{rec.name}</span>
                <p class="rec-desc">{rec.description}</p>
              </div>
              {#if isConfigured(rec.name)}
                <span class="added">Added</span>
              {:else}
                <button
                  class="ghost small"
                  disabled={busyRef === rec.name || !projectDir}
                  onclick={() => addRecommended(rec)}
                >
                  <Icon name="plus" size={13} /> Add
                </button>
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    </div>

    <footer class="actions">
      <button class="ghost" onclick={close}>Close</button>
    </footer>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .backdrop { position: fixed; inset: 0; background: var(--app-backdrop); z-index: 1000; }
  .dialog {
    position: fixed; top: 50%; left: 50%; transform: translate(-50%, -50%);
    width: min(560px, 94vw); max-height: 86vh;
    background: var(--app-surface); color: var(--app-text-secondary);
    border-radius: 8px; box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001; display: flex; flex-direction: column; overflow: hidden;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex; align-items: center; justify-content: space-between;
    padding: 14px 18px; border-bottom: 1px solid var(--app-border-subtle); flex-shrink: 0;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent; border: 1px solid transparent; border-radius: 5px;
    color: var(--app-text-muted); cursor: pointer; padding: 4px;
    display: inline-flex; align-items: center; justify-content: center;
    min-width: 28px; min-height: 28px;
  }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }

  .dialog-body { padding: 18px; display: flex; flex-direction: column; gap: 20px; overflow-y: auto; flex: 1; }
  .block { display: flex; flex-direction: column; gap: 10px; }
  .block-head { display: flex; align-items: center; justify-content: space-between; }
  .block h3 { margin: 0; font-size: 13px; font-weight: 600; color: var(--app-text); text-transform: uppercase; letter-spacing: 0.04em; }
  .muted { margin: 0; font-size: 13px; color: var(--app-text-muted); }
  .error { color: var(--app-error-text); font-size: 12px; margin: 0; }
  .hint { margin: 0; font-size: 11.5px; color: var(--app-text-faint); line-height: 1.4; }
  .hint code { background: var(--app-surface-sunken); padding: 1px 4px; border-radius: 3px; font-size: 11px; }

  .plugin-list, .rec-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .plugin-list li, .rec-list li {
    display: flex; align-items: center; gap: 10px; padding: 9px 11px;
    border-radius: 6px; background: var(--app-surface-sunken); border: 1px solid var(--app-border);
  }
  .plugin-list li.disabled { opacity: 0.6; }
  .plugin-main, .rec-main { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px; }
  .plugin-name { font-size: 13px; color: var(--app-text); font-family: ui-monospace, monospace; word-break: break-all; }
  .plugin-meta { display: flex; align-items: center; gap: 10px; font-size: 11px; }
  .kind { color: var(--app-text-faint); }
  .status { display: inline-flex; align-items: center; gap: 3px; font-weight: 500; }
  .status.ok { color: var(--app-success-text, #3fb950); }
  .status.error { color: var(--app-error-text); }
  .status.checking { color: var(--app-text-faint); }
  .status.disabled { color: var(--app-text-faint); }
  .status-detail { margin: 0; font-size: 11px; color: var(--app-error-text); word-break: break-word; line-height: 1.35; }

  .rec-desc { margin: 0; font-size: 11.5px; color: var(--app-text-muted); line-height: 1.4; }
  .added { font-size: 11px; color: var(--app-text-faint); font-style: italic; flex-shrink: 0; }

  /* Toggle switch */
  .toggle {
    flex-shrink: 0; width: 38px; height: 22px; border-radius: 11px;
    background: var(--app-border); border: 1px solid var(--app-border);
    position: relative; cursor: pointer; transition: background 0.15s; padding: 0;
  }
  .toggle.on { background: var(--app-focus-ring); border-color: var(--app-focus-ring); }
  .toggle .knob {
    position: absolute; top: 2px; left: 2px; width: 16px; height: 16px;
    border-radius: 50%; background: #fff; transition: transform 0.15s;
  }
  .toggle.on .knob { transform: translateX(16px); }
  .toggle:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .toggle:disabled { cursor: progress; }

  .add-row { display: flex; gap: 8px; }
  .npm-input {
    flex: 1; background: var(--app-surface-sunken); border: 1px solid var(--app-border);
    color: var(--app-text-secondary); padding: 8px 10px; border-radius: 6px;
    font-size: 13px; font-family: inherit;
  }
  .npm-input:focus { outline: none; border-color: var(--app-focus-ring); }

  button.full { width: 100%; justify-content: center; }
  .actions {
    display: flex; gap: 8px; justify-content: flex-end; padding: 14px 18px;
    border-top: 1px solid var(--app-border-subtle); flex-shrink: 0;
  }
  button { display: inline-flex; align-items: center; gap: 5px; padding: 7px 14px; font-size: 13px; border-radius: 5px; cursor: pointer; border: 1px solid transparent; font-family: inherit; }
  button.small { padding: 5px 10px; font-size: 12px; }
  .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .primary:hover:not(:disabled) { background: var(--app-accent-hover); }
  .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .ghost:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>

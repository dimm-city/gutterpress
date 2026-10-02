<script lang="ts">
  /**
   * TroubleshootingView — the start screen's Troubleshooting tab: the
   * sub-tabbed home for everything a writer needs when something is wrong or
   * support asks "which version?". Diagnostics (system + tool status, copyable
   * report), Logs (the app's diagnostic logs) and Sync (repair tools
   * for a stuck online backup). Versions + updates live in
   * the landing's About tab. Split out of the old Help screen, which now
   * carries guidance only.
   *
   * Reuses SettingsView's sub-tab pattern (TABS, tablist keys, tabpanel with
   * `idPrefix`). Owns its api.doctor load for Diagnostics.
   */
  import { isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { DoctorDiagnostics } from "$lib/api";
  import LogsPanel from "$lib/components/LogsPanel.svelte";
  import SyncToolsPanel from "$lib/components/SyncToolsPanel.svelte";
  import { sanitizeTroubleshootingTab, type TroubleshootingTab } from "$lib/troubleshooting-tabs";

  let {
    initialTab = "diagnostics",
    idPrefix = "troubleshooting",
  }: {
    /** The sub-tab to land on (deep link, e.g. "logs"). */
    initialTab?: TroubleshootingTab;
    /** Element-id namespace for the tab/panel aria wiring. */
    idPrefix?: string;
  } = $props();

  // ── Tabs ────────────────────────────────────────────────────────────────────
  const TABS: Array<{ id: TroubleshootingTab; label: string }> = [
    { id: "diagnostics", label: "Diagnostics" },
    { id: "logs", label: "Logs" },
    { id: "sync", label: "Sync" },
  ];
  // Mounted fresh per visit; the initial value is the requested landing tab.
  // svelte-ignore state_referenced_locally
  let activeTab = $state<TroubleshootingTab>(sanitizeTroubleshootingTab(initialTab));
  let tabEls = $state<Record<TroubleshootingTab, HTMLButtonElement | undefined>>({
    diagnostics: undefined,
    logs: undefined,
    sync: undefined,
  });

  function onTablistKeydown(e: KeyboardEvent) {
    const ids = TABS.map((tab) => tab.id);
    const current = ids.indexOf(activeTab);
    let next: number | undefined;
    if (e.key === "ArrowRight") next = (current + 1) % ids.length;
    else if (e.key === "ArrowLeft") next = (current - 1 + ids.length) % ids.length;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = ids.length - 1;
    if (next === undefined) return;
    e.preventDefault();
    activeTab = ids[next]!;
    tabEls[activeTab]?.focus();
  }

  let data = $state<DoctorDiagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);
  // Per-tool one-click install: id of the tool being installed + last failure.
  let installing = $state<string | null>(null);
  let installError = $state<Record<string, string>>({});

  async function installTool(toolId: string) {
    installing = toolId;
    installError = { ...installError, [toolId]: "" };
    try {
      const r = await api.doctorInstall(toolId);
      if (r.ok) await load();
      else installError = { ...installError, [toolId]: `Install failed (exit ${r.exitCode ?? "none"}). ${r.output.split("\n").slice(-5).join("\n")}` };
    } catch (e) {
      installError = { ...installError, [toolId]: e instanceof Error ? e.message : String(e) };
    } finally {
      installing = null;
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      if (!isDesktop()) {
        error = "Desktop system details are only available in the desktop app.";
        return;
      }
      data = await api.doctor();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function loadOnMount(_el: HTMLElement) {
    if (!data && !loading) load();
  }

  function osLabel(os: string) {
    if (os === "darwin") return "macOS";
    if (os === "win32") return "Windows";
    if (os === "linux") return "Linux";
    return os;
  }

  function copyReport() {
    if (!data) return;
    const lines = [
      `Gutterpress desktop ${data.desktopVersion}`,
      `lib ${data.libVersion}  ·  electron ${data.electronVersion}  ·  chromium ${data.chromeVersion}  ·  node ${data.platform.node}`,
      `platform: ${osLabel(data.platform.os)} ${data.platform.arch} (${data.platform.release})`,
      `CLI config directory: ${data.configDir}`,
      ``,
      `Tools:`,
      ...data.tools.map((t) => {
        const status = t.found ? `found ${t.version ?? "(no version)"} @ ${t.path ?? "?"}` : `NOT FOUND`;
        return `  ${t.name} (${t.bin})  —  ${status}`;
      }),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }

  function getInstallHint(hint: string, os: string): string {
    if (!hint) return hint;
    let label = '';
    if (os === 'darwin') label = 'macOS:';
    else if (os === 'win32') label = 'Windows:';
    else if (os === 'linux') label = 'Ubuntu:';

    if (!label) return hint;

    const idx = hint.indexOf(label);
    if (idx === -1) {
      // Try alternate Linux label
      if (os === 'linux') {
        const altIdx = hint.indexOf('Linux:');
        if (altIdx === -1) return hint;
        const after = hint.slice(altIdx + 'Linux:'.length);
        const nextLabel = after.search(/\n[A-Z][a-zA-Z]+:/);
        return nextLabel === -1 ? after.trim() : after.slice(0, nextLabel).trim();
      }
      return hint;
    }

    const after = hint.slice(idx + label.length);
    const nextLabel = after.search(/\n[A-Z][a-zA-Z]+:/);
    return nextLabel === -1 ? after.trim() : after.slice(0, nextLabel).trim();
  }
</script>

<div class="troubleshooting" use:loadOnMount>
  <div class="tab-bar app-tab-bar" role="tablist" aria-label="Troubleshooting sections" onkeydown={onTablistKeydown} tabindex="-1">
    {#each TABS as tab (tab.id)}
      <button
        id="{idPrefix}-tab-{tab.id}"
        type="button"
        role="tab"
        class="app-tab"
        class:active={activeTab === tab.id}
        aria-selected={activeTab === tab.id}
        aria-controls="{idPrefix}-panel"
        tabindex={activeTab === tab.id ? 0 : -1}
        bind:this={tabEls[tab.id]}
        onclick={() => (activeTab = tab.id)}
      >{tab.label}</button>
    {/each}
  </div>

  <div
    id="{idPrefix}-panel"
    class="panel"
    role="tabpanel"
    aria-labelledby="{idPrefix}-tab-{activeTab}"
  >
    {#if activeTab === "logs"}
      <!-- Mounted only while this tab is active, so each visit re-lists (a
           sync may have written since). -->
      <LogsPanel />
    {:else if activeTab === "sync"}
      <SyncToolsPanel />
    {:else if loading}
      <p class="status">Checking system…</p>
    {:else if error}
      <p class="status error">{error}</p>
      <button class="retry app-btn-primary" onclick={load}>Retry</button>
    {:else if data}
      <p class="intro">Check that your computer has what Gutterpress needs, and copy the details to share when you ask for help.</p>

      <section class="versions">
        <div>
          <strong>Runtime:</strong>
          Electron {data.electronVersion} · Chromium {data.chromeVersion} · Node {data.platform.node}
        </div>
        <div>
          <strong>Platform:</strong>
          {osLabel(data.platform.os)} {data.platform.arch} ({data.platform.release})
        </div>
        <div><strong>CLI config directory:</strong> <code>{data.configDir}</code></div>
      </section>

      <section class="tools">
        <h3>Optional system tools</h3>
        <p class="hint">
          Gutterpress renders your preview using the built-in browser engine. The standard <strong>Publish</strong> PDF needs no extra tools. The optional <strong>pre-press PDF</strong> (for professional print shops) additionally needs Ghostscript and qpdf.
        </p>
        <ul>
          {#each data.tools as t (t.bin)}
            <li class:found={t.found} class:missing={!t.found}>
              <div class="tool-row">
                <span class="status-icon"><span class="status-word">{t.found ? "Found" : "Missing"}</span></span>
                <span class="tool-name">{t.name}</span>
                <span class="tool-version">
                  {#if t.found}
                    {t.version ?? "(installed)"}
                  {:else}
                    not found
                  {/if}
                </span>
              </div>
              {#if t.path}
                <div class="tool-path"><code>{t.path}</code></div>
              {/if}
              <div class="used-by">
                {#each t.usedBy as u}
                  <span class="badge {u.severity}">{u.severity === 'required' ? 'needed for:' : 'used by:'}</span>
                  <span>{u.feature}</span><br />
                {/each}
              </div>
              {#if !t.found}
                {@const install = t.install}
                {#if install?.kind === "run"}
                  <button class="install-btn app-btn-primary" onclick={() => void installTool(t.id)} disabled={installing !== null} title={install.label}>
                    {installing === t.id ? "Installing…" : `Install ${t.name}`}
                  </button>
                {:else if install?.kind === "download"}
                  <button class="install-btn app-btn-primary" onclick={() => void api.shell.openExternal(install.url)}>
                    Download {t.name}
                  </button>
                {/if}
                {#if installError[t.id]}
                  <p class="install-error" role="alert">{installError[t.id]}</p>
                {/if}
                <details class="install-hint">
                  <summary>Install manually</summary>
                  {#if data.platform.os === 'win32'}
                    <p class="install-note">Run in Command Prompt or PowerShell as Administrator, or download the installer from the tool's website.</p>
                  {:else if data.platform.os === 'darwin'}
                    <p class="install-note">Run in Terminal. Homebrew must be installed first for brew commands.</p>
                  {/if}
                  <pre>{getInstallHint(t.installHint, data.platform.os)}</pre>
                </details>
              {/if}
            </li>
          {/each}
        </ul>
      </section>

      <footer class="actions">
        <button class="ghost" onclick={copyReport} title="Copy system info to clipboard — useful when asking for support">
          {copied ? "Copied!" : "Copy diagnostic info"}
        </button>
      </footer>
    {/if}
  </div>
</div>

<style>
  .troubleshooting { font-size: 13px; color: var(--app-text-secondary); }
  .panel { padding-top: 16px; }
  .intro { margin: 0 0 14px; font-size: 12px; color: var(--app-text-muted); }
  .status { margin: 8px 0; }
  .status.error { color: var(--app-error-text); font-family: var(--app-font-mono); font-size: 12px; }
  .retry {
    padding: 6px 14px; font-size: 13px; border-radius: 4px;
    border-width: 1px; border-style: solid; cursor: pointer;
  }

  .versions { font-size: 13px; line-height: 1.7; margin-bottom: 18px; }
  .versions strong { color: var(--app-text-muted); font-weight: 500; min-width: 80px; display: inline-block; }
  .tools h3 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .tools .hint { font-size: 12px; color: var(--app-text-muted); margin: 0 0 12px; }
  .tools ul { list-style: none; margin: 0; padding: 0; }
  .tools li {
    padding: 10px 12px;
    border-radius: 6px;
    background: var(--app-surface-raised);
    margin-bottom: 8px;
    font-size: 13px;
  }
  .tools li.found { border-left: 3px solid var(--app-success-text); }
  .tools li.missing { border-left: 3px solid var(--app-warning-text); }
  .tool-row {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    gap: 6px 10px;
    align-items: start;
  }
  .status-icon {
    min-width: 44px;
    text-align: left;
  }
  .status-word {
    display: inline-block;
    font-size: 10px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.3px;
    line-height: 1.2;
  }
  .tools li.found .status-word { color: var(--app-success-text); }
  .tools li.missing .status-word { color: var(--app-warning-text); }
  .tool-name {
    align-self: start;
    min-width: 0;
    font-weight: 600;
  }
  .tool-version {
    align-self: start;
    color: var(--app-text-muted);
    font-family: var(--app-font-mono);
    font-size: 12px;
    overflow-wrap: anywhere;
    text-align: right;
  }

  /* 640px: the tool rows collapse well before the app-wide 820px
     breakpoint — component-local layout, not an app tier. */
  @media (max-width: 640px) {
    .tool-row {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .tool-version {
      grid-column: 2;
      text-align: left;
    }
  }
  .tool-path { font-family: var(--app-font-mono); font-size: 11px; color: var(--app-text-muted); margin: 2px 0 4px 24px; word-break: break-all; }
  .used-by { font-size: 11px; color: var(--app-text-muted); margin: 4px 0 0 24px; line-height: 1.55; }
  .badge {
    display: inline-block;
    padding: 0 6px;
    border-radius: 3px;
    font-size: 10px;
    font-weight: 600;
    margin-right: 4px;
    text-transform: uppercase;
    letter-spacing: 0.3px;
  }
  .badge.required { background: var(--app-error-bg); color: var(--app-error-text); }
  .badge.optional { background: var(--app-info-bg); color: var(--app-info-text); }
  .install-btn {
    margin: 8px 0 0 24px; padding: 5px 12px; font-size: 12px; border-radius: 4px;
    border-width: 1px; border-style: solid; cursor: pointer;
  }
  .install-btn:disabled { opacity: 0.6; cursor: not-allowed; }
  .install-error { margin: 6px 0 0 24px; font-size: 11px; color: var(--app-error-text); white-space: pre-wrap; font-family: var(--app-font-mono); }
  .install-hint { margin: 6px 0 0 24px; font-size: 11px; }
  .install-hint summary { cursor: pointer; color: var(--app-info-text); }
  .install-hint pre {
    background: var(--app-surface-sunken);
    padding: 8px;
    border-radius: 4px;
    margin: 6px 0 0;
    color: var(--app-text-secondary);
    font-family: var(--app-font-mono);
    font-size: 11px;
    white-space: pre-wrap;
  }
  .install-note { font-size: 11px; color: var(--app-text-muted); margin: 0 0 6px; }

  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding: 16px 0 0;
    margin-top: 8px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions .ghost {
    background: transparent;
    border: 1px solid var(--app-border);
    color: var(--app-text-muted);
    font-size: 12px;
    padding: 5px 10px;
    border-radius: 6px;
    cursor: pointer;
  }
  .actions .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>

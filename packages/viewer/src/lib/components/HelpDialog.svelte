<script lang="ts">
  import { isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import { trapFocus } from "$lib/a11y";

  interface ToolStatus {
    name: string;
    bin: string;
    found: boolean;
    path?: string;
    version?: string;
    usedBy: Array<{ feature: string; severity: "required" | "optional" }>;
    installHint: string;
  }
  interface Diagnostics {
    libVersion: string;
    viewerVersion: string;
    webUiVersion: string | null;
    electronVersion: string;
    chromeVersion: string;
    platform: { os: string; arch: string; release: string; node: string };
    tools: ToolStatus[];
    docsUrl: string;
  }

  let {
    open = $bindable(false),
    onClose,
    triggerEl,
    onCheckForUpdates,
    checkingUpdates = false,
    updateReadyVersion = null,
  }: {
    open?: boolean;
    onClose?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
    /** Relocated from the toolbar: triggers the manual web-UI update check. */
    onCheckForUpdates?: () => void;
    checkingUpdates?: boolean;
    updateReadyVersion?: string | null;
  } = $props();

  let data = $state<Diagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  async function load() {
    loading = true;
    error = null;
    try {
      if (!isDesktop()) {
        error = "Electron bridge unavailable — run via the viewer app (not vite dev in a browser).";
        return;
      }
      data = (await api.doctor()) as Diagnostics;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      queueMicrotask(() => dialogEl?.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled])')?.focus());
      if (!data && !loading) load();
    }
  });

  function close() {
    open = false;
    onClose?.();
    triggerEl?.focus();
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
      `print-md viewer ${data.viewerVersion}  ·  web-ui ${data.webUiVersion ?? "—"}`,
      `lib ${data.libVersion}  ·  electron ${data.electronVersion}  ·  chromium ${data.chromeVersion}  ·  node ${data.platform.node}`,
      `platform: ${osLabel(data.platform.os)} ${data.platform.arch} (${data.platform.release})`,
      ``,
      `Tools:`,
      ...data.tools.map((t) => {
        const status = t.found ? `✓ ${t.version ?? "(no version)"} @ ${t.path ?? "?"}` : `✗ NOT FOUND`;
        return `  ${t.name} (${t.bin})  —  ${status}`;
      }),
    ];
    navigator.clipboard.writeText(lines.join("\n"));
    copied = true;
    setTimeout(() => { copied = false; }, 1500);
  }

  function openDocs() {
    if (isDesktop() && data) api.shell.openExternal(data.docsUrl).catch(() => {});
  }

  const isMac = $derived(data?.platform?.os === 'darwin');
  const modKey = $derived(isMac ? 'Cmd' : 'Ctrl');

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

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div bind:this={dialogEl} class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1" onkeydown={(e) => trapFocus(e, dialogEl)}>
    <header class="dialog-header">
      <div class="dialog-title-group">
        <h2 id="help-title">About Print MD</h2>
        {#if data?.webUiVersion}
          <span class="web-ui-version">v{data.webUiVersion}</span>
        {/if}
      </div>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      {#if loading}
        <p class="status">Checking system…</p>
      {:else if error}
        <p class="status error">{error}</p>
        <button class="primary" onclick={load}>Retry</button>
      {:else if data}
        <section class="getting-started">
          <h3>Getting Started</h3>
          <ol class="steps">
            <li><strong>Open your project folder</strong> — click <em>Open</em> in the toolbar and choose the folder that contains your <code>print-md.yaml</code> file.</li>
            <li><strong>Browse your document</strong> — use the arrow keys or Page Up/Down to flip through pages. Use <em>Single / Two-page</em> to switch between one page and two pages side by side.</li>
            <li><strong>Edit your pages</strong> — click <em>Edit</em> (or press {modKey}+E) to open the markdown editor beside the preview. Your changes are saved automatically as you type.</li>
            <li><strong>Keep a history of your work</strong> — click <em>History</em> and choose <em>Enable Version History</em> to keep a record of changes on this computer. Snapshots are then saved automatically as you work; use <em>Save Snapshot</em> to name important moments, and <em>Restore Version</em> to return to any earlier snapshot.</li>
            <li><strong>Save as PDF</strong> — click <em>Save PDF</em> (or press {modKey}+S) when your layout looks right.</li>
          </ol>
          <p class="gs-note">Don't have a project yet? Visit the <button class="inline-link" onclick={openDocs}>online setup guide</button> to create one.</p>
        </section>

        <section class="online-copy">
          <h3>Work with an Online Copy</h3>
          <ul class="steps">
            <li><strong>Open from GitHub</strong> — click <em>Open</em>, then <em>Open from GitHub…</em> to connect your GitHub account, choose a repository, and download a copy of the project to your computer.</li>
            <li><strong>Sync Changes</strong> — when your project has an online copy, click <em>Sync</em> to send your latest work to it. If you're offline, your work stays saved on this computer and it will sync when you're back online. If your copy and the online copy both changed, print-md lists each file that differs and lets you choose: keep your version, use the online version, or keep both copies.</li>
            <li><strong>Other hosting services</strong> — if your project lives somewhere other than GitHub, open the <em>More</em> menu and choose <em>Advanced setup</em> to connect a Git server (such as Gitea or Forgejo).</li>
          </ul>
        </section>

        {#if isDesktop() && onCheckForUpdates}
          <section class="updates">
            <h3>Updates</h3>
            <p class="updates-note">
              {#if updateReadyVersion}
                An update (v{updateReadyVersion}) is ready to apply — close this dialog and use the banner at the top of the window.
              {:else}
                print-md keeps its interface up to date automatically. You can also check now.
              {/if}
            </p>
            <button
              class="update-check"
              onclick={() => onCheckForUpdates?.()}
              disabled={checkingUpdates}
            >
              <span class="update-check-icon" class:spinning={checkingUpdates}><Icon name="refresh-cw" /></span>
              {checkingUpdates ? "Checking for updates…" : "Check for updates"}
            </button>
          </section>
        {/if}

        <section class="shortcuts">
          <h3>Keyboard Shortcuts</h3>
          <table>
            <thead>
              <tr><th>Action</th><th>Keys</th></tr>
            </thead>
            <tbody>
              <tr><td>Navigate pages</td><td>← → Arrow keys, Page Up/Down</td></tr>
              <tr><td>First / Last page</td><td>Home / End</td></tr>
              <tr><td>Zoom in / out</td><td>+ / -</td></tr>
              <tr><td>Fit to width</td><td>F</td></tr>
              <tr><td>Open folder</td><td>{modKey}+O</td></tr>
              <tr><td>Toggle editor</td><td>{modKey}+E</td></tr>
              <tr><td>Save PDF</td><td>{modKey}+S</td></tr>
              <tr><td>Settings</td><td>{modKey}+,</td></tr>
            </tbody>
          </table>
        </section>

        <details class="system-info">
          <summary>System info &amp; tool status</summary>

        <section class="versions">
          <div><strong>Viewer:</strong> {data.viewerVersion}</div>
          <div><strong>Web UI:</strong> {data.webUiVersion ?? "—"}</div>
          <div><strong>Lib:</strong> {data.libVersion}</div>
          <div>
            <strong>Runtime:</strong>
            Electron {data.electronVersion} · Chromium {data.chromeVersion} · Node {data.platform.node}
          </div>
          <div>
            <strong>Platform:</strong>
            {osLabel(data.platform.os)} {data.platform.arch} ({data.platform.release})
          </div>
        </section>

        <section class="tools">
          <h3>Optional system tools</h3>
          <p class="hint">
            print-md renders your preview using the built-in browser engine. The standard <strong>Save PDF</strong> feature needs no extra tools. The optional <strong>pre-press PDF export</strong> (for professional print shops) additionally needs Ghostscript and qpdf.
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
                  <details class="install-hint">
                    <summary>Install</summary>
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
        </details>

        <footer class="actions">
          <button class="ghost" onclick={copyReport} title="Copy system info to clipboard — useful when asking for support">
            {copied ? "Copied!" : "Copy diagnostic info"}
          </button>
          <button class="ghost" onclick={openDocs}>View setup guide</button>
          <button class="primary" onclick={close}>Close</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<svelte:window
  onkeydown={(e) => {
    if (e.key === "Escape" && open) close();
  }}
/>

<style>
  .backdrop {
    position: fixed;
    inset: 0;
    background: var(--app-backdrop);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(720px, 92vw);
    max-height: 88vh;
    background: var(--app-surface);
    color: var(--app-text-secondary);
    border-radius: 8px;
    box-shadow: 0 14px 40px var(--app-shadow-lg);
    z-index: 1001;
    display: flex;
    flex-direction: column;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
  }
  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 14px 18px;
    border-bottom: 1px solid var(--app-border-subtle);
  }
  .dialog-title-group { display: flex; align-items: baseline; gap: 10px; }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .web-ui-version { font-size: 11px; color: var(--app-text-faint); font-weight: 400; white-space: nowrap; }
  .close {
    background: transparent;
    border: 1px solid transparent;
    border-radius: 5px;
    color: var(--app-text-muted);
    line-height: 1;
    cursor: pointer;
    padding: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    /* WCAG 2.5.8: minimum target size 24x24px */
    min-width: 28px;
    min-height: 28px;
  }
  .close:focus-visible { outline: 2px solid var(--app-focus-ring); outline-offset: 2px; }
  .close:hover { color: var(--app-text); background: var(--app-surface-hover); }
  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
  }
  .status { margin: 8px 0; }
  .status.error { color: var(--app-error-text); font-family: ui-monospace, monospace; font-size: 12px; }

  /* Getting Started + Work with an Online Copy sections (same treatment) */
  .getting-started, .online-copy { margin-bottom: 18px; }
  .getting-started h3, .online-copy h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .steps { margin: 0 0 10px; padding-left: 20px; font-size: 13px; line-height: 1.6; color: var(--app-text-secondary); }
  .steps li { margin-bottom: 6px; }
  .steps code { font-family: ui-monospace, monospace; color: var(--app-code-text); background: var(--app-code-bg); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .gs-note { margin: 0; font-size: 12px; color: var(--app-text-faint); }
  .inline-link { background: none; border: none; color: var(--app-link); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; text-underline-offset: 2px; }
  .inline-link:hover { color: var(--app-link-hover); }

  /* System info collapsible */
  .system-info { margin-top: 8px; }
  .system-info > summary { cursor: pointer; font-size: 12px; color: var(--app-text-faint); user-select: none; padding: 6px 0; list-style: none; }
  .system-info > summary::-webkit-details-marker { display: none; }
  .system-info > summary::before { content: "▶ "; font-size: 10px; }
  .system-info[open] > summary::before { content: "▼ "; }
  .system-info > summary:hover { color: var(--app-text-muted); }

  /* Updates section (relocated from toolbar) */
  .updates { margin-bottom: 18px; }
  .updates h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .updates-note { margin: 0 0 10px; font-size: 12px; color: var(--app-text-faint); line-height: 1.5; }
  .update-check {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 6px;
    cursor: pointer;
    background: transparent;
    color: var(--app-text-muted);
    border: 1px solid var(--app-border);
  }
  .update-check:hover:not(:disabled) { background: var(--app-surface-hover); color: var(--app-text); }
  .update-check:disabled { opacity: 0.6; cursor: not-allowed; }
  .update-check-icon { display: inline-flex; }
  .update-check-icon.spinning :global(svg) { animation: help-update-spin 1s linear infinite; }
  @keyframes help-update-spin { to { transform: rotate(360deg); } }

  .shortcuts { margin-bottom: 18px; }
  .shortcuts h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .shortcuts table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .shortcuts td { padding: 5px 8px; }
  .shortcuts tr:nth-child(even) td { background: var(--app-surface-raised); }
  .shortcuts td:last-child { font-family: ui-monospace, monospace; color: var(--app-code-text); }
  .shortcuts th { text-align: left; padding: 5px 8px; font-size: 11px; text-transform: uppercase; color: var(--app-text-faint); letter-spacing: 0.3px; border-bottom: 1px solid var(--app-border-subtle); }
  .versions { font-size: 13px; line-height: 1.7; margin-bottom: 18px; }
  .versions strong { color: var(--app-text-muted); font-weight: 500; min-width: 80px; display: inline-block; }
  .tools h3 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .tools .hint { font-size: 12px; color: var(--app-text-faint); margin: 0 0 12px; }
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
    color: var(--app-text-faint);
    font-family: ui-monospace, monospace;
    font-size: 12px;
    overflow-wrap: anywhere;
    text-align: right;
  }
  @media (max-width: 640px) {
    .tool-row {
      grid-template-columns: auto minmax(0, 1fr);
    }
    .tool-version {
      grid-column: 2;
      text-align: left;
    }
  }
  .tool-path { font-family: ui-monospace, monospace; font-size: 11px; color: var(--app-text-faint); margin: 2px 0 4px 24px; word-break: break-all; }
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
  .install-hint { margin: 6px 0 0 24px; font-size: 11px; }
  .install-hint summary { cursor: pointer; color: var(--app-info-text); }
  .install-hint pre {
    background: var(--app-surface-sunken);
    padding: 8px;
    border-radius: 4px;
    margin: 6px 0 0;
    color: var(--app-text-secondary);
    font-family: ui-monospace, monospace;
    font-size: 11px;
    white-space: pre-wrap;
  }
  .install-note { font-size: 11px; color: var(--app-text-muted); margin: 0 0 6px; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    margin-top: 8px;
    border-top: 1px solid var(--app-border-subtle);
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions .primary { background: var(--app-focus-ring); color: var(--app-text-on-accent); }
  .actions .primary:hover { background: var(--app-accent-hover); }
  .actions .ghost { background: transparent; color: var(--app-text-muted); border-color: var(--app-border); }
  .actions .ghost:hover { background: var(--app-surface-hover); color: var(--app-text); }
</style>

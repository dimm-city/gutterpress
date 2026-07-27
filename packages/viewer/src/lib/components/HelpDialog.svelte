<script lang="ts">
  import { isDesktop } from "$lib/platform";
  import { api } from "$lib/api";
  import type { DoctorDiagnostics } from "$lib/api";
  import Icon from "$lib/components/Icon.svelte";
  import { dialogBehavior } from "$lib/dialog";
  import type { UpdaterAvailableAction } from "$lib/platform";

  let {
    open = $bindable(false),
    onClose,
    triggerEl,
    onCheckForUpdates,
    checkingUpdates = false,
    updateReadyVersion = null,
    updateAvailableVersion = null,
    updateAvailableAction = null,
  }: {
    open?: boolean;
    onClose?: () => void;
    triggerEl?: HTMLButtonElement | undefined;
    /** Relocated from the toolbar: triggers the manual update check. */
    onCheckForUpdates?: () => void;
    checkingUpdates?: boolean;
    updateReadyVersion?: string | null;
    updateAvailableVersion?: string | null;
    updateAvailableAction?: UpdaterAvailableAction | null;
  } = $props();

  let data = $state<DoctorDiagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);

  async function load() {
    loading = true;
    error = null;
      try {
        if (!isDesktop()) {
        error = "Desktop system details are only available in the viewer app.";
        return;
      }
      data = await api.doctor();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  function loadOnOpen(_el: HTMLElement) {
    if (!data && !loading) load();
  }

  function close() {
    // Focus restoration to `triggerEl` is handled by the dialogBehavior action.
    open = false;
    onClose?.();
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
      `print-md viewer ${data.viewerVersion}`,
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
  <div class="dlg-backdrop" onclick={close} role="presentation"></div>

  <div class="dlg-shell" use:dialogBehavior={{ onClose: close, triggerEl, labelledBy: "help-title" }} use:loadOnOpen>
    <header class="dlg-header">
      <div class="dialog-title-group">
        <h2 id="help-title">About Print MD</h2>
      </div>
      <button class="dlg-close" onclick={close} title="Close (Esc)" aria-label="Close"><Icon name="x" size={16} /></button>
    </header>

    <div class="dialog-body">
      {#if loading}
        <p class="status">Checking system…</p>
      {:else if error}
        <p class="status error">{error}</p>
        <button class="dlg-primary app-btn-primary dlg-retry" onclick={load}>Retry</button>
      {:else if data}
        <section class="version-strip" aria-label="Loaded versions">
          <div><strong>Viewer:</strong> {data.viewerVersion}</div>
          <div><strong>Lib:</strong> {data.libVersion}</div>
        </section>

        <section class="getting-started">
          <h3>Getting Started</h3>
          <ol class="steps">
            <li><strong>Open your project folder</strong> — click <em>Open</em> in the toolbar and choose the folder that contains your <code>manifest.yaml</code> file.</li>
            <li><strong>Browse your document</strong> — use the arrow keys or Page Up/Down to flip through pages. Use <em>Single / Two-page</em> to switch between one page and two pages side by side.</li>
            <li><strong>Edit your pages</strong> — click <em>Edit</em> (or press {modKey}+E) to open the markdown editor beside the preview. Your changes auto-save, and {modKey}+S or the editor save button saves immediately.</li>
            <li><strong>Keep a history of your work</strong> — click the sync/status pill to see your project's saved history and activity log.</li>
            <li><strong>Export PDF</strong> — click <em>Export</em> (or press {modKey}+Shift+E) when your layout looks right.</li>
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
              {:else if updateAvailableVersion}
                An update (v{updateAvailableVersion}) is available — close this dialog and use the banner at the top of the window to {updateAvailableAction === "open-release" ? "download it from GitHub" : "download it"}.
              {:else}
                print-md checks for updates automatically. You can also check now.
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
              <tr><td>Navigate pages</td><td>Left / Right arrow keys, Page Up/Down</td></tr>
              <tr><td>First / Last page</td><td>Home / End</td></tr>
              <tr><td>Zoom in / out</td><td>+ / -</td></tr>
              <tr><td>Fit to width</td><td>F</td></tr>
              <tr><td>Open folder</td><td>{modKey}+O</td></tr>
              <tr><td>Toggle editor</td><td>{modKey}+E</td></tr>
              <tr><td>Focus mode (editor only)</td><td>{modKey}+Shift+F</td></tr>
              <tr><td>Save source edits</td><td>{modKey}+S</td></tr>
              <tr><td>Export PDF</td><td>{modKey}+Shift+E</td></tr>
              <tr><td>Settings</td><td>{modKey}+,</td></tr>
            </tbody>
          </table>
        </section>

        <details class="system-info">
          <summary><span class="summary-marker" aria-hidden="true"><Icon name="chevron-right" size={11} /></span>System info &amp; tool status</summary>

        <section class="versions">
          <div><strong>Viewer:</strong> {data.viewerVersion}</div>
          <div><strong>Lib:</strong> {data.libVersion}</div>
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
            print-md renders your preview using the built-in browser engine. The standard <strong>Export</strong> feature needs no extra tools. The optional <strong>pre-press PDF export</strong> (for professional print shops) additionally needs Ghostscript and qpdf.
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

        <footer class="dlg-actions">
          <button class="dlg-ghost" onclick={copyReport} title="Copy system info to clipboard — useful when asking for support">
            {copied ? "Copied!" : "Copy diagnostic info"}
          </button>
          <button class="dlg-ghost" onclick={openDocs}>View setup guide</button>
          <button class="dlg-primary app-btn-primary" onclick={close}>Close</button>
        </footer>
      {/if}
    </div>
  </div>
{/if}

<style>
  @import "$lib/styles/dialog-shell.css";

  /* Help/About is the widest dialog (versions, tables, tool lists). */
  .dlg-shell {
    width: min(720px, 92vw);
    max-height: 88vh;
  }
  /* Footer is the last item INSIDE the scrolling body here, not a pinned
     sibling — restore its original in-flow spacing (see SettingsView for
     the same note). */
  .dlg-actions {
    padding: 16px 0 0;
    margin-top: 8px;
  }
  .dialog-title-group { display: flex; align-items: baseline; gap: 10px; }
  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
  }
  .status { margin: 8px 0; }
  .status.error { color: var(--app-error-text); font-family: var(--app-font-mono); font-size: 12px; }

  /* Getting Started + Work with an Online Copy sections (same treatment) */
  .getting-started, .online-copy { margin-bottom: 18px; }
  .getting-started h3, .online-copy h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .steps { margin: 0 0 10px; padding-left: 20px; font-size: 13px; line-height: 1.6; color: var(--app-text-secondary); }
  .steps li { margin-bottom: 6px; }
  .steps code { font-family: var(--app-font-mono); color: light-dark(#2b4a6f, #99aabb); background: light-dark(#e8edf5, #2a3040); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .gs-note { margin: 0; font-size: 12px; color: var(--app-text-muted); }
  .inline-link { background: none; border: none; color: var(--app-link); cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; text-underline-offset: 2px; }
  .inline-link:hover { color: var(--app-link-hover); }

  .version-strip {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: 8px;
    margin: 0 0 18px;
  }
  .version-strip > div {
    padding: 8px 10px;
    border-radius: 6px;
    background: var(--app-surface-raised);
    font-size: 12px;
    color: var(--app-text-secondary);
  }
  .version-strip strong {
    display: block;
    margin-bottom: 2px;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--app-text-muted);
  }

  /* System info collapsible */
  .system-info { margin-top: 8px; }
  .system-info > summary { cursor: pointer; font-size: 12px; color: var(--app-text-muted); user-select: none; padding: 6px 0; list-style: none; }
  .system-info > summary::-webkit-details-marker { display: none; }
  /* Disclosure marker is an inline SVG chevron that rotates when open (the
     old "▶"/"▼" content glyphs are banned — see no-glyph-chrome.test.ts). */
  .summary-marker { display: inline-flex; margin-right: 4px; vertical-align: -1px; transition: transform 0.12s ease-out; }
  .system-info[open] > summary .summary-marker { transform: rotate(90deg); }
  .system-info > summary:hover { color: var(--app-text-muted); }

  /* Updates section (relocated from toolbar) */
  .updates { margin-bottom: 18px; }
  .updates h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.5px; }
  .updates-note { margin: 0 0 10px; font-size: 12px; color: var(--app-text-muted); line-height: 1.5; }
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
  .shortcuts td:last-child { font-family: var(--app-font-mono); color: light-dark(#2b4a6f, #99aabb); }
  .shortcuts th { text-align: left; padding: 5px 8px; font-size: 11px; text-transform: uppercase; color: var(--app-text-muted); letter-spacing: 0.3px; border-bottom: 1px solid var(--app-border-subtle); }
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
  /* In-body Retry sits outside the .dlg-actions footer — restate its geometry. */
  .dlg-retry {
    padding: 6px 14px; font-size: 13px; border-radius: 4px;
    border-width: 1px; border-style: solid; cursor: pointer;
  }

  /* 640px: this dialog's two-column shortcut table collapses well before the
     app-wide 820px breakpoint — dialog-local layout, not an app tier. */
  @media (max-width: 640px) {
    .version-strip {
      grid-template-columns: 1fr;
    }
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
</style>

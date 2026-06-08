<script lang="ts">
  import { getPlatform, isDesktop } from "$lib/platform";

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

  let { open = $bindable(false), onClose, triggerEl }: { open?: boolean; onClose?: () => void; triggerEl?: HTMLButtonElement | undefined } = $props();

  let data = $state<Diagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);
  let dialogEl = $state<HTMLDivElement | undefined>(undefined);

  function focusableElements() {
    return Array.from(
      dialogEl?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
      ) ?? []
    );
  }

  function focusFirstElement() {
    focusableElements()[0]?.focus();
  }

  function trapFocus(e: KeyboardEvent) {
    if (e.key !== "Tab") return;
    const focusable = focusableElements();
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  async function load() {
    loading = true;
    error = null;
    try {
      if (!isDesktop()) {
        error = "Electron bridge unavailable — run via the viewer app (not vite dev in a browser).";
        return;
      }
      data = (await getPlatform().doctor()) as Diagnostics;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open) {
      queueMicrotask(focusFirstElement);
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
    if (isDesktop() && data) getPlatform().openExternal(data.docsUrl).catch(() => {});
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

  <div bind:this={dialogEl} class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title" tabindex="-1" onkeydown={trapFocus}>
    <header class="dialog-header">
      <h2 id="help-title">Help &amp; About</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">&times;</button>
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
            <li><strong>Browse your document</strong> — use the arrow keys or Page Up/Down to flip through pages. Use <em>Page / Spread</em> to switch between single and two-page view.</li>
            <li><strong>Save as PDF</strong> — click <em>Save PDF</em> (or press {modKey}+S) when your layout looks right.</li>
          </ol>
          <p class="gs-note">Don't have a project yet? Visit the <button class="inline-link" onclick={openDocs}>online setup guide</button> to create one.</p>
        </section>

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
              <tr><td>Save PDF</td><td>{modKey}+S</td></tr>
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
    background: rgba(0, 0, 0, 0.55);
    z-index: 1000;
  }
  .dialog {
    position: fixed;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    width: min(720px, 92vw);
    max-height: 88vh;
    background: #1e1e1e;
    color: #e0e0e0;
    border-radius: 8px;
    box-shadow: 0 14px 40px rgba(0, 0, 0, 0.5);
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
    border-bottom: 1px solid #303030;
  }
  .dialog-header h2 { margin: 0; font-size: 16px; font-weight: 600; }
  .close {
    background: transparent;
    border: 0;
    color: #aaa;
    font-size: 22px;
    line-height: 1;
    cursor: pointer;
    padding: 0 4px;
  }
  .close:hover { color: #fff; }
  .dialog-body {
    padding: 16px 18px;
    overflow-y: auto;
  }
  .status { margin: 8px 0; }
  .status.error { color: #f08080; font-family: ui-monospace, monospace; font-size: 12px; }

  /* Getting Started section */
  .getting-started { margin-bottom: 18px; }
  .getting-started h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; }
  .steps { margin: 0 0 10px; padding-left: 20px; font-size: 13px; line-height: 1.6; color: #d0d0d0; }
  .steps li { margin-bottom: 6px; }
  .steps code { font-family: ui-monospace, monospace; color: #9ab; background: #2a3040; padding: 1px 5px; border-radius: 3px; font-size: 11px; }
  .gs-note { margin: 0; font-size: 12px; color: #888; }
  .inline-link { background: none; border: none; color: #6a9fd8; cursor: pointer; font-size: 12px; padding: 0; text-decoration: underline; text-underline-offset: 2px; }
  .inline-link:hover { color: #88c0f8; }

  /* System info collapsible */
  .system-info { margin-top: 8px; }
  .system-info > summary { cursor: pointer; font-size: 12px; color: #888; user-select: none; padding: 6px 0; list-style: none; }
  .system-info > summary::-webkit-details-marker { display: none; }
  .system-info > summary::before { content: "▶ "; font-size: 10px; }
  .system-info[open] > summary::before { content: "▼ "; }
  .system-info > summary:hover { color: #bbb; }

  .shortcuts { margin-bottom: 18px; }
  .shortcuts h3 { margin: 0 0 8px; font-size: 13px; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; }
  .shortcuts table { width: 100%; border-collapse: collapse; font-size: 12px; }
  .shortcuts td { padding: 5px 8px; }
  .shortcuts tr:nth-child(even) td { background: #262626; }
  .shortcuts td:last-child { font-family: ui-monospace, monospace; color: #88c0e0; }
  .shortcuts th { text-align: left; padding: 5px 8px; font-size: 11px; text-transform: uppercase; color: #666; letter-spacing: 0.3px; border-bottom: 1px solid #303030; }
  .versions { font-size: 13px; line-height: 1.7; margin-bottom: 18px; }
  .versions strong { color: #aaa; font-weight: 500; min-width: 80px; display: inline-block; }
  .tools h3 { margin: 0 0 6px; font-size: 13px; text-transform: uppercase; color: #aaa; letter-spacing: 0.5px; }
  .tools .hint { font-size: 12px; color: #888; margin: 0 0 12px; }
  .tools ul { list-style: none; margin: 0; padding: 0; }
  .tools li {
    padding: 10px 12px;
    border-radius: 6px;
    background: #262626;
    margin-bottom: 8px;
    font-size: 13px;
  }
  .tools li.found { border-left: 3px solid #4caf50; }
  .tools li.missing { border-left: 3px solid #f0a020; }
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
  .tools li.found .status-word { color: #4caf50; }
  .tools li.missing .status-word { color: #f0a020; }
  .tool-name {
    align-self: start;
    min-width: 0;
    font-weight: 600;
  }
  .tool-version {
    align-self: start;
    color: #888;
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
  .tool-path { font-family: ui-monospace, monospace; font-size: 11px; color: #6a6a6a; margin: 2px 0 4px 24px; word-break: break-all; }
  .used-by { font-size: 11px; color: #aaa; margin: 4px 0 0 24px; line-height: 1.55; }
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
  .badge.required { background: #5a2020; color: #f08080; }
  .badge.optional { background: #1f3a52; color: #88c0e0; }
  .install-hint { margin: 6px 0 0 24px; font-size: 11px; }
  .install-hint summary { cursor: pointer; color: #88c0e0; }
  .install-hint pre {
    background: #1a1a1a;
    padding: 8px;
    border-radius: 4px;
    margin: 6px 0 0;
    color: #d0d0d0;
    font-family: ui-monospace, monospace;
    font-size: 11px;
    white-space: pre-wrap;
  }
  .install-note { font-size: 11px; color: #aaa; margin: 0 0 6px; }
  .actions {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
    padding-top: 16px;
    margin-top: 8px;
    border-top: 1px solid #303030;
  }
  .actions button {
    padding: 6px 14px;
    font-size: 13px;
    border-radius: 4px;
    cursor: pointer;
    border: 1px solid transparent;
  }
  .actions .primary { background: #3a6fb5; color: #fff; }
  .actions .primary:hover { background: #4882d4; }
  .actions .ghost { background: transparent; color: #aaa; border-color: #404040; }
  .actions .ghost:hover { background: #262626; color: #fff; }
</style>

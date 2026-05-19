<script lang="ts">
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
    electronVersion: string;
    chromeVersion: string;
    platform: { os: string; arch: string; release: string; node: string };
    tools: ToolStatus[];
    docsUrl: string;
  }

  let { open = $bindable(false), onClose }: { open?: boolean; onClose?: () => void } = $props();

  let data = $state<Diagnostics | null>(null);
  let loading = $state(false);
  let error = $state<string | null>(null);
  let copied = $state(false);

  async function load() {
    loading = true;
    error = null;
    try {
      const electron = (window as any).electron;
      if (!electron?.doctor) {
        error = "Electron bridge unavailable — run via the viewer app (not vite dev in a browser).";
        return;
      }
      data = (await electron.doctor()) as Diagnostics;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    if (open && !data && !loading) load();
  });

  function close() {
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
    const electron = (window as any).electron;
    if (electron?.openExternal && data) electron.openExternal(data.docsUrl);
  }
</script>

{#if open}
  <div class="backdrop" onclick={close} role="presentation"></div>

  <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="help-title">
    <header class="dialog-header">
      <h2 id="help-title">About print-md</h2>
      <button class="close" onclick={close} title="Close (Esc)" aria-label="Close">&times;</button>
    </header>

    <div class="dialog-body">
      {#if loading}
        <p class="status">Checking system…</p>
      {:else if error}
        <p class="status error">{error}</p>
        <button class="primary" onclick={load}>Retry</button>
      {:else if data}
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
        </section>

        <section class="tools">
          <h3>System tools</h3>
          <p class="hint">
            Tools print-md may spawn at build time. Required tools must be present for the
            corresponding feature; optional tools just degrade gracefully.
          </p>
          <ul>
            {#each data.tools as t (t.bin)}
              <li class:found={t.found} class:missing={!t.found}>
                <div class="tool-row">
                  <span class="status-icon">{t.found ? "✓" : "✗"}</span>
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
                    <span class="badge {u.severity}">{u.severity}</span>
                    <span>{u.feature}</span><br />
                  {/each}
                </div>
                {#if !t.found}
                  <details class="install-hint">
                    <summary>Install</summary>
                    <pre>{t.installHint}</pre>
                  </details>
                {/if}
              </li>
            {/each}
          </ul>
        </section>

        <footer class="actions">
          <button class="ghost" onclick={copyReport}>
            {copied ? "Copied!" : "Copy report"}
          </button>
          <button class="ghost" onclick={openDocs}>Open system requirements doc</button>
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
  .tool-row { display: flex; gap: 10px; align-items: baseline; }
  .status-icon { width: 14px; text-align: center; }
  .tools li.found .status-icon { color: #4caf50; }
  .tools li.missing .status-icon { color: #f0a020; }
  .tool-name { flex: 0 0 auto; font-weight: 600; }
  .tool-version { color: #888; font-family: ui-monospace, monospace; font-size: 12px; }
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

<script lang="ts">
  let previewUrl = $state<string | null>(null);
  let currentDir = $state<string | null>(null);
  let busy = $state(false);
  let error = $state<string | null>(null);

  async function openFolder() {
    busy = true;
    error = null;
    try {
      // For dev (no Electron): use the prompt fallback so the route is testable
      // in a regular browser. The Electron preload will replace this with a
      // native dialog.
      const electron = (window as any).electron;
      let dir: string | null;
      if (electron?.openDirectory) {
        dir = await electron.openDirectory();
      } else {
        dir = prompt("Path to a print-md project directory");
      }
      if (!dir) {
        busy = false;
        return;
      }
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: dir }),
      });
      if (!res.ok) {
        const msg = await res.text();
        throw new Error(`Failed to start preview: ${res.status} ${msg}`);
      }
      const data = await res.json();
      currentDir = dir;
      previewUrl = data.url;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="shell">
  <header class="toolbar">
    <button onclick={openFolder} disabled={busy}>
      {busy ? "Loading…" : "Open folder"}
    </button>
    <span class="path">{currentDir ?? "No folder selected"}</span>
  </header>

  {#if error}
    <div class="error">{error}</div>
  {/if}

  {#if previewUrl}
    <iframe src={previewUrl} title="Preview" />
  {:else}
    <div class="empty">Open a folder to begin.</div>
  {/if}
</div>

<style>
  :global(html, body) {
    margin: 0;
    height: 100%;
    background: #1e1e1e;
    color: #eee;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  }
  .shell {
    display: flex;
    flex-direction: column;
    height: 100vh;
  }
  .toolbar {
    display: flex;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 56px;
    background: linear-gradient(to bottom, #252525, #1e1e1e);
    border-bottom: 1px solid #3a3a3a;
  }
  button {
    background: #0066cc;
    color: white;
    border: 0;
    padding: 8px 14px;
    border-radius: 6px;
    cursor: pointer;
    font-weight: 600;
  }
  button:disabled { opacity: 0.5; cursor: wait; }
  .path { color: #9ca3af; font-size: 13px; }
  .error { padding: 12px 16px; background: #4a1a1a; color: #fbb; }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: #888;
  }
  iframe {
    flex: 1;
    width: 100%;
    border: 0;
  }
</style>

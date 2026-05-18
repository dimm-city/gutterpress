<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import { PreviewClient } from "$lib/preview-client";

  // Per-screen state
  let previewUrl = $state<string | null>(null);
  let currentDir = $state<string | null>(null);
  let busy = $state(false);
  let busyLabel = $state("");
  let error = $state<string | null>(null);
  let info = $state<string | null>(null);

  // Frame state
  let client = $state<PreviewClient | null>(null);
  let currentPage = $state(1);
  let totalPages = $state(0);
  let pageInput = $state(1);
  let zoom = $state<string>("fit-width");
  let twoColumn = $state(false);
  let debug = $state(false);
  let bgColor = $state("#5a5a5a");
  let rendering = $state(true);

  // Hook PreviewClient events when it appears.
  $effect(() => {
    if (!client) return;
    const off = client.on((e) => {
      if (e.name === "renderingComplete") {
        rendering = false;
        totalPages = e.detail.totalPages ?? 0;
      } else if (e.name === "pageChanged") {
        currentPage = e.detail.currentPage ?? 1;
        pageInput = currentPage;
        totalPages = e.detail.totalPages ?? totalPages;
      } else if (e.name === "ready") {
        rendering = true;
        // Tiny delay; previewAPI is available but pages may not be paginated yet.
        client?.call<number>("getTotalPages").then((n) => {
          if (n > 0) {
            totalPages = n;
            rendering = false;
          }
        }).catch(() => {});
      }
    });
    return off;
  });

  async function openFolder() {
    busy = true;
    busyLabel = "Opening folder…";
    error = null;
    info = null;
    try {
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
      busyLabel = "Starting preview…";
      const res = await fetch("/api/preview", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ input: dir }),
      });
      if (!res.ok) throw new Error(`Preview start failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      currentDir = dir;
      previewUrl = null; // force iframe remount
      await Promise.resolve();
      previewUrl = data.url;
      rendering = true;
      totalPages = 0;
      currentPage = 1;
      pageInput = 1;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  async function savePdf() {
    if (!currentDir) {
      error = "Open a folder first.";
      return;
    }
    busy = true;
    busyLabel = "Building PDF…";
    error = null;
    info = null;
    try {
      const electron = (window as any).electron;
      let outPath: string | null;
      const defaultName = (currentDir.split("/").pop() ?? "book") + ".pdf";
      if (electron?.savePdf) {
        outPath = await electron.savePdf(defaultName);
      } else {
        outPath = prompt("Save PDF to:", "/tmp/" + defaultName);
      }
      if (!outPath) {
        busy = false;
        return;
      }
      const res = await fetch("/api/build", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          input: currentDir,
          format: "pdf",
          out: outPath,
          skipPreValidate: true,
          skipPostValidate: true,
        }),
      });
      if (!res.ok) throw new Error(`Build failed: ${res.status} ${await res.text()}`);
      const data = await res.json();
      info = `PDF saved to ${data.pdfPath ?? outPath}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  function gotoPage(n: number) {
    if (!client) return;
    client.call("goToPage", [n]).catch(() => {});
  }
  function firstPage() { client?.call("firstPage").catch(() => {}); }
  function prevPage() { client?.call("prevPage").catch(() => {}); }
  function nextPage() { client?.call("nextPage").catch(() => {}); }
  function lastPage() { client?.call("lastPage").catch(() => {}); }

  function applyZoom(value: string) {
    zoom = value;
    if (!client) return;
    if (value === "fit-width") {
      // Compute scale from iframe width / page width (approx).
      // For the spike, just set 1 and let CSS handle it.
      client.call("setZoom", [1]).catch(() => {});
    } else {
      client.call("setZoom", [Number(value)]).catch(() => {});
    }
  }

  function toggleTwoColumn() {
    twoColumn = !twoColumn;
    client?.call("setViewMode", [twoColumn ? "two-column" : "single"]).catch(() => {});
  }

  function toggleDebug() {
    debug = !debug;
    client?.call("toggleDebugMode").catch(() => {});
  }

  function onBgColor(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    bgColor = v;
    client?.setBgColor(v);
  }
</script>

<div class="shell">
  <header class="toolbar">
    <section class="left">
      <button class="primary" onclick={openFolder} disabled={busy} title="Open folder">
        📁 Open
      </button>
      <span class="path" title={currentDir ?? ""}>{currentDir ?? "No folder selected"}</span>
    </section>

    <section class="center">
      <button onclick={firstPage} disabled={!previewUrl || rendering}>⏮</button>
      <button onclick={prevPage} disabled={!previewUrl || rendering}>◀</button>
      <input type="number" min="1" max={totalPages || 1} bind:value={pageInput}
             onchange={() => gotoPage(pageInput)} disabled={!previewUrl || rendering} />
      <span class="status">/ {totalPages || "—"}</span>
      <button onclick={nextPage} disabled={!previewUrl || rendering}>▶</button>
      <button onclick={lastPage} disabled={!previewUrl || rendering}>⏭</button>
    </section>

    <section class="right">
      <button class:active={twoColumn} onclick={toggleTwoColumn} disabled={!previewUrl} title="Two-column view">
        ▥
      </button>
      <select bind:value={zoom} onchange={() => applyZoom(zoom)} disabled={!previewUrl}>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="fit-width">Fit</option>
      </select>
      <button class:active={debug} onclick={toggleDebug} disabled={!previewUrl} title="Debug">
        🔲
      </button>
      <label class="bg-swatch" title="Background color">
        <input type="color" value={bgColor} oninput={onBgColor} />
      </label>
      <button class="primary" onclick={savePdf} disabled={busy || !currentDir} title="Save as PDF">
        💾 Save PDF
      </button>
    </section>
  </header>

  {#if error}
    <div class="banner err">{error}</div>
  {/if}
  {#if info}
    <div class="banner ok">{info}</div>
  {/if}
  {#if busy && busyLabel}
    <div class="banner busy">{busyLabel}</div>
  {/if}

  {#if previewUrl}
    {#key previewUrl}
      <PreviewFrame url={previewUrl} bind:client />
    {/key}
  {:else}
    <div class="empty">
      <p>Open a folder containing markdown files to begin.</p>
    </div>
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
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 12px;
    padding: 0 16px;
    height: 56px;
    background: linear-gradient(to bottom, #252525, #1e1e1e);
    border-bottom: 1px solid #3a3a3a;
  }
  section { display: flex; align-items: center; gap: 8px; }
  .left { justify-self: start; min-width: 0; }
  .center { justify-self: center; }
  .right { justify-self: end; }

  button, select, input[type="number"] {
    background: #3a3a3a;
    border: 1px solid #4a4a4a;
    color: #e0e0e0;
    padding: 6px 12px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
  }
  button.primary {
    background: linear-gradient(to bottom, #0077dd, #0066cc);
    border-color: #0055aa;
    color: #fff;
    font-weight: 600;
  }
  button.active {
    background: linear-gradient(to bottom, #0077dd, #0066cc);
    border-color: #0055aa;
    color: #fff;
  }
  button:disabled, select:disabled, input:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  input[type="number"] { width: 56px; text-align: center; }
  .status { color: #9ca3af; font-size: 12px; }
  .path {
    color: #9ca3af;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 360px;
  }
  .bg-swatch { display: inline-block; cursor: pointer; }
  .bg-swatch input { width: 32px; height: 28px; padding: 0; border-radius: 6px; border: 1px solid #4a4a4a; background: none; }
  .banner {
    padding: 10px 16px;
    font-size: 13px;
  }
  .banner.err { background: #4a1a1a; color: #fbb; }
  .banner.ok { background: #1a4a1a; color: #bfb; }
  .banner.busy { background: #1a2a4a; color: #bcd; }
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: #888;
  }
</style>

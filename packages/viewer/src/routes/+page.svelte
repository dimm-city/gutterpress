<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
  import { PreviewClient } from "$lib/preview-client";
  import { buildViewerStyles, DEBUG_STYLES } from "$lib/iframe-styles";

  // Per-screen state
  let previewUrl = $state<string | null>(null);
  let currentDir = $state<string | null>(null);
  let docTitle = $state<string | null>(null);
  let busy = $state(false);
  let busyLabel = $state("");

  // Frame state
  let client = $state<PreviewClient | undefined>(undefined);
  let currentPage = $state(1);
  let totalPages = $state(0);
  let pageInput = $state(1);
  let zoom = $state<string>("fit-width");
  let viewMode = $state<"single" | "two-column">("two-column");
  let debug = $state(false);
  let bgColor = $state("#5a5a5a");
  let rendering = $state(false);

  // Toast controller (populated by Toast.svelte via bind:api)
  let toast = $state<ToastController | null>(null);
  let userSetViewMode = $state(false);

  // ----------------------------------------------------------------
  // Inject viewer canvas styles into iframe when client + bgColor change
  // ----------------------------------------------------------------
  $effect(() => {
    if (!client) return;
    // Inject once on client attach; renderingComplete will re-inject with final bg
    client.injectStyles("viewer-canvas", buildViewerStyles(bgColor));
  });

  // ----------------------------------------------------------------
  // Hook PreviewClient events when it appears
  // ----------------------------------------------------------------
  $effect(() => {
    if (!client) return;
    const off = client.on((e) => {
      if (e.name === "renderingComplete") {
        const n = e.detail.totalPages ?? 0;
        totalPages = n;
        rendering = false;
        // Inject canvas styles now that Paged.js is done
        client?.injectStyles("viewer-canvas", buildViewerStyles(bgColor));
        client?.injectStyles("debug", DEBUG_STYLES);
        // Set initial view mode (auto if user hasn't chosen)
        const auto = window.innerWidth < 1280 ? "single" : "two-column";
        const mode = userSetViewMode ? viewMode : auto;
        applyViewMode(mode, false);
        // Apply fit-width zoom on narrow screens
        if (window.innerWidth < 1280) {
          applyFitWidthZoom();
        } else {
          client?.call("setZoom", [zoom === "fit-width" ? 1 : Number(zoom)]).catch(() => {});
        }
        toast?.success(`${n} pages loaded`);
      } else if (e.name === "pageChanged") {
        currentPage = e.detail.currentPage ?? 1;
        pageInput = currentPage;
        totalPages = e.detail.totalPages ?? totalPages;
      } else if (e.name === "ready") {
        rendering = true;
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

  // ----------------------------------------------------------------
  // Keyboard shortcuts
  // ----------------------------------------------------------------
  $effect(() => {
    if (!previewUrl) return;

    function onKey(e: KeyboardEvent) {
      // Don't intercept when focus is in an input/textarea/select
      const tag = (e.target as HTMLElement)?.tagName ?? "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
          e.preventDefault();
          nextPage();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          prevPage();
          break;
        case "Home":
          e.preventDefault();
          firstPage();
          break;
        case "End":
          e.preventDefault();
          lastPage();
          break;
        case "+":
        case "=":
          e.preventDefault();
          stepZoom(0.25);
          break;
        case "-":
          e.preventDefault();
          stepZoom(-0.25);
          break;
        case "f":
        case "F":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            applyZoom("fit-width");
          }
          break;
        case "d":
        case "D":
          if (!e.ctrlKey && !e.metaKey) {
            e.preventDefault();
            toggleDebug();
          }
          break;
      }
    }

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // ----------------------------------------------------------------
  // Responsive auto view-mode on resize (unless user locked it)
  // ----------------------------------------------------------------
  $effect(() => {
    if (!previewUrl) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    function onResize() {
      if (userSetViewMode) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const auto = window.innerWidth < 1280 ? "single" : "two-column";
        applyViewMode(auto, false);
      }, 150);
    }
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      if (timer) clearTimeout(timer);
    };
  });

  // ----------------------------------------------------------------
  // Actions
  // ----------------------------------------------------------------

  async function openFolder() {
    busy = true;
    busyLabel = "Opening folder…";
    try {
      const electron = (window as any).electron;
      if (!electron?.openDirectory || !electron?.startPreview) {
        toast?.error("Electron bridge unavailable — run via the viewer app");
        return;
      }
      const dir = await electron.openDirectory();
      if (!dir) return;
      busyLabel = "Starting preview…";
      const data = await electron.startPreview({ input: dir });
      currentDir = dir;
      docTitle = data.title ?? null;
      // Force iframe remount by nulling first
      previewUrl = null;
      await Promise.resolve();
      previewUrl = data.url;
      rendering = true;
      totalPages = 0;
      currentPage = 1;
      pageInput = 1;
      userSetViewMode = false;
    } catch (e) {
      toast?.error(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  async function savePdf() {
    if (!currentDir) {
      toast?.error("Open a folder first.");
      return;
    }
    busy = true;
    busyLabel = "Building PDF…";
    try {
      const electron = (window as any).electron;
      if (!electron?.savePdf || !electron?.build) {
        toast?.error("Electron bridge unavailable — run via the viewer app");
        return;
      }
      const sep = currentDir.includes("\\") ? "\\" : "/";
      const defaultName = (currentDir.split(sep).pop() ?? "book") + ".pdf";
      const outPath = await electron.savePdf(defaultName);
      if (!outPath) return;
      const data = await electron.build({
        input: currentDir,
        format: "pdf",
        out: outPath,
        // pre/post validate skipped for now (they require external tools
        // like qpdf, pdfinfo, etc that aren't bundled with the viewer).
        // Lint stays ON — stylelint + stylelint-config-standard are
        // production deps of the lib so they ship; lint catches real
        // CSS problems before PDF gen.
        skipPreValidate: true,
        skipPostValidate: true,
      });
      toast?.success(`PDF saved to ${data.pdfPath ?? outPath}`);
    } catch (e) {
      toast?.error(e instanceof Error ? e.message : String(e));
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  function gotoPage(n: number) {
    if (!client || rendering) return;
    client.call("goToPage", [n]).catch(() => {});
  }
  function firstPage() { if (client && !rendering) client.call("firstPage").catch(() => {}); }
  function prevPage() { if (client && !rendering) client.call("prevPage").catch(() => {}); }
  function nextPage() { if (client && !rendering) client.call("nextPage").catch(() => {}); }
  function lastPage() { if (client && !rendering) client.call("lastPage").catch(() => {}); }

  /** Apply fit-width by querying the page's rendered width from the iframe. */
  async function applyFitWidthZoom() {
    if (!client) return;
    try {
      const iframe = document.querySelector<HTMLIFrameElement>("iframe");
      const containerWidth = iframe?.clientWidth ?? window.innerWidth;
      const dims = await client.call<{ width: number; height: number } | null>("getPageDimensions");
      const pageWidth = dims?.width ?? 0;
      const scale = pageWidth > 0 && pageWidth > containerWidth
        ? (containerWidth - 32) / pageWidth
        : 1;
      await client.call("setZoom", [scale]);
    } catch {
      await client.call("setZoom", [1]).catch(() => {});
    }
  }

  function applyZoom(value: string) {
    zoom = value;
    if (!client) return;
    if (value === "fit-width") {
      applyFitWidthZoom();
    } else {
      client.call("setZoom", [Number(value)]).catch(() => {});
    }
  }

  function stepZoom(delta: number) {
    const current = zoom === "fit-width" ? 1 : parseFloat(zoom) || 1;
    const next = Math.max(0.25, Math.min(4, current + delta));
    applyZoom(String(Math.round(next * 100) / 100));
  }

  function applyViewMode(mode: "single" | "two-column", fromUser: boolean) {
    viewMode = mode;
    if (fromUser) userSetViewMode = true;
    client?.call("setViewMode", [mode]).catch(() => {});
  }

  function toggleViewMode() {
    applyViewMode(viewMode === "single" ? "two-column" : "single", true);
  }

  function toggleDebug() {
    debug = !debug;
    client?.call("toggleDebugMode").catch(() => {});
  }

  function onBgColor(e: Event) {
    const v = (e.target as HTMLInputElement).value;
    bgColor = v;
    client?.setBgColor(v);
    // Re-inject canvas styles with new bg (covers elements Paged.js strips)
    client?.injectStyles("viewer-canvas", buildViewerStyles(v));
  }
</script>

<Toast bind:api={toast} />
<LoadingOverlay visible={rendering || (busy && !!busyLabel)} label={busyLabel || "Rendering…"} />

<div class="shell">
  <header class="toolbar">
    <section class="left">
      <button class="primary" onclick={openFolder} disabled={busy} title="Open folder (Ctrl+O)">
        Open
      </button>
      {#if docTitle}
        <span class="doc-title" title={docTitle}>{docTitle}</span>
      {/if}
      <span class="path" title={currentDir ?? ""}>{currentDir ?? "No folder selected"}</span>
    </section>

    <section class="center">
      <button class="icon-btn" onclick={firstPage} disabled={!previewUrl || rendering} title="First page (Home)">&#8676;</button>
      <button class="icon-btn" onclick={prevPage} disabled={!previewUrl || rendering} title="Previous page (Left/PageUp)">&#9664;</button>
      <input
        type="number"
        class="page-input"
        min="1"
        max={totalPages || 1}
        bind:value={pageInput}
        onchange={() => gotoPage(pageInput)}
        onkeydown={(e) => e.key === "Enter" && gotoPage(pageInput)}
        disabled={!previewUrl || rendering}
      />
      <span class="status">/ {totalPages || "—"}</span>
      <button class="icon-btn" onclick={nextPage} disabled={!previewUrl || rendering} title="Next page (Right/PageDown)">&#9654;</button>
      <button class="icon-btn" onclick={lastPage} disabled={!previewUrl || rendering} title="Last page (End)">&#8677;</button>
    </section>

    <section class="right">
      <button
        class="icon-btn"
        class:active={viewMode === "single"}
        onclick={() => applyViewMode("single", true)}
        disabled={!previewUrl}
        title="Single page view"
      >1</button>
      <button
        class="icon-btn"
        class:active={viewMode === "two-column"}
        onclick={() => applyViewMode("two-column", true)}
        disabled={!previewUrl}
        title="Two-column (spread) view"
      >2</button>
      <select
        class="zoom-select"
        bind:value={zoom}
        onchange={() => applyZoom(zoom)}
        disabled={!previewUrl}
        title="Zoom level (+ / - keys)"
      >
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
        <option value="fit-width">Fit (F)</option>
      </select>
      <button
        class="icon-btn"
        class:active={debug}
        onclick={toggleDebug}
        disabled={!previewUrl}
        title="Toggle debug mode (D)"
      >DBG</button>
      <label class="bg-swatch" title="Background color">
        <input type="color" value={bgColor} oninput={onBgColor} />
      </label>
      <button class="primary save-btn" onclick={savePdf} disabled={busy || !currentDir} title="Save as PDF">
        Save PDF
      </button>
    </section>
  </header>

  {#if previewUrl}
    {#key previewUrl}
      <PreviewFrame
        url={previewUrl}
        bind:client
        onError={(msg) => toast?.error(msg)}
      />
    {/key}
  {:else}
    <div class="empty">
      <p>Open a folder containing markdown files to begin.</p>
      <p class="hint">Use the Open button above or press Ctrl+O.</p>
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
    overflow: hidden;
  }

  /* ---- Toolbar ---- */
  .toolbar {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    align-items: center;
    gap: 8px;
    padding: 0 12px;
    height: 56px;
    flex-shrink: 0;
    background: linear-gradient(to bottom, #252525, #1e1e1e);
    border-bottom: 1px solid #3a3a3a;
    overflow: hidden;
  }

  section { display: flex; align-items: center; gap: 6px; min-width: 0; }
  .left { justify-self: start; overflow: hidden; }
  .center { justify-self: center; flex-shrink: 0; }
  .right { justify-self: end; flex-shrink: 0; }

  /* ---- Buttons & inputs ---- */
  button, select {
    background: #3a3a3a;
    border: 1px solid #4a4a4a;
    color: #e0e0e0;
    padding: 5px 10px;
    border-radius: 6px;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    white-space: nowrap;
  }
  button:hover:not(:disabled) {
    background: #444;
    border-color: #5a5a5a;
  }
  button.primary {
    background: linear-gradient(to bottom, #0077dd, #0066cc);
    border-color: #0055aa;
    color: #fff;
    font-weight: 600;
  }
  button.primary:hover:not(:disabled) {
    background: linear-gradient(to bottom, #0088ee, #0077dd);
  }
  button.active {
    background: linear-gradient(to bottom, #0077dd, #0066cc);
    border-color: #0055aa;
    color: #fff;
  }
  button:disabled, select:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .icon-btn { padding: 5px 8px; }

  .page-input {
    background: #3a3a3a;
    border: 1px solid #4a4a4a;
    color: #e0e0e0;
    padding: 5px 4px;
    border-radius: 6px;
    font-size: 13px;
    width: 52px;
    text-align: center;
  }
  .page-input:disabled { opacity: 0.4; }

  .zoom-select { padding: 5px 6px; }

  .status { color: #9ca3af; font-size: 12px; white-space: nowrap; }

  .doc-title {
    color: #ddd;
    font-size: 13px;
    font-weight: 600;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 200px;
    flex-shrink: 1;
  }

  .path {
    color: #888;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
    flex-shrink: 2;
  }

  .bg-swatch { display: inline-block; cursor: pointer; flex-shrink: 0; }
  .bg-swatch input {
    width: 32px;
    height: 28px;
    padding: 0;
    border-radius: 6px;
    border: 1px solid #4a4a4a;
    background: none;
    cursor: pointer;
  }

  /* ---- Empty state ---- */
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: #888;
    text-align: center;
  }
  .empty p { margin: 4px 0; }
  .hint { font-size: 12px; color: #666; }

  /* ---- Responsive breakpoints ---- */
  @media screen and (max-width: 1200px) {
    .doc-title { max-width: 140px; }
    .path { max-width: 180px; }
  }
  @media screen and (max-width: 900px) {
    .doc-title { display: none; }
    .path { max-width: 140px; }
    .save-btn { display: none; }
  }
  @media screen and (max-width: 700px) {
    .path { display: none; }
    .zoom-select { display: none; }
  }
  @media screen and (max-width: 520px) {
    .toolbar { grid-template-columns: auto 1fr; }
    .right { display: none; }
  }
</style>

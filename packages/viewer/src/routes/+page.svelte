<script lang="ts">
  import PreviewFrame from "$lib/components/PreviewFrame.svelte";
  import Toast from "$lib/components/Toast.svelte";
  import type { ToastController } from "$lib/components/Toast.svelte";
  import LoadingOverlay from "$lib/components/LoadingOverlay.svelte";
  import HelpDialog from "$lib/components/HelpDialog.svelte";
  import OpenUrlDialog from "$lib/components/OpenUrlDialog.svelte";
  import Icon from "$lib/components/Icon.svelte";
  import { PreviewClient } from "$lib/preview-client";
  import { buildViewerStyles, DEBUG_STYLES } from "$lib/iframe-styles";

  // Per-screen state
  let previewUrl = $state<string | null>(null);
  let currentDir = $state<string | null>(null);
  let currentUrl = $state<string | null>(null);
  let sourceMode = $state<"folder" | "url">("folder");
  let docTitle = $state<string | null>(null);
  // Folder name (basename) for the toolbar label; the full path is the tooltip.
  let folderName = $derived(
    currentDir ? (currentDir.split(/[\\/]/).filter(Boolean).pop() ?? currentDir) : ""
  );
  let busy = $state(false);
  let busyLabel = $state("");
  let openUrlOpen = $state(false);
  // PDF export runs in a separate render window, so the UI stays usable — track
  // it separately with a NON-blocking status pill instead of the modal overlay.
  let exporting = $state(false);
  let pdfProgress = $state<string | null>(null);

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
  let helpOpen = $state(false);
  let userSetViewMode = $state(false);
  let openError = $state<string | null>(null);

  // UX-026: focus-restoration references for Help and URL dialogs
  let helpBtn = $state<HTMLButtonElement | undefined>(undefined);
  let urlBtn = $state<HTMLButtonElement | undefined>(undefined);

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
        // UX-011: improved success toast copy
        toast?.success(`Your book is ready — ${n} ${n === 1 ? 'page' : 'pages'}`);
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

      // UX-006: Ctrl/Cmd+S saves PDF
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        savePdf();
        return;
      }

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
        // UX-004: 'D' shortcut for debug removed — non-technical writers should
        // not accidentally trigger debug mode.
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

  function friendlyFolderError(msg: string): string {
    if (/manifest|print-md\.yaml|No such file/i.test(msg)) {
      return "This doesn't look like a print-md project — we couldn't find a print-md.yaml file. Make sure you're opening the right folder.";
    }
    if (/ENOENT|not found/i.test(msg)) {
      return "The folder couldn't be read. Check that it exists and you have permission to open it.";
    }
    if (/permission|EACCES/i.test(msg)) {
      return "Permission denied. Check that you have access to this folder.";
    }
    return "Something went wrong opening this folder. Try again, or choose a different folder.";
  }

  function friendlyPdfError(e: unknown): string {
    const msg = e instanceof Error ? e.message : String(e);
    const code = (e as any)?.code ?? "";
    if (code === "BUILD_ERROR") {
      const firstLine = msg.split("\n")[0]?.trim() ?? msg;
      return `PDF generation failed: ${firstLine}. Open Help (?) for setup details.`;
    }
    if (code === "TOOL_MISSING") {
      const match = msg.match(/Required system tool not found: ([^\n]+)/);
      const tool = match?.[1]?.trim() ?? "a required tool";
      return `PDF export needs "${tool}" installed. Open Help (?) → System tools to see how to install it.`;
    }
    if (/chrome|chromium|browser/i.test(msg)) {
      return "PDF export needs a browser (Chrome or Edge) installed. Open Help (?) for setup details.";
    }
    if (/ENOENT|not found/i.test(msg)) {
      return "Could not find a required program. Open Help (?) → System tools to check what needs to be installed.";
    }
    if (/permission|EACCES/i.test(msg)) {
      return "Permission denied saving the PDF. Try saving to a different folder (like your Desktop).";
    }
    return "PDF export failed. Open Help (?) → System tools to check for issues.";
  }

  async function openFolder() {
    openError = null;
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
      sourceMode = "folder";
      currentDir = dir;
      currentUrl = null;
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
      // Loud signal for the #1 cause of wrong fonts/styles: shared asset dirs
      // (e.g. ../dc-design-guide/fonts) that don't resolve next to this project.
      const missing = data.missingSharedAssets ?? [];
      if (missing.length > 0) {
        toast?.error(
          `Shared asset folder(s) not found — fonts/styles may be wrong: ${missing.join(", ")}. ` +
            `Make sure the shared directory exists next to this project.`
        );
      }
    } catch (e) {
      previewUrl = null;
      currentDir = null;
      docTitle = null;
      rendering = false;
      openError = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
      busyLabel = "";
    }
  }

  function openUrl(url: string) {
    openError = null;
    sourceMode = "url";
    currentUrl = url;
    currentDir = null;
    docTitle = null;
    // Force iframe remount by nulling first
    previewUrl = null;
    queueMicrotask(() => {
      previewUrl = url;
      rendering = false;
      totalPages = 0;
      currentPage = 1;
      pageInput = 1;
    });
  }

  function openInBrowser() {
    if (!currentUrl) return;
    const electron = (window as any).electron;
    electron?.openExternal?.(currentUrl);
  }

  async function savePdf() {
    if (sourceMode !== "folder" || !currentDir) {
      toast?.error("Open a folder first — PDF export is disabled for URL sources.");
      return;
    }
    const electron = (window as any).electron;
    if (!electron?.savePdf || !electron?.build) {
      toast?.error("Electron bridge unavailable — run via the viewer app");
      return;
    }
    const sep = currentDir.includes("\\") ? "\\" : "/";
    const defaultName = (currentDir.split(sep).pop() ?? "book") + ".pdf";
    const outPath = await electron.savePdf(defaultName);
    if (!outPath) return;

    // Non-blocking: the build runs in a separate render window, so keep the
    // preview interactive and show progress in a corner pill (not the overlay).
    exporting = true;
    pdfProgress = "Preparing PDF…";
    let offProgress: (() => void) | undefined;
    try {
      // Live progress: Paged.js pagination of large books takes minutes, so show
      // the growing page count instead of an opaque spinner.
      offProgress = electron.onBuildProgress?.(
        (p: { phase: "rendering" | "finalizing"; pages: number }) => {
          pdfProgress =
            p.phase === "finalizing"
              ? `Finalizing PDF (${p.pages} pages)…`
              : `Rendering page ${p.pages}…`;
        }
      );
      const data = await electron.build({
        input: currentDir,
        format: "pdf",
        out: outPath,
        // Validation is skipped for the quick "Save PDF" action by design —
        // it's a fast RGB export, not the full preflight. (Most checks now run
        // in-process and need no system tools; the full validated/PDF-X pipeline
        // is available via the CLI or the Docker image.) Lint stays ON — the
        // in-process PostCSS print-safety checks catch real CSS problems before
        // PDF gen.
        skipPreValidate: true,
        skipPostValidate: true,
      });
      toast?.success(`PDF saved to ${data.pdfPath ?? outPath}`);
    } catch (e) {
      toast?.error(friendlyPdfError(e));
    } finally {
      offProgress?.();
      exporting = false;
      pdfProgress = null;
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

<!-- Non-blocking PDF export progress: a corner pill that leaves the preview
     fully interactive (the build runs in a separate render window). -->
{#if exporting && pdfProgress}
  <div class="export-pill" role="status" aria-live="polite">
    <span class="export-spinner" aria-hidden="true"></span>
    <span class="export-label">{pdfProgress}</span>
  </div>
{/if}

<div class="shell">
  <header class="toolbar">
    <section class="left">
      <button class="primary icon-text" onclick={openFolder} disabled={busy} title="Open folder (Ctrl+O)">
        <Icon name="folder-open" />
        <span>Open</span>
      </button>
      <!-- UX-016: renamed "URL" → "Web" for clarity; UX-026: bind:this for focus restore -->
      <button bind:this={urlBtn} class="icon-text" onclick={() => (openUrlOpen = true)} disabled={busy} title="Preview a published document from a web address">
        <Icon name="link" />
        <span>Web</span>
      </button>
      {#if sourceMode === "url" && currentUrl}
        {#if docTitle}
          <span class="doc-title" title={docTitle}>{docTitle}</span>
        {/if}
        <span class="path" title={currentUrl}>{currentUrl}</span>
        <button class="icon-btn" onclick={openInBrowser} title="Open in browser" aria-label="Open in browser">
          <Icon name="external-link" />
        </button>
      {:else if currentDir}
        <!-- Folder source: show the title/name; full path is the hover tooltip. -->
        <span class="doc-title" title={currentDir}>{docTitle || folderName}</span>
      {:else}
        <span class="path">No source selected</span>
      {/if}
    </section>

    <!-- UX-012: center nav only shows when a document is loaded -->
    {#if previewUrl}
      <section class="center">
        <button class="icon-btn" onclick={firstPage} disabled={rendering} title="First page (Home)" aria-label="First page">
          <Icon name="chevrons-left" />
        </button>
        <button class="icon-btn" onclick={prevPage} disabled={rendering} title="Previous page (Left/PageUp)" aria-label="Previous page">
          <Icon name="chevron-left" />
        </button>
        <!-- UX-029: accessible label and describedby for page input -->
        <input
          type="number"
          class="page-input"
          min="1"
          max={totalPages || 1}
          bind:value={pageInput}
          onchange={() => gotoPage(pageInput)}
          onkeydown={(e) => e.key === "Enter" && gotoPage(pageInput)}
          disabled={rendering}
          aria-label="Go to page"
          aria-describedby="page-total"
        />
        <!-- UX-031: #b8c0cc for WCAG AA; UX-029: id for aria-describedby -->
        <span class="status" id="page-total">/ {totalPages || "—"}</span>
        <button class="icon-btn" onclick={nextPage} disabled={rendering} title="Next page (Right/PageDown)" aria-label="Next page">
          <Icon name="chevron-right" />
        </button>
        <button class="icon-btn" onclick={lastPage} disabled={rendering} title="Last page (End)" aria-label="Last page">
          <Icon name="chevrons-right" />
        </button>
        <!-- UX-037: persistent page count badge -->
        {#if totalPages > 0}
          <span class="page-count-badge">{totalPages} pages</span>
        {/if}
      </section>
    {/if}

    <section class="right">
      <!-- UX-039: separator before view mode buttons -->
      <span class="toolbar-sep" aria-hidden="true"></span>
      <!-- UX-014: text labels + aria-pressed on view mode buttons -->
      <button
        class="icon-text"
        class:active={viewMode === "single"}
        onclick={() => applyViewMode("single", true)}
        disabled={!previewUrl}
        title="Single page view (Page)"
        aria-label="Single page view"
        aria-pressed={viewMode === "single"}
      >
        <Icon name="rectangle-vertical" /><span class="view-label">Page</span>
      </button>
      <button
        class="icon-text"
        class:active={viewMode === "two-column"}
        onclick={() => applyViewMode("two-column", true)}
        disabled={!previewUrl}
        title="Two-page spread view (Spread)"
        aria-label="Two-page spread view"
        aria-pressed={viewMode === "two-column"}
      >
        <Icon name="columns-2" /><span class="view-label">Spread</span>
      </button>
      <select
        class="zoom-select"
        bind:value={zoom}
        onchange={() => applyZoom(zoom)}
        disabled={!previewUrl}
        title="Zoom level — F for fit width, + / - to zoom in and out"
      >
        <!-- UX-015: fit-width first, renamed to "Fit width" -->
        <option value="fit-width">Fit width</option>
        <option value="0.25">25%</option>
        <option value="0.5">50%</option>
        <option value="0.75">75%</option>
        <option value="1">100%</option>
        <option value="1.25">125%</option>
        <option value="1.5">150%</option>
        <option value="2">200%</option>
      </select>
      <!-- UX-005: labeled canvas color picker -->
      <div class="bg-swatch-wrapper">
        <span class="bg-label">Canvas</span>
        <label class="bg-swatch" title="Change the preview canvas color — does not affect your PDF">
          <input type="color" value={bgColor} oninput={onBgColor} />
        </label>
      </div>
      <!-- UX-004: debug button removed from toolbar -->
      <!-- UX-039: separator before Save PDF -->
      <span class="toolbar-sep" aria-hidden="true"></span>
      <!-- UX-006: Save PDF always visible; icon-only at narrow widths -->
      <button
        class="primary save-btn icon-text"
        onclick={savePdf}
        disabled={busy || exporting || !currentDir || sourceMode === "url"}
        title="Save as PDF (Ctrl+S)"
      >
        <Icon name="file-down" />
        <span class="save-btn-label">{exporting ? "Saving…" : "Save PDF"}</span>
      </button>
      <!-- UX-023: explain why Save PDF is disabled -->
      {#if !currentDir && !busy}
        <span class="save-hint">Open a folder first</span>
      {:else if sourceMode === "url"}
        <span class="save-hint">Not available for web previews</span>
      {/if}
      <!-- UX-026: bind:this for focus restore -->
      <button
        bind:this={helpBtn}
        class="icon-btn"
        onclick={() => (helpOpen = true)}
        title="Help / About"
        aria-label="Help and system info"
      >
        <Icon name="circle-help" />
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
      <div class="empty-hero">
        <div class="empty-icon" aria-hidden="true">📖</div>
        <h1 class="empty-title">print-md</h1>
        <p class="empty-tagline">Turn your markdown writing into a print-ready book</p>
        <button class="primary empty-cta" onclick={openFolder} disabled={busy}>Open Your Book Folder</button>
        <p class="empty-hint">Your project folder needs a <code>print-md.yaml</code> file and your <code>.md</code> chapter files.</p>
        <button class="ghost-link" onclick={() => (openUrlOpen = true)}>Or preview from a web address →</button>
        {#if openError}
          <div class="open-error" role="alert">
            <strong>Couldn't open that folder.</strong>
            <p>{friendlyFolderError(openError)}</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}
</div>

<HelpDialog bind:open={helpOpen} triggerEl={helpBtn} />
<OpenUrlDialog bind:open={openUrlOpen} onOpen={openUrl} triggerEl={urlBtn} />


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

  /* ---- Non-blocking PDF export progress pill ---- */
  .export-pill {
    position: fixed;
    right: 16px;
    bottom: 16px;
    z-index: 50;
    display: flex;
    align-items: center;
    gap: 10px;
    max-width: 320px;
    padding: 10px 14px;
    border-radius: 8px;
    background: rgba(30, 30, 30, 0.95);
    border: 1px solid #3a3a3a;
    box-shadow: 0 4px 16px rgba(0, 0, 0, 0.4);
    color: #eee;
    font-size: 13px;
    /* Informational only — never intercept clicks/scroll on the preview. */
    pointer-events: none;
  }
  .export-spinner {
    width: 14px;
    height: 14px;
    flex: 0 0 auto;
    border: 2px solid #555;
    border-top-color: #4c9ffe;
    border-radius: 50%;
    animation: export-spin 0.8s linear infinite;
  }
  .export-label {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  @keyframes export-spin {
    to { transform: rotate(360deg); }
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

  .icon-btn {
    padding: 5px 8px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }
  /* Combo button: icon + label text side by side */
  .icon-text {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }
  .icon-text :global(svg) { flex: 0 0 auto; }

  /* UX-014: small text label under/beside view mode icon */
  .view-label { font-size: 11px; }

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

  /* UX-031: #b8c0cc meets WCAG AA on dark background */
  .status { color: #b8c0cc; font-size: 12px; white-space: nowrap; }

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

  /* UX-031: #a8a8a8 for better contrast */
  .path {
    color: #a8a8a8;
    font-size: 12px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 260px;
    flex-shrink: 2;
  }

  /* UX-005: labeled canvas color picker wrapper */
  .bg-swatch-wrapper {
    display: flex;
    align-items: center;
    gap: 4px;
    flex-shrink: 0;
  }
  .bg-label { font-size: 11px; color: #aaa; white-space: nowrap; }
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

  /* UX-039: visual separator between toolbar groups */
  .toolbar-sep {
    width: 1px;
    height: 20px;
    background: #404040;
    margin: 0 4px;
    flex-shrink: 0;
  }

  /* UX-023: hint below Save PDF when disabled */
  .save-hint {
    font-size: 11px;
    color: #888;
    white-space: nowrap;
  }

  /* UX-037: persistent page count badge */
  .page-count-badge {
    font-size: 11px;
    color: #9ab;
    background: #2a3040;
    padding: 2px 7px;
    border-radius: 10px;
    white-space: nowrap;
    margin-left: 4px;
  }

  /* ---- Empty state / welcome hero ---- */
  .empty {
    flex: 1;
    display: grid;
    place-items: center;
    color: #888;
    text-align: center;
  }
  .empty-hero {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    max-width: 400px;
    text-align: center;
    padding: 32px 24px;
  }
  .empty-icon { font-size: 48px; line-height: 1; margin-bottom: 4px; }
  .empty-title { margin: 0; font-size: 22px; font-weight: 700; color: #e0e0e0; letter-spacing: -0.3px; }
  .empty-tagline { margin: 0; font-size: 14px; color: #aaa; line-height: 1.5; }
  .empty-cta { padding: 10px 24px; font-size: 14px; font-weight: 600; border-radius: 8px; margin-top: 4px; }
  .empty-hint { margin: 0; font-size: 12px; color: #777; line-height: 1.5; }
  .empty-hint code {
    font-family: ui-monospace, monospace;
    color: #9ab;
    background: #2a3040;
    padding: 1px 5px;
    border-radius: 3px;
  }
  .ghost-link {
    background: transparent;
    border: none;
    color: #6a9fd8;
    font-size: 12px;
    cursor: pointer;
    padding: 0;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .ghost-link:hover { color: #88c0f8; }
  .open-error {
    background: #3a1a1a;
    border: 1px solid #5a2d2d;
    border-radius: 6px;
    padding: 10px 14px;
    font-size: 12px;
    color: #fca5a5;
    max-width: 340px;
    text-align: left;
    line-height: 1.5;
  }
  .open-error strong { display: block; margin-bottom: 4px; font-size: 13px; }
  .open-error p { margin: 0; color: #f0a0a0; }

  /* ---- Responsive breakpoints ---- */
  @media screen and (max-width: 1200px) {
    .doc-title { max-width: 140px; }
    .path { max-width: 180px; }
  }
  @media screen and (max-width: 900px) {
    .doc-title { display: none; }
    .path { max-width: 140px; }
    /* UX-006: hide Save PDF text label at 900px, keep button as icon-only */
    .save-btn-label { display: none; }
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

// ============================================================================
// Preview Client for print-md (Vite + Build Watch Architecture)
// ============================================================================
//
// REFACTORED VERSION:
// - Toolbar UI controls (folder selection, page navigation, zoom, view mode)
// - Uses iframe's previewAPI directly via same-origin access
// - NO state duplication - iframe is source of truth
// - Listens to iframe events for page changes
//
// Architecture:
// - Preview server serves content via Vite with HMR
// - Iframe contains Paged.js rendered content with previewAPI exposed on window
// - Parent window delegates all operations to iframe API
//
// ============================================================================

// ============================================================================
// Operating Mode
// ============================================================================
//
// `live`    a print-md server is backing the UI (preview command). API
//           routes for folder picker / GitHub clone / exit are reachable.
// `static`  the viewer is being served as plain files (GitHub Pages, S3,
//           file://). No API. Server-coupled buttons are hidden.
//
// Read once at module load — `<html data-mode="...">` is set by the build
// pipeline (`emitViewer` in src/lib/viewer.ts) or shipped as `live` for the
// preview server. Use documentElement (not document.body) so this works
// when the script is loaded from <head> non-defer — body doesn't exist yet
// at that point, but documentElement always does during head parsing.

const MODE =
  (typeof document !== "undefined" &&
    document.documentElement &&
    document.documentElement.dataset.mode) ||
  "live";
const IS_LIVE = MODE === "live";

// ============================================================================
// Client-Side State Management (Folder Selection Only)
// ============================================================================

const clientState = {
  currentFolder: "", // Absolute path to input directory (for folder selector)
};

// Track rendering timeout to prevent race conditions
let renderingTimeoutId = null;

// ============================================================================
// Notification Utilities
// ============================================================================

function showError(title, message) {
  console.error(`${title}: ${message}`);

  // Show toast notification if available
  if (typeof window.showToast === "function") {
    window.showToast(title, message, "error");
  }
}

function showSuccess(title, message) {
  console.log(`${title}: ${message}`);

  if (typeof window.showToast === "function") {
    window.showToast(title, message, "success");
  }
}

function showInfo(title, message) {
  console.log(`${title}: ${message}`);

  if (typeof window.showToast === "function") {
    window.showToast(title, message, "info");
  }
}

function updateLoadingMessage(message) {
  const loadingEl = document.getElementById("loading-message");
  if (loadingEl) {
    loadingEl.textContent = message;
  }
}

// ============================================================================
// Folder Selection Modal
// ============================================================================

/**
 * Folder navigation state
 */
let currentPath = "";
let folderHistory = [];

/**
 * Open folder selection modal
 */
async function openFolderModal() {
  const modal = document.getElementById("folder-modal");
  const overlay = document.getElementById("loading-overlay");

  modal.style.display = "flex";
  if (overlay) overlay.style.display = "none";

  // Reset GitHub state - we're in local folder selection mode
  githubState.selectedTargetDirectory = null;

  // Start navigation from current folder if available, otherwise fetch from server
  if (!currentPath) {
    // Fetch current directory from server (will return home if no path specified)
    try {
      const response = await fetch("/api/directories");
      const data = await response.json();
      currentPath = data.currentPath;
    } catch (error) {
      console.error("Failed to get current directory:", error);
      currentPath = ""; // Fallback
    }
  }

  folderHistory = [currentPath];
  loadFolderList(currentPath);
}

/**
 * Close folder selection modal
 */
function closeFolderModal() {
  const modal = document.getElementById("folder-modal");
  modal.style.display = "none";
}

/**
 * Load list of directories for given path
 */
async function loadFolderList(path) {
  try {
    const response = await fetch(
      `/api/directories?path=${encodeURIComponent(path)}`,
    );

    if (!response.ok) {
      throw new Error(`Failed to load directories: ${response.status}`);
    }

    const data = await response.json();
    currentPath = data.currentPath;

    // Update current path display
    const pathDisplay = document.getElementById("current-path-display");
    pathDisplay.textContent = currentPath;

    // Render folder list
    const folderList = document.getElementById("folder-list");
    folderList.innerHTML = "";

    // Add "parent directory" option if not at root
    if (data.parent) {
      const parentDiv = createFolderItem("..", data.parent, true);
      folderList.appendChild(parentDiv);
    }

    // Add subdirectories
    data.directories.forEach((dir) => {
      const itemDiv = createFolderItem(dir.name, dir.path, false);
      folderList.appendChild(itemDiv);
    });
  } catch (error) {
    console.error("Failed to load folder list:", error);
    showError(
      "Folder List Error",
      "Could not load directories. Check server logs.",
    );
  }
}

/**
 * Create folder list item element
 */
function createFolderItem(name, path, isParent) {
  const div = document.createElement("div");
  div.className = "folder-item";
  div.setAttribute("data-path", path);
  div.setAttribute("role", "listitem");
  div.setAttribute("tabindex", "0");

  const iconSvg = isParent
    ? `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m18 15-6-6-6 6"/></svg>`
    : `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z"/></svg>`;
  div.innerHTML = `
		<span class="folder-item-icon">${iconSvg}</span>
		<span class="folder-item-name">${name}</span>
	`;

  // Click or Enter to navigate
  div.addEventListener("click", () => loadFolderList(path));
  div.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      loadFolderList(path);
    }
  });

  return div;
}

/**
 * Switch to selected folder
 */
async function switchToFolder(path) {
  try {
    console.log(`Switching to folder: ${path}`);

    const response = await fetch("/api/change-folder", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path }),
    });

    if (!response.ok) {
      throw new Error(`Failed to switch folder: ${response.status}`);
    }

    const data = await response.json();

    // Update client state
    clientState.currentFolder = path;

    // Close modal
    closeFolderModal();

    // Show success message
    showSuccess("Folder Changed", `Now previewing: ${path}`);

    // Clear rendering timeout from previous session
    if (renderingTimeoutId) {
      clearTimeout(renderingTimeoutId);
      renderingTimeoutId = null;
    }

    // Disable print button while new content loads
    const printBtn = document.getElementById("btn-print");
    if (printBtn) {
      printBtn.disabled = true;
      printBtn.setAttribute("aria-label", "Print (disabled while rendering)");
    }

    // Reload iframe to show new folder content
    const iframe = document.getElementById("preview-iframe");
    if (iframe) {
      updateLoadingMessage("Loading new folder content...");
      iframe.src = iframe.src; // Trigger reload
    }
  } catch (error) {
    console.error("Failed to switch folder:", error);
    showError("Folder Switch Failed", error.message);
  }
}

// ============================================================================
// Iframe API Access - Direct same-origin communication
// ============================================================================

/**
 * Get iframe's content window (same-origin access)
 */
function getIframeWindow() {
  const iframe = document.getElementById("preview-iframe");
  if (iframe && iframe.contentWindow) {
    return iframe.contentWindow;
  }
  return null;
}

// No polling needed - iframe signals via events when ready

// ============================================================================
// Toolbar UI State Management
// ============================================================================

/**
 * Update page display in toolbar
 * Reads current state from iframe API
 */
function updatePageDisplay() {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.previewAPI) return;

  const api = iframeWin.previewAPI;

  const currentPage = api.getCurrentPage();
  const totalPages = api.getTotalPages();

  const pageInput = document.getElementById("page-input");
  const totalPagesEl = document.getElementById("total-pages");

  if (pageInput) {
    pageInput.value = currentPage;
    pageInput.max = totalPages;
  }

  if (totalPagesEl) {
    totalPagesEl.textContent = totalPages || "-";
  }

  // Update navigation button states
  updateNavigationButtons(currentPage, totalPages);
}

/**
 * Update navigation button enabled/disabled states
 */
function updateNavigationButtons(currentPage, totalPages) {
  const firstBtn = document.getElementById("btn-first");
  const prevBtn = document.getElementById("btn-prev");
  const nextBtn = document.getElementById("btn-next");
  const lastBtn = document.getElementById("btn-last");

  const isFirstPage = currentPage <= 1;
  const isLastPage = currentPage >= totalPages;

  if (firstBtn) firstBtn.disabled = isFirstPage;
  if (prevBtn) prevBtn.disabled = isFirstPage;
  if (nextBtn) nextBtn.disabled = isLastPage;
  if (lastBtn) lastBtn.disabled = isLastPage;
}

// ============================================================================
// Toolbar Event Handlers - Delegate to Iframe API
// ============================================================================

/**
 * Navigate to specific page via iframe API
 */
function goToPage(pageNum) {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.previewAPI) {
    showError(
      "Preview Not Ready",
      "Please wait for preview to finish loading.",
    );
    return;
  }

  iframeWin.previewAPI.goToPage(pageNum);
  // UI will be updated via pageChanged event from iframe
}

/**
 * Navigate to first page
 */
function goToFirstPage() {
  const iframeWin = getIframeWindow();
  if (iframeWin && iframeWin.previewAPI) {
    iframeWin.previewAPI.firstPage();
  }
}

/**
 * Navigate to previous page
 */
function goToPreviousPage() {
  const iframeWin = getIframeWindow();
  if (iframeWin && iframeWin.previewAPI) {
    iframeWin.previewAPI.prevPage();
  }
}

/**
 * Navigate to next page
 */
function goToNextPage() {
  const iframeWin = getIframeWindow();
  if (iframeWin && iframeWin.previewAPI) {
    iframeWin.previewAPI.nextPage();
  }
}

/**
 * Navigate to last page
 */
function goToLastPage() {
  const iframeWin = getIframeWindow();
  if (iframeWin && iframeWin.previewAPI) {
    iframeWin.previewAPI.lastPage();
  }
}

/**
 * Viewport width (px) at or below which the auto-mode picks single-page
 * layout. Above the breakpoint, auto-mode picks two-column.
 */
const VIEW_MODE_BREAKPOINT = 1280;

/**
 * Tracks whether the user has explicitly picked a view mode via the toolbar.
 * Once true, the resize listener stops second-guessing them.
 */
let userOverrodeViewMode = false;

/**
 * Pick the auto view mode for the current viewport.
 */
function autoViewModeForViewport() {
  return window.innerWidth < VIEW_MODE_BREAKPOINT ? "single" : "two-column";
}

/**
 * Change view mode (single/two-column) via iframe API.
 *
 * `source` defaults to "user" — clicking a toolbar button locks in the choice
 * and disables the resize-driven auto-switch. Pass "auto" from the resize
 * handler / initial render so the user's explicit pick is never overwritten.
 */
function setViewMode(mode, source = "user") {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.previewAPI) return;

  if (source === "user") {
    userOverrodeViewMode = true;
  }

  const api = iframeWin.previewAPI;

  // Update button states
  const singleBtn = document.getElementById("btn-single");
  const twoColumnBtn = document.getElementById("btn-two-column");

  if (singleBtn) {
    singleBtn.classList.toggle("active", mode === "single");
  }

  if (twoColumnBtn) {
    twoColumnBtn.classList.toggle("active", mode === "two-column");
  }

  // Apply view mode via API
  api.setViewMode(mode);
}

/**
 * Change zoom level via iframe API.
 * "fit-width" computes a scale so the page fills the iframe width; all other
 * values are passed directly to api.setZoom. The CSS in buildViewerStyleSheet
 * applies zoom via `zoom: var(--pmd-zoom)` — JS only supplies the number.
 */
function setZoom(zoom) {
  const iframeWin = getIframeWindow();
  if (!iframeWin?.previewAPI) return;

  let scale;
  if (zoom === "fit-width") {
    const iframeEl = document.getElementById("preview-iframe");
    const containerWidth = iframeEl ? iframeEl.clientWidth : window.innerWidth;
    const page = iframeWin.document.querySelector(".pagedjs_page");
    const pageWidth = page ? page.offsetWidth : 0;
    scale = (pageWidth > 0 && pageWidth > containerWidth)
      ? (containerWidth - 32) / pageWidth
      : 1;
  } else {
    scale = parseFloat(zoom) || 1;
  }

  iframeWin.previewAPI.setZoom(scale);

  const zoomSelect = document.getElementById("zoom-select");
  if (zoomSelect) {
    zoomSelect.value = (zoom === "fit-width") ? "fit-width" : String(zoom);
  }
}

/**
 * Toggle debug mode (show/hide crop marks, page boxes, bleed/safe areas)
 * Directly toggles the 'debug' class on the iframe body for CSS-driven indicators
 */
function toggleDebugMode() {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.document || !iframeWin.document.body) {
    showError(
      "Preview Not Ready",
      "Please wait for preview to finish loading.",
    );
    return;
  }

  // Toggle debug class directly on iframe body (CSS-driven debug indicators)
  const isDebug = iframeWin.document.body.classList.toggle("debug");

  // Update button state
  const debugBtn = document.getElementById("btn-debug");
  if (debugBtn) {
    debugBtn.classList.toggle("active", isDebug);
  }

  showInfo("Debug Mode", `Debug mode ${isDebug ? "enabled" : "disabled"}`);
}

/**
 * Print the iframe content (save as PDF)
 * Accesses iframe's contentWindow to trigger browser print dialog
 */
function printPreview() {
  const iframeWin = getIframeWindow();
  if (!iframeWin) {
    showError(
      "Print Failed",
      "Preview window is not available. Try refreshing the page.",
    );
    return;
  }

  // Check if print button is disabled (belt-and-suspenders with keyboard shortcut check)
  const printBtn = document.getElementById("btn-print");
  if (printBtn && printBtn.disabled) {
    showError("Print Not Ready", "Please wait for rendering to complete.");
    return;
  }

  try {
    // Validate iframe is still attached and accessible
    if (!iframeWin.document || iframeWin.closed) {
      throw new Error("Preview window is no longer valid");
    }

    iframeWin.print();
    console.log("Print dialog opened");
  } catch (error) {
    console.error("Print failed:", error);

    // Provide specific, actionable error message
    const errorMsg = error instanceof Error ? error.message : "Unknown error";
    showError(
      "Print Error",
      `Unable to open print dialog: ${errorMsg}. Try refreshing the page or check browser popup settings.`,
    );
  }
}

// ============================================================================
// Viewer Canvas Styles — injected after Paged.js renders
// ============================================================================
//
// Paged.js strips @media pagedjs-ignore rules from the browser's CSSOM, so
// canvas background, page shadows, and row spacing cannot be set via preview.css
// on pagedjs_* elements. Instead, we inject a <style> block after rendering.

const VIEWER_CANVAS_DEFAULT_BG = "#e0e0e0";
let _currentCanvasBg = VIEWER_CANVAS_DEFAULT_BG;

function buildViewerStyleSheet(bg) {
  return `
/* Injected by preview.js after Paged.js render — not in preview.css to avoid pagedjs stripping */

/* ── Zoom — set via --pmd-zoom CSS custom property (JS only sets the number) ── */
html { --pmd-zoom: 1; }
.pagedjs_pages { zoom: var(--pmd-zoom) !important; }

/* ── Canvas (space around pages) ── */
html, body {
  background-color: ${bg} !important;
  min-height: 100% !important;
}
body {
  margin: 0 !important;
  padding: 0 0 32px !important;
}

/* ── Spread container (two-page side-by-side default) ── */
.pagedjs_pages {
  display: flex !important;
  flex-direction: row !important;
  flex-wrap: wrap !important;
  /* Width = two pages + column-gap so flex-wrap breaks into proper spread rows */
  width: calc(var(--pagedjs-width) * 2 + 8mm) !important;
  margin: 20mm auto !important;
  row-gap: 20mm !important;
  column-gap: 8mm !important;
}

/* ── Page shadows ── */
.pagedjs_page {
  margin: 0 !important;
  box-shadow:
    0 2px 6px rgba(0, 0, 0, 0.40),
    0 8px 28px rgba(0, 0, 0, 0.35) !important;
}

/* ── Reset any Paged.js bleed offsets so column-gap controls the gutter ── */
.pagedjs_left_page .pagedjs_sheet {
  margin-left: 0 !important;
}
.pagedjs_right_page {
  position: relative !important;
  left: 0 !important;
}

/* ── Single-page mode ── */
body.view-single .pagedjs_pages {
  flex-direction: column !important;
  width: fit-content !important;
  align-items: center !important;
  row-gap: 16mm !important;
}
body.view-single .pagedjs_right_page {
  left: 0 !important;
  position: relative !important;
}
body.view-single .pagedjs_left_page .pagedjs_sheet {
  margin-left: 0 !important;
}

/* ── Two-column mode (re-asserts the base layout so it wins over view-single
      when the user toggles back, and over the @media narrow-viewport fallback). */
body.view-two-column .pagedjs_pages {
  flex-direction: row !important;
  flex-wrap: wrap !important;
  width: calc(var(--pagedjs-width) * 2 + 8mm) !important;
  row-gap: 20mm !important;
  column-gap: 8mm !important;
  align-items: flex-start !important;
}
body.view-two-column .pagedjs_page {
  margin: 0 !important;
}
body.view-two-column .pagedjs_first_page {
  margin-left: 0 !important;
}
body.view-two-column .pagedjs_right_page {
  position: relative !important;
  left: 0 !important;
}
body.view-two-column .pagedjs_left_page .pagedjs_sheet {
  margin-left: 0 !important;
}
`.trim();
}

/**
 * Inject (or update) the viewer canvas styles into the iframe after Paged.js renders.
 * Paged.js strips @media pagedjs-ignore from the CSSOM, so these must be injected via JS.
 */
function injectViewerStyles(iframeWin, bg) {
  if (!iframeWin?.document) return;
  bg = bg || _currentCanvasBg;
  _currentCanvasBg = bg;

  let block = iframeWin.document.querySelector('style[data-viewer-canvas]');
  if (!block) {
    block = iframeWin.document.createElement('style');
    block.setAttribute('data-viewer-canvas', 'true');
    iframeWin.document.head.appendChild(block);
  }
  block.textContent = buildViewerStyleSheet(bg);
}

/**
 * Change the background color of the preview canvas (area surrounding pages)
 */
function changeBackgroundColor(color) {
  const iframeWin = getIframeWindow();
  if (!iframeWin) return;

  try {
    // Update the injected viewer-canvas style block (preview.css canvas rules are
    // stripped by Paged.js, so we inject/update them via JS instead).
    injectViewerStyles(iframeWin, color);
    console.log(`Background color changed to ${color}`);
  } catch (error) {
    console.error("Failed to change background color:", error);
  }
}

/**
 * Update the toolbar title with the document title from iframe
 */
function updateDocumentTitle() {
  const iframeWin = getIframeWindow();
  const titleElement = document.getElementById("document-title");

  if (!titleElement) {
    return;
  }

  try {
    if (iframeWin && iframeWin.document && iframeWin.document.title) {
      const docTitle = iframeWin.document.title;
      titleElement.textContent = docTitle;
      console.log(`Document title set to: ${docTitle}`);
    }
  } catch (error) {
    console.error("Failed to update document title:", error);
  }
}

// ============================================================================
// Iframe Event Listeners
// ============================================================================

/**
 * Handle page change events from iframe
 */
function onPageChanged(event) {
  const { currentPage, totalPages } = event.detail;
  console.log(`Page changed: ${currentPage}/${totalPages}`);
  updatePageDisplay();
}

/**
 * Handle rendering complete event from iframe
 * This fires when Paged.js has finished rendering all pages
 */
function onRenderingComplete(event) {
  const { totalPages } = event.detail;
  console.log(`✓ Rendering complete: ${totalPages} pages`);

  // While iframe is still hidden: inject CSS, set view mode, set zoom.
  // This ensures the iframe is at its final layout state before becoming visible —
  // no flash of wrong zoom or wrong view mode during the fade-in.
  injectViewerStyles(getIframeWindow());

  // Always set an explicit view mode based on viewport so neither the toolbar
  // button states nor the iframe CSS depend on a "no mode" fallback. The
  // resize listener registered in initializeToolbarControls() keeps this
  // in sync as the window grows/shrinks (until the user explicitly picks
  // a mode via the toolbar — see userOverrodeViewMode).
  setViewMode(autoViewModeForViewport(), "auto");
  if (window.innerWidth < VIEW_MODE_BREAKPOINT) {
    setZoom("fit-width");
  }

  // Update document title and page counter
  updateDocumentTitle();
  updatePageDisplay();

  // Hide loading overlay
  const overlay = document.getElementById("loading-overlay");
  if (overlay) {
    overlay.classList.remove("active");
  }

  // Fade in the iframe — content is fully laid out at correct zoom
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    iframe.classList.add("ready");
  }

  // Enable print button now that rendering is complete
  const printBtn = document.getElementById("btn-print");
  if (printBtn) {
    printBtn.disabled = false;
    printBtn.setAttribute("aria-label", "Print preview (save as PDF)");
  }

  console.log("✓ Preview initialized and ready");
  showSuccess("Preview Ready", `${totalPages} pages loaded successfully`);
}

/**
 * Setup event listeners on iframe window
 */
function setupIframeEventListeners() {
  const iframeWin = getIframeWindow();
  if (!iframeWin) {
    console.error("Cannot setup iframe listeners - window not accessible");
    return;
  }

  // Listen for page change events
  iframeWin.addEventListener("pageChanged", onPageChanged);

  // Listen for rendering complete events
  iframeWin.addEventListener("renderingComplete", onRenderingComplete);

  console.log("✓ Iframe event listeners registered");

  // Handle race condition: if Paged.js already finished rendering
  // before we set up listeners, the renderingComplete event was missed.
  // Only trigger if pages actually exist (not just the API object).
  if (iframeWin.previewAPI) {
    const totalPages = iframeWin.previewAPI.getTotalPages();
    if (totalPages > 0) {
      console.log("✓ Paged.js already rendered, triggering rendering complete");
      onRenderingComplete({ detail: { totalPages } });
    }
  }
}

// ============================================================================
// Toolbar Control Initialization
// ============================================================================

/**
 * Exit the preview client
 *
 * Closes the current window/tab
 */
function exitPreviewServer() {
  window.close();
}

/**
 * Initialize toolbar button event listeners
 *
 * Live-only buttons (folder picker, GitHub clone, exit) are wired up only
 * when MODE === "live". In static mode the buttons are hidden entirely so
 * authors browsing a published design guide aren't shown features that
 * would 404 against the static host.
 */
function initializeToolbarControls() {
  if (IS_LIVE) {
    // Exit button
    const exitBtn = document.getElementById("btn-exit");
    if (exitBtn) {
      exitBtn.addEventListener("click", exitPreviewServer);
    }

    // Folder selection button
    const folderBtn = document.getElementById("btn-folder");
    if (folderBtn) {
      folderBtn.addEventListener("click", openFolderModal);
    }

    // Modal close button
    const closeBtn = document.getElementById("modal-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", closeFolderModal);
    }

    // "Open This Folder" button
    const openBtn = document.getElementById("btn-open-folder");
    if (openBtn) {
      openBtn.addEventListener("click", () => {
        // Check if we're in folder browser mode for GitHub clone
        if (githubState.selectedTargetDirectory !== null) {
          selectFolderForCloning(currentPath);
        } else {
          switchToFolder(currentPath);
        }
      });
    }

    // GitHub button
    const githubBtn = document.getElementById("btn-github");
    if (githubBtn) {
      githubBtn.addEventListener("click", openGitHubModal);
    }

    // GitHub modal close button
    const githubCloseBtn = document.getElementById("github-modal-close");
    if (githubCloseBtn) {
      githubCloseBtn.addEventListener("click", closeGitHubModal);
    }

    // GitHub login button
    const githubLoginBtn = document.getElementById("btn-gh-login");
    if (githubLoginBtn) {
      githubLoginBtn.addEventListener("click", handleGitHubLogin);
    }

    // GitHub clone button
    const githubCloneBtn = document.getElementById("btn-gh-clone");
    if (githubCloneBtn) {
      githubCloneBtn.addEventListener("click", handleGitHubClone);
    }

    // Browse folder button
    const browseFolderBtn = document.getElementById("btn-browse-folder");
    if (browseFolderBtn) {
      browseFolderBtn.addEventListener("click", openFolderBrowser);
    }

    // Allow Enter key in repo URL input to trigger clone
    const repoUrlInput = document.getElementById("repo-url-input");
    if (repoUrlInput) {
      repoUrlInput.addEventListener("keydown", (e) => {
        if (e.key === "Enter") {
          handleGitHubClone();
        }
      });
    }

    // Close modals on Escape key
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const folderModal = document.getElementById("folder-modal");
        if (folderModal && folderModal.style.display === "flex") {
          // If folder modal is open and GitHub modal was the source, restore GitHub modal
          const githubModal = document.getElementById("github-modal");
          if (githubState.selectedTargetDirectory !== null) {
            closeFolderModal();
            if (githubModal) githubModal.style.display = "flex";
          } else {
            closeFolderModal();
          }
        }

        const githubModal = document.getElementById("github-modal");
        if (githubModal && githubModal.style.display === "flex") {
          closeGitHubModal();
        }
      }
    });
  } else {
    // Static mode: server-coupled buttons are hidden via CSS
    // (html[data-mode="static"] rules in preview.css).
  }

  // Page navigation buttons
  const firstBtn = document.getElementById("btn-first");
  if (firstBtn) {
    firstBtn.addEventListener("click", goToFirstPage);
  }

  const prevBtn = document.getElementById("btn-prev");
  if (prevBtn) {
    prevBtn.addEventListener("click", goToPreviousPage);
  }

  const nextBtn = document.getElementById("btn-next");
  if (nextBtn) {
    nextBtn.addEventListener("click", goToNextPage);
  }

  const lastBtn = document.getElementById("btn-last");
  if (lastBtn) {
    lastBtn.addEventListener("click", goToLastPage);
  }

  // Page input
  const pageInput = document.getElementById("page-input");
  if (pageInput) {
    pageInput.addEventListener("change", (e) => {
      const page = parseInt(e.target.value, 10);
      if (!isNaN(page)) {
        goToPage(page);
      }
    });

    pageInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        const page = parseInt(e.target.value, 10);
        if (!isNaN(page)) {
          goToPage(page);
        }
      }
    });
  }

  // View mode buttons. Clicking either flips userOverrodeViewMode = true,
  // so the resize listener below stops auto-switching after that.
  const singleBtn = document.getElementById("btn-single");
  if (singleBtn) {
    singleBtn.addEventListener("click", () => setViewMode("single"));
  }

  const twoColumnBtn = document.getElementById("btn-two-column");
  if (twoColumnBtn) {
    twoColumnBtn.addEventListener("click", () => setViewMode("two-column"));
  }

  // Re-evaluate auto view mode on window resize. Skipped once the user has
  // explicitly picked a mode — keep their choice. Debounced because resize
  // fires aggressively on drag.
  let resizeTimer = null;
  window.addEventListener("resize", () => {
    if (userOverrodeViewMode) return;
    if (resizeTimer) clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      setViewMode(autoViewModeForViewport(), "auto");
    }, 150);
  });

  // Zoom select
  const zoomSelect = document.getElementById("zoom-select");
  if (zoomSelect) {
    zoomSelect.addEventListener("change", (e) => {
      const value = e.target.value;

      if (value === "fit-width") {
        setZoom("fit-width");
      } else {
        const zoom = parseFloat(value);
        if (!isNaN(zoom)) {
          setZoom(zoom);
        }
      }
    });
  }

  // Debug mode button
  const debugBtn = document.getElementById("btn-debug");
  if (debugBtn) {
    debugBtn.addEventListener("click", toggleDebugMode);
  }

  // Print button
  const printBtn = document.getElementById("btn-print");
  if (printBtn) {
    printBtn.addEventListener("click", printPreview);
    // Start disabled - will be enabled when rendering completes
    printBtn.disabled = true;
  }

  // Background color button and picker
  const bgColorBtn = document.getElementById("btn-bg-color");
  const bgColorPicker = document.getElementById("bg-color-picker");

  if (bgColorBtn && bgColorPicker) {
    // When button is clicked, trigger the color picker
    bgColorBtn.addEventListener("click", () => {
      bgColorPicker.click();
    });

    // When color changes, update the iframe background
    bgColorPicker.addEventListener("input", (e) => {
      changeBackgroundColor(e.target.value);
    });
  }

  // Keyboard shortcut for print (Ctrl/Cmd+P)
  document.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "p") {
      event.preventDefault();

      const printBtn = document.getElementById("btn-print");
      if (printBtn && printBtn.disabled) {
        showError("Print Not Ready", "Please wait for rendering to complete.");
        return;
      }

      printPreview();
    }
  });

  // Wait for iframe to load, then initialize
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    iframe.addEventListener("load", onIframeLoad);
  }
}

/**
 * Handle iframe load event
 * Wait for Paged.js to finish rendering, then initialize
 */
function onIframeLoad() {
  // Clear any existing timeout from previous rendering
  if (renderingTimeoutId) {
    clearTimeout(renderingTimeoutId);
    renderingTimeoutId = null;
  }

  console.log("Iframe loaded, setting up event listeners...");
  updateLoadingMessage("Rendering pages...");

  // Show loading overlay while Paged.js renders
  const overlay = document.getElementById("loading-overlay");
  if (overlay) {
    overlay.classList.add("active");
  }

  // Hide iframe until rendering completes (will be shown by onRenderingComplete)
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    iframe.classList.remove("ready");
  }

  // Setup event listeners - iframe will signal when ready via 'renderingComplete' event
  setupIframeEventListeners();

  // Set new timeout and store ID
  renderingTimeoutId = setTimeout(() => {
    const printBtn = document.getElementById("btn-print");
    if (printBtn && printBtn.disabled) {
      showError(
        "Rendering Warning",
        "Preview rendering did not complete. Print may be incomplete.",
      );
      printBtn.disabled = false;
    }
    renderingTimeoutId = null; // Clear ID after timeout fires
  }, 120000);

  console.log("✓ Waiting for renderingComplete event from iframe...");
}

// ============================================================================
// Initialization
// ============================================================================

/**
 * Initialize preview client
 */
async function initializePreview() {
  try {
    console.log("Initializing preview...");
    updateLoadingMessage("Initializing preview...");

    // Show loading overlay while Paged.js is rendering
    const overlay = document.getElementById("loading-overlay");
    if (overlay) {
      overlay.classList.add("active");
    }

    // Initialize toolbar controls
    initializeToolbarControls();

    // Set current folder from URL or default
    clientState.currentFolder = window.location.pathname.includes("/home")
      ? window.location.pathname
      : "/home";

    // Register page lifecycle listeners
    registerPageLifecycleListeners();

    // If the server started without an input directory (`print-md` with no
    // args), the iframe is showing a placeholder. Pop the folder picker so
    // the user can choose a project to render. Static-mode viewers have no
    // /api/status — fetch failures are ignored and we leave the viewer alone.
    if (document.documentElement.dataset.mode === "live") {
      try {
        const statusResp = await fetch("/api/status");
        if (statusResp.ok) {
          const status = await statusResp.json();
          if (!status.hasInput) {
            const overlay = document.getElementById("loading-overlay");
            if (overlay) overlay.classList.remove("active");
            openFolderModal();
          }
        }
      } catch (e) {
        // Non-fatal — viewer still works without the auto-open.
        console.warn("Could not check preview status:", e);
      }
    }

    console.log("✓ Preview initialized");
  } catch (error) {
    console.error("Initialization failed:", error);
    showError("Initialization Error", error.message);
  }
}

/**
 * Register page lifecycle event listeners
 */
function registerPageLifecycleListeners() {
  console.log("✓ Page lifecycle listeners registered");
}

// ============================================================================
// GitHub Clone Modal
// ============================================================================

/**
 * GitHub state tracking
 */
const githubState = {
  isAuthenticated: false,
  username: null,
  ghCliInstalled: false,
  selectedTargetDirectory: null,
};

/**
 * Open folder browser for selecting clone target directory
 */
async function openFolderBrowser() {
  const modal = document.getElementById("folder-modal");
  const githubModal = document.getElementById("github-modal");

  // Hide GitHub modal temporarily
  if (githubModal) githubModal.style.display = "none";

  // Set a placeholder value to indicate we're in GitHub browse mode
  // This will be replaced with the actual path when user selects a folder
  githubState.selectedTargetDirectory = "";

  // Open folder modal in browse mode
  if (modal) modal.style.display = "flex";

  // Start navigation from home directory
  try {
    const response = await fetch("/api/directories");
    const data = await response.json();
    currentPath = data.currentPath;
    folderHistory = [currentPath];
    loadFolderList(currentPath);
  } catch (error) {
    console.error("Failed to open folder browser:", error);
    showError("Folder Browser Error", "Could not open folder selector");
  }
}

/**
 * Select folder for cloning
 */
function selectFolderForCloning(path) {
  githubState.selectedTargetDirectory = path;

  // Update the input field
  const targetInput = document.getElementById("target-dir-input");
  if (targetInput) {
    targetInput.value = path;
  }

  // Close folder modal and reopen GitHub modal
  const folderModal = document.getElementById("folder-modal");
  const githubModal = document.getElementById("github-modal");

  if (folderModal) folderModal.style.display = "none";
  if (githubModal) githubModal.style.display = "flex";

  showInfo("Folder Selected", `Will clone to: ${path}`);
}

/**
 * Show progress indicator
 */
function showProgress(message) {
  const progressEl = document.getElementById("gh-progress");
  const progressText = document.getElementById("gh-progress-text");

  if (progressEl) {
    progressEl.style.display = "block";
    progressEl.classList.add("active");
  }

  if (progressText) {
    progressText.textContent = message;
  }
}

/**
 * Hide progress indicator
 */
function hideProgress() {
  const progressEl = document.getElementById("gh-progress");

  if (progressEl) {
    progressEl.style.display = "none";
    progressEl.classList.remove("active");
  }
}

/**
 * Open GitHub clone modal
 */
async function openGitHubModal() {
  const modal = document.getElementById("github-modal");
  const overlay = document.getElementById("loading-overlay");

  modal.style.display = "flex";
  if (overlay) overlay.style.display = "none";

  // Reset input and message
  const repoInput = document.getElementById("repo-url-input");
  if (repoInput) repoInput.value = "";

  const targetInput = document.getElementById("target-dir-input");
  if (targetInput) targetInput.value = "";

  githubState.selectedTargetDirectory = null;

  hideGitHubMessage();
  hideProgress();

  // Check GitHub status
  await checkGitHubStatus();
}

/**
 * Close GitHub clone modal
 */
function closeGitHubModal() {
  const modal = document.getElementById("github-modal");
  modal.style.display = "none";
}

/**
 * Check GitHub CLI and authentication status
 */
async function checkGitHubStatus() {
  const statusInfo = document.getElementById("gh-status-info");
  const loginBtn = document.getElementById("btn-gh-login");
  const cloneBtn = document.getElementById("btn-gh-clone");

  if (!statusInfo) return;

  // Show loading state
  statusInfo.innerHTML =
    '<div class="gh-status-loading">Checking GitHub CLI status...</div>';

  try {
    const response = await fetch("/api/gh/status");
    const data = await response.json();

    githubState.ghCliInstalled = data.ghCliInstalled;
    githubState.isAuthenticated = data.authenticated;
    githubState.username = data.username;

    if (!data.ghCliInstalled) {
      statusInfo.innerHTML = `
        <div class="gh-status-error">
          <svg class="gh-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          <span>GitHub CLI not installed. Please install <code>gh</code> to use this feature.</span>
        </div>
      `;
      if (loginBtn) loginBtn.style.display = "none";
      if (cloneBtn) cloneBtn.disabled = true;
      return;
    }

    if (!data.authenticated) {
      statusInfo.innerHTML = `
        <div class="gh-status-not-authenticated">
          <svg class="gh-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <span>Not authenticated with GitHub. Click "Login to GitHub" to authenticate.</span>
        </div>
      `;
      if (loginBtn) loginBtn.style.display = "inline-flex";
      if (cloneBtn) cloneBtn.disabled = true;
      return;
    }

    // Authenticated
    statusInfo.innerHTML = `
      <div class="gh-status-authenticated">
        <svg class="gh-status-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
          <polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        <span>Authenticated as <span class="gh-username">${data.username}</span></span>
      </div>
    `;
    if (loginBtn) loginBtn.style.display = "none";
    if (cloneBtn) cloneBtn.disabled = false;
  } catch (error) {
    console.error("Failed to check GitHub status:", error);
    statusInfo.innerHTML = `
      <div class="gh-status-error">
        <span>Failed to check GitHub status: ${error.message}</span>
      </div>
    `;
    if (loginBtn) loginBtn.style.display = "none";
    if (cloneBtn) cloneBtn.disabled = true;
  }
}

/**
 * Handle GitHub login
 */
async function handleGitHubLogin() {
  const loginBtn = document.getElementById("btn-gh-login");

  if (loginBtn) {
    loginBtn.disabled = true;
    loginBtn.textContent = "Authenticating...";
  }

  showProgress("Opening browser for authentication...");
  hideGitHubMessage();

  try {
    const response = await fetch("/api/gh/login", {
      method: "POST",
    });

    const data = await response.json();

    hideProgress();

    if (data.success) {
      showGitHubMessage("Authentication successful!", "success");
      // Refresh status
      await checkGitHubStatus();
    } else {
      showGitHubMessage(data.error || "Authentication failed", "error");
      if (loginBtn) {
        loginBtn.disabled = false;
        loginBtn.textContent = "Login to GitHub";
      }
    }
  } catch (error) {
    console.error("GitHub login failed:", error);
    hideProgress();
    showGitHubMessage(`Authentication failed: ${error.message}`, "error");
    if (loginBtn) {
      loginBtn.disabled = false;
      loginBtn.textContent = "Login to GitHub";
    }
  }
}

/**
 * Handle GitHub clone
 */
async function handleGitHubClone() {
  const repoInput = document.getElementById("repo-url-input");
  const cloneBtn = document.getElementById("btn-gh-clone");

  if (!repoInput) return;

  const repoUrl = repoInput.value.trim();

  if (!repoUrl) {
    showGitHubMessage("Please enter a repository URL", "error");
    return;
  }

  if (cloneBtn) {
    cloneBtn.disabled = true;
    cloneBtn.textContent = "Cloning...";
  }

  showProgress("Cloning repository... This may take a moment.");
  hideGitHubMessage();

  try {
    const requestBody = { repoUrl };

    // Add target directory if selected
    if (githubState.selectedTargetDirectory) {
      requestBody.targetDirectory = githubState.selectedTargetDirectory;
    }

    const response = await fetch("/api/gh/clone", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
    });

    const data = await response.json();

    hideProgress();

    if (data.success) {
      showGitHubMessage(
        `Repository cloned successfully! Opening ${data.localPath}...`,
        "success",
      );

      // Close modal
      setTimeout(() => {
        closeGitHubModal();
        showSuccess("Repository Cloned", `Now previewing: ${data.localPath}`);
      }, 1500);
    } else {
      showGitHubMessage(data.error || "Clone failed", "error");
      if (cloneBtn) {
        cloneBtn.disabled = false;
        cloneBtn.textContent = "Clone Repository";
      }
    }
  } catch (error) {
    console.error("GitHub clone failed:", error);
    hideProgress();
    showGitHubMessage(`Clone failed: ${error.message}`, "error");
    if (cloneBtn) {
      cloneBtn.disabled = false;
      cloneBtn.textContent = "Clone Repository";
    }
  }
}

/**
 * Show message in GitHub modal
 */
function showGitHubMessage(message, type = "info") {
  const messageEl = document.getElementById("gh-message");
  if (!messageEl) return;

  messageEl.textContent = message;
  messageEl.className = `gh-message ${type}`;
  messageEl.style.display = "block";
}

/**
 * Hide message in GitHub modal
 */
function hideGitHubMessage() {
  const messageEl = document.getElementById("gh-message");
  if (messageEl) {
    messageEl.style.display = "none";
  }
}

// ============================================================================
// Entry Point
// ============================================================================

// Run initialization when DOM is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initializePreview);
} else {
  initializePreview();
}

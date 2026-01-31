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
// Client-Side State Management (Folder Selection Only)
// ============================================================================

const clientState = {
  currentFolder: "", // Absolute path to input directory (for folder selector)
  clientId: generateClientId(), // Unique ID for this browser instance
};

// Track rendering timeout to prevent race conditions
let renderingTimeoutId = null;

// ============================================================================
// Server Shutdown & Connection Tracking
// ============================================================================
//
// This preview client implements intelligent server shutdown behavior:
//
// **Multiple Clients:**
// - When 2+ browser tabs are open, the server stays alive
// - Exit button is DISABLED on all tabs (gray, not clickable)
// - Closing any single tab has no effect on server
//
// **Last Client (Single Tab):**
// - When only 1 tab remains, exit button becomes ENABLED (muted red)
// - User has TWO ways to shutdown:
//   1. Click Exit button → Custom confirmation → Immediate shutdown + tab close
//   2. Close tab/browser → Browser confirmation → 5-second delay → Auto-shutdown
//
// **Exit Button States:**
// - Initial load: Disabled, "Exit (checking connection status...)"
// - Multiple tabs: Disabled, "Exit (disabled - close other browser tabs first)"
// - Last tab: Enabled (red), "Exit and shutdown preview server"
//
// **Heartbeat System:**
// - Every 3 seconds, client sends heartbeat to server
// - Server responds with { isLastClient: true/false }
// - Button state updates automatically based on server response
// - When tab closes, pagehide event sends disconnect signal
//
// **Auto-Shutdown Flow:**
// - Last client disconnects → Server waits 5 seconds
// - If no clients reconnect → Server shuts down cleanly
// - Grace period allows accidental closes to be recovered
//
// **Confirmation Behavior:**
// - beforeunload: Only prompts if isLastConnectedClient === true
// - Exit button: Shows custom confirmation before shutdown
// - If exit button used, beforeunload is bypassed (no double confirmation)
//
// ============================================================================

// Heartbeat tracking for auto-shutdown
let heartbeatInterval = null;
const HEARTBEAT_INTERVAL = 3000; // Send heartbeat every 3 seconds
let isLastConnectedClient = false; // Track if this is the last client
let exitButtonClicked = false; // Track if user initiated exit via button (skip beforeunload)

/**
 * Generate a unique client ID for this browser instance
 */
function generateClientId() {
  return `client-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Send heartbeat to server to indicate this client is still connected
 */
async function sendHeartbeat() {
  try {
    const response = await fetch("/api/heartbeat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: clientState.clientId }),
    });

    if (response.ok) {
      const data = await response.json();
      // Update whether this is the last connected client
      const wasLastClient = isLastConnectedClient;
      isLastConnectedClient = data.isLastClient || false;

      // Update exit button styling if status changed
      if (wasLastClient !== isLastConnectedClient) {
        updateExitButtonStyle();
      }
    }
  } catch (error) {
    console.error("Failed to send heartbeat:", error);
  }
}

/**
 * Update exit button styling based on last client status
 */
function updateExitButtonStyle() {
  const exitBtn = document.getElementById("btn-exit");
  if (!exitBtn) return;

  if (isLastConnectedClient) {
    exitBtn.classList.add("last-client");
    exitBtn.disabled = false;
    exitBtn.title = "Exit and shutdown preview server";
  } else {
    exitBtn.classList.remove("last-client");
    exitBtn.disabled = true;
    exitBtn.title = "Exit (disabled - close other browser tabs first)";
  }
}

/**
 * Notify server that this client is disconnecting
 */
async function sendDisconnect() {
  try {
    // Use sendBeacon for reliable delivery during page unload
    const blob = new Blob(
      [JSON.stringify({ clientId: clientState.clientId })],
      { type: "application/json" },
    );
    navigator.sendBeacon("/api/disconnect", blob);
  } catch (error) {
    console.error("Failed to send disconnect:", error);
  }
}

/**
 * Start sending heartbeats to keep the server alive
 */
async function startHeartbeat() {
  // Send initial heartbeat and wait for response to set initial state
  await sendHeartbeat();

  // Start periodic heartbeat
  heartbeatInterval = setInterval(sendHeartbeat, HEARTBEAT_INTERVAL);

  console.log(`Heartbeat started for client ${clientState.clientId}`);
}

/**
 * Stop sending heartbeats
 */
function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

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
 * Change view mode (single/two-column) via iframe API
 */
function setViewMode(mode) {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.previewAPI) return;

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
 * Change zoom level via iframe API
 */
function setZoom(zoom) {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.previewAPI) return;

  const api = iframeWin.previewAPI;

  if (zoom === "fit-width") {
    // For Paged.js, fit-width is handled internally
    // Just pass a reasonable scale value
    api.setZoom(1.0);
  } else {
    api.setZoom(zoom);
  }
}

/**
 * Toggle debug mode (show/hide crop marks and page boxes)
 */
function toggleDebugMode() {
  const iframeWin = getIframeWindow();
  if (!iframeWin || !iframeWin.previewAPI) {
    showError(
      "Preview Not Ready",
      "Please wait for preview to finish loading.",
    );
    return;
  }

  const api = iframeWin.previewAPI;
  const isDebug = api.toggleDebugMode();

  // Update button state
  const debugBtn = document.getElementById("btn-debug");
  if (debugBtn) {
    if (isDebug) {
      debugBtn.classList.add("active");
    } else {
      debugBtn.classList.remove("active");
    }
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

/**
 * Change the background color of the iframe body
 */
function changeBackgroundColor(color) {
  const iframeWin = getIframeWindow();
  if (!iframeWin) {
    return;
  }

  try {
    // Update the body background color
    if (iframeWin.document && iframeWin.document.body) {
      iframeWin.document.body.style.backgroundColor = color;
      console.log(`Background color changed to ${color}`);
    }
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

  // Hide loading overlay now that rendering is complete
  const overlay = document.getElementById("loading-overlay");
  if (overlay) {
    overlay.classList.remove("active");
  }

  // Fade in the iframe now that content is ready
  const iframe = document.getElementById("preview-iframe");
  if (iframe) {
    iframe.classList.add("ready");
  }

  // Update document title from iframe
  updateDocumentTitle();

  // Update UI with initial page state
  updatePageDisplay();

  // Apply default view mode (two-column)
  setViewMode("two-column");

  // Apply default zoom
  setZoom(1.0);

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
 * Exit the preview server
 *
 * This is the primary shutdown method - user explicitly clicks the exit button.
 * Shows custom confirmation dialog, then:
 * 1. Shuts down the server immediately
 * 2. Closes the browser tab/window
 * 3. Bypasses beforeunload confirmation (sets exitButtonClicked flag)
 */
async function exitPreviewServer() {
  // Only allow if this is the last client
  if (!isLastConnectedClient) {
    showInfo(
      "Cannot Exit",
      "Close other browser tabs first to shut down the server.",
    );
    return;
  }

  // Confirm shutdown with custom message
  const confirmed = window.confirm(
    "This will shut down the preview server and close this window.\n\nAre you sure you want to exit?",
  );

  if (!confirmed) {
    return;
  }

  // Set flag to bypass beforeunload confirmation
  // We've already confirmed via the button, don't ask again when closing
  exitButtonClicked = true;

  try {
    // Show shutdown overlay immediately
    const shutdownOverlay = document.getElementById("shutdown-overlay");
    if (shutdownOverlay) {
      shutdownOverlay.classList.add("active");
    }

    // Stop heartbeat and disconnect
    stopHeartbeat();
    sendDisconnect();

    // Call shutdown API
    const response = await fetch("/api/shutdown", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
    });

    if (!response.ok) {
      throw new Error(`Shutdown failed: ${response.status}`);
    }

    console.log("Server shutdown initiated");

    // Close the window/tab after a brief delay to ensure shutdown message is sent
    setTimeout(() => {
      window.close();
    }, 500);
  } catch (error) {
    console.error("Failed to shutdown server:", error);
    showError("Shutdown Failed", error.message);

    // Reset flag on error
    exitButtonClicked = false;

    // Hide shutdown overlay on error
    const shutdownOverlay = document.getElementById("shutdown-overlay");
    if (shutdownOverlay) {
      shutdownOverlay.classList.remove("active");
    }

    // Restart heartbeat if shutdown failed
    startHeartbeat();
  }
}

/**
 * Initialize toolbar button event listeners
 */
function initializeToolbarControls() {
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

  // View mode buttons
  const singleBtn = document.getElementById("btn-single");
  if (singleBtn) {
    singleBtn.addEventListener("click", () => setViewMode("single"));
  }

  const twoColumnBtn = document.getElementById("btn-two-column");
  if (twoColumnBtn) {
    twoColumnBtn.addEventListener("click", () => setViewMode("two-column"));
  }

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

    // Start heartbeat to keep server alive
    startHeartbeat();

    // Register page lifecycle listeners
    registerPageLifecycleListeners();

    console.log("✓ Preview initialized");
  } catch (error) {
    console.error("Initialization failed:", error);
    showError("Initialization Error", error.message);
  }
}

/**
 * Register page lifecycle event listeners for connection tracking
 *
 * Handles two shutdown scenarios:
 * 1. User clicks Exit button → exitButtonClicked = true → Skip beforeunload
 * 2. User closes tab/browser → Show confirmation → Auto-shutdown after 5s
 */
function registerPageLifecycleListeners() {
  // Handle beforeunload - show confirmation when closing last client
  // Modern browsers only show a generic confirmation, not custom messages
  window.addEventListener("beforeunload", (event) => {
    //NOTE: Temporarily disable beforeunload confirmation to address bug with selecting local folder
    return true;

    // Skip confirmation if user already confirmed via exit button
    if (exitButtonClicked) {
      console.log("Exit button used - bypassing beforeunload confirmation");
      return;
    }

    // Only prompt if this is the last connected client
    if (isLastConnectedClient) {
      // Prevent the default behavior
      event.preventDefault();

      // Chrome requires returnValue to be set
      event.returnValue = "";

      // Some browsers use the return value
      return "";
    }
  });

  // Handle actual page hide - cleanup when page is definitely unloading
  // This fires after user confirms (or if no confirmation needed)
  window.addEventListener("pagehide", (event) => {
    // Stop heartbeat and notify server
    stopHeartbeat();
    sendDisconnect();
  });

  // Handle page visibility changes (tab switching)
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      // Tab became hidden - keep heartbeat running but log it
      console.log("Tab hidden, heartbeat continues");
    } else {
      // Tab became visible again
      console.log("Tab visible again");
      // Ensure heartbeat is still running
      if (!heartbeatInterval) {
        startHeartbeat();
      }
    }
  });

  // Handle page freeze/resume (mobile, resource constraints)
  window.addEventListener("freeze", () => {
    console.log("Page frozen");
    stopHeartbeat();
    sendDisconnect();
  });

  window.addEventListener("resume", () => {
    console.log("Page resumed");
    startHeartbeat();
  });

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

/**
 * Shared test helper: pick the workspace mode from the toolbar.
 *
 * There is ONE workspace switch — `mode: "editor" | "viewer" | "focus"` — and
 * the page count follows from it rather than being chosen directly:
 *
 *   viewMode = mode === "viewer" && !isNarrow ? "two-column" : "single"
 *
 * So "show me one page" is **Edit** (the editor with one page beside it) and
 * "show me two" is **Read**, at a window wider than NARROW_BREAKPOINT (820px)
 * — below that `isNarrow` clamps Read back to a single page.
 *
 * This helper exists because the tests drifted: they still drove the
 * `summary[aria-label="Page view mode"]` dropdown and its "Single page view" /
 * "Two pages side by side" buttons, all three deleted when the four
 * overlapping switches became this one. Four call sites across two files broke
 * together and silently, because neither file is CI-gated. Routing every call
 * through here means the next rename breaks one function, not four locators.
 *
 * (Not named *.pw.mjs on purpose — run-ui.mjs must not treat it as a test.)
 */

/**
 * @param {import("playwright-core").Page} page
 * @param {"Edit" | "Read"} mode
 */
export async function setWorkspaceMode(page, mode) {
  if (mode !== "Edit" && mode !== "Read") {
    throw new Error(`setWorkspaceMode: expected "Edit" or "Read", got ${JSON.stringify(mode)}`);
  }
  // Both forms are always in the DOM; CSS decides which one is visible at this
  // window width, so ask about visibility rather than presence.
  const button = page.locator(`.mode-group button[aria-label="${mode}"]`);
  if (await button.isVisible().catch(() => false)) {
    await button.click();
    return;
  }
  // Collapsed toolbar: the same choice lives behind a disclosure, where the
  // items carry their label as TEXT rather than aria-label.
  await page.locator('summary[aria-label="Edit or read"]').click();
  await page.locator(".mode-menu .menu-item", { hasText: mode }).click();
}

/**
 * Whether the toolbar currently reports this mode as active. `aria-pressed` is
 * the app's own signal, so this asserts what a screen reader would be told
 * rather than re-deriving the state from geometry.
 *
 * @param {import("playwright-core").Page} page
 * @param {"Edit" | "Read"} mode
 */
export async function workspaceModeIsActive(page, mode) {
  const button = page.locator(`.mode-group button[aria-label="${mode}"]`);
  return (await button.getAttribute("aria-pressed")) === "true";
}

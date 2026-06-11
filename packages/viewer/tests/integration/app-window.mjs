/**
 * Shared test helper: wait for the packaged viewer's REAL SPA window.
 *
 * The app shows a frameless data:-URL splash screen first (0.4.x+), so
 * `electronApp.firstWindow()` returns the SPLASH, which never navigates to
 * the SPA — every test that used firstWindow() broke silently when the
 * splash landed. Poll for the window on the app:// origin instead.
 *
 * (Not named *.pw.mjs on purpose — run-ui.mjs must not treat it as a test.)
 */
export async function waitForAppWindow(electronApp, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = electronApp
      .windows()
      .find((w) => w.url().startsWith("app://"));
    if (page) {
      await page.waitForLoadState("domcontentloaded");
      return page;
    }
    if (Date.now() > deadline) {
      const urls = electronApp.windows().map((w) => w.url().slice(0, 80));
      throw new Error(
        `main app:// window never appeared (windows: ${urls.join(", ") || "none"})`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

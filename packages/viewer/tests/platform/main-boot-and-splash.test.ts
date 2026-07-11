/**
 * Regression tests for ARCH review #28 (boot-failure UX) and #58 (splash
 * fallback comment/value mismatch) in electron/main.ts.
 *
 * main.ts is Electron's entry script — it calls `app.whenReady()` and other
 * singleton APIs at module scope, so (matching the existing convention in
 * viewer-ui-regressions.test.ts, e.g. the "splash screen is closable..." and
 * "C2: recents..." cases) these are source-text assertions rather than an
 * executed unit test. That is enough to pin the two behaviors this review
 * package is responsible for:
 *
 *  - #28: if startSvelteKitServer() throws during app.whenReady(), main.ts
 *    must show a plain-language dialog.showErrorBox(...) instead of only
 *    logging to console.error and silently continuing.
 *  - #58: the splash fallback timer's comment must describe what the 15s
 *    timeout actually budgets (revealing the window early, not a
 *    render-completion deadline) instead of the stale "Generous (60s)"
 *    claim that never matched the 15_000 value.
 *
 * Both assertions fail against the HEAD version of main.ts as of commit
 * e0708a3 (confirmed via `git show HEAD:packages/viewer/electron/main.ts`):
 * that revision's catch block is only
 *   console.error("[sk-server] failed to start SvelteKit server:", err);
 *   // Non-fatal: registerAppProtocol will return 503 until skServerPort is set.
 * with no showErrorBox call anywhere in the file, and its splash-fallback
 * comment reads "Generous (60s) so a large book on a slow machine finishes
 * rendering ... rather than being cut off mid-render by the timeout" above a
 * `setTimeout(showMainWindowAndCloseSplash, 15_000)` call.
 */
import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const main = readFileSync(
  path.resolve(import.meta.dir, "../../electron/main.ts"),
  "utf8"
);

test("ARCH #28: a SvelteKit boot failure shows a plain-language native dialog, not just a console.error swallow", () => {
  // The try/catch around startSvelteKitServer() in app.whenReady().
  const bootBlockStart = main.indexOf("await startSvelteKitServer(slog);");
  expect(bootBlockStart).toBeGreaterThan(-1);
  const catchBlock = main.slice(bootBlockStart, bootBlockStart + 1500);

  // Still logs for diagnostics...
  expect(catchBlock).toContain(
    'console.error("[sk-server] failed to start SvelteKit server:", err);'
  );
  // ...but must ALSO surface a native dialog so the author isn't stranded on
  // a silent failure (the pre-fix behavior was console.error-and-continue
  // with no dialog anywhere in the file).
  expect(catchBlock).toContain("dialog.showErrorBox(");
  expect(catchBlock).toContain("print-md couldn't start");
  // Author-friendly: no stack traces or raw Node error class names required
  // reading, and it must mention the underlying error for support/debugging.
  expect(catchBlock).toMatch(/Details:.*err/s);
});

test("ARCH #28: dialog is imported from electron so showErrorBox actually resolves", () => {
  expect(main).toMatch(/import\s*\{[^}]*\bdialog\b[^}]*\}\s*from\s*"electron"/);
});

test("ARCH #58: splash fallback comment is reconciled with the 15s value it documents", () => {
  const timerIdx = main.indexOf(
    "splashFallbackTimer = setTimeout(showMainWindowAndCloseSplash, 15_000);"
  );
  expect(timerIdx).toBeGreaterThan(-1);

  // The comment block immediately preceding the timer call.
  const commentBlock = main.slice(Math.max(0, timerIdx - 1200), timerIdx);

  // The stale claim (an unqualified "Generous (60s)" framing that never
  // matched the 15_000ms value) must be gone.
  expect(commentBlock).not.toContain("Generous (60s)");
  expect(commentBlock).not.toContain("60s)");

  // The reconciled comment explains the 15s window is about revealing the
  // window early / not stranding the user on the splash — NOT a budget for
  // finishing a full render — since showInactive() already paints real
  // compositor frames underneath the splash the whole time.
  expect(commentBlock).toContain("showInactive");
  expect(commentBlock).toContain("not a render-completion budget");
});

test("ARCH #58: the fallback timer still uses 15_000ms, not the stale 60s figure", () => {
  expect(main).toContain(
    "splashFallbackTimer = setTimeout(showMainWindowAndCloseSplash, 15_000);"
  );
  expect(main).not.toContain(
    "splashFallbackTimer = setTimeout(showMainWindowAndCloseSplash, 60_000);"
  );
});

test("residual docs-sweep fix: the prod-mode window-load comment describes adapter-node, not adapter-static", () => {
  const loadUrlIdx = main.indexOf('mainWindow.loadURL(devUrl || "app://local/");');
  expect(loadUrlIdx).toBeGreaterThan(-1);
  const precedingComment = main.slice(Math.max(0, loadUrlIdx - 800), loadUrlIdx);
  expect(precedingComment).toContain("adapter-node emits a Node HTTP handler");
  expect(precedingComment).not.toContain("adapter-static emits an SPA");
});

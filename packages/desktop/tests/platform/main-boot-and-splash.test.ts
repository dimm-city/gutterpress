/**
 * Regression tests for ARCH review #28 (boot-failure UX) in electron/main.ts.
 *
 * main.ts is Electron's entry script — it calls `app.whenReady()` and other
 * singleton APIs at module scope, so (matching the existing convention in
 * desktop-ui-regressions.test.ts) these are source-text assertions rather than
 * an executed unit test:
 *
 *  - #28: if startSvelteKitServer() throws during app.whenReady(), main.ts
 *    must show a plain-language dialog.showErrorBox(...) instead of only
 *    logging to console.error and silently continuing.
 *
 * (This file also used to pin ARCH #58 — the splash fallback timer's
 * comment/value mismatch. The external splash window has since been REMOVED
 * outright in favour of the in-window start screen, so those assertions moved
 * to desktop-ui-regressions.test.ts's "the external splash window is gone"
 * test, which pins the removal itself.)
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
  const bootBlockStart = main.indexOf("await startSvelteKitServer(slog, skAuthToken);");
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
  expect(catchBlock).toContain("Gutterpress couldn't start");
  // Author-friendly: no stack traces or raw Node error class names required
  // reading, and it must mention the underlying error for support/debugging.
  expect(catchBlock).toMatch(/Details:.*err/s);
});

test("ARCH #28: dialog is imported from electron so showErrorBox actually resolves", () => {
  expect(main).toMatch(/import\s*\{[^}]*\bdialog\b[^}]*\}\s*from\s*"electron"/);
});

test("the splash machinery stays deleted (superseded by the in-window start screen)", () => {
  expect(main).not.toContain("splashFallbackTimer");
  expect(main).not.toContain("showMainWindowAndCloseSplash");
  expect(main).not.toContain("createSplashWindow");
});

test("residual docs-sweep fix: the prod-mode window-load comment describes adapter-node, not adapter-static", () => {
  const loadUrlIdx = main.indexOf('mainWindow.loadURL(devUrl || "app://local/");');
  expect(loadUrlIdx).toBeGreaterThan(-1);
  const precedingComment = main.slice(Math.max(0, loadUrlIdx - 800), loadUrlIdx);
  expect(precedingComment).toContain("adapter-node emits a Node HTTP handler");
  expect(precedingComment).not.toContain("adapter-static emits an SPA");
});

// ARCH review finding #1 (CRITICAL): a packaged build must never trust
// VITE_DEV_SERVER_URL for window loading, the IPC/navigation origin policy,
// or the "skip the local server" decision — otherwise an attacker who
// launches the packaged binary with that env var set can point it at remote
// content that then receives the full preload/IPC bridge. All three call
// sites named in the finding (window load, originPolicyConfig(), and the
// whenReady() server-start gate) must route through the single
// resolveDevServerUrl(app.isPackaged, …) gate — none of them may read
// `process.env.VITE_DEV_SERVER_URL` directly.
test("ARCH #1: resolveDevServerUrl is imported from navigation-policy", () => {
  expect(main).toMatch(
    /import\s*\{[^}]*\bresolveDevServerUrl\b[^}]*\}\s*from\s*"\.\/navigation-policy"/,
  );
});

test("ARCH #1: mainWindow.loadURL uses the packaged-aware gate, not the raw env var", () => {
  const idx = main.indexOf(
    'const devUrl = resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL);',
  );
  expect(idx).toBeGreaterThan(-1);
  const loadUrlIdx = main.indexOf('mainWindow.loadURL(devUrl || "app://local/");', idx);
  expect(loadUrlIdx).toBeGreaterThan(idx);
  expect(loadUrlIdx - idx).toBeLessThan(200);
});

test("ARCH #1: originPolicyConfig()'s devServerOrigin uses the packaged-aware gate", () => {
  const fnIdx = main.indexOf("function originPolicyConfig(): OriginPolicyConfig {");
  expect(fnIdx).toBeGreaterThan(-1);
  const body = main.slice(fnIdx, fnIdx + 400);
  expect(body).toContain(
    "resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL)",
  );
  // Must not fall back to reading the raw env var directly into the config.
  expect(body).not.toContain("devServerOrigin: process.env.VITE_DEV_SERVER_URL");
});

test("ARCH #1: the whenReady() local-server-start gate uses the packaged-aware helper", () => {
  const idx = main.indexOf("await startSvelteKitServer(slog, skAuthToken);");
  expect(idx).toBeGreaterThan(-1);
  const precedingGate = main.slice(Math.max(0, idx - 400), idx);
  expect(precedingGate).toContain(
    "if (!resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL)) {",
  );
  expect(precedingGate).not.toContain("if (!process.env.VITE_DEV_SERVER_URL) {");
});

test("ARCH #1: no remaining direct process.env.VITE_DEV_SERVER_URL reads outside resolveDevServerUrl(...) call sites", () => {
  // Every occurrence of the raw env var must be an argument to
  // resolveDevServerUrl(...) (or inside a comment) — never read standalone
  // for a trust/load decision.
  const rawReads = [...main.matchAll(/process\.env\.VITE_DEV_SERVER_URL/g)];
  expect(rawReads.length).toBeGreaterThan(0); // sanity: the var is still used somewhere
  for (const m of rawReads) {
    const idx = m.index ?? -1;
    const lineStart = main.lastIndexOf("\n", idx) + 1;
    const line = main.slice(lineStart, main.indexOf("\n", idx));
    const isComment = line.trim().startsWith("//") || line.trim().startsWith("*");
    const isGatedCall = line.includes("resolveDevServerUrl(app.isPackaged, process.env.VITE_DEV_SERVER_URL)");
    expect(isComment || isGatedCall).toBe(true);
  }
});

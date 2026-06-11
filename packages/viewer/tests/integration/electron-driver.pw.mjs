#!/usr/bin/env node
/**
 * Drive the packaged Electron viewer end-to-end on the current platform.
 *
 * - Launches the print-md-viewer Electron app via Playwright's _electron.
 * - Waits for the first BrowserWindow.
 * - Calls /api/preview from the renderer with a real platform-native
 *   project path (this is the exact code path the user hits when they
 *   pick a folder via the dialog).
 * - Asserts the response is 200 and the returned URL serves book.html.
 *
 * Usage:
 *   node tests/integration/electron-driver.pw.mjs <main-js-path> <fixture-dir>
 *
 *   <main-js-path> — path to electron-dist/main.js inside the unpacked app
 *   <fixture-dir>  — project directory the test will open
 *
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { waitForAppWindow } from "./app-window.mjs";
import { existsSync, mkdtempSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

function log(msg) { console.log(`[etest] ${msg}`); }
function fail(msg) { console.error(`[etest] FAIL: ${msg}`); process.exit(1); }

const [, , exeArg, fixtureArg] = process.argv;
if (!exeArg || !fixtureArg) {
  fail("usage: electron-driver.pw.mjs <packaged-exe-path> <fixture-dir>");
}
const exePath = resolve(exeArg);
const fixturePath = resolve(fixtureArg);
if (!existsSync(exePath)) fail(`packaged exe not found at ${exePath}`);
if (!existsSync(fixturePath)) fail(`fixture not found at ${fixturePath}`);

log(`launching packaged electron app: ${exePath}`);
// executablePath points at the packaged print-md-viewer.exe (or .AppImage)
// produced by electron-builder — exactly what the end user runs. Launch with a
// FRESH userData dir so the run is deterministic: the app shows the empty
// "Open a folder" state regardless of any project the developer's real profile
// last had open (otherwise it auto-reopens that project and the sentinel check
// below sees the wrong screen).
const userDataDir = mkdtempSync(join(tmpdir(), "pmd-etest-"));
const electronApp = await electron.launch({
  executablePath: exePath,
  args: [`--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
});

let exitCode = 0;
try {
  // firstWindow() would return the data:-URL SPLASH screen — wait for the
  // real SPA window on the app:// origin instead.
  const page = await waitForAppWindow(electronApp);
  log(`page loaded at ${page.url()}`);

  // CRITICAL: verify the SPA actually rendered, not just that the URL
  // is right. A broken protocol handler can return a 404 page that
  // navigates fine but shows nothing. Check for a Svelte-rendered element.
  try {
    await page.waitForLoadState("networkidle", { timeout: 15_000 });
  } catch { /* networkidle is best-effort */ }

  const pageText = await page.evaluate(() => document.body.innerText || "");
  log(`page body first 200 chars: ${pageText.slice(0, 200).replace(/\n/g, " | ")}`);

  // Look for any of the strings the viewer's +page.svelte renders.
  const sentinels = ["Open a folder", "Open Folder", "print-md"];
  const found = sentinels.find((s) => pageText.includes(s));
  if (!found) {
    fail(
      `SPA did not render — body did not contain any of: ${sentinels.join(", ")}.\n` +
      `  body was: ${pageText.slice(0, 500)}`
    );
  }
  log(`SPA rendered (found sentinel "${found}")`);

  // Now verify the preload bridge.
  await page.waitForFunction(
    () => typeof (window).electron?.startPreview === "function",
    { timeout: 10_000 }
  );
  log(`window.electron bridge is wired up`);

  // ── Trigger startPreview through the IPC bridge ───────────────────────
  log(`window.electron.startPreview({ input: ${fixturePath} })`);
  const result = await page.evaluate(async (input) => {
    try {
      const r = await (window).electron.startPreview({ input });
      return { ok: true, data: r };
    } catch (e) {
      return { ok: false, error: e?.message ?? String(e) };
    }
  }, fixturePath);

  if (!result.ok) {
    fail(`startPreview threw: ${result.error}`);
  }
  log(`startPreview ok: ${JSON.stringify(result.data)}`);

  const data = result.data;
  if (typeof data.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(data.url)) {
    fail(`bad url in response: ${data.url}`);
  }

  // The viewer loads the preview URL via iframe navigation. We verify the
  // preview server actually serves book.html (the iframe target) by
  // fetching from node — cross-origin doesn't matter outside the renderer.
  const bookRes = await fetch(`${data.url}/book.html`);
  if (bookRes.status !== 200) fail(`book.html returned ${bookRes.status}`);
  const bookHtml = await bookRes.text();
  if (bookHtml.length < 500) fail(`book.html unexpectedly short: ${bookHtml.length} bytes`);
  log(`book.html served, ${bookHtml.length} bytes`);

  log("PASS: full directory-load flow works end-to-end inside Electron");
} catch (err) {
  console.error("[etest] uncaught:", err);
  exitCode = 1;
} finally {
  log("closing electron");
  await electronApp.close();
}
process.exit(exitCode);

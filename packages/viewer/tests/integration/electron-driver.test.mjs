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
 *   node tests/integration/electron-driver.test.mjs <main-js-path> <fixture-dir>
 *
 *   <main-js-path> — path to electron-dist/main.js inside the unpacked app
 *   <fixture-dir>  — project directory the test will open
 *
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

function log(msg) { console.log(`[etest] ${msg}`); }
function fail(msg) { console.error(`[etest] FAIL: ${msg}`); process.exit(1); }

const [, , exeArg, fixtureArg] = process.argv;
if (!exeArg || !fixtureArg) {
  fail("usage: electron-driver.test.mjs <packaged-exe-path> <fixture-dir>");
}
const exePath = resolve(exeArg);
const fixturePath = resolve(fixtureArg);
if (!existsSync(exePath)) fail(`packaged exe not found at ${exePath}`);
if (!existsSync(fixturePath)) fail(`fixture not found at ${fixturePath}`);

log(`launching packaged electron app: ${exePath}`);
// executablePath points at the packaged print-md-viewer.exe (or .AppImage)
// produced by electron-builder. With no args, it boots the embedded
// electron-dist/main.js using the bundled Electron runtime — i.e. exactly
// what the end user runs when they double-click the installed app.
const electronApp = await electron.launch({
  executablePath: exePath,
  args: [],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
});

let exitCode = 0;
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  log(`first window opened, url=${page.url()}`);

  // adapter-static + protocol.handle: page loads instantly at app://local/.
  // No "wait for SvelteKit server" phase anymore — that whole thing is gone.
  await page.waitForLoadState("domcontentloaded");
  if (!page.url().startsWith("app://")) {
    fail(`window not on app:// origin (still at ${page.url()})`);
  }
  log(`page loaded at ${page.url()}`);

  // The preload script exposes window.electron with startPreview/build/etc.
  // Wait for it to be defined (Electron sometimes mounts it just after load).
  await page.waitForFunction(
    () => typeof (window).electron?.startPreview === "function",
    { timeout: 10_000 }
  );

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

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

const [, , mainArg, fixtureArg] = process.argv;
if (!mainArg || !fixtureArg) {
  fail("usage: electron-driver.test.mjs <main-js-path> <fixture-dir>");
}
const mainPath = resolve(mainArg);
const fixturePath = resolve(fixtureArg);
if (!existsSync(mainPath)) fail(`main.js not found at ${mainPath}`);
if (!existsSync(fixturePath)) fail(`fixture not found at ${fixturePath}`);

log(`launching electron with main=${mainPath}`);
const electronApp = await electron.launch({
  args: [mainPath],
  // Force a colourless theme so the launch isn't blocked by any system
  // colour-scheme query on a server runner.
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
});

let exitCode = 0;
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  log(`first window opened, url=${page.url()}`);

  // The first window shows a "Loading server" data: URL until the
  // SvelteKit server is ready. Wait for navigation to the real http URL.
  const t0 = Date.now();
  while (Date.now() - t0 < 60_000) {
    const url = page.url();
    if (url.startsWith("http://")) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  if (!page.url().startsWith("http://")) {
    fail(`window never navigated to http:// (still at ${page.url()})`);
  }
  log(`sveltekit server ready at ${page.url()} after ${Date.now() - t0}ms`);

  // ── Hit /api/preview from inside the renderer ─────────────────────────
  log(`POST /api/preview with input=${fixturePath} from renderer`);
  const result = await page.evaluate(async (input) => {
    const r = await fetch("/api/preview", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input }),
    });
    return { ok: r.ok, status: r.status, body: await r.text() };
  }, fixturePath);

  if (!result.ok) {
    fail(`/api/preview returned ${result.status}: ${result.body}`);
  }
  log(`/api/preview ok: ${result.body}`);

  // ── Fetch book.html from the returned preview URL ─────────────────────
  let data;
  try { data = JSON.parse(result.body); } catch { fail(`bad json: ${result.body}`); }
  if (typeof data.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(data.url)) {
    fail(`bad url in response: ${data.url}`);
  }

  const bookRes = await page.evaluate(async (u) => {
    const r = await fetch(`${u}/book.html`);
    return { status: r.status, html: await r.text() };
  }, data.url);
  if (bookRes.status !== 200) fail(`book.html returned ${bookRes.status}`);
  log(`book.html served, ${bookRes.html.length} bytes`);

  log("PASS: directory load works end-to-end inside Electron");
} catch (err) {
  console.error("[etest] uncaught:", err);
  exitCode = 1;
} finally {
  log("closing electron");
  await electronApp.close();
}
process.exit(exitCode);

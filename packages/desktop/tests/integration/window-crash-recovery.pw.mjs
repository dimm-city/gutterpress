#!/usr/bin/env node
/**
 * Real-Electron acceptance check: a crashed main-window renderer is reloaded.
 *
 * Before the fix main.ts only logged `render-process-gone`, so an out-of-memory
 * or crashed renderer left the window blank until the app was restarted. This
 * drive kills the window's renderer process for real
 * (SIGKILL to its OS process) and waits for the window to come back on its own
 * with the app's interface loaded again.
 *
 * Usage:
 *   node tests/integration/window-crash-recovery.pw.mjs <packaged-exe-or-out/main/main.js>
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { waitForAppWindow } from "./app-window.mjs";

function log(msg) { console.log(`[window-crash-recovery] ${msg}`); }
let electronApp;
function fail(msg) {
  console.error(`[window-crash-recovery] FAIL: ${msg}`);
  electronApp?.process().kill("SIGKILL");
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg] = process.argv;
if (!targetArg) fail("usage: window-crash-recovery.pw.mjs <packaged-exe-or-out/main/main.js>");
const target = resolve(targetArg);
if (!existsSync(target)) fail(`desktop target not found at ${target}`);
const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;

const userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-crash-"));
electronApp = await electron.launch({
  executablePath,
  args: [...(isMainJs ? [target] : []), `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 90_000,
});

let exitCode = 0;
try {
  const first = await waitForAppWindow(electronApp);
  // A mark that only the pre-crash page has: its absence proves a fresh load.
  await first.evaluate(() => { window.__beforeCrash = true; });
  log("app window loaded");

  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("app://"));
    process.kill(win.webContents.getOSProcessId(), "SIGKILL");
  });
  log("renderer killed");

  // Ask from the main process: Playwright's Page object stays "crashed" for good,
  // even after the window has loaded a fresh page.
  let reloaded = false;
  const deadline = Date.now() + 20_000;
  while (!reloaded && Date.now() < deadline) {
    reloaded = await electronApp.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find((w) => w.webContents.getURL().startsWith("app://"));
      if (!win || win.webContents.isCrashed() || win.webContents.isLoading()) return false;
      const state = await Promise.race([
        win.webContents.executeJavaScript(
          "({ marked: window.__beforeCrash === true, text: document.body.innerText.trim().length })",
        ),
        new Promise((r) => setTimeout(() => r(null), 2000)),
      ]);
      return !!state && !state.marked && state.text > 0;
    });
    if (!reloaded) await new Promise((r) => setTimeout(r, 250));
  }
  if (!reloaded) fail("the window was not reloaded after its renderer crashed");
  log("window reloaded and shows the app again");
} catch (e) {
  console.error(e);
  exitCode = 1;
} finally {
  electronApp.process().kill("SIGKILL");
  if (process.env.KEEP) console.log(userDataDir); else rmSync(userDataDir, { recursive: true, force: true });
}
process.exit(exitCode);

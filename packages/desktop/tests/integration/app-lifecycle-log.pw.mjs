#!/usr/bin/env node
/**
 * Real-Electron acceptance check for electron/app-log.ts's lifecycle lines.
 *
 * The Logs tab dropdown showed only per-project logs on a real beta install —
 * "Gutterpress app.log" never appeared, because app-log.ts only wrote on an
 * update check/download/install FAILURE (electron/updater.ts's three call
 * sites), never on ordinary start/close. Investigation confirmed the
 * write→directory→list→dropdown pipeline was already correct; the file
 * simply never existed until logAppEvent() gained two new callers: one at
 * app.whenReady() (started), one on the app's own "before-quit" (closing).
 *
 * The closing write is the part worth a real end-to-end check, not just a
 * unit test: it depends on Electron's before-quit NOT being awaited by the
 * framework, so main.ts's preventDefault()-then-requeue dance is the only
 * thing standing between "the write completes" and "the process exits with
 * the write still in flight, silently dropped." This drive proves that by
 * calling the app's own app.quit() and waiting for the real OS process to
 * exit — a Node ChildProcess 'exit' event, not Playwright's close() (whose
 * internal graceful-vs-forceful semantics this repo has not verified) —
 * before reading the log a second time. If the write raced the exit, the
 * closing line would be missing from that second read.
 *
 * Usage:
 *   node tests/integration/app-lifecycle-log.pw.mjs <packaged-exe-or-out/main/main.js>
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { waitForAppWindow } from "./app-window.mjs";

function log(msg) { console.log(`[app-lifecycle-log] ${msg}`); }
function fail(msg) { console.error(`[app-lifecycle-log] FAIL: ${msg}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg] = process.argv;
if (!targetArg) fail("usage: app-lifecycle-log.pw.mjs <packaged-exe-or-out/main/main.js>");
const target = resolve(targetArg);
if (!existsSync(target)) fail(`desktop target not found at ${target}`);
// Same dual-mode launch every other drive in this directory uses.
const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;

const userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-applog-"));
const logFile = join(userDataDir, "logs", "Gutterpress app.log");

log(`launching ${target}`);
const electronApp = await electron.launch({
  executablePath,
  args: [...(isMainJs ? [target] : []), `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 90_000,
});

let exitCode = 0;
try {
  await waitForAppWindow(electronApp);
  log("app window loaded");

  await new Promise((r) => {
    const deadline = Date.now() + 15_000;
    (function poll() {
      if (existsSync(logFile)) return r();
      if (Date.now() > deadline) return r(); // let the read below report what's actually there
      setTimeout(poll, 200);
    })();
  });
  if (!existsSync(logFile)) fail(`${logFile} was never created after startup`);
  const afterStart = readFileSync(logFile, "utf8");
  if (!afterStart.includes("[app] started")) {
    fail(`log after startup did not contain "[app] started" — got:\n${afterStart}`);
  }
  log('confirmed "[app] started" written before any quit');

  // The real OS process, not Playwright's close() — see header. app.quit()
  // is the same public entry point a real user's Cmd+Q / taskbar-close / menu
  // Quit ultimately calls, so this exercises the exact before-quit path.
  const proc = electronApp.process();
  const exited = new Promise((resolve) => proc.once("exit", resolve));
  await electronApp.evaluate(({ app }) => app.quit());
  const exitTimeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error("process did not exit within 15s of app.quit()")), 15_000),
  );
  await Promise.race([exited, exitTimeout]);
  log("process exited");

  const afterClose = readFileSync(logFile, "utf8");
  if (!afterClose.includes("[app] closing")) {
    fail(
      `log after the process fully exited did not contain "[app] closing" — the ` +
      `before-quit write raced the real exit. Got:\n${afterClose}`,
    );
  }
  const startIdx = afterClose.indexOf("[app] started");
  const closeIdx = afterClose.indexOf("[app] closing");
  if (!(startIdx >= 0 && closeIdx > startIdx)) {
    fail(`expected "[app] started" before "[app] closing" in:\n${afterClose}`);
  }
  log('confirmed "[app] closing" persisted before process exit, after "[app] started"');
  log("PASS: app-log records the app's own start and close, not only updater failures");
} catch (err) {
  console.error("[app-lifecycle-log] uncaught:", err);
  exitCode = 1;
} finally {
  await electronApp.close().catch(() => {});
  rmSync(userDataDir, { recursive: true, force: true });
}
process.exit(exitCode);

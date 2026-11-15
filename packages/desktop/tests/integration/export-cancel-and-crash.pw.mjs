#!/usr/bin/env node
/**
 * Real-Electron acceptance check for the PDF export's two ways of stopping
 * that used to leave "Preparing PDF…" up: Cancel, and the hidden render
 * window's renderer dying.
 *
 * A long generated book is opened and exported three times:
 *
 *   1. The export's hidden windows have their renderer processes killed mid-
 *      render (what an out-of-memory crash looks like). The export must fail
 *      with the crash sentence, not hang.
 *   2. Cancel is pressed mid-render. The export must settle as canceled within
 *      seconds, close its hidden windows, and not wait for the render.
 *   3. The slot those two freed: a third export starts, and finishes with a PDF.
 *
 * Usage:
 *   node tests/integration/export-cancel-and-crash.pw.mjs <exe-or-main-js>
 */
import { _electron as electron } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppWindow } from "./app-window.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg] = process.argv;

const log = (message) => console.log(`[export-cancel-and-crash] ${message}`);
function fail(message) {
  throw new Error(message);
}

if (!targetArg) {
  console.error("usage: export-cancel-and-crash.pw.mjs <packaged-exe-or-out/main/main.js>");
  process.exit(1);
}
const target = resolve(targetArg);
if (!existsSync(target)) fail(`desktop target not found: ${target}`);
const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;

let electronApp;
let projectDir;
let userDataDir;
let exitCode = 0;

try {
  const scratch = mkdtempSync(join(tmpdir(), "gp-export-stop-"));
  projectDir = join(scratch, "book");
  userDataDir = join(scratch, "home");
  // A book long enough (over a thousand pages) that its render is still going
  // when Cancel lands: a short one finishes before the difference shows.
  mkdirSync(projectDir, { recursive: true });
  const paragraph = "The lamps along the quay burned late, and the ferrymen traded rumours about the lighthouse keeper who never came ashore. ".repeat(6);
  const chapters = Array.from({ length: 300 }, (_, c) =>
    [`# Chapter ${c + 1}`, "", ...Array.from({ length: 22 }, () => `${paragraph}\n`)].join("\n"),
  );
  writeFileSync(join(projectDir, "book.md"), chapters.join("\n"));
  writeFileSync(
    join(projectDir, "manifest.yaml"),
    ['title: "Export stop fixture"', "preset: book", "source:", "  files:", "    - book.md", ""].join("\n"),
  );
  mkdirSync(userDataDir, { recursive: true });
  writeFileSync(
    join(userDataDir, "gutterpress-prefs.json"),
    JSON.stringify({ lastProjectDir: projectDir, showLandingAtStartup: false }),
  );
  // The drive exports, so it runs as an author (the app defaults to a reader).
  writeFileSync(join(userDataDir, "app-settings.json"), JSON.stringify({ workspace: { role: "author" } }));

  electronApp = await electron.launch({
    executablePath,
    args: [...(isMainJs ? [target] : []), `--user-data-dir=${userDataDir}`, "--no-sandbox"],
    env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
    timeout: 90_000,
  });
  const page = await waitForAppWindow(electronApp);
  await page.locator(".toc-item").first().waitFor({ state: "visible", timeout: 120_000 });
  log("book opened");

  await page.evaluate(() => {
    window.__progress = [];
    window.electron.onBuildProgress((event) => window.__progress.push(event));
  });

  // Start an export (not awaited); resolves to what it has seen so far.
  const startExport = async (name) => {
    await page.evaluate(
      ([input, out]) => {
        window.__progress.length = 0;
        window.__result = undefined;
        window.electron.build({ input, out }).then((r) => (window.__result = r));
      },
      [projectDir, join(projectDir, "dist", name)],
    );
  };
  const waitFor = async (what, read, timeoutMs) => {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const value = await read();
      if (value) return value;
      if (Date.now() > deadline) fail(`${what} did not happen within ${timeoutMs / 1000}s`);
      await new Promise((r) => setTimeout(r, 100));
    }
  };
  const rendering = () =>
    waitFor(
      "the render starting",
      () => page.evaluate(() => window.__progress.find((e) => e.state === "rendering") ?? null),
      60_000,
    );
  const result = (timeoutMs) => waitFor("the export settling", () => page.evaluate(() => window.__result ?? null), timeoutMs);
  // The export's hidden windows (every window that is not the app's own), as
  // the pid of each one's renderer and whether it has loaded the book yet.
  const renderWindows = () =>
    electronApp.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()
        .filter((w) => !w.isDestroyed() && !w.webContents.getURL().startsWith("app://") && !w.webContents.getURL().startsWith("data:"))
        .map((w) => ({
          pid: w.webContents.getOSProcessId(),
          laidOut: w.webContents.getURL().startsWith("file:") && !w.webContents.isLoading(),
        })),
    );

  // 1. The renderer dies mid-render.
  await startExport("crash.pdf");
  await rendering();
  // Once the book has loaded, the engine is waiting on the page (laying it
  // out): that wait is what a dead renderer used to leave unanswered.
  const pids = await waitFor("a render window with the book loaded", async () => {
    const found = (await renderWindows()).filter((w) => w.laidOut && w.pid > 0).map((w) => w.pid);
    return found.length ? found : null;
  }, 30_000);
  for (const pid of pids) process.kill(pid, "SIGKILL");
  log(`killed the render window's renderer (pid ${pids.join(", ")})`);
  const crashed = await result(30_000);
  const crashedText = JSON.stringify(crashed);
  if (crashed.ok !== false || !/renderer for this page crashed/.test(crashedText)) {
    fail(`a crashed renderer did not end the export with the crash sentence: ${crashedText}`);
  }
  log("the export failed with the crash sentence instead of hanging");

  // 2. Cancel mid-render.
  await startExport("cancel.pdf");
  const started = await rendering();
  const canceledAt = Date.now();
  const cancel = await page.evaluate((id) => window.electron.cancelExport(id), started.exportId);
  if (!cancel.canceled) fail(`Cancel was refused: ${JSON.stringify(cancel)}`);
  const stopped = await result(10_000);
  const tookMs = Date.now() - canceledAt;
  if (stopped.ok !== false || stopped.error?.code !== "EXPORT_CANCELED") {
    fail(`Cancel did not settle as canceled: ${JSON.stringify(stopped)}`);
  }
  // The render takes far longer than this; settling sooner means it was stopped.
  if (tookMs > 2500) fail(`Cancel took ${tookMs} ms to settle`);
  await waitFor("the hidden windows closing", async () => (await renderWindows()).length === 0, 5_000);
  log(`Cancel settled as canceled in ${tookMs} ms and the render windows closed`);

  // 3. The slot is free: another export runs to a PDF.
  await startExport("after.pdf");
  const done = await result(120_000);
  if (done.ok !== true || !existsSync(join(projectDir, "dist", "after.pdf"))) {
    fail(`the export after a cancel did not finish: ${JSON.stringify(done)}`);
  }
  log("the next export was accepted and finished");
  log("PASS: a dead renderer and Cancel both end the export promptly and free it for the next");
} catch (error) {
  console.error(`[export-cancel-and-crash] FAIL: ${error.stack ?? error.message}`);
  exitCode = 1;
} finally {
  await electronApp?.close().catch(() => {});
  if (projectDir) rmSync(dirname(projectDir), { recursive: true, force: true });
}
process.exit(exitCode);

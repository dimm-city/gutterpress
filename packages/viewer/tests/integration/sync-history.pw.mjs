#!/usr/bin/env node
/**
 * Windows-focused e2e: the FULL History-tab sync scenario in the packaged
 * Electron viewer, against a real in-process git smart-HTTP server (the lib's
 * test-support server — no system git anywhere, CLAUDE.md §7).
 *
 * Scenario (mirrors the v0.5.0 user flow that broke on Windows):
 *   1. Launch the packaged app; clone a MULTI-BOOK repo through the app's own
 *      IPC path (remote:cloneRepository) with platform-native paths, opening
 *      the books/alpha SUBFOLDER as the project (ADR 0006 D2).
 *      Also: connect a generic Git host against an authed instance of the
 *      same server — exercises the safeStorage credential store round-trip
 *      (DPAPI on Windows) + the Basic-auth refs probe.
 *   2. Advance the remote, relaunch the app auto-opening the cloned
 *      subfolder → the fetch-on-open "New changes online" modal must appear.
 *   3. History tab: Check for updates → incoming badge; Get changes → file
 *      content updated on disk + history refreshed + badge clears.
 *   4. Local edit → Send changes → server tip moves, pushed content matches.
 *   5. Remote advances again + another local edit → Send changes must show
 *      the "pull-first" message (never auto-merge); Get + Send then succeed.
 *
 * Main-process stderr is captured for the whole run; any `[remote:*]`/`[vcs:*]`
 * handler failure line is a test failure (those handlers only log on
 * UNEXPECTED faults — every expected outcome is a typed status).
 *
 * Usage:
 *   node tests/integration/sync-history.pw.mjs <packaged-exe-path> [ignored]
 *
 * Requires `bun` on PATH (runs the TypeScript fixture-server helper).
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { spawn } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

const __dirname = dirname(fileURLToPath(import.meta.url));

function log(msg) { console.log(`[synctest] ${msg}`); }

const [, , exeArg] = process.argv;
if (!exeArg) {
  console.error("[synctest] usage: sync-history.pw.mjs <packaged-exe-path>");
  process.exit(1);
}
const exePath = resolve(exeArg);
if (!existsSync(exePath)) {
  console.error(`[synctest] packaged exe not found at ${exePath}`);
  process.exit(1);
}

// ── Fixture git server (bun child — the helper imports lib TS test-support) ──

const helper = spawn("bun", [join(__dirname, "sync-fixture-server.ts")], {
  stdio: ["pipe", "pipe", "inherit"],
});
helper.on("error", (e) => {
  console.error(`[synctest] failed to spawn bun helper: ${e}`);
  process.exit(1);
});

const pending = new Map(); // id → resolve
let nextId = 1;
let readyResolve;
const ready = new Promise((r) => (readyResolve = r));
let helperBuf = "";
helper.stdout.on("data", (chunk) => {
  helperBuf += chunk.toString();
  let nl;
  while ((nl = helperBuf.indexOf("\n")) >= 0) {
    const line = helperBuf.slice(0, nl).trim();
    helperBuf = helperBuf.slice(nl + 1);
    if (!line) continue;
    let msg;
    try { msg = JSON.parse(line); } catch { continue; }
    if (msg.ready) readyResolve(msg);
    else if (pending.has(msg.id)) {
      pending.get(msg.id)(msg);
      pending.delete(msg.id);
    }
  }
});

function serverCmd(cmd, extra = {}) {
  const id = nextId++;
  return new Promise((resolvePromise, rejectPromise) => {
    const t = setTimeout(
      () => rejectPromise(new Error(`fixture-server cmd timed out: ${cmd}`)),
      30_000,
    );
    pending.set(id, (msg) => {
      clearTimeout(t);
      if (msg.ok) resolvePromise(msg);
      else rejectPromise(new Error(`fixture-server ${cmd} failed: ${msg.error}`));
    });
    helper.stdin.write(JSON.stringify({ id, cmd, ...extra }) + "\n");
  });
}

const fixture = await Promise.race([
  ready,
  new Promise((_, rej) =>
    setTimeout(() => rej(new Error("fixture server not ready in 60s")), 60_000),
  ),
]);
log(`git server up: ${fixture.url} (authed twin: ${fixture.authUrl})`);

// ── Shared launch plumbing ────────────────────────────────────────────────────

/** Main-process output captured across ALL launches (IPC errors land here). */
let mainOutput = "";

async function launchApp(userDataDir) {
  const app = await electron.launch({
    executablePath: exePath,
    args: [`--user-data-dir=${userDataDir}`, "--no-sandbox"],
    env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  });
  const proc = app.process();
  proc.stderr?.on("data", (d) => { mainOutput += d.toString(); });
  proc.stdout?.on("data", (d) => { mainOutput += d.toString(); });
  // The FIRST window can be the splash (which closes again) — poll for the
  // real SPA window on the app:// origin instead of trusting firstWindow().
  const deadline = Date.now() + 90_000;
  let page = null;
  for (;;) {
    page = app.windows().find((w) => w.url().startsWith("app://"));
    if (page) break;
    if (Date.now() > deadline) {
      throw new Error(
        `main app:// window never appeared (windows: ${app.windows().map((w) => w.url()).join(", ") || "none"})`,
      );
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  await page.waitForLoadState("domcontentloaded");
  await page.waitForFunction(
    () => typeof window.electron?.cloneRemoteRepository === "function",
    { timeout: 30_000 },
  );
  return { app, page };
}

function assertNoIpcErrors(where) {
  const hits = mainOutput.match(/\[(remote|vcs):[^\]]*\] failed:.*/g);
  if (hits) {
    throw new Error(
      `unexpected IPC handler failure(s) ${where}:\n  ${hits.join("\n  ")}`,
    );
  }
}

/** Poll for a file's content to contain a needle (pull writes async). */
async function waitForFileContains(file, needle, timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    try {
      if (readFileSync(file, "utf8").includes(needle)) return;
    } catch { /* not there yet */ }
    if (Date.now() - start > timeoutMs) {
      throw new Error(`file ${file} never contained "${needle}"`);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

let exitCode = 0;
let electronApp = null;
try {
  // ════ Phase 1: clone through the app + credential-store round-trip ═════════
  const userData1 = mkdtempSync(join(tmpdir(), "pmd-synctest-ud1-"));
  const parentDir = mkdtempSync(join(tmpdir(), "pmd-synctest-clone-"));
  log(`phase 1: launching for clone (parentDir=${parentDir})`);
  let { app, page } = await launchApp(userData1);
  electronApp = app;

  // Credential store: connect the AUTHED twin server as a generic Git host.
  // On Windows this exercises safeStorage/DPAPI encrypt; the testRemoteAccess
  // call below exercises decrypt + the Basic-auth header on the wire.
  const conn = await page.evaluate(
    (args) => window.electron.connectGenericHost(args),
    {
      host: fixture.authHost,
      username: fixture.authUser,
      token: fixture.authToken,
      repoUrl: fixture.authUrl,
    },
  );
  if (!conn?.connected) throw new Error(`connectGenericHost failed: ${JSON.stringify(conn)}`);
  log(`generic host connected (${conn.host}) — token stored via safeStorage`);

  const status = await page.evaluate(
    (host) => window.electron.getRemoteConnection(host),
    fixture.authHost,
  );
  if (!status?.connected) throw new Error(`getConnection(${fixture.authHost}) not connected`);

  const access = await page.evaluate(
    (url) => window.electron.testRemoteAccess(url),
    fixture.authUrl,
  );
  if (!access?.ok) {
    throw new Error(`testRemoteAccess with stored credential failed: ${JSON.stringify(access)}`);
  }
  log("stored credential decrypted + accepted by the authed server");

  // Clone the multi-book repo through the app's own IPC path, opening the
  // books/alpha SUBFOLDER (the user's exact app-clone shape).
  const cloneResult = await page.evaluate(
    (args) => window.electron.cloneRemoteRepository(args),
    {
      url: fixture.url,
      parentDir,
      folderName: "fixture-book",
      subPath: "books/alpha",
    },
  );
  const projectDir = cloneResult?.projectDir;
  if (!projectDir) throw new Error(`cloneRepository returned ${JSON.stringify(cloneResult)}`);
  log(`cloned; project (subfolder) = ${projectDir}`);

  const repoRoot = join(parentDir, "fixture-book");
  if (!existsSync(join(repoRoot, ".git"))) throw new Error(`no .git at ${repoRoot}`);
  if (!existsSync(join(projectDir, "manifest.yaml"))) {
    throw new Error(`opened subfolder has no manifest.yaml: ${projectDir}`);
  }
  const introFile = join(projectDir, "01-intro.md");
  const bodyFile = join(projectDir, "02-body.md");
  if (!existsSync(introFile)) throw new Error(`missing ${introFile}`);

  await app.close();
  electronApp = null;
  assertNoIpcErrors("during phase 1 (connect + clone)");

  // ════ Phase 2: remote advances; relaunch → fetch-on-open modal ═════════════
  const advance1 = await serverCmd("advance", {
    path: "books/alpha/01-intro.md",
    content: "# Alpha Intro {#ch-intro}\n\nRemote edit one.\n",
    message: "Remote edit #1",
  });
  log(`remote advanced to ${advance1.head} (Remote edit #1)`);

  // Seed prefs: auto-open the cloned subfolder, left panel open on History.
  const userData2 = mkdtempSync(join(tmpdir(), "pmd-synctest-ud2-"));
  writeFileSync(
    join(userData2, "viewer-prefs.json"),
    JSON.stringify({
      lastProjectDir: projectDir,
      leftPanel: { open: true, activeTab: "history", width: 340 },
    }),
  );
  log("phase 2: relaunching with project auto-open + History tab");
  ({ app, page } = await launchApp(userData2));
  electronApp = app;

  // Fetch-on-open: after the first render, the background previewSync must
  // detect the incoming remote commit and raise the modal.
  await page.locator("#incoming-title").waitFor({ timeout: 120_000 });
  const modalTitle = await page.locator("#incoming-title").textContent();
  if (!/new changes online/i.test(modalTitle ?? "")) {
    throw new Error(`unexpected modal title: ${modalTitle}`);
  }
  log('fetch-on-open modal appeared ("New changes online")');
  await page.getByRole("button", { name: "Not now" }).click();
  log('dismissed modal with "Not now" — continuing via the History tab');

  // ════ Phase 3: History tab — Check for updates → Get changes ═══════════════
  const checkBtn = page.locator(".sync-btns button", { hasText: "Check for updates" });
  await checkBtn.waitFor({ state: "visible", timeout: 30_000 });
  await checkBtn.click();
  await page
    .locator(".sync-status-badge", { hasText: /incoming|New changes online/i })
    .waitFor({ timeout: 60_000 });
  log("Check for updates → incoming badge shown");

  const getBtn = page.locator(".sync-btns button", { hasText: "Get changes" });
  await getBtn.click();
  await page
    .locator(".notice.small", { hasText: /downloaded|combined with your changes/i })
    .waitFor({ timeout: 60_000 });
  log("Get changes → success notice shown");

  await waitForFileContains(introFile, "Remote edit one.");
  log("pulled content verified on disk");

  // Badge must clear to Up to date (no stale "changes online").
  await page
    .locator(".sync-status-badge", { hasText: "Up to date" })
    .waitFor({ timeout: 30_000 });
  // History list refreshed with the remote commit.
  await page
    .locator(".snapshot-message", { hasText: "Remote edit #1" })
    .first()
    .waitFor({ timeout: 30_000 });
  log("badge cleared to Up to date; history shows the pulled commit");

  // ════ Phase 4: local edit → Send changes → server tip moves ════════════════
  const tipBefore = (await serverCmd("tip")).head;
  writeFileSync(bodyFile, "# Alpha Body {#ch-body}\n\nLocal edit one.\n");
  log("made a local edit (02-body.md)");

  const sendBtn = page.locator(".sync-btns button", { hasText: "Send changes" });
  await sendBtn.click();
  await page
    .locator(".notice.small", { hasText: "Your changes are online." })
    .waitFor({ timeout: 60_000 });
  const tipAfterPush = (await serverCmd("tip")).head;
  if (tipAfterPush === tipBefore) {
    throw new Error("Send changes reported success but the server tip did not move");
  }
  const pushed = await serverCmd("show", { path: "books/alpha/02-body.md" });
  if (!pushed.content.includes("Local edit one.")) {
    throw new Error(`pushed content mismatch on server:\n${pushed.content}`);
  }
  log(`Send changes → server tip ${tipBefore.slice(0, 7)} → ${tipAfterPush.slice(0, 7)}, content verified`);

  // ════ Phase 5: push-when-behind → pull-first message, then recover ═════════
  await serverCmd("advance", {
    path: "books/alpha/01-intro.md",
    content: "# Alpha Intro {#ch-intro}\n\nRemote edit two.\n",
    message: "Remote edit #2",
  });
  writeFileSync(bodyFile, "# Alpha Body {#ch-body}\n\nLocal edit two.\n");
  log("remote advanced again + second local edit — Send must demand pull-first");

  await sendBtn.click();
  await page
    .locator(".error-msg.small", { hasText: "Get the latest changes first" })
    .waitFor({ timeout: 60_000 });
  log("push-when-behind → pull-first message shown (no auto-merge)");

  // Recover: Get changes (merges the snapshot with the remote edit) then Send.
  await getBtn.click();
  await page
    .locator(".notice.small", { hasText: /downloaded|combined with your changes/i })
    .waitFor({ timeout: 60_000 });
  await waitForFileContains(introFile, "Remote edit two.");
  log("Get changes after pull-first → remote edit two on disk");

  await sendBtn.click();
  await page
    .locator(".notice.small", { hasText: "Your changes are online." })
    .waitFor({ timeout: 60_000 });
  const finalBody = await serverCmd("show", { path: "books/alpha/02-body.md" });
  if (!finalBody.content.includes("Local edit two.")) {
    throw new Error(`final pushed content mismatch on server:\n${finalBody.content}`);
  }
  log("recovery Send → local edit two is on the server");

  assertNoIpcErrors("during phases 2–5 (History tab scenario)");
  log("PASS: full History-tab sync scenario works end-to-end in the packaged app");
} catch (err) {
  console.error("[synctest] FAIL:", err);
  // Dump captured main-process output — the IPC error context lives here.
  if (mainOutput.trim()) {
    console.error("[synctest] ── captured main-process output ──");
    console.error(mainOutput.slice(-20_000));
  }
  exitCode = 1;
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  helper.stdin.write(JSON.stringify({ id: nextId++, cmd: "stop" }) + "\n");
  setTimeout(() => helper.kill(), 3_000).unref?.();
}
process.exit(exitCode);

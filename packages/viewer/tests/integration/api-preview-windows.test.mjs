#!/usr/bin/env node
/**
 * Drives the viewer's adapter-node server end-to-end on whatever platform
 * the runner is on. Proves the /api/preview route — the exact code path
 * the Electron viewer hits when a user picks a folder — handles native
 * paths correctly (backslashes on Windows, forward slashes on POSIX).
 *
 * Usage:  node tests/integration/api-preview-windows.test.mjs
 *
 * Assumes:
 *   - packages/viewer/build/index.js exists (`npm run build` was run)
 *   - packages/lib/dist/ exists (`bun run build` in packages/lib was run)
 *
 * Exit codes:  0 = pass, 1 = fail.
 */

import { spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, cpSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import net from "node:net";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VIEWER_ROOT = resolve(__dirname, "../..");
const REPO_ROOT = resolve(VIEWER_ROOT, "../..");
const FIXTURE_DIR = join(
  REPO_ROOT,
  "packages/cli/tests/integration/fixtures/smoke"
);
const SERVER_ENTRY = join(VIEWER_ROOT, "build/index.js");

function log(msg) {
  console.log(`[itest] ${msg}`);
}

function fail(msg) {
  console.error(`[itest] FAIL: ${msg}`);
  process.exit(1);
}

async function pickFreePort() {
  return new Promise((res, rej) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", rej);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      srv.close(() => res(port));
    });
  });
}

async function waitForPort(port, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise((res) => {
      const s = net.createConnection({ port, host: "127.0.0.1" });
      s.on("connect", () => { s.destroy(); res(true); });
      s.on("error", () => res(false));
    });
    if (ok) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server did not start within ${timeoutMs}ms`);
}

function copyFixtureToTemp() {
  const root = mkdtempSync(join(tmpdir(), "viewer-itest-"));
  cpSync(FIXTURE_DIR, root, { recursive: true });
  return root;
}

function makeProjectWithSharedAssets() {
  const root = mkdtempSync(join(tmpdir(), "viewer-itest-shared-"));
  const sharedCss = join(root, "_shared", "css");
  const projectDir = join(root, "book");
  mkdirSync(sharedCss, { recursive: true });
  mkdirSync(projectDir, { recursive: true });
  writeFileSync(join(sharedCss, "print.css"), "body { color: black; }\n");
  writeFileSync(
    join(projectDir, "manifest.yaml"),
    [
      "title: Shared Assets Test",
      "source:",
      "  assets:",
      "    - ../_shared",
      "",
    ].join("\n")
  );
  writeFileSync(
    join(projectDir, "chapter-01.md"),
    "# Shared Assets Test\n\nBody text for layout.\n"
  );
  return { root, projectDir };
}

async function main() {
  const port = await pickFreePort();
  log(`Picked port ${port}; spawning adapter-node server: node ${SERVER_ENTRY}`);

  const child = spawn(process.execPath, [SERVER_ENTRY], {
    env: {
      ...process.env,
      PORT: String(port),
      HOST: "127.0.0.1",
      ORIGIN: `http://127.0.0.1:${port}`,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => { stdout += d.toString(); process.stdout.write(d); });
  child.stderr.on("data", (d) => { stderr += d.toString(); process.stderr.write(d); });
  child.on("exit", (code) => log(`server child exited with code ${code}`));

  try {
    await waitForPort(port);
    log(`server is up on http://127.0.0.1:${port}`);

    // ── Case 1: open a simple project ──────────────────────────────────
    const project1 = copyFixtureToTemp();
    log(`POST /api/preview with input=${project1}`);
    const res1 = await fetch(`http://127.0.0.1:${port}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: project1 }),
    });
    if (res1.status !== 200) {
      fail(`/api/preview returned ${res1.status}: ${await res1.text()}`);
    }
    const data1 = await res1.json();
    log(`server returned ${JSON.stringify(data1)}`);
    if (typeof data1.url !== "string" || !/^http:\/\/127\.0\.0\.1:\d+$/.test(data1.url)) {
      fail(`bad url in response: ${data1.url}`);
    }
    const book1 = await fetch(`${data1.url}/book.html`);
    if (book1.status !== 200) fail(`book.html returned ${book1.status}`);
    const html1 = await book1.text();
    if (!html1.includes("Smoke Test")) {
      fail(`book.html missing expected content (first 300 chars: ${html1.slice(0, 300)})`);
    }
    log("case 1 PASS: simple project loaded and book.html served");

    // ── Case 2: project with external ../_shared assets root ───────────
    const { root: project2Root, projectDir: project2 } = makeProjectWithSharedAssets();
    log(`POST /api/preview with input=${project2} (with ../_shared)`);
    const res2 = await fetch(`http://127.0.0.1:${port}/api/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ input: project2 }),
    });
    if (res2.status !== 200) {
      fail(`/api/preview returned ${res2.status}: ${await res2.text()}`);
    }
    const data2 = await res2.json();
    log(`server returned ${JSON.stringify(data2)}`);
    const book2 = await fetch(`${data2.url}/book.html`);
    if (book2.status !== 200) fail(`book.html returned ${book2.status}`);
    const html2 = await book2.text();
    if (!html2.includes("Shared Assets Test")) {
      fail(`book.html missing expected content for case 2`);
    }
    const css2 = await fetch(`${data2.url}/_shared/css/print.css`);
    if (css2.status !== 200) {
      fail(`shared asset css returned ${css2.status}`);
    }
    log("case 2 PASS: project with external assets loaded and served");

    // ── Done ────────────────────────────────────────────────────────────
    log("all cases passed");

    // Cleanup tempdirs
    try {
      rmSync(project1, { recursive: true, force: true });
      rmSync(project2Root, { recursive: true, force: true });
    } catch { /* ignore */ }
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err));
  } finally {
    log("stopping server");
    child.kill();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

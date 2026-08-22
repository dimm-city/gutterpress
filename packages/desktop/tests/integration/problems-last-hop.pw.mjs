#!/usr/bin/env node
/**
 * Real-Electron acceptance check for the two last hops into the Problems panel:
 *
 *   1. A malformed authored layout marker reaches the panel with its exact
 *      source file/line, and selecting it opens the editor with that formerly
 *      off-screen line revealed.
 *   2. A PDF export of an authored multicol section returns a native-engine
 *      diagnostic, which the same panel renders with its writer-facing label.
 *
 * The committed fixture is copied to a throwaway project and replaced with a
 * minimal purpose-built book. No fixture or preference mutation survives the
 * run, and the native Save dialog is stubbed only inside this Electron process.
 *
 * Usage:
 *   node tests/integration/problems-last-hop.pw.mjs <exe-or-main-js> [fixture-dir]
 */
import { _electron as electron } from "playwright-core";
import {
  cpSync,
  existsSync,
  mkdtempSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppWindow } from "./app-window.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg, fixtureArg] = process.argv;

function fail(message) {
  throw new Error(message);
}

function log(message) {
  console.log(`[problems-last-hop] ${message}`);
}

async function waitUntil(check, timeoutMs, description) {
  const deadline = Date.now() + timeoutMs;
  let lastError;
  while (Date.now() < deadline) {
    try {
      if (await check()) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((done) => setTimeout(done, 250));
  }
  const label = typeof description === "function" ? description() : description;
  fail(`${label} (${timeoutMs}ms)${lastError ? `: ${lastError.message}` : ""}`);
}

if (!targetArg) {
  console.error(
    "usage: problems-last-hop.pw.mjs <packaged-exe-or-out/main/main.js> [fixture-dir]",
  );
  process.exit(1);
}

const target = resolve(targetArg);
if (!existsSync(target)) fail(`desktop target not found: ${target}`);
const sourceFixture = resolve(fixtureArg ?? join(here, "fixtures", "multichapter"));
if (!existsSync(sourceFixture)) fail(`fixture not found: ${sourceFixture}`);

const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;

let electronApp;
let projectDir;
let userDataDir;
let outputPath;
let malformedLine;
let exitCode = 0;
let shuttingDown = false;

function cleanupTemporaryPaths() {
  // Remove only the throwaway paths minted by this process. Keep each removal
  // independent so one filesystem failure cannot prevent the other cleanup.
  for (const dir of [projectDir, userDataDir]) {
    if (!dir) continue;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {}
  }
  projectDir = undefined;
  userDataDir = undefined;
}

async function handleSignal(exitStatus) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await electronApp?.close();
  } catch {
    // The process is already shutting down; cleanup below is still required.
  } finally {
    cleanupTemporaryPaths();
    process.exit(exitStatus);
  }
}

process.once("SIGINT", () => void handleSignal(130));
process.once("SIGTERM", () => void handleSignal(143));

try {
  projectDir = mkdtempSync(join(tmpdir(), "gutterpress-problems-last-hop-project-"));
  userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-problems-last-hop-home-"));
  outputPath = join(userDataDir, "problems-last-hop.pdf");
  cpSync(sourceFixture, projectDir, { recursive: true });

  // Put the malformed marker well below the initial CodeMirror viewport. The
  // click-through assertion can then distinguish a real line reveal from merely
  // opening the right file while leaving the editor at line 1.
  const lines = ["@page", "", "# Problems-panel last-hop fixture", ""];
  for (let i = 1; i <= 80; i += 1) {
    lines.push(`Padding paragraph ${i}.`, "");
  }
  malformedLine = lines.length + 1;
  lines.push(
    "@secton {.gp-columns-2}",
    "",
    "This typo must appear in the Problems panel.",
    "",
    // Real author marker syntax is load-bearing here: the engine diagnostic
    // must be seeded through Gutterpress's authoring surface, not raw HTML that
    // markdown rendering could discard.
    "@section {.e2e-fragmenting-columns}",
    "",
    "This deliberately tall multicol section exercises the export diagnostic hop.",
    "",
    "@end-section",
    "",
  );
  writeFileSync(join(projectDir, "01-alpha.md"), `${lines.join("\n")}\n`);
  writeFileSync(
    join(projectDir, "e2e.css"),
    [
      ".e2e-fragmenting-columns {",
      "  column-count: 2;",
      "  column-fill: balance;",
      "  height: 2000px;",
      "}",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(projectDir, "manifest.yaml"),
    [
      'title: "Problems-panel last-hop fixture"',
      "source:",
      "  files:",
      "    - 01-alpha.md",
      "styles:",
      "  - e2e.css",
      "",
    ].join("\n"),
  );
  writeFileSync(
    join(userDataDir, "gutterpress-prefs.json"),
    JSON.stringify({
      lastProjectDir: projectDir,
      leftPanel: { open: true, activeTab: "toc", width: 300 },
      showLandingAtStartup: false,
    }),
  );

  const args = [
    ...(isMainJs ? [target] : []),
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
  ];

  log(`launching real Electron app from ${target}`);
  electronApp = await electron.launch({
    executablePath,
    args,
    env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
    timeout: 90_000,
  });
  const page = await waitForAppWindow(electronApp);
  await page.locator(".toc-item").first().waitFor({ state: "visible", timeout: 120_000 });
  log("throwaway project opened and preview rendered");

  const toggle = page.locator(".toggle-strip");
  await toggle.waitFor({ state: "visible", timeout: 30_000 });
  await toggle.click();

  const markerEntry = page
    .locator(".problems-panel .entry")
    .filter({ hasText: "@secton" })
    .first();
  await markerEntry.waitFor({ state: "visible", timeout: 30_000 });
  const markerEvidence = await markerEntry.evaluate((entry) => {
    const group = entry.closest(".group");
    return {
      file: group?.querySelector(".group-file-name")?.textContent?.trim() ?? null,
      line: entry.querySelector(".entry-line")?.textContent?.trim() ?? null,
      source: entry.querySelector(".entry-source")?.textContent?.trim() ?? null,
      message: entry.querySelector(".entry-message")?.textContent?.trim() ?? null,
    };
  });
  if (markerEvidence.file !== "01-alpha.md") {
    fail(`malformed marker grouped under ${markerEvidence.file}, expected 01-alpha.md`);
  }
  if (markerEvidence.line !== `line ${malformedLine}`) {
    fail(
      `malformed marker reported at ${markerEvidence.line}, expected line ${malformedLine}`,
    );
  }
  if (markerEvidence.source !== "Layout marker") {
    fail(`malformed marker label was ${markerEvidence.source}, expected Layout marker`);
  }
  log(`source diagnostic arrived: ${JSON.stringify(markerEvidence)}`);

  await markerEntry.click();
  await page.locator(".cm-editor").waitFor({ state: "visible", timeout: 15_000 });
  let revealEvidence = null;
  await waitUntil(
    async () => {
      revealEvidence = await page.evaluate(() => {
        const scroller = document.querySelector(".cm-scroller");
        const targetLine = [...document.querySelectorAll(".cm-line")].find((line) =>
          line.textContent?.includes("@secton"),
        );
        if (!scroller || !targetLine) {
          return {
            found: false,
            renderedLines: document.querySelectorAll(".cm-line").length,
            scrollTop: scroller?.scrollTop ?? null,
          };
        }
        const viewport = scroller.getBoundingClientRect();
        const target = targetLine.getBoundingClientRect();
        return {
          found: true,
          visible: target.top >= viewport.top && target.bottom <= viewport.bottom,
          offsetFromTop: Math.round(target.top - viewport.top),
          scrollTop: scroller.scrollTop,
        };
      });
      return revealEvidence?.visible === true;
    },
    15_000,
    () => `malformed marker line was not revealed in the editor; last state ${JSON.stringify(revealEvidence)}`,
  );
  const activeFile = await page.locator(".file-item.active .file-name").textContent();
  if (activeFile?.trim() !== "01-alpha.md") {
    fail(`problem navigation opened ${activeFile}, expected 01-alpha.md`);
  }
  log(
    `problem click opened ${activeFile?.trim()} and revealed line ${malformedLine}: ${JSON.stringify(revealEvidence)}`,
  );

  // Keep the real route/capability/export path. Only replace the native file
  // picker, which an automated renderer cannot interact with headlessly.
  await electronApp.evaluate(({ dialog }, out) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
  }, outputPath);
  await page.locator("button.export-btn").click();
  await page.locator(".export-dialog").waitFor({ state: "visible", timeout: 5_000 });
  await page.locator(".export-dialog .dlg-primary").click();
  await waitUntil(
    () => existsSync(outputPath) && statSync(outputPath).size > 1_000,
    120_000,
    "PDF export did not finish",
  );

  const engineEntry = page
    .locator(".problems-panel .entry")
    .filter({ hasText: "earlier pages are left with an empty column" })
    .first();
  await engineEntry.waitFor({ state: "visible", timeout: 15_000 });
  const engineEvidence = await engineEntry.evaluate((entry) => ({
    source: entry.querySelector(".entry-source")?.textContent?.trim() ?? null,
    message: entry.querySelector(".entry-message")?.textContent?.trim() ?? null,
    clickable: entry.tagName === "BUTTON",
  }));
  if (engineEvidence.source !== "Empty column") {
    fail(`engine diagnostic label was ${engineEvidence.source}, expected Empty column`);
  }
  if (engineEvidence.clickable) {
    fail("engine diagnostic invented a source jump even though it has no source location");
  }
  log(`export diagnostic arrived: ${JSON.stringify(engineEvidence)}`);
  log(
    `PASS: marker file/line/navigation and exported native-engine diagnostic reached the real Problems panel (${statSync(outputPath).size} bytes)`,
  );
} catch (error) {
  console.error(`[problems-last-hop] FAIL: ${error.stack ?? error.message}`);
  exitCode = 1;
} finally {
  await electronApp?.close().catch(() => {});
  cleanupTemporaryPaths();
}

process.exit(exitCode);

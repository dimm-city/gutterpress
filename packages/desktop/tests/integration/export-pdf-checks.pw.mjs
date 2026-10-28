#!/usr/bin/env node
/**
 * Real-Electron acceptance check for #399: the post-build PDF checks run on
 * the desktop's export path, and what they find reaches the Problems panel.
 *
 * A purpose-built book targets DriveThruRPG (`preset: dtrpg`, `targets:
 * [dtrpg]`) and pushes its body text to 0.15in from the trim, inside the
 * target's 0.5in text safe area. Exporting it with the quick-export shortcut
 * (Ctrl+Shift+E — the native Save dialog is stubbed in this Electron process
 * only, so the whole SPA hop runs: ExportController → host build → checks →
 * findings → toast → Problems) must:
 *
 *   1. report `pdf.print.safe-margins`'s finding — the page, the words and the
 *      edge — under its writer-facing label "Safe margins", file-less (no
 *      source jump), counted on the badge as an error;
 *   2. report the target's required PDF/X check as an ERROR either way: the
 *      lib's synthetic "requires check … skipped because required tools are
 *      not available" when qpdf is absent (this container), or the check's
 *      own non-conformance findings on a plain PDF when it is present. Never
 *      a silent pass;
 *   3. tell the author in a toast how many problems the checks found, whose
 *      Review button opens the Problems list.
 *
 * No fixture or preference mutation survives the run. Every panel entry is
 * logged, and `EXPORT_PDF_CHECKS_SHOT=<png path>` saves a screenshot of the
 * panel at the end for a reviewer.
 *
 * Usage:
 *   node tests/integration/export-pdf-checks.pw.mjs <exe-or-main-js>
 */
import { _electron as electron } from "playwright-core";
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { waitForAppWindow } from "./app-window.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg] = process.argv;

function fail(message) {
  throw new Error(message);
}

function log(message) {
  console.log(`[export-pdf-checks] ${message}`);
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
  console.error("usage: export-pdf-checks.pw.mjs <packaged-exe-or-out/main/main.js>");
  process.exit(1);
}

const target = resolve(targetArg);
if (!existsSync(target)) fail(`desktop target not found: ${target}`);

const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;

let electronApp;
let projectDir;
let userDataDir;
let outputPath;
let exitCode = 0;
let shuttingDown = false;

function cleanupTemporaryPaths() {
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
    // Already shutting down; the cleanup below is still required.
  } finally {
    cleanupTemporaryPaths();
    process.exit(exitStatus);
  }
}

process.once("SIGINT", () => void handleSignal(130));
process.once("SIGTERM", () => void handleSignal(143));

try {
  projectDir = mkdtempSync(join(tmpdir(), "gutterpress-export-pdf-checks-project-"));
  userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-export-pdf-checks-home-"));
  // Where the stubbed Save dialog points the export: inside the book, so the
  // host authorizes it either way (dialog capability or in-project path).
  mkdirSync(join(projectDir, "dist"), { recursive: true });
  outputPath = join(projectDir, "dist", `${basename(projectDir)}.pdf`);

  writeFileSync(
    join(projectDir, "01-edge.md"),
    [
      "@page",
      "",
      "# Safe-margins fixture",
      "",
      "This paragraph sits too close to the trim for DriveThruRPG.",
      "",
    ].join("\n"),
  );
  // Standard CSS Paged Media: the page margin is the author's to set, and
  // 0.15in puts every line inside the dtrpg preset's 0.5in text safe area.
  writeFileSync(join(projectDir, "e2e.css"), "@page { margin: 0.15in; }\n");
  writeFileSync(
    join(projectDir, "manifest.yaml"),
    [
      'title: "Export PDF checks fixture"',
      "preset: dtrpg",
      "targets:",
      "  - dtrpg",
      "source:",
      "  files:",
      "    - 01-edge.md",
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
  log("throwaway dtrpg project opened and preview rendered");

  // The quick export: Ctrl+Shift+E asks the host for a Save destination
  // through Electron's native dialog, which cannot be driven — so this process
  // answers it with the fixture's own path. Patched on the `dialog` module
  // object in MAIN, which is what `electron/main.ts`'s `showSaveDialog` host
  // service calls; the `dialog:savePdf` route then registers the returned
  // path as the one-time save capability the export controller consumes,
  // exactly as for a real pick.
  await electronApp.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, outputPath);
  await page.locator("body").click({ position: { x: 5, y: 5 } }).catch(() => {});
  await page.keyboard.press("Control+Shift+E");
  await waitUntil(
    () => existsSync(outputPath) && statSync(outputPath).size > 1_000,
    120_000,
    "PDF export did not finish",
  );
  log(`PDF exported (${statSync(outputPath).size} bytes)`);

  // 3. The findings toast, and its Review button opening the Problems list.
  const findingsToast = page.locator(".toast.toast-warning").filter({ hasText: "found in the PDF" });
  await findingsToast.waitFor({ state: "visible", timeout: 30_000 });
  const toastText = (await findingsToast.locator(".toast-message").textContent())?.trim();
  if (!/^\d+ problems? found in the PDF — see Problems\.$/.test(toastText ?? "")) {
    fail(`findings toast read "${toastText}"`);
  }
  await findingsToast.locator("button.toast-action", { hasText: "Review" }).click();
  log(`findings toast arrived and Review was pressed: "${toastText}"`);

  // 1. Safe margins, with its page, words and edge, under its label.
  const marginEntry = page
    .locator(".problems-panel .entry")
    .filter({ hasText: "too close to the" })
    .first();
  await marginEntry.waitFor({ state: "visible", timeout: 15_000 });
  const marginEvidence = await marginEntry.evaluate((entry) => ({
    source: entry.querySelector(".entry-source")?.textContent?.trim() ?? null,
    message: entry.querySelector(".entry-message")?.textContent?.trim() ?? null,
    severity: entry.querySelector(".entry-severity")?.className ?? null,
    clickable: entry.tagName === "BUTTON",
    group: entry.closest(".group")?.querySelector(".group-file-name")?.textContent?.trim() ?? null,
  }));
  if (marginEvidence.source !== "Safe margins") {
    fail(`safe-margins finding label was ${marginEvidence.source}, expected Safe margins`);
  }
  if (!/^\[dtrpg\] Page 1: ".+" is [\d.]+in too close to the (top|bottom|binding|outside) edge\./.test(marginEvidence.message ?? "")) {
    fail(`safe-margins finding did not name the page, words and edge: ${marginEvidence.message}`);
  }
  if (!/sev-error/.test(marginEvidence.severity ?? "")) {
    fail(`safe-margins finding was not an error: ${marginEvidence.severity}`);
  }
  if (marginEvidence.clickable) {
    fail("safe-margins finding invented a source jump even though it is about the PDF");
  }
  if (marginEvidence.group !== "Book") {
    fail(`safe-margins finding grouped under ${marginEvidence.group}, expected Book`);
  }
  log(`safe-margins finding arrived: ${JSON.stringify(marginEvidence)}`);

  // 2. The target's required PDF/X check has an error verdict, with or
  //    without qpdf on this computer.
  const pdfxEntries = page
    .locator(".problems-panel .entry")
    .filter({ has: page.locator(".entry-source", { hasText: /^PDF\/X markers$/ }) });
  await pdfxEntries.first().waitFor({ state: "visible", timeout: 15_000 });
  const pdfxEvidence = await pdfxEntries.first().evaluate((entry) => ({
    message: entry.querySelector(".entry-message")?.textContent?.trim() ?? null,
    severity: entry.querySelector(".entry-severity")?.className ?? null,
  }));
  if (!/sev-error/.test(pdfxEvidence.severity ?? "")) {
    fail(`PDF/X markers verdict was not an error: ${JSON.stringify(pdfxEvidence)}`);
  }
  const syntheticSkip = /requires check pdf\.print\.pdfx-markers, but it was skipped because required tools are not available/.test(
    pdfxEvidence.message ?? "",
  );
  log(
    `required PDF/X check reported an error (${syntheticSkip ? "qpdf absent: the lib's synthetic error" : "qpdf present: the check's own finding"}): ${pdfxEvidence.message}`,
  );

  const allEntries = await page.locator(".problems-panel .entry").evaluateAll((entries) =>
    entries.map((entry) => ({
      source: entry.querySelector(".entry-source")?.textContent?.trim() ?? null,
      severity: /sev-(\w+)/.exec(entry.querySelector(".entry-severity")?.className ?? "")?.[1] ?? null,
      message: entry.querySelector(".entry-message")?.textContent?.trim() ?? null,
    })),
  );
  for (const entry of allEntries) log(`panel entry: ${JSON.stringify(entry)}`);
  if (process.env.EXPORT_PDF_CHECKS_SHOT) {
    await page.screenshot({ path: process.env.EXPORT_PDF_CHECKS_SHOT });
    log(`screenshot saved to ${process.env.EXPORT_PDF_CHECKS_SHOT}`);
  }

  // The badge counts these as errors, like any source error.
  const badgeLabel = await page.locator(".toggle-strip").getAttribute("aria-label");
  if (!/Problems: \d+ errors?/.test(badgeLabel ?? "")) {
    fail(`Problems badge did not count the PDF-check errors: ${badgeLabel}`);
  }
  log(`badge: ${badgeLabel}`);
  log("PASS: the post-build PDF checks ran on the exported file and their findings reached the real Problems panel");
} catch (error) {
  console.error(`[export-pdf-checks] FAIL: ${error.stack ?? error.message}`);
  exitCode = 1;
} finally {
  await electronApp?.close().catch(() => {});
  cleanupTemporaryPaths();
}

process.exit(exitCode);

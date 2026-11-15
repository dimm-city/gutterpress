#!/usr/bin/env node
/**
 * Real-Electron acceptance check for #399: the publish run checks each
 * target's file, and what the checks find reaches the wizard and the Problems
 * panel.
 *
 * A purpose-built book publishes to DriveThruRPG print (`publish:
 * drivethrurpg-print:`) and pushes its body text to 0.15in from the trim,
 * inside the target's 0.5in text safe area. "Check only" from the Publish
 * wizard (checks are on by default; the whole hop runs: wizard → main's
 * publish run → the lib's checks → result → wizard → Problems) must:
 *
 *   1. report `pdf.print.safe-margins`'s finding — the page, the words and the
 *      edge — under its writer-facing label "Safe margins", file-less (no
 *      source jump), counted on the badge as an error;
 *   2. report the target's required PDF/X check as an ERROR either way: the
 *      lib's synthetic "requires check … skipped because required tools are
 *      not available" when qpdf is absent, or the check's own findings when
 *      it is present. Never a silent pass;
 *   3. show the target held back in the wizard, with the safe-margins finding.
 *
 * No fixture or preference mutation survives the run. Every panel entry is
 * logged, and `PUBLISH_CHECKS_SHOT=<png path>` saves a screenshot of the
 * panel at the end for a reviewer.
 *
 * Usage:
 *   node tests/integration/publish-checks.pw.mjs <exe-or-main-js>
 */
import { _electron as electron } from "playwright-core";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
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
  console.log(`[publish-checks] ${message}`);
}

if (!targetArg) {
  console.error("usage: publish-checks.pw.mjs <packaged-exe-or-out/main/main.js>");
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
  projectDir = mkdtempSync(join(tmpdir(), "gutterpress-publish-checks-project-"));
  userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-publish-checks-home-"));
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
      'title: "Publish checks fixture"',
      "publish:",
      "  drivethrurpg-print:",
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
  // The drive exports, so it runs as an author (the app defaults to a
  // reader, who has no editor and no Problems list).
  writeFileSync(join(userDataDir, "app-settings.json"), JSON.stringify({ workspace: { role: "author" } }));

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

  // Targets (the book's one, sending, checks on) → Set up → Publish: Check only.
  await page.locator("button.publish-btn").click();
  const wizard = page.locator(".app-view.wizard");
  await wizard.waitFor({ state: "visible", timeout: 5_000 });
  if (!(await wizard.locator(".setting input").isChecked())) fail("checks were not on by default");
  const nextStep = async (label) => {
    await wizard.locator(".steps li.current").filter({ hasText: label }).waitFor({ timeout: 10_000 });
    await wizard.locator(".view-actions .app-btn-primary").click();
  };
  await nextStep("Targets");
  await nextStep("Set up");
  await wizard.locator(".steps li.current").filter({ hasText: "Publish" }).waitFor({ timeout: 10_000 });
  await wizard.locator(".view-actions button", { hasText: "Check only" }).click();

  // 3. The target is held back, with the safe-margins finding.
  const row = wizard.locator(".pub-row").filter({ hasText: "DriveThruRPG" });
  const held = row.locator(".warn").filter({ hasText: "Held back" });
  await held.waitFor({ state: "visible", timeout: 180_000 });
  const rowText = (await row.textContent())?.replace(/\s+/g, " ").trim() ?? "";
  if (!/too close to the/.test(rowText)) fail(`the held target did not show the safe-margins finding: "${rowText}"`);
  log(`wizard: ${rowText}`);
  await wizard.locator(".view-actions button", { hasText: "Done" }).click();
  await wizard.waitFor({ state: "hidden", timeout: 5_000 });
  await page.locator(".toggle-strip").click();

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
  // Findings are tagged with the target they were checked for.
  if (!/^\[drivethrurpg-print\] Page 1: ".+" is [\d.]+in too close to the (top|bottom|binding|outside) edge\./.test(marginEvidence.message ?? "")) {
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

  // 2. The print target's file is the PDF/X itself, checked against its PDF/X
  //    rule: it passes where qpdf can read it, and is an error, never a silent
  //    pass, where qpdf is missing.
  const hasQpdf = spawnSync("qpdf", ["--version"]).status === 0;
  const pdfxEntries = page
    .locator(".problems-panel .entry")
    .filter({ has: page.locator(".entry-source", { hasText: /^PDF\/X markers$/ }) });
  if (hasQpdf) {
    if ((await pdfxEntries.count()) > 0) {
      fail(`the PDF/X failed its PDF/X markers check: ${await pdfxEntries.first().textContent()}`);
    }
    log("qpdf present: the PDF/X passed its PDF/X markers check");
  } else {
    await pdfxEntries.first().waitFor({ state: "visible", timeout: 15_000 });
    const message = await pdfxEntries.first().locator(".entry-message").textContent();
    if (!/requires check pdf\.print\.pdfx-markers, but it was skipped/.test(message ?? "")) {
      fail(`qpdf absent, but the PDF/X markers entry read: ${message}`);
    }
    log(`qpdf absent: the required check reported its skip as an error: ${message}`);
  }

  const allEntries = await page.locator(".problems-panel .entry").evaluateAll((entries) =>
    entries.map((entry) => ({
      source: entry.querySelector(".entry-source")?.textContent?.trim() ?? null,
      severity: /sev-(\w+)/.exec(entry.querySelector(".entry-severity")?.className ?? "")?.[1] ?? null,
      message: entry.querySelector(".entry-message")?.textContent?.trim() ?? null,
    })),
  );
  for (const entry of allEntries) log(`panel entry: ${JSON.stringify(entry)}`);
  if (process.env.PUBLISH_CHECKS_SHOT) {
    await page.screenshot({ path: process.env.PUBLISH_CHECKS_SHOT });
    log(`screenshot saved to ${process.env.PUBLISH_CHECKS_SHOT}`);
  }

  // The badge counts these as errors, like any source error.
  const badgeLabel = await page.locator(".toggle-strip").getAttribute("aria-label");
  if (!/Problems: \d+ errors?/.test(badgeLabel ?? "")) {
    fail(`Problems badge did not count the PDF-check errors: ${badgeLabel}`);
  }
  log(`badge: ${badgeLabel}`);
  log("PASS: the publish run checked the target's file and its findings reached the wizard and the real Problems panel");
} catch (error) {
  console.error(`[publish-checks] FAIL: ${error.stack ?? error.message}`);
  exitCode = 1;
} finally {
  await electronApp?.close().catch(() => {});
  cleanupTemporaryPaths();
}

process.exit(exitCode);

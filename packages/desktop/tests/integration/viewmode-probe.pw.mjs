// Pinned-scroll view-mode probe: go to page 1, then toggle modes and count
// sheets-per-row (distinct `left` values among sheets sharing a `top`).
import { _electron as electron } from "playwright-core";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const desktopDir = "/home/founder3/code/dimm-city/print-md/packages/desktop";
const electronBin = createRequire(join(desktopDir, "package.json"))("electron");
const mainJs = join(desktopDir, "out", "main", "main.js");
const [, , fixtureArg, label] = process.argv;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const userDataDir = mkdtempSync(join(tmpdir(), `vm-${label}-`));
writeFileSync(join(userDataDir, "gutterpress-prefs.json"), JSON.stringify({
  lastProjectDir: fixtureArg, leftPanel: { open: true, activeTab: "toc", width: 300 }, showLandingAtStartup: false }));
const app = await electron.launch({ executablePath: electronBin,
  args: [mainJs, `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" }, timeout: 90_000 });
let page;
for (;;) { page = app.windows().find((w) => w.url().startsWith("app://")); if (page) break; await sleep(200); }
await page.waitForLoadState("domcontentloaded");
const book = page.frameLocator('iframe[title="Gutterpress preview"]').frameLocator("#gutterpress-active");
const body = book.locator("body");
await body.waitFor({ state: "attached", timeout: 60_000 });
await Promise.race([
  book.locator(".pagedjs_page").first().waitFor({ state: "visible", timeout: 60_000 }).catch(()=>{}),
  book.locator(".gp-sheet").first().waitFor({ state: "visible", timeout: 60_000 }).catch(()=>{}),
]);
const shot = async () => {
  await body.evaluate((el) => el.ownerDocument.defaultView.previewAPI.goToPage(1));
  await sleep(900);
  return body.evaluate((el) => {
    const doc = el.ownerDocument;
    const sheets = [...doc.querySelectorAll(".gp-sheet, .pagedjs_page")].slice(0, 8)
      .map((n) => { const r = n.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; });
    const rows = {};
    for (const s of sheets) (rows[s.top] ||= new Set()).add(s.left);
    const perRow = Object.values(rows).map((s) => s.size);
    return { bodyClass: doc.body.className, sheets, maxSheetsPerRow: Math.max(...perRow) };
  });
};
const click = async (aria) => { await page.locator(`button[aria-label="${aria}"]`).click(); await sleep(800); };
await click("Single page view");
const single = await shot();
await click("Two pages side by side");
const twoUp = await shot();
await click("Single page view");
const singleAgain = await shot();
console.log(`[${label}] SINGLE     ${JSON.stringify(single)}`);
console.log(`[${label}] TWO-UP     ${JSON.stringify(twoUp)}`);
console.log(`[${label}] SINGLE(2)  ${JSON.stringify(singleAgain)}`);
await app.close().catch(()=>{});
process.exit(0);

// Screenshot representative pages per engine for the #46 audit.
// Usage: node shoot.mjs --url <url> --label <name> [--engines a,b,c]
import { chromium, firefox, webkit } from "playwright";
import { mkdirSync } from "node:fs";

const ENGINES = { chromium, firefox, webkit };
const arg = (n, f) => {
  const i = process.argv.indexOf(`--${n}`);
  return i !== -1 ? process.argv[i + 1] : f;
};
const url = arg("url");
const label = arg("label", "proj");
const outDir = arg("out", "/tmp/claude-1000/compat-shots");
const engines = arg("engines", "chromium,firefox,webkit").split(",");
mkdirSync(outDir, { recursive: true });

for (const name of engines) {
  const browser = await ENGINES[name].launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1000, height: 1400 } });
  await page.addInitScript(() => {
    window.__gutterpressRender = { done: false };
    window.addEventListener("renderingComplete", () => (window.__gutterpressRender = { done: true }));
  });
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  let frame = null;
  const deadline = Date.now() + 30_000;
  while (!frame && Date.now() < deadline) {
    frame = page.frames().find((f) => f.url().includes("book.html")) || null;
    if (!frame && page.frames().length === 1) frame = page.mainFrame();
    if (!frame) await page.waitForTimeout(250);
  }
  await frame.waitForFunction(() => window.__gutterpressRender && window.__gutterpressRender.done, null, {
    timeout: 180_000,
    polling: 250,
  });
  // Pick representative pages: 1, first page with multicol section, first table-heavy page.
  const picks = await frame.evaluate(() => {
    const pages = Array.from(document.querySelectorAll(".pagedjs_page"));
    const out = [{ idx: 0, tag: "p1" }];
    const colIdx = pages.findIndex((p) => p.querySelector(".two-column, .three-column, .col-split, .section.probe-columns"));
    if (colIdx > 0) out.push({ idx: colIdx, tag: `p${colIdx + 1}-columns` });
    const tblIdx = pages.findIndex((p) => p.querySelectorAll("table").length >= 1 && p.querySelectorAll("tr").length >= 4);
    if (tblIdx > 0 && tblIdx !== colIdx) out.push({ idx: tblIdx, tag: `p${tblIdx + 1}-table` });
    pages.forEach((p, i) => p.setAttribute("data-shot-idx", String(i)));
    return out;
  });
  for (const { idx, tag } of picks) {
    const el = frame.locator(`.pagedjs_page[data-shot-idx="${idx}"]`);
    await el.scrollIntoViewIfNeeded();
    await el.screenshot({ path: `${outDir}/${label}-${name}-${tag}.jpg`, type: "jpeg", quality: 60 });
    console.log(`${label} ${name} ${tag} captured`);
  }
  await browser.close();
}

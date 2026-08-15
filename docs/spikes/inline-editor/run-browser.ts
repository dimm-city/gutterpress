import fsp from "node:fs/promises"; import path from "node:path";
import { serveDir } from "../../../packages/cli/src/engine/viewer/test-support/serve-dir.ts";
import { getAssetPath } from "../../../packages/cli/src/lib/embedded-assets.ts";
import { getBrowser, closeBrowser } from "../../../packages/cli/src/lib/browser-pool.ts";

const SPIKE = "/tmp/claude-0/-home-user-gutterpress/0e2f1e65-8402-591e-bf20-2d6c96d51fba/scratchpad/tiptap-spike";
const dir = await fsp.mkdtemp(path.join(SPIKE, "run-"));
const lorem = "Gutter presses hum through the night shift, setting long galleys of borrowed prose while the compositor argues with the clock about widows.";
let body = ""; for (let i = 0; i < 600; i++) body += `<p>§${i} ${lorem}</p>\n`;
await fsp.writeFile(path.join(dir, "book.html"), `<!doctype html><html><head><meta charset="utf-8">
<style>@page{size:4in 3in;margin:.4in}body{font:11pt/1.35 Georgia,serif;margin:0}p{margin:0 0 6pt}</style>
</head><body><main id="root">${body}</main>
<script src="gutterpress-viewer.js"></script><script src="spike-editor.js"></script></body></html>`);
await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
await fsp.copyFile(path.join(SPIKE, "spike-editor.js"), path.join(dir, "spike-editor.js"));

const { url, close } = await serveDir(dir, "book.html");
const browser = await getBrowser(120_000); const page = await browser.newPage();
const log: string[] = []; page.on("pageerror", (e) => log.push("PAGEERROR " + String(e).slice(0, 160)));
try {
  await page.goto(`${url}book.html`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
  const before = await page.evaluate(() => ({
    pages: (window as any).Gutterpress.totalPages,
    strips: document.querySelectorAll(".gp-strip").length,
    paras: document.querySelectorAll(".gp-strip p").length,
  }));

  const mounted = await page.evaluate(() => (window as any).SPIKE.mount(".gp-strip"));
  const after = await page.evaluate(() => ({
    pages: (window as any).Gutterpress.totalPages,
    sheets: document.querySelectorAll(".gp-sheet").length,
    paras: document.querySelectorAll(".gp-strip p").length,
    editable: document.querySelector(".gp-strip")?.getAttribute("contenteditable"),
  }));

  const bench = await page.evaluate(() => (window as any).SPIKE.bench(40));
  // Does the ENGINE still agree after PM owns the DOM?
  const afterRefresh = await page.evaluate(() => {
    (window as any).Gutterpress.refresh();
    return { pages: (window as any).Gutterpress.totalPages,
             paras: document.querySelectorAll(".gp-strip p").length,
             viewAlive: !!(window as any).__view?.docView };
  });

  console.log("\nSPIKE B — ProseMirror mounted on a live paginated strip\n");
  console.log(`  before mount : ${before.pages} pages, ${before.strips} strip(s), ${before.paras} paragraphs`);
  console.log(`  PM parsed    : ${mounted.nodes} top-level nodes`);
  console.log(`  after mount  : ${after.pages} pages, ${after.sheets} sheets, ${after.paras} paragraphs, contenteditable=${after.editable}`);
  console.log(`  typing (PM transaction + forced reflow): median ${bench.median.toFixed(2)}ms  p95 ${bench.p95.toFixed(2)}ms  (n=${bench.n})`);
  console.log(`  after Gutterpress.refresh(): ${afterRefresh.pages} pages, ${afterRefresh.paras} paragraphs, PM view alive=${afterRefresh.viewAlive}`);
  if (log.length) console.log("  page errors:\n    " + log.slice(0, 4).join("\n    "));
} finally { await page.close(); await close(); await closeBrowser(); await fsp.rm(dir, { recursive: true, force: true }); }

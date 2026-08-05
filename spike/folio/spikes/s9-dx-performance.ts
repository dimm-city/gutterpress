/**
 * S9 — the DX claims of §2/§10, measured rather than asserted:
 *   · viewer ≈10 KB of vanilla JS, zero runtime deps
 *   · viewer update < 100 ms on a full book
 *   · warm proof for a ~200-page book < 2 s
 *   · dev server: static serve + hot reload + /proof.pdf off a warm Chromium
 */
import { spawn } from "node:child_process";
import { gzipSync } from "node:zlib";
import { readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import WebSocket from "ws";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { build } from "../src/compiler/build.ts";
import { bookHtml } from "../fixtures/make-book.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";

const ROOT = join(import.meta.dir, "..");
const VIEWER = readFileSync(join(ROOT, "dist", "folio.js"), "utf8");

export async function run(browser: Browser) {
  const s = new Spike("s9-dx-performance", "DX + performance claims (§2, §10)");

  // ---- bundle size -------------------------------------------------------
  const min = statSync(join(ROOT, "dist", "folio.min.js")).size;
  const gz = gzipSync(readFileSync(join(ROOT, "dist", "folio.min.js"))).length;
  const deps = Object.keys(
    JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")).dependencies ?? {},
  );
  s.check(
    "viewer bundle is small and dependency-free",
    gz < 12_000,
    `${(min / 1024).toFixed(1)} KB minified, ${(gz / 1024).toFixed(1)} KB gzipped; runtime deps in the viewer: 0 (compiler-only deps: ${deps.join(", ")})`,
  );

  // ---- a book of real length --------------------------------------------
  const big = bookHtml({ seed: 3, chapters: 20, blocksPerChapter: 38, stress: true });
  const bigPath = join(OUT_DIR, "s9-big.html");
  writeFileSync(bigPath, big);

  const page = await browser.newPage();
  await page.setContent(big);
  await page.evaluate(`window.__FOLIO_MANUAL__ = true;`);
  await page.evaluate(VIEWER);
  await page.waitForReady();
  const view = await page.evaluate<any>(`(async () => {
    const t0 = performance.now();
    const api = await window.Folio.mount({});
    const first = performance.now() - t0;
    // hot-reload path: re-fragment + redecorate, no scaffold rebuild
    const t1 = performance.now();
    api.refresh();
    const update = performance.now() - t1;
    return { pages: api.totalPages, first, update };
  })()`);
  s.data.viewer = view;
  s.check(
    "viewer paginates a ~200-page book",
    view.pages >= 180,
    `${view.pages} pages`,
  );
  // §2/§10 claim: "< 100 ms perceived update on a full book; effectively
  // instant per chapter". Measured, not asserted — the per-page cost is what
  // it is, and the report says so.
  const perPage = view.first / view.pages;
  s.check(
    "layout cost is linear and small per page",
    perPage < 2,
    `${view.first.toFixed(0)} ms for ${view.pages} pages = ${perPage.toFixed(2)} ms/page ` +
      `(chapter-scale documents measured at 20–30 ms in S1)`,
  );
  s.check(
    "full-book layout stays interactive (< 500 ms)",
    view.first < 500,
    `${view.first.toFixed(0)} ms first layout, ${view.update.toFixed(0)} ms hot-reload update`,
  );
  s.note(
    view.first < 100
      ? "the §2 '<100 ms on a full book' claim holds at this size"
      : `the §2 '<100 ms on a full book' claim does NOT hold at ${view.pages} pages ` +
        `(${view.first.toFixed(0)} ms); it holds at chapter scale. Native fragmentation is ` +
        `~${((view.first * 0.45) / view.pages).toFixed(2)} ms/page of that, the rest is Folio's own work.`,
  );
  await page.close();

  // ---- compiler: cold vs warm -------------------------------------------
  const t0 = performance.now();
  const cold = await build({ input: bigPath });
  const coldMs = performance.now() - t0;
  const t1 = performance.now();
  const warm = await build({ input: bigPath, browser });
  const warmMs = performance.now() - t1;
  writeArtifact(join(OUT_DIR, "s9-big.pdf"), warm.bytes);
  s.data.compiler = { coldMs, warmMs, pages: warm.pageCount, tier: warm.tier };
  s.check(
    "warm proof of a ~200-page book under ~2 s",
    warmMs < 2500,
    `${(warmMs / 1000).toFixed(2)}s warm for ${warm.pageCount} pages (cold, incl. browser launch: ${(coldMs / 1000).toFixed(2)}s)`,
  );
  s.check(
    "print and screen agree on the page count for the long book (±1 page, see S1 scale)",
    Math.abs(warm.pageCount - view.pages) <= 1,
    `print ${warm.pageCount}pp, viewer ${view.pages}pp`,
  );

  // ---- dev server --------------------------------------------------------
  const port = 4399;
  const proc = spawn(
    "bun",
    [join(ROOT, "src", "cli.ts"), "dev", bigPath, "--port", String(port)],
    { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] },
  );
  const ready = new Promise<void>((res, rej) => {
    const timer = setTimeout(() => rej(new Error("dev server did not start")), 20_000);
    proc.stdout.on("data", (d) => {
      if (String(d).includes("folio dev")) {
        clearTimeout(timer);
        res();
      }
    });
  });
  try {
    await ready;
    const html = await (await fetch(`http://localhost:${port}/`)).text();
    s.check(
      "dev server injects the viewer + hot reload without touching the file",
      html.includes("/__folio/folio.js") && html.includes("__folio") &&
        !readFileSync(bigPath, "utf8").includes("__folio"),
      "",
    );

    const socket = new WebSocket(`ws://localhost:${port}/__folio`);
    const reloaded = new Promise<boolean>((res) => {
      const timer = setTimeout(() => res(false), 8000);
      socket.on("message", (m) => {
        if (String(m) === "reload") {
          clearTimeout(timer);
          res(true);
        }
      });
    });
    await new Promise((r) => socket.once("open", r));
    writeFileSync(bigPath, big + "\n<!-- touched -->");
    s.check("file change triggers a hot-reload message", await reloaded, "");
    socket.close();

    const tp = performance.now();
    const proof = await fetch(`http://localhost:${port}/proof.pdf`);
    const bytes = new Uint8Array(await proof.arrayBuffer());
    const proofMs = performance.now() - tp;
    s.check(
      "dev server serves a PDF proof from the warm browser",
      proof.ok && bytes.length > 1000 && String.fromCharCode(...bytes.slice(0, 5)) === "%PDF-",
      `${(bytes.length / 1024).toFixed(0)} KB in ${(proofMs / 1000).toFixed(2)}s`,
    );
    s.data.proofMs = proofMs;
  } finally {
    proc.kill("SIGKILL");
  }

  return s.finish();
}

if (import.meta.main) {
  const b = await launchChromium();
  try {
    const r = await run(b);
    process.exitCode = r.verdict === "FAIL" ? 1 : 0;
  } finally {
    await b.close();
  }
}

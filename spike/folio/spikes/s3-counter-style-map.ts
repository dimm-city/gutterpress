/**
 * S3 (§11.3) — can a generated `@counter-style { system: fixed; symbols: … }`
 * carry per-page strings into a margin box?
 *
 * This is the mechanism Tier 3 uses to put a DIFFERENT string on each page
 * (page-granular running heads, dictionary headers) while keeping rendering
 * inside Chromium with the document's own fonts. Fallback if it fails:
 * post-process text stamping with pdf-lib.
 */
import { join } from "node:path";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const filler = (n: number) =>
  Array.from(
    { length: n },
    (_, i) => `<p>Body ${i + 1}. Aenean lacinia bibendum nulla sed consectetur donec ullamcorper nulla non metus auctor fringilla nullam quis.</p>`,
  ).join("");

/** What the compiler's Tier 3 would emit into folio.gen.css. */
export function counterStyleMap(name: string, values: string[]): string {
  const symbols = values
    .map((v) => `"${v.replace(/["\\]/g, "\\$&")}"`)
    .join(" ");
  return `@counter-style ${name} { system: fixed; symbols: ${symbols}; suffix: ""; }`;
}

export async function run(browser: Browser) {
  const s = new Spike("s3-counter-style-map", "@counter-style fixed map inside margin-box content (§11.3)");
  const page = await browser.newPage();

  const perPage = [
    "The Gutters",
    "Creature Codex",
    "Signature & Quire",
    "Ünïcode — em—dash",
    "Vellum",
  ];
  const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 1in;
  @top-right  { content: counter(page, folio-strings); font-size: 8pt; }
  @bottom-center { content: counter(page); font-size: 9pt; }
}
${counterStyleMap("folio-strings", perPage)}
html { font: 11pt/1.4 'DejaVu Serif', serif; } body { margin: 0 }
</style>
<main>${filler(60)}</main>`;

  await page.setContent(html);
  await page.waitForReady();
  const p = join(OUT_DIR, "s3-counter-style.pdf");
  writeArtifact(p, await page.printToPDF());
  const t = pdfText(p);
  s.data.pageHeads = t.pages.map((x) => x.text.split("\n")[0]);

  s.check(
    "document is long enough to exercise the map",
    t.pageCount >= 3,
    `${t.pageCount} pages`,
  );

  let matched = 0;
  for (let i = 0; i < Math.min(t.pageCount, perPage.length); i++) {
    const want = perPage[i];
    const got = t.pages[i].text.replace(/\s+/g, " ");
    const ok = got.includes(want.replace(/\s+/g, " "));
    if (ok) matched++;
    s.check(`page ${i + 1} carries its own generated string`, ok, ok ? want : `text: ${got.slice(0, 70)}`);
  }
  s.data.matched = matched;

  s.check(
    "page numbering is unaffected by the mapped counter style",
    t.pages.every((pg, i) => new RegExp(`(^|\\D)${i + 1}(\\D|$)`).test(pg.text)),
    "",
  );

  // Overflow behaviour: fixed systems fall back to the fallback style beyond
  // the symbol list — Tier 3 must emit a symbol for EVERY page.
  const beyond = t.pages.slice(perPage.length);
  s.note(
    `pages beyond the symbol list (${beyond.length}) fall back to the counter-style fallback ` +
      `(observed head text: ${JSON.stringify(beyond.map((x) => x.text.split("\n")[0]).slice(0, 3))}) — ` +
      `Tier 3 must emit one symbol per page.`,
  );

  await page.close();
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

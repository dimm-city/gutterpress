import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "../browser-harness/index.ts";

/**
 * A document laid out in two columns (the paged editor's `.gp-columns-2`
 * page, here a plain CSS multicol box on the fork's own document): a click
 * in the SECOND column places the caret in the second column's text, not in
 * the first column's line at the same height.
 */
const entryPath = resolve(import.meta.dir, "support/entry.ts");

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

const SOURCE =
  [
    "First column line one.",
    "",
    "First column line two.",
    "",
    "First column line three.",
    "",
    "Second column line one.",
    "",
    "Second column line two.",
    "",
    "Second column line three.",
  ].join("\n") + "\n";

describe("a click in the second column of a multicol document", () => {
  test("lands in the second column's line, and a keystroke edits that line", async () => {
    const { containerSelector } = await harness.page.evaluate((t) => window.__gpGutterpress.mount(t), SOURCE);
    // Two columns, each 90px tall: three 28px paragraphs per column.
    await harness.page.evaluate((sel) => {
      const style = document.createElement("style");
      style.id = "gp-columns-test";
      style.textContent = `${sel} .md-document { column-count: 2; column-fill: auto; column-gap: 40px; height: 90px; } ${sel} .md-paragraph { margin: 0 0 8px; line-height: 20px; font-size: 14px; }`;
      document.head.appendChild(style);
    }, containerSelector);
    await harness.page.waitForTimeout(150);
    const geometry = await harness.page.evaluate((sel) => {
      const paras = Array.from(document.querySelectorAll(`${sel} .md-paragraph`)).map((p) => {
        const r = p.getBoundingClientRect();
        return { text: p.textContent?.trim() ?? "", left: r.left, top: r.top, right: r.right, bottom: r.bottom };
      });
      return paras;
    }, containerSelector);
    const first = geometry.find((p) => p.text.startsWith("First column line one"))!;
    const second = geometry.find((p) => p.text.startsWith("Second column line one"))!;
    // The two "line one" paragraphs sit side by side: same band, different columns.
    expect(Math.abs(first.top - second.top)).toBeLessThan(2);
    expect(second.left).toBeGreaterThan(first.right);

    await harness.page.mouse.click(second.right - 6, (second.top + second.bottom) / 2);
    await harness.page.waitForTimeout(80);
    await harness.page.keyboard.type("ZZq");
    await harness.page.waitForTimeout(120);
    const text = await harness.page.evaluate(() => window.__gpGutterpress.getHostText());
    expect(text).toContain("Second column line one.ZZq");
    expect(text).toContain("First column line one.\n");
    await harness.page.evaluate(() => document.getElementById("gp-columns-test")?.remove());
  });
});

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import { openHarnessSession, waitForHarnessReady, type HarnessSession } from "../browser-harness/index.ts";

/**
 * A pipe table inside a section, decorated the way the page shows it (header
 * row promoted to thead/th, body rows in a tbody): a click into a body cell
 * still places the caret there, and a keystroke lands in that cell's source.
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
    "@section",
    "",
    "### Quickstart",
    "",
    "| Specialty | Starting Gear |",
    "|-------|-------|",
    "| Augmerc | Punishing Counter and Spit Fire |",
    "| Proxy | Zeal Stitch and Blind to Fate |",
    "",
    "@end-section",
    "",
    "After the table.",
  ].join("\n") + "\n";

describe("a decorated pipe table takes a click and a keystroke", () => {
  test("clicking a body cell and typing edits that cell's source", async () => {
    const { containerSelector } = await harness.page.evaluate((t) => window.__gpGutterpress.mount(t), SOURCE);
    await harness.page.waitForTimeout(80);
    const shape = await harness.page.evaluate((sel) => {
      const table = document.querySelector(`${sel} table`);
      return {
        children: Array.from(table?.children ?? []).map((c) => c.tagName),
        headerCells: Array.from(table?.querySelectorAll("thead th") ?? []).map((c) => c.textContent?.trim()),
        bodyRows: table?.querySelectorAll("tbody tr").length ?? 0,
      };
    }, containerSelector);
    expect(shape.children).toEqual(["THEAD", "TBODY"]);
    expect(shape.headerCells).toEqual(["Specialty", "Starting Gear"]);
    expect(shape.bodyRows).toBe(2);

    const cell = harness.page.locator(`${containerSelector} td`, { hasText: "Zeal Stitch" });
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    await harness.page.mouse.click(box!.x + box!.width - 12, box!.y + box!.height / 2);
    await harness.page.waitForTimeout(80);
    await harness.page.keyboard.type("ZZq");
    await harness.page.waitForTimeout(120);
    const text = await harness.page.evaluate(() => window.__gpGutterpress.getHostText());
    expect(text).toContain("Blind to FateZZq");
    expect(text).toContain("| Augmerc | Punishing Counter and Spit Fire |");
  });

  test("clicking a header cell edits the header's source", async () => {
    const { containerSelector } = await harness.page.evaluate((t) => window.__gpGutterpress.mount(t), SOURCE);
    await harness.page.waitForTimeout(80);
    const cell = harness.page.locator(`${containerSelector} th`, { hasText: "Starting Gear" });
    const box = await cell.boundingBox();
    expect(box).not.toBeNull();
    await harness.page.mouse.click(box!.x + box!.width - 12, box!.y + box!.height / 2);
    await harness.page.waitForTimeout(80);
    await harness.page.keyboard.type("HHq");
    await harness.page.waitForTimeout(120);
    const text = await harness.page.evaluate(() => window.__gpGutterpress.getHostText());
    expect(text).toContain("Starting GearHHq");
  });
});

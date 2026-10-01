/**
 * Troubleshooting sub-tab contract (mirrors settings-tabs.test.ts): any value
 * that is not a known id collapses to "diagnostics" so the panel can't blank.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TROUBLESHOOTING_TAB_IDS, sanitizeTroubleshootingTab } from "../../src/lib/troubleshooting-tabs";

const root = path.resolve(import.meta.dir, "../..");

describe("sanitizeTroubleshootingTab", () => {
  test("ids are Diagnostics, Logs in that order", () => {
    expect([...TROUBLESHOOTING_TAB_IDS]).toEqual(["diagnostics", "logs"]);
  });

  test("valid ids pass through unchanged", () => {
    for (const id of TROUBLESHOOTING_TAB_IDS) expect(sanitizeTroubleshootingTab(id)).toBe(id);
  });

  test("garbage collapses to 'diagnostics'", () => {
    const mouseEventish = { type: "click", clientX: 4, target: {} };
    for (const bad of [undefined, null, mouseEventish, "bogus", 3, "", {}, []]) {
      expect(sanitizeTroubleshootingTab(bad)).toBe("diagnostics");
    }
  });

  test("the id list matches the tabs TroubleshootingView renders", () => {
    const view = fs.readFileSync(path.join(root, "src/lib/components/TroubleshootingView.svelte"), "utf8");
    for (const id of TROUBLESHOOTING_TAB_IDS) expect(view).toContain(`id: "${id}"`);
  });
});

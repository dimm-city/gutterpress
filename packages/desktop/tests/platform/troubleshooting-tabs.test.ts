/**
 * Troubleshooting sub-tab contract: any value that is not a known id
 * collapses to "logs" so the panel can't blank.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { TROUBLESHOOTING_TAB_IDS, sanitizeTroubleshootingTab } from "../../src/lib/troubleshooting-tabs";

const root = path.resolve(import.meta.dir, "../..");

describe("sanitizeTroubleshootingTab", () => {
  test("ids are Logs, Diagnostics, Sync, Report a problem in that order", () => {
    expect([...TROUBLESHOOTING_TAB_IDS]).toEqual(["logs", "diagnostics", "sync", "report"]);
  });

  test("valid ids pass through unchanged", () => {
    for (const id of TROUBLESHOOTING_TAB_IDS) expect(sanitizeTroubleshootingTab(id)).toBe(id);
  });

  test("garbage collapses to 'logs'", () => {
    const mouseEventish = { type: "click", clientX: 4, target: {} };
    for (const bad of [undefined, null, mouseEventish, "bogus", 3, "", {}, []]) {
      expect(sanitizeTroubleshootingTab(bad)).toBe("logs");
    }
  });

  test("the id list matches the tabs TroubleshootingView renders", () => {
    const view = fs.readFileSync(path.join(root, "src/lib/components/TroubleshootingView.svelte"), "utf8");
    for (const id of TROUBLESHOOTING_TAB_IDS) expect(view).toContain(`id: "${id}"`);
  });
});

describe("About tab folded into Troubleshooting → Diagnostics", () => {
  const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

  test("the start screen has no About tab and AboutView is gone", () => {
    const landing = read("src/lib/components/WelcomeLanding.svelte");
    const ids = [...landing.matchAll(/\{ id: "(\w+)", label: "([^"]+)" \}/g)]
      .filter((m) => ["projects", "settings", "help", "about", "troubleshooting"].includes(m[1]!))
      .map((m) => m[1]);
    expect(ids).toEqual(["projects", "help", "troubleshooting"]);
    expect(landing).not.toContain("AboutView");
    expect(fs.existsSync(path.join(root, "src/lib/components/AboutView.svelte"))).toBe(false);
    expect(read("src/routes/+page.svelte")).not.toContain('"about"');
  });

  test("Diagnostics renders versions, the update check/channel and desktop integration", () => {
    const view = read("src/lib/components/TroubleshootingView.svelte");
    expect(view).toContain("data.desktopVersion");
    expect(view).toContain("data.libVersion");
    expect(view).toContain("<UpdatesIntegrationSection");
    const section = read("src/lib/components/UpdatesIntegrationSection.svelte");
    expect(section).toContain('id="set-update-channel"');
    expect(section).toContain("s.updates.channel");
    expect(section).toContain("appImage?.supported");
    expect(section).toContain("onCheckForUpdates");
  });

  test("Settings no longer carries the update channel or desktop integration", () => {
    const settings = read("src/lib/components/SettingsView.svelte");
    expect(settings).not.toContain("set-update-channel");
    expect(settings).not.toContain("appImage");
  });

  test("the landing forwards the update wiring to Troubleshooting", () => {
    const landing = read("src/lib/components/WelcomeLanding.svelte");
    const block = landing.slice(landing.indexOf("<TroubleshootingView"));
    for (const prop of ["onCheckForUpdates", "checkingUpdates", "updateReadyVersion", "updateAvailableVersion", "updateAvailableAction"]) {
      expect(block.slice(0, block.indexOf("/>"))).toContain(`{${prop}}`);
    }
  });
});

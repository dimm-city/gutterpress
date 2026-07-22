/**
 * Settings default-tab regression (owner report, 2026-07-22): the settings
 * view opened with NO tab selected — an empty body until the user clicked a
 * tab. Cause: `WelcomeLanding` and `StatusBar` rendered
 * `onclick={onOpenSettings}`, so the DOM MouseEvent rode into
 * `openSettings(tab)` as the tab id, matched nothing, and every
 * `{#if activeTab === …}` branch stayed false.
 *
 * The guard is `sanitizeSettingsTab` ($lib/settings-tabs): any value that is
 * not a known tab id collapses to "app". Both ends use it — `openSettings`
 * in +page (so no caller can poison the stored tab) and SettingsView's
 * initial `activeTab` (so a bad prop can't blank the view). The two raw
 * `onclick={onOpenSettings}` call sites are also pinned to arrow wrappers.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { SETTINGS_TAB_IDS, sanitizeSettingsTab } from "../../src/lib/settings-tabs";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("sanitizeSettingsTab — every value becomes a real tab id", () => {
  test("valid ids pass through unchanged", () => {
    for (const id of SETTINGS_TAB_IDS) {
      expect(sanitizeSettingsTab(id)).toBe(id);
    }
  });

  test("garbage collapses to the default 'app' tab", () => {
    const mouseEventish = { type: "click", clientX: 4, target: {} };
    for (const bad of [undefined, null, mouseEventish, "bogus", 3, "", {}, []]) {
      expect(sanitizeSettingsTab(bad)).toBe("app");
    }
  });

  test("the id list matches the tabs SettingsView renders", () => {
    const view = read("src/lib/components/SettingsView.svelte");
    for (const id of SETTINGS_TAB_IDS) {
      expect(view).toContain(`id: "${id}"`);
    }
  });
});

describe("both ends sanitize (the regression can't come back via a new caller)", () => {
  test("+page's openSettings routes through sanitizeSettingsTab", () => {
    const page = read("src/routes/+page.svelte");
    expect(page).toMatch(/function openSettings\([^)]*\)[^{]*\{\s*settingsInitialTab = sanitizeSettingsTab\(/);
  });

  test("SettingsView's initial activeTab is sanitized", () => {
    const view = read("src/lib/components/SettingsView.svelte");
    expect(view).toMatch(/activeTab = \$state[^(]*\(sanitizeSettingsTab\(initialTab\)\)/);
  });

  test("no component passes a DOM event into onOpenSettings", () => {
    for (const rel of [
      "src/lib/components/WelcomeLanding.svelte",
      "src/lib/components/StatusBar.svelte",
    ]) {
      const src = read(rel);
      expect(src).not.toContain("onclick={onOpenSettings}");
      expect(src).toContain("onclick={() => onOpenSettings?.()}");
    }
  });
});

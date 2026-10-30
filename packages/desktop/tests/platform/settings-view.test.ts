/**
 * The Settings controls 0.11.22 had and #442 removed, back on the one-page
 * Settings (#481): Preview background, Default zoom, the right-click menu in
 * the preview (its key and the context-menu controller's check), the print
 * overlay strength and colours, and a Reset on every group that shows a
 * settings section (Appearance, Preview, Editor, Saving; Your name and email
 * on the Accounts page). The keys are 0.11.22's, so a saved file reads the
 * same (pinned in settings-store.test.ts); the overlay controls are pinned in
 * margin-overlay.test.ts and the controller's check in
 * context-menu-controller.test.ts.
 *
 * There is no Svelte component harness in this repo, so the markup is pinned
 * by its source; `resetSection` runs for real against the store.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

// settings.svelte.ts calls $state() at module top level: shim it before the
// (dynamic, so not hoisted) import — see settings-change-guard.test.ts.
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;
const { useSettings } = await import("../../src/lib/settings.svelte");
const { DEFAULT_SETTINGS } = await import("../../src/lib/platform/shared-types");
const { ZOOM_LEVELS } = await import("../../src/lib/editor/preview-layout");

const read = (rel: string) => readFileSync(new URL(`../../src/${rel}`, import.meta.url), "utf8");
const view = read("lib/components/SettingsView.svelte");
const page = read("routes/+page.svelte");

/** The markup of one Settings group, from its heading's section to the next group. */
function group(id: string): string {
  const start = view.indexOf(`<section class="group" aria-labelledby="${id}">`);
  expect(start).toBeGreaterThan(-1);
  const end = view.indexOf("</section>", start);
  return view.slice(start, end);
}

describe("the Settings page", () => {
  test("groups, in order: How you use Gutterpress, Appearance, Preview, Editor, Saving, Accounts", () => {
    const ids = [...view.matchAll(/<section class="group" aria-labelledby="(settings-[a-z]+)">/g)].map((m) => m[1]);
    expect(ids).toEqual(["settings-role", "settings-appearance", "settings-preview", "settings-editor", "settings-saving", "settings-accounts"]);
    // Still one page: no tabs.
    expect(view).not.toMatch(/role="tab"|role="tablist"/);
  });

  test("every group that shows settings has a Reset for its own section; the role and Accounts groups have none", () => {
    const resets: Array<[string, string, string]> = [
      ["settings-appearance", "Appearance", "resetAppearance"],
      ["settings-preview", "Preview", '() => settings.resetSection("preview")'],
      ["settings-editor", "Editor", '() => settings.resetSection("editor")'],
      ["settings-saving", "Saving", "resetSaving"],
    ];
    for (const [id, title, run] of resets) {
      expect(group(id)).toMatch(new RegExp(`<div class="group-head">\\s*<h2 id="${id}">${title}</h2>\\s*\\{@render reset\\("${title}", ${run.replace(/[()]/g, "\\$&")}\\)\\}`));
    }
    expect(view).toMatch(/function resetAppearance\(\) \{\s*settings\.resetSection\("appearance"\);\s*syncThemeFromSettings\(\);/);
    expect(view).toMatch(/function resetSaving\(\) \{\s*settings\.resetSection\("versionHistory"\);\s*getPlatform\(\)\.setAutoSync\(settings\.current\.versionHistory\.autoSync\)/);
    // The snippet draws a Reset button named for its group.
    const snippet = view.slice(view.indexOf("{#snippet reset("), view.indexOf("{/snippet}", view.indexOf("{#snippet reset(")));
    expect(snippet).toContain('onclick={run} aria-label="Reset {group}"');
    expect(snippet).toContain(">Reset</button>");
    for (const id of ["settings-role", "settings-accounts"]) expect(group(id)).not.toContain("Reset");
  });

  test("Appearance: Theme and the Preview background colour, saved as appearance.previewBg", () => {
    const g = group("settings-appearance");
    expect(g).toContain('name="settings-theme"');
    expect(g).toContain('<label for="settings-preview-bg">Preview background</label>');
    expect(g).toContain('id="settings-preview-bg" type="color"');
    expect(g).toContain("value={s.appearance.previewBg}");
    expect(g).toContain("oninput={(e) => settings.set({ appearance: { previewBg: e.currentTarget.value } })}");
    // The workspace paints the colour live (the previewBg sink), as before.
    expect(page).toContain("previewBgSink(s.appearance.previewBg)");
  });

  test("Preview: Default zoom, saved as preview.defaultZoom, from the same levels as the preview's zoom menu", () => {
    const g = group("settings-preview");
    expect(g).toContain('<label for="settings-zoom">Default zoom</label>');
    expect(g).toContain("value={s.preview.defaultZoom}");
    expect(g).toContain("onchange={(e) => settings.set({ preview: { defaultZoom: e.currentTarget.value } })}");
    expect(g).toContain("{#each zoomLevels as [value, label] (value)}");
    expect(read("lib/components/PreviewToolbar.svelte")).toContain('import { ZOOM_LEVELS } from "#lib/editor/preview-layout.ts";');
    expect(ZOOM_LEVELS.map(([v]) => v)).toEqual(["fit-width", "0.25", "0.5", "0.75", "1", "1.25", "1.5", "2"]);
    expect(ZOOM_LEVELS.some(([v]) => v === DEFAULT_SETTINGS.preview.defaultZoom)).toBe(true);
    // The workspace's zoom is the setting, and the zoom menu writes it back.
    expect(page).toContain("let zoom = $derived(settings.current.preview.defaultZoom);");
    expect(page).toContain("persistZoom: (value) => settings.set({ preview: { defaultZoom: value } })");
  });

  test("Preview: the right-click menu switch, saved as preview.contextMenu, gates the menu and closes an open one", () => {
    const g = group("settings-preview");
    expect(g).toContain('{@render toggle("settings-context-menu", "Right-click menu in the preview", "Right-click (or Shift+F10) an image, link, or block in the preview for quick edit actions.", s.preview.contextMenu, (on) => settings.set({ preview: { contextMenu: on } }))}');
    const ctrl = page.slice(page.indexOf("const contextMenu = new ContextMenuController({"));
    expect(ctrl.slice(0, ctrl.indexOf("});"))).toContain("enabled: () => settings.current.preview.contextMenu,");
    expect(page).toMatch(/const contextMenuSettingSink = settingsChangeGuard<boolean>\(\(enabled\) => \{\s*if \(!enabled\) contextMenu\.close\(\);/);
    expect(page).toContain("contextMenuSettingSink(s.preview.contextMenu);");
  });

  test("Editor: Mark problems in the editor, in its own group", () => {
    expect(group("settings-editor")).toContain("s.editor.highlightProblems");
    expect(group("settings-appearance")).not.toContain("highlightProblems");
  });
});

describe("resetSection", () => {
  const realFetch = globalThis.fetch;
  let persisted: unknown[];
  beforeEach(() => {
    persisted = [];
    globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
      if (String(url) === "/api/app/settings") persisted.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
  });
  afterEach(() => {
    globalThis.fetch = realFetch;
  });

  test("puts one whole section back to its defaults and saves it, leaving the others alone", () => {
    const settings = useSettings();
    settings.set({
      appearance: { theme: "dark", previewBg: "#101010" },
      preview: { defaultZoom: "1.5", contextMenu: false, marginOverlayStrength: "strong" },
      gitIdentity: { authorName: "Ada", authorEmail: "ada@example.com" },
    });
    persisted = [];

    settings.resetSection("preview");
    expect(settings.current.preview).toEqual(DEFAULT_SETTINGS.preview);
    expect(settings.current.appearance.previewBg).toBe("#101010");
    expect(persisted).toEqual([{ preview: DEFAULT_SETTINGS.preview }]);

    settings.resetSection("appearance");
    expect(settings.current.appearance).toEqual(DEFAULT_SETTINGS.appearance);
    settings.resetSection("gitIdentity");
    expect(settings.current.gitIdentity).toEqual({ authorName: "", authorEmail: "" });
    expect(persisted).toHaveLength(3);
  });

  test("a reset hands out a copy, so a later change never edits DEFAULT_SETTINGS", () => {
    const settings = useSettings();
    settings.resetSection("preview");
    settings.set({ preview: { overlayColors: { ...settings.current.preview.overlayColors, bleed: "#000000" } } });
    expect(DEFAULT_SETTINGS.preview.overlayColors.bleed).toBe("#e5484d");
    expect(settings.current.preview.overlayColors).not.toBe(DEFAULT_SETTINGS.preview.overlayColors);
  });
});

describe("the Accounts page", () => {
  test("Your name and email has its Reset, which clears both", () => {
    const accounts = read("lib/components/AccountsView.svelte");
    const identity = accounts.slice(accounts.indexOf('aria-labelledby="accounts-identity"'), accounts.indexOf('id="accounts-name"'));
    expect(identity).toContain('<h2 id="accounts-identity">Your name and email</h2>');
    expect(identity).toContain('onclick={() => settings.resetSection("gitIdentity")}');
    expect(identity).toContain(">Reset</button>");
  });
});

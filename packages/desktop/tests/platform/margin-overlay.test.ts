/**
 * Safe area & bleed overlay — the app side: a persisted setting, a toolbar toggle
 * in BOTH Read and Edit, and the words for what the viewer found. (The overlay
 * itself is drawn and tested in the viewer: cli `engine/viewer/overlay.test.ts`.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSettingsStore, DEFAULT_SETTINGS, mergeSettings, type DeepPartialSettings } from "../../electron/settings-store";
import {
  formatBleed,
  overlayStyleFrom,
  overlaySummaryFrom,
  overlayTooltip,
  type MarginOverlaySummary,
} from "../../src/lib/margin-overlay";

const read = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

describe("preview.marginOverlay setting", () => {
  test("is off until the author turns it on", () => {
    expect(DEFAULT_SETTINGS.preview.marginOverlay).toBe(false);
  });

  test("the look defaults to a normal-strength blue, and a patch changes just that", () => {
    expect(DEFAULT_SETTINGS.preview.marginOverlayColor).toBe("#2f80ed");
    expect(DEFAULT_SETTINGS.preview.marginOverlayStrength).toBe("normal");
    const m = mergeSettings(DEFAULT_SETTINGS, {
      preview: { marginOverlayColor: "#00aa55", marginOverlayStrength: "strong" },
    } as DeepPartialSettings);
    expect(m.preview.marginOverlayColor).toBe("#00aa55");
    expect(m.preview.marginOverlayStrength).toBe("strong");
    expect(m.preview.marginOverlay).toBe(false);
  });

  test("a hand-edited bad value falls back to the default look", () => {
    expect(overlayStyleFrom("#00AA55", "subtle")).toEqual({ color: "#00AA55", strength: "subtle" });
    expect(overlayStyleFrom("red; background: url(x)", "loud")).toEqual({ color: "#2f80ed", strength: "normal" });
    expect(overlayStyleFrom(undefined, undefined)).toEqual({ color: "#2f80ed", strength: "normal" });
  });

  test("a patch persists and leaves the sibling preview fields alone", () => {
    const on = mergeSettings(DEFAULT_SETTINGS, { preview: { marginOverlay: true } } as DeepPartialSettings);
    expect(on.preview.marginOverlay).toBe(true);
    expect(on.preview.readLayout).toBe(DEFAULT_SETTINGS.preview.readLayout);
    // Read ↔ Edit never touches it: one switch for both modes.
    const inEdit = mergeSettings(on, { preview: { mode: "editor" } } as DeepPartialSettings);
    const inRead = mergeSettings(inEdit, { preview: { mode: "viewer" } } as DeepPartialSettings);
    expect(inEdit.preview.marginOverlay).toBe(true);
    expect(inRead.preview.marginOverlay).toBe(true);
  });

  test("round-trips through the settings store, and an old settings file reads as off", async () => {
    const files = new Map<string, string>();
    const store = createSettingsStore({
      getUserDataDir: () => "/ud",
      fs: {
        readFile: async (p: string) => {
          const v = files.get(p);
          if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return v;
        },
        writeFile: async (p: string, d: string) => void files.set(p, d),
        mkdir: async () => undefined,
        rename: async (a: string, b: string) => {
          files.set(b, files.get(a)!);
          files.delete(a);
        },
      },
    });
    // no file yet (a settings file from before the setting existed reads the same)
    expect((await store.readSettings()).preview.marginOverlay).toBe(false);
    await store.updateSettings({ preview: { marginOverlay: true } } as DeepPartialSettings);
    expect((await store.readSettings()).preview.marginOverlay).toBe(true);
    // Edit mode's own write leaves it alone
    await store.updateSettings({ preview: { mode: "editor" } } as DeepPartialSettings);
    expect((await store.readSettings()).preview.marginOverlay).toBe(true);
  });
});

describe("the viewer's finding", () => {
  test("only an 'on' summary counts; counts are whole and non-negative", () => {
    expect(overlaySummaryFrom(undefined)).toBeNull();
    expect(overlaySummaryFrom({})).toBeNull();
    expect(overlaySummaryFrom({ on: false, issues: 4 })).toBeNull();
    expect(
      overlaySummaryFrom({
        on: true,
        issues: 2.7,
        intended: -1,
        bleedPt: 9,
        safePt: 36,
        artSafePt: 18,
        counts: { text: 1.9, art: 1, bleed: -2, offPage: 0 },
      }),
    ).toEqual({
      on: true,
      issues: 2,
      intended: 0,
      bleedPt: 9,
      safePt: 36,
      artSafePt: 18,
      counts: { text: 1, art: 1, bleed: 0, offPage: 0, intended: 0 },
    });
    expect(overlaySummaryFrom({ on: true })).toEqual({
      on: true,
      issues: 0,
      intended: 0,
      bleedPt: 0,
      safePt: 0,
      artSafePt: 0,
      counts: { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 },
    });
  });

  test("bleed reads in inches", () => {
    expect(formatBleed(9)).toBe("0.125 in");
    expect(formatBleed(18)).toBe("0.25 in");
    expect(formatBleed(72)).toBe("1 in");
  });
});

describe("the toolbar tooltip", () => {
  test("off: says what turning it on does", () => {
    const t = overlayTooltip(false, null);
    expect(t).toMatch(/^Show safe area and bleed/);
    expect(t).toMatch(/print settings/);
  });

  const summary = (over: Partial<MarginOverlaySummary> = {}): MarginOverlaySummary => ({
    on: true,
    issues: 0,
    intended: 0,
    bleedPt: 9,
    safePt: 18,
    artSafePt: 18,
    counts: { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 },
    ...over,
  });

  test("on: reports the text and art outside the safe area, the bleed band, the page, placed art, the safe area and the bleed", () => {
    const t = overlayTooltip(
      true,
      summary({
        issues: 5,
        intended: 1,
        safePt: 36,
        artSafePt: 18,
        counts: { text: 2, art: 1, bleed: 1, offPage: 1, intended: 1 },
      }),
    );
    expect(t).toContain("Hide safe area and bleed");
    expect(t).toContain("2 text, 1 art outside the safe area");
    expect(t).toContain("1 in the bleed band");
    expect(t).toContain("1 off the page");
    expect(t).not.toContain("Everything is inside");
    expect(t).toContain("1 piece of art placed on purpose (not counted)");
    expect(t).toContain("Safe area: text 0.5 in, art 0.25 in (0.5 in at the binding), inside the trim");
    expect(t).toContain("Bleed: 0.125 in, inside the page");
  });

  test("on: one rule reads as one distance, a clean book says so, and a project with neither set points at the manifest", () => {
    const t = overlayTooltip(true, summary({ issues: 1, counts: { text: 0, art: 1, bleed: 0, offPage: 0, intended: 0 }, bleedPt: 0 }));
    expect(t).toContain("1 art outside the safe area");
    expect(t).not.toContain("text outside");
    expect(t).not.toContain("placed on purpose");
    expect(t).toContain("Safe area: 0.25 in inside the trim");
    expect(t).toContain("No bleed set \u2014 set page.bleed in manifest.yaml");
    const none = overlayTooltip(true, summary({ safePt: 0, artSafePt: 0 }));
    expect(none).toContain("No safe area set \u2014 set page.safe in manifest.yaml");
    // never a CSS fix: the overlay does not read the book's stylesheet
    expect(none).not.toContain("@page");
    expect(overlayTooltip(true, summary())).toContain("Everything is inside the safe area");
  });

  test("on, before the viewer has answered: just the action", () => {
    expect(overlayTooltip(true, null)).toBe("Hide safe area and bleed");
  });
});

describe("wiring", () => {
  test("Settings > Preview has the strength and colour controls", () => {
    const settingsView = read("src/lib/components/SettingsView.svelte");
    expect(settingsView).toContain("marginOverlayStrength");
    expect(settingsView).toContain("marginOverlayColor");
    expect(settingsView).toContain('type="color"');
  });

  const toolbar = read("src/lib/components/PreviewToolbar.svelte");
  const page = read("src/routes/+page.svelte");

  test("the toggle is a pressed-state button with a tooltip, outside the Read-only layout group", () => {
    const button = toolbar.slice(toolbar.indexOf('class="icon-btn overlay-btn"'));
    expect(button).toContain("aria-pressed={marginOverlay}");
    expect(button).toContain("title={overlayLabel}");
    expect(button).toContain("onToggleMarginOverlay()");
    // `showLayoutToggle` (Read only) must not wrap it: it is available in Edit too
    const layoutBlock = toolbar.slice(toolbar.indexOf("{#if showLayoutToggle}"), toolbar.indexOf("<nav class=\"page-nav\""));
    expect(layoutBlock).not.toContain("overlay");
  });

  test("the page persists the choice, pushes it through the settings channel, and shows the count", () => {
    expect(page).toContain("marginOverlay: !marginOverlay");
    expect(page).toContain("marginOverlaySink(");
    expect(page).toContain("s.preview.marginOverlayStrength");
    expect(page).toContain('client?.call("setMarginOverlay", [on, { color, strength }])');
    expect(page).toContain("{overlaySummary}");
    // no $effect in the SPA: the sink rides the settings change channel
    expect(page.slice(page.indexOf("const marginOverlaySink"), page.indexOf("const marginOverlaySink") + 400)).not.toContain("$effect");
  });

  test("the toolbar shows the toggle whenever the toolbar shows (Read and Edit)", () => {
    // PreviewToolbar is rendered for `!inFocus && previewUrl` — no mode gate
    const use = page.slice(page.indexOf("<PreviewToolbar"));
    const gate = page.slice(page.lastIndexOf("{#if", page.indexOf("<PreviewToolbar")), page.indexOf("<PreviewToolbar"));
    expect(gate).not.toMatch(/mode/);
    expect(use).toContain("onToggleMarginOverlay");
  });
});

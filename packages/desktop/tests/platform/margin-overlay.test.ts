/**
 * Print overlays — the app side: persisted choices (a master switch, which
 * layers show, a colour per layer, a strength), a toolbar toggle and layer menu
 * in BOTH Read and Edit, and the words for what the viewer found. (The overlays
 * themselves are drawn and tested in the viewer: cli `engine/viewer/overlay.test.ts`.)
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createSettingsStore, DEFAULT_SETTINGS, mergeSettings, type DeepPartialSettings } from "../../electron/settings-store";
import {
  OVERLAY_LAYERS,
  overlayLayersFrom,
  overlayStyleFrom,
  overlaySummaryFrom,
  overlayTooltip,
  type MarginOverlaySummary,
} from "../../src/lib/margin-overlay";

const read = (rel: string) => readFileSync(resolve(__dirname, "../..", rel), "utf8");

/** A settings store over an in-memory file, so a test can start from a hand-written (or old) settings file. */
function storeWith(file?: unknown) {
  const files = new Map<string, string>();
  if (file !== undefined) files.set("/ud/app-settings.json", JSON.stringify(file));
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
  return { store, files };
}

describe("preview.marginOverlay setting", () => {
  test("is off until the author turns it on", () => {
    expect(DEFAULT_SETTINGS.preview.marginOverlay).toBe(false);
  });

  test("all three layers are on and each has its own colour by default", () => {
    expect(DEFAULT_SETTINGS.preview.overlayLayers).toEqual({ bleed: true, safe: true, margins: true });
    expect(DEFAULT_SETTINGS.preview.overlayColors).toEqual({ bleed: "#e5484d", safe: "#2f80ed", margins: "#1a9c6b" });
    expect(DEFAULT_SETTINGS.preview.marginOverlayStrength).toBe("normal");
    // the colour the overlay had before it had layers is the safe layer's default
    expect(DEFAULT_SETTINGS.preview.overlayColors.safe).toBe(DEFAULT_SETTINGS.preview.marginOverlayColor);
  });

  test("a patch changes just the layer or colour set (each is written whole) and leaves the master switch alone", () => {
    const layers = mergeSettings(DEFAULT_SETTINGS, {
      preview: { overlayLayers: { bleed: false, safe: true, margins: true } },
    } as DeepPartialSettings);
    expect(layers.preview.overlayLayers).toEqual({ bleed: false, safe: true, margins: true });
    expect(layers.preview.overlayColors).toEqual(DEFAULT_SETTINGS.preview.overlayColors);
    expect(layers.preview.marginOverlay).toBe(false);
    const look = mergeSettings(DEFAULT_SETTINGS, {
      preview: { overlayColors: { bleed: "#00aa55", safe: "#2f80ed", margins: "#e91e63" }, marginOverlayStrength: "strong" },
    } as DeepPartialSettings);
    expect(look.preview.overlayColors).toEqual({ bleed: "#00aa55", safe: "#2f80ed", margins: "#e91e63" });
    expect(look.preview.marginOverlayStrength).toBe("strong");
    expect(look.preview.overlayLayers).toEqual(DEFAULT_SETTINGS.preview.overlayLayers);
  });

  test("a hand-edited bad value falls back to the default, layer by layer", () => {
    expect(overlayLayersFrom({ bleed: false, safe: "no", margins: 0 })).toEqual({ bleed: false, safe: true, margins: true });
    expect(overlayLayersFrom(undefined)).toEqual({ bleed: true, safe: true, margins: true });
    expect(overlayLayersFrom("off")).toEqual({ bleed: true, safe: true, margins: true });
    expect(overlayStyleFrom({ bleed: "#00AA55", safe: "#2f80ed", margins: "#e91e63" }, "subtle")).toEqual({
      strength: "subtle",
      colors: { bleed: "#00AA55", safe: "#2f80ed", margins: "#e91e63" },
    });
    expect(overlayStyleFrom({ bleed: "#AA0000", safe: "red; background: url(x)", margins: 7 }, "loud")).toEqual({
      strength: "normal",
      colors: { bleed: "#AA0000", safe: "#2f80ed", margins: "#1a9c6b" },
    });
    expect(overlayStyleFrom(undefined, undefined)).toEqual({
      strength: "normal",
      colors: { bleed: "#e5484d", safe: "#2f80ed", margins: "#1a9c6b" },
    });
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

  test("round-trips through the settings store, and an old settings file reads as off with every layer on", async () => {
    const { store } = storeWith();
    // no file yet (a settings file from before the setting existed reads the same)
    expect((await store.readSettings()).preview.marginOverlay).toBe(false);
    await store.updateSettings({ preview: { marginOverlay: true } } as DeepPartialSettings);
    expect((await store.readSettings()).preview.marginOverlay).toBe(true);
    await store.updateSettings({ preview: { overlayLayers: { bleed: true, safe: false, margins: true } } } as DeepPartialSettings);
    expect((await store.readSettings()).preview.overlayLayers).toEqual({ bleed: true, safe: false, margins: true });
    // Edit mode's own write leaves them alone
    await store.updateSettings({ preview: { mode: "editor" } } as DeepPartialSettings);
    const after = (await store.readSettings()).preview;
    expect(after.marginOverlay).toBe(true);
    expect(after.overlayLayers).toEqual({ bleed: true, safe: false, margins: true });

    // a file written before there were layers: the overlay was on, with a colour of its own
    const old = storeWith({ preview: { marginOverlay: true, marginOverlayColor: "#2f80ed", marginOverlayStrength: "strong" } });
    const read = (await old.store.readSettings()).preview;
    expect(read.marginOverlay).toBe(true);
    expect(read.marginOverlayStrength).toBe("strong");
    expect(read.overlayLayers).toEqual({ bleed: true, safe: true, margins: true });
  });

  test("the one colour from before the layers becomes the safe layer's, until the layer colours are saved", async () => {
    const { store, files } = storeWith({ preview: { marginOverlay: true, marginOverlayColor: "#00aa55" } });
    // read as the safe layer's colour; the other two are their defaults
    expect((await store.readSettings()).preview.overlayColors).toEqual({ bleed: "#e5484d", safe: "#00aa55", margins: "#1a9c6b" });
    // any write (even of something else) saves it with the rest, so it is the layer's own from then on
    await store.updateSettings({ preview: { mode: "editor" } } as DeepPartialSettings);
    expect(JSON.parse(files.get("/ud/app-settings.json")!).preview.overlayColors).toEqual({
      bleed: "#e5484d",
      safe: "#00aa55",
      margins: "#1a9c6b",
    });
    // choosing another colour replaces it; the old key is no longer consulted
    await store.updateSettings({ preview: { overlayColors: { bleed: "#e5484d", safe: "#123456", margins: "#1a9c6b" } } } as DeepPartialSettings);
    expect(JSON.parse(files.get("/ud/app-settings.json")!).preview.overlayColors.safe).toBe("#123456");
    expect((await store.readSettings()).preview.overlayColors.safe).toBe("#123456");

    // a file that already has layer colours is not overridden by the old key
    const both = storeWith({
      preview: { marginOverlayColor: "#00aa55", overlayColors: { bleed: "#111111", safe: "#222222", margins: "#333333" } },
    });
    expect((await both.store.readSettings()).preview.overlayColors).toEqual({ bleed: "#111111", safe: "#222222", margins: "#333333" });

    // a file with no old colour at all reads the defaults
    const none = storeWith({ preview: { marginOverlay: true } });
    expect((await none.store.readSettings()).preview.overlayColors).toEqual(DEFAULT_SETTINGS.preview.overlayColors);
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
        layers: { bleed: false, safe: true, margins: true },
        issues: 2.7,
        intended: -1,
        bleedPt: 9,
        safePt: 36,
        artSafePt: 18,
        counts: { text: 1.9, art: 1, bleed: -2, offPage: 0 },
      }),
    ).toEqual({
      on: true,
      layers: { bleed: false, safe: true, margins: true },
      issues: 2,
      intended: 0,
      bleedPt: 9,
      safePt: 36,
      artSafePt: 18,
      counts: { text: 1, art: 1, bleed: 0, offPage: 0, intended: 0 },
    });
    // a viewer that predates the layers drew them all
    expect(overlaySummaryFrom({ on: true })).toEqual({
      on: true,
      layers: { bleed: true, safe: true, margins: true },
      issues: 0,
      intended: 0,
      bleedPt: 0,
      safePt: 0,
      artSafePt: 0,
      counts: { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 },
    });
  });

  test("the layers are listed in one order, with the names the legend and the settings use", () => {
    expect(OVERLAY_LAYERS.map((l) => [l.id, l.label])).toEqual([
      ["bleed", "Bleed"],
      ["safe", "Safe area"],
      ["margins", "Page margins"],
    ]);
  });
});

describe("the toolbar tooltip", () => {
  test("off: says what turning it on does, on one line", () => {
    const t = overlayTooltip(false, null);
    expect(t).toMatch(/^Show print overlays/);
    expect(t).toMatch(/bleed, safe area and page margins/);
    expect(t).not.toContain("\n");
  });

  const summary = (over: Partial<MarginOverlaySummary> = {}): MarginOverlaySummary => ({
    on: true,
    layers: { bleed: true, safe: true, margins: true },
    issues: 0,
    intended: 0,
    bleedPt: 9,
    safePt: 18,
    artSafePt: 18,
    counts: { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 },
    ...over,
  });

  test("on: reports the text and art outside the safe area, the bleed band, the page and placed art, on one line", () => {
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
    expect(t).toBe(
      "Hide print overlays · 2 text, 1 art outside the safe area · 1 in the bleed band · 1 off the page · 1 placed on purpose",
    );
    expect(t).not.toContain("\n");
  });

  test("on: a clean book says so, and a lone kind of finding is named alone", () => {
    expect(overlayTooltip(true, summary())).toBe("Hide print overlays · everything inside the safe area");
    const t = overlayTooltip(true, summary({ issues: 1, counts: { text: 0, art: 1, bleed: 0, offPage: 0, intended: 0 } }));
    expect(t).toBe("Hide print overlays · 1 art outside the safe area");
    expect(t).not.toContain("text");
    expect(t).not.toContain("placed on purpose");
  });

  test("on: only the safe layer judges the book, so without it there is nothing to report", () => {
    const noSafe = summary({ layers: { bleed: true, safe: false, margins: true }, issues: 0 });
    expect(overlayTooltip(true, noSafe)).toBe("Hide print overlays");
    expect(overlayTooltip(true, noSafe)).not.toContain("everything inside");
  });

  test("on, before the viewer has answered: just the action", () => {
    expect(overlayTooltip(true, null)).toBe("Hide print overlays");
  });
});

describe("wiring", () => {
  test("Settings > Preview has the strength and one colour per layer", () => {
    const settingsView = read("src/lib/components/SettingsView.svelte");
    expect(settingsView).toContain("marginOverlayStrength");
    expect(settingsView).toContain("overlayColors");
    expect(settingsView).toContain("OVERLAY_LAYERS");
    expect(settingsView).toContain('type="color"');
    // the one colour from before the layers is no longer a control
    expect(settingsView).not.toContain("marginOverlayColor");
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

  test("a menu beside the toggle holds a labelled checkbox and colour swatch per layer", () => {
    const menu = toolbar.slice(toolbar.indexOf('<details class="menu layers-menu">'), toolbar.indexOf('<details class="menu zoom-menu">'));
    expect(menu).toContain("{#each OVERLAY_LAYERS as layer");
    expect(menu).toContain('type="checkbox"');
    expect(menu).toContain("checked={overlayLayers[layer.id]}");
    expect(menu).toContain("onToggleOverlayLayer(layer.id)");
    expect(menu).toContain("style:background={overlayColors[layer.id]}");
    expect(menu).toContain("{layer.label}");
    // it sits after the master button and is not inside the Read-only layout group either
    expect(toolbar.indexOf('<details class="menu layers-menu">')).toBeGreaterThan(toolbar.indexOf('class="icon-btn overlay-btn"'));
  });

  test("the page persists the choices, pushes them through the settings channel, and shows the count", () => {
    expect(page).toContain("marginOverlay: !marginOverlay");
    expect(page).toContain("marginOverlaySink(");
    expect(page).toContain("s.preview.marginOverlayStrength");
    expect(page).toContain("s.preview.overlayColors");
    expect(page).toContain('client?.call("setMarginOverlay", [state, style])');
    expect(page).toContain("state: s.preview.marginOverlay && overlayLayersFrom(s.preview.overlayLayers)");
    expect(page).toContain("{overlaySummary}");
    // a layer is written whole (settings merge one level deep), and ticking one while the overlay is off turns it on
    expect(page).toContain("overlayLayers: { ...overlayLayers, [layer]: !overlayLayers[layer] }");
    expect(page).toContain("marginOverlay: marginOverlay || !overlayLayers[layer]");
    // no $effect in the SPA: the sink rides the settings change channel
    expect(page.slice(page.indexOf("const marginOverlaySink"), page.indexOf("const marginOverlaySink") + 400)).not.toContain("$effect");
  });

  test("the toolbar shows the toggle whenever the toolbar shows (Read and Edit)", () => {
    // PreviewToolbar is rendered for `!inFocus && previewUrl` — no mode gate
    const use = page.slice(page.indexOf("<PreviewToolbar"));
    const gate = page.slice(page.lastIndexOf("{#if", page.indexOf("<PreviewToolbar")), page.indexOf("<PreviewToolbar"));
    expect(gate).not.toMatch(/mode/);
    expect(use).toContain("onToggleMarginOverlay");
    expect(use).toContain("onToggleOverlayLayer");
  });
});

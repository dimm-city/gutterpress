/**
 * Read-mode page layout ($lib/read-layout): the one-page / two-page toggle
 * exists only in Read, Edit is always single-page, and the choice persists in
 * app settings without Edit ever overwriting it.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { showReadLayoutToggle, viewModeFor } from "../../src/lib/read-layout";
import { createSettingsStore, DEFAULT_SETTINGS, mergeSettings, type DeepPartialSettings } from "../../electron/settings-store";

describe("viewModeFor", () => {
  test("Read honours the author's layout choice", () => {
    expect(viewModeFor("viewer", false, "spread")).toBe("two-column");
    expect(viewModeFor("viewer", false, "single")).toBe("single");
  });

  test("Edit is always single-page, whatever Read last chose", () => {
    expect(viewModeFor("editor", false, "spread")).toBe("single");
    expect(viewModeFor("editor", false, "single")).toBe("single");
  });

  test("a narrow window never lays out two pages", () => {
    expect(viewModeFor("viewer", true, "spread")).toBe("single");
  });

  test("returning to Read restores the last read-mode choice", () => {
    const stored = "single" as const;
    const seq = [viewModeFor("viewer", false, stored), viewModeFor("editor", false, stored), viewModeFor("viewer", false, stored)];
    expect(seq).toEqual(["single", "single", "single"]);
    const spread = [viewModeFor("viewer", false, "spread"), viewModeFor("editor", false, "spread"), viewModeFor("viewer", false, "spread")];
    expect(spread).toEqual(["two-column", "single", "two-column"]);
  });
});

describe("showReadLayoutToggle", () => {
  test("only in Read, and only where two pages can fit", () => {
    expect(showReadLayoutToggle("viewer", false)).toBe(true);
    expect(showReadLayoutToggle("editor", false)).toBe(false);
    expect(showReadLayoutToggle("viewer", true)).toBe(false);
  });
});

describe("preview.readLayout setting", () => {
  test("defaults to a spread, as reading always was", () => {
    expect(DEFAULT_SETTINGS.preview.readLayout).toBe("spread");
  });

  test("a patch persists and leaves sibling preview fields (mode included) alone", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { preview: { readLayout: "single" } } as DeepPartialSettings);
    expect(merged.preview.readLayout).toBe("single");
    expect(merged.preview.mode).toBe(DEFAULT_SETTINGS.preview.mode);
    // Switching to Edit writes `mode` only: the stored read choice survives.
    const inEdit = mergeSettings(merged, { preview: { mode: "editor" } } as DeepPartialSettings);
    expect(inEdit.preview.readLayout).toBe("single");
  });

  test("round-trips through the settings store", async () => {
    const files = new Map<string, string>();
    const store = createSettingsStore({
      getUserDataDir: () => "/ud",
      fs: {
        readFile: async (p) => {
          const v = files.get(p);
          if (v === undefined) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
          return v;
        },
        writeFile: async (p, d) => void files.set(p, d),
        mkdir: async () => undefined,
        rename: async (a, b) => {
          files.set(b, files.get(a)!);
          files.delete(a);
        },
      },
    });
    await store.updateSettings({ preview: { readLayout: "single" } } as DeepPartialSettings);
    await store.updateSettings({ preview: { mode: "editor" } } as DeepPartialSettings);
    expect((await store.readSettings()).preview.readLayout).toBe("single");
  });
});

describe("wiring", () => {
  const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

  test("the toggle renders only behind showLayoutToggle, in the preview toolbar", () => {
    const src = read("../../src/lib/components/PreviewToolbar.svelte");
    const markup = src.slice(src.indexOf('<div class="preview-toolbar"'), src.indexOf("<style>"));
    const gate = markup.indexOf("{#if showLayoutToggle}");
    expect(gate).toBeGreaterThan(-1);
    expect(markup.indexOf('aria-label="One page"')).toBeGreaterThan(gate);
    expect(markup.indexOf('aria-label="Two pages"')).toBeGreaterThan(gate);
  });

  test("the page derives viewMode through viewModeFor and pushes changes via the settings channel, no $effect", () => {
    const src = read("../../src/routes/+page.svelte");
    expect(src).toContain("viewModeFor(mode, isNarrow, readLayout)");
    expect(src).toContain("showLayoutToggle={showReadLayoutToggle(mode, isNarrow)}");
    expect(src).toContain("readLayoutSink(s.preview.readLayout)");
  });
});

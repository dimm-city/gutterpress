/**
 * Unit tests for `deepMergeSettings` (Phase 1b) — the single shared settings
 * deep-merge that replaces the two inline copies previously duplicated in
 * `web-adapter.ts` (guarded `!Array.isArray`) and `settings.svelte.ts` (did
 * NOT). The copies DISAGREED on array handling; the reconciled copy REPLACES
 * arrays wholesale rather than spreading them into an object.
 */
import { test, expect } from "bun:test";
import { deepMergeSettings } from "../../src/lib/settings-merge";
import type { AppSettings, DeepPartial } from "../../src/lib/platform";

// A minimal base with two sections; enough to exercise section-level merges.
function makeBase(): AppSettings {
  return {
    editor: { fontSize: 14, lineHeight: 1.6 },
    appearance: { theme: "system", previewBg: "#5a5a5a" },
  } as unknown as AppSettings;
}

test("merges nested objects: untouched section keys are preserved", () => {
  const base = makeBase();
  const merged = deepMergeSettings(base, {
    editor: { fontSize: 16 },
  } as DeepPartial<AppSettings>);

  // fontSize patched, lineHeight preserved from base.
  expect(merged.editor).toEqual({ fontSize: 16, lineHeight: 1.6 } as never);
  // Untouched section is carried through unchanged.
  expect(merged.appearance).toEqual({ theme: "system", previewBg: "#5a5a5a" } as never);
  // A new object is returned; the base is not mutated.
  expect(merged).not.toBe(base);
  expect((base.editor as { fontSize: number }).fontSize).toBe(14);
});

test("replaces arrays wholesale (never deep-merges or index-spreads them)", () => {
  const base = { list: { items: [1, 2, 3] } } as unknown as AppSettings;
  const merged = deepMergeSettings(base, {
    list: { items: [4] },
  } as unknown as DeepPartial<AppSettings>);

  // The nested array is replaced, not concatenated or element-merged.
  expect((merged as unknown as { list: { items: number[] } }).list.items).toEqual([4]);
});

test("ignores a section whose patch value is an array (no corruption)", () => {
  const base = makeBase();
  // A malformed array-valued SECTION patch must be skipped entirely — spreading
  // an array into an object would produce corrupt numeric index keys.
  const merged = deepMergeSettings(base, {
    editor: [1, 2, 3],
  } as unknown as DeepPartial<AppSettings>);

  expect(merged.editor).toEqual({ fontSize: 14, lineHeight: 1.6 } as never);
});

test("ignores undefined sections", () => {
  const base = makeBase();
  const merged = deepMergeSettings(base, {
    editor: undefined,
  } as DeepPartial<AppSettings>);

  // The undefined patch leaves the base section intact.
  expect(merged.editor).toEqual({ fontSize: 14, lineHeight: 1.6 } as never);
  expect(merged.appearance).toEqual({ theme: "system", previewBg: "#5a5a5a" } as never);
});

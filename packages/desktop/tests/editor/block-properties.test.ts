/**
 * block-properties — what the dialog offers (core's keep-together plus each
 * plugin's catalog modifiers, nothing hard-coded to one plugin), how its answers
 * become changes, and the read → ask → plan flow both entry points share.
 */
import { describe, expect, test } from "bun:test";
import type { ClassCatalogEntry } from "../../src/lib/api";
import { readBlock } from "../../src/lib/editor/block-attrs";
import {
  buildModel,
  changesFrom,
  editBlockProperties,
  initialValue,
  modifierOptions,
  type BlockPropertiesValue,
} from "../../src/lib/editor/block-properties";

const dc = { kind: "extension" as const, ref: "gp-dimm-city@1.6.2", name: "Dimm City" };
const other = { kind: "extension" as const, ref: "house@1.0.0", name: "House Style" };
const catalog: ClassCatalogEntry[] = [
  { class: "dc-snug", modifier: true, appliesTo: ["section", "page"], label: "Snug", description: "Tighter margins.", source: dc },
  { class: "dc-avoid-split", modifier: true, appliesTo: ["section", "skill"], label: "Avoid split", description: "Keep the card whole.", source: dc },
  { class: "hs-tight", modifier: true, appliesTo: [], label: "Tight", source: other },
  { class: "dc-chevron", appliesTo: [], label: "Chevron", source: dc }, // documented, not a modifier
  { class: "my-note", modifier: true, appliesTo: [], source: { kind: "book" } }, // a book class is never a toggle
  { class: "gp-no-break", modifier: true, appliesTo: [], label: "Dup", source: dc }, // core already owns it
];

describe("modifierOptions", () => {
  test("core's keep-together first, then plugin modifiers by plugin and label; nothing else", () => {
    const options = modifierOptions("section", catalog);
    expect(options.map((o) => [o.group, o.class])).toEqual([
      ["Gutterpress", "gp-no-break"],
      ["Dimm City", "dc-avoid-split"],
      ["Dimm City", "dc-snug"],
      ["House Style", "hs-tight"],
    ]);
    expect(options[0]!.label).toBe("Keep together");
  });

  test("with no plugin catalog there is still core's toggle", () => {
    expect(modifierOptions("section", []).map((o) => o.class)).toEqual(["gp-no-break"]);
  });

  test("a modifier documented for other markers says so, one documented for this marker or none does not", () => {
    const forSkill = modifierOptions("skill", catalog);
    expect(forSkill.find((o) => o.class === "dc-snug")!.hint).toBe("Documented for @section, @page");
    expect(forSkill.find((o) => o.class === "dc-avoid-split")!.hint).toBeUndefined();
    expect(forSkill.find((o) => o.class === "hs-tight")!.hint).toBeUndefined();
  });

  test("a plugin's description comes along", () => {
    expect(modifierOptions("section", catalog).find((o) => o.class === "dc-snug")!.description).toBe("Tighter margins.");
  });
});

describe("initialValue / changesFrom", () => {
  const source = "A\n\n@page-break\n\n@section card .dc-snug .x\n\n@end-section\n";
  const info = readBlock(source, 4)!;
  const model = buildModel(info, catalog);
  const initial = initialValue(info, model.options);

  test("reads which toggles are on, the break and the columns", () => {
    expect(initial).toEqual({
      classes: { "gp-no-break": false, "dc-avoid-split": false, "dc-snug": true, "hs-tight": false },
      breakBefore: true,
      columns: "",
    });
  });

  test("an unchanged dialog changes nothing", () => {
    expect(changesFrom(initial, { ...initial, classes: { ...initial.classes } })).toEqual({});
  });

  test("only what the author touched is passed on", () => {
    const next: BlockPropertiesValue = {
      classes: { ...initial.classes, "dc-snug": false, "hs-tight": true },
      breakBefore: false,
      columns: "3",
    };
    expect(changesFrom(initial, next)).toEqual({
      classes: { "dc-snug": false, "hs-tight": true },
      breakBefore: false,
      columns: 3,
    });
  });

  test("columns: None removes, a number sets, Custom keeps what was written", () => {
    expect(changesFrom({ ...initial, columns: "2" }, { ...initial, columns: "" })).toEqual({ columns: null });
    expect(changesFrom({ ...initial, columns: "custom" }, { ...initial, columns: "custom" })).toEqual({});
    expect(changesFrom({ ...initial, columns: "custom" }, { ...initial, columns: "4" })).toEqual({ columns: 4 });
    expect(changesFrom({ ...initial, columns: "2" }, { ...initial, columns: "custom" })).toEqual({});
  });

  test("a wrapper with an unrecognized count starts as Custom", () => {
    const wrapped = readBlock("@section\n@columns wide\nx\n@end-columns\n@end-section\n", 0)!;
    expect(initialValue(wrapped, []).columns).toBe("custom");
  });
});

describe("editBlockProperties", () => {
  const source = "Intro.\n\n@skill .dc-snug label=\"Fireball\"\n\nBody.\n\n@end-skill\n";
  const noPrompt = async () => null;
  const base = { source, line: 2, catalog, isSelfClosingMarker: () => false };

  test("plans one line patch from the answers", async () => {
    const outcome = await editBlockProperties({
      ...base,
      prompt: async (_m, initial) => ({ ...initial, classes: { ...initial.classes, "dc-avoid-split": true, "dc-snug": false } }),
    });
    expect(outcome).toEqual({
      kind: "patch",
      patch: {
        range: [2, 3],
        expected: '@skill .dc-snug label="Fireball"\n',
        replacement: '@skill label="Fireball" .dc-avoid-split\n',
      },
    });
  });

  test("shows the dialog the marker's own options and starting values", async () => {
    let seen: Parameters<Parameters<typeof editBlockProperties>[0]["prompt"]> | null = null;
    await editBlockProperties({ ...base, prompt: async (m, i) => { seen = [m, i]; return null; } });
    expect(seen![0].marker).toBe("skill");
    expect(seen![0].columns).toEqual({ kind: "none" });
    expect(seen![1].classes["dc-snug"]).toBe(true);
  });

  test("cancelled, unchanged, unreadable and refused are each their own outcome", async () => {
    expect(await editBlockProperties({ ...base, prompt: noPrompt })).toEqual({ kind: "cancelled" });
    expect(await editBlockProperties({ ...base, prompt: async (_m, i) => ({ ...i }) })).toEqual({ kind: "unchanged" });
    expect(await editBlockProperties({ ...base, line: 0, prompt: noPrompt })).toEqual({ kind: "unreadable" });
    expect(await editBlockProperties({ ...base, line: 99, prompt: noPrompt })).toEqual({ kind: "unreadable" });
    const refused = await editBlockProperties({
      ...base,
      source: "@skill\nBody.\n",
      line: 0,
      prompt: async (_m, i) => ({ ...i, columns: "2" }),
    });
    expect(refused.kind).toBe("error");
  });

  test("a self-closing marker reaches the dialog with columns unavailable", async () => {
    let columns: unknown = null;
    await editBlockProperties({
      source: "@tape\n",
      line: 0,
      catalog,
      isSelfClosingMarker: (name) => name === "tape",
      prompt: async (m) => { columns = m.columns; return null; },
    });
    expect(columns).toMatchObject({ kind: "unavailable" });
  });
});

/**
 * core-classes — the drift gate. The desktop mirrors core's `gp-*` vocabulary
 * for autocomplete and Block properties; this keeps the mirror and core from
 * parting: a class core drops must leave the list, and a class core adds must
 * be either offered or named (with the reason) as one authors do not type.
 */
import { describe, expect, test } from "bun:test";
import { CORE_CLASSES, CORE_CLASSES_NOT_OFFERED, KEEP_TOGETHER_CLASS } from "../../src/lib/editor/core-classes";

async function core() {
  return import("../../../cli/src/lib/markdown/gutterpress-css.ts");
}

describe("core-classes against core's GP_CLASSES", () => {
  test("every class offered exists in core", async () => {
    const { GP_CLASSES } = await core();
    for (const c of CORE_CLASSES) expect(GP_CLASSES.has(c.class)).toBe(true);
  });

  test("every core class is offered or deliberately not", async () => {
    const { GP_CLASSES } = await core();
    const offered = new Set(CORE_CLASSES.map((c) => c.class));
    const missing = [...GP_CLASSES].filter((c) => !offered.has(c) && !(c in CORE_CLASSES_NOT_OFFERED));
    expect(missing).toEqual([]);
  });

  test("nothing is both offered and excluded, and the exclusions still exist in core", async () => {
    const { GP_CLASSES } = await core();
    const offered = new Set(CORE_CLASSES.map((c) => c.class));
    for (const name of Object.keys(CORE_CLASSES_NOT_OFFERED)) {
      expect(offered.has(name)).toBe(false);
      expect(GP_CLASSES.has(name)).toBe(true);
    }
  });

  test("every offered class has a rule in GUTTERPRESS_CSS", async () => {
    const { GUTTERPRESS_CSS } = await core();
    for (const c of CORE_CLASSES) {
      expect(GUTTERPRESS_CSS).toContain(`.${c.class}`);
    }
  });

  test("the keep-together class is a real fragmentation control", async () => {
    const { GUTTERPRESS_CSS } = await core();
    expect(GUTTERPRESS_CSS).toMatch(new RegExp(`\\.${KEEP_TOGETHER_CLASS}\\s*\\{\\s*break-inside:\\s*avoid`));
  });

  test("names are unique and every class has a one-line description", () => {
    const names = CORE_CLASSES.map((c) => c.class);
    expect(new Set(names).size).toBe(names.length);
    for (const c of CORE_CLASSES) {
      expect(c.description.length).toBeGreaterThan(8);
      expect(c.description).not.toContain("\n");
    }
  });
});

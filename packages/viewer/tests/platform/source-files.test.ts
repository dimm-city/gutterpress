/**
 * Unit tests for the source-files list model (project settings → Details →
 * the drag-and-drop include/exclude editor that replaced the textarea).
 */
import { describe, test, expect } from "bun:test";
import {
  buildSourceList,
  moveEntry,
  setIncluded,
  toManifestFiles,
  naturalOrder,
} from "../../src/lib/components/config/source-files";

describe("naturalOrder", () => {
  test("sorts numerically (2 before 10), case-insensitively", () => {
    expect(naturalOrder(["10-b.md", "2-a.md", "Intro.md"])).toEqual([
      "2-a.md",
      "10-b.md",
      "Intro.md",
    ]);
  });
});

describe("buildSourceList", () => {
  test("blank manifest → every file included, natural order", () => {
    const list = buildSourceList(["02.md", "01.md"], null);
    expect(list).toEqual([
      { path: "01.md", included: true },
      { path: "02.md", included: true },
    ]);
  });

  test("empty-array manifest behaves like null (the 'all files' default)", () => {
    const list = buildSourceList(["b.md", "a.md"], []);
    expect(list.map((e) => e.included)).toEqual([true, true]);
  });

  test("manifest order leads; files off the manifest follow, excluded", () => {
    const list = buildSourceList(["a.md", "b.md", "c.md"], ["c.md", "a.md"]);
    expect(list).toEqual([
      { path: "c.md", included: true },
      { path: "a.md", included: true },
      { path: "b.md", included: false },
    ]);
  });

  test("manifest entries missing from disk are kept and flagged", () => {
    const list = buildSourceList(["a.md"], ["gone.md", "a.md"]);
    expect(list[0]).toEqual({ path: "gone.md", included: true, missing: true });
    expect(list[1]).toEqual({ path: "a.md", included: true });
  });
});

describe("moveEntry", () => {
  const entries = buildSourceList(["a.md", "b.md", "c.md"], null);

  test("moves an entry and returns a new array", () => {
    const next = moveEntry(entries, 0, 2);
    expect(next.map((e) => e.path)).toEqual(["b.md", "c.md", "a.md"]);
    expect(entries.map((e) => e.path)).toEqual(["a.md", "b.md", "c.md"]);
  });

  test("clamps out-of-range targets", () => {
    expect(moveEntry(entries, 2, 99).map((e) => e.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(moveEntry(entries, 0, -5).map((e) => e.path)).toEqual(["a.md", "b.md", "c.md"]);
    expect(moveEntry(entries, 2, -5).map((e) => e.path)).toEqual(["c.md", "a.md", "b.md"]);
  });

  test("no-op move returns the same entries", () => {
    expect(moveEntry(entries, 1, 1)).toBe(entries);
  });
});

describe("setIncluded", () => {
  test("toggles one entry immutably", () => {
    const entries = buildSourceList(["a.md", "b.md"], null);
    const next = setIncluded(entries, 1, false);
    expect(next[1]!.included).toBe(false);
    expect(entries[1]!.included).toBe(true);
  });
});

describe("toManifestFiles", () => {
  const all = ["01.md", "02.md", "03.md"];

  test("everything included in natural order collapses to null (blank manifest)", () => {
    const entries = buildSourceList(all, null);
    expect(toManifestFiles(entries, all)).toBeNull();
  });

  test("an exclusion produces an explicit list", () => {
    const entries = setIncluded(buildSourceList(all, null), 1, false);
    expect(toManifestFiles(entries, all)).toEqual(["01.md", "03.md"]);
  });

  test("a reorder produces an explicit list in list order", () => {
    const entries = moveEntry(buildSourceList(all, null), 2, 0);
    expect(toManifestFiles(entries, all)).toEqual(["03.md", "01.md", "02.md"]);
  });

  test("round-trip: reorder + exclude → rebuild reproduces the same view", () => {
    let entries = moveEntry(buildSourceList(all, null), 2, 0);
    entries = setIncluded(entries, 1, false); // exclude 01.md
    const manifest = toManifestFiles(entries, all);
    expect(manifest).toEqual(["03.md", "02.md"]);
    const rebuilt = buildSourceList(all, manifest);
    expect(rebuilt).toEqual([
      { path: "03.md", included: true },
      { path: "02.md", included: true },
      { path: "01.md", included: false },
    ]);
  });
});

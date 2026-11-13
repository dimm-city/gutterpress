import { describe, expect, test } from "bun:test";
import { countChanged, diffSequences, textLines } from "./text-diff";

/** Apply the ops back to both sides to prove the script is a valid edit. */
function sides<T>(ops: ReturnType<typeof diffSequences<T>>): { a: T[]; b: T[] } {
  const a: T[] = [];
  const b: T[] = [];
  for (const op of ops) {
    if (op.kind !== "insert") a.push(op.a);
    if (op.kind !== "delete") b.push(op.b);
  }
  return { a, b };
}

describe("diffSequences", () => {
  test("identical, empty, and one-sided inputs", () => {
    expect(diffSequences([], [])).toEqual([]);
    expect(diffSequences(["a"], ["a"])).toEqual([{ kind: "equal", a: "a", b: "a" }]);
    expect(diffSequences([], ["a", "b"])).toEqual([
      { kind: "insert", b: "a" },
      { kind: "insert", b: "b" },
    ]);
    expect(diffSequences(["a", "b"], [])).toEqual([
      { kind: "delete", a: "a" },
      { kind: "delete", a: "b" },
    ]);
  });

  test("finds a minimal script for a middle edit and reproduces both sides", () => {
    const a = ["one", "two", "three", "four", "five"];
    const b = ["one", "two", "THREE", "four", "five", "six"];
    const ops = diffSequences(a, b);
    expect(sides(ops)).toEqual({ a, b });
    expect(ops.filter((o) => o.kind !== "equal")).toEqual([
      { kind: "delete", a: "three" },
      { kind: "insert", b: "THREE" },
      { kind: "insert", b: "six" },
    ]);
  });

  test("reproduces both sides on a shuffle with repeated items", () => {
    const a = ["x", "y", "x", "z", "y", "x"];
    const b = ["y", "x", "x", "y", "z", "z", "x"];
    expect(sides(diffSequences(a, b))).toEqual({ a, b });
  });

  test("two unrelated long texts stay bounded and still reproduce both sides", () => {
    const a = Array.from({ length: 3000 }, (_, i) => `a${i}`);
    const b = Array.from({ length: 3000 }, (_, i) => `b${i}`);
    const ops = diffSequences(a, b);
    expect(sides(ops)).toEqual({ a, b });
    expect(ops.every((o) => o.kind !== "equal")).toBe(true);
  });
});

describe("countChanged", () => {
  test("an edited item counts once; a run counts its longer side", () => {
    expect(countChanged(diffSequences(["a", "b", "c"], ["a", "B", "c"]))).toBe(1);
    expect(countChanged(diffSequences(["a", "b", "c"], ["a", "c"]))).toBe(1);
    expect(countChanged(diffSequences(["a", "c"], ["a", "b1", "b2", "c"]))).toBe(2);
    expect(countChanged(diffSequences(["a", "b", "c", "d"], ["A", "b", "C", "d"]))).toBe(2);
    expect(countChanged(diffSequences(["a"], ["a"]))).toBe(0);
  });
});

describe("textLines", () => {
  test("a trailing line break does not add an empty line; CR is not content", () => {
    expect(textLines("a\nb\n")).toEqual(["a", "b"]);
    expect(textLines("a\r\nb\r\n")).toEqual(["a", "b"]);
    expect(textLines("a\nb")).toEqual(["a", "b"]);
    expect(textLines("a\n\nb\n")).toEqual(["a", "", "b"]);
    expect(textLines("")).toEqual([]);
  });
});

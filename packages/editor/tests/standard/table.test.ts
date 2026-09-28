import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";

/** `insert-table {rows, cols}` (run spec "Command list"). Insert-only, like
 *  `insert-horizontal-rule` — no toggle-OFF/idempotence case. */

describe("insert-table", () => {
  test("generates a rows x cols pipe skeleton at the caret's line boundary", () => {
    const text = "before";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "insert-table", rows: 2, cols: 3 },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe(
      "before\n\n" +
        "| Header 1 | Header 2 | Header 3 |\n" +
        "| ------ | ------ | ------ |\n" +
        "| Cell | Cell | Cell |\n" +
        "| Cell | Cell | Cell |\n\n",
    );
  });

  test("clamps cols to [1, 10]", () => {
    const zero = applyCommand({ text: "", version: 0 }, { start: 0, endExclusive: 0 }, { kind: "insert-table", rows: 1, cols: 0 });
    if ("refused" in zero) throw new Error("unexpected refusal");
    expect(zero.edit.insert).toContain("| Header 1 |");
    expect(zero.edit.insert).not.toContain("Header 2");

    const many = applyCommand({ text: "", version: 0 }, { start: 0, endExclusive: 0 }, { kind: "insert-table", rows: 1, cols: 99 });
    if ("refused" in many) throw new Error("unexpected refusal");
    const headerLine = many.edit.insert.split("\n").find((l) => l.includes("Header"))!;
    const colCount = (headerLine.match(/\|/g) ?? []).length - 1;
    expect(colCount).toBeLessThanOrEqual(10);
  });

  test("clamps rows to at least 1", () => {
    const result = applyCommand({ text: "", version: 0 }, { start: 0, endExclusive: 0 }, { kind: "insert-table", rows: 0, cols: 1 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const cellLines = result.edit.insert.split("\n").filter((l) => l === "| Cell |");
    expect(cellLines.length).toBeGreaterThanOrEqual(1);
  });

  test("desktop mapping equivalence: rows=1 reproduces desktop applyTable's fixed single body row", () => {
    const result = applyCommand({ text: "", version: 0 }, { start: 0, endExclusive: 0 }, { kind: "insert-table", rows: 1, cols: 2 });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe(
      "\n\n| Header 1 | Header 2 |\n| ------ | ------ |\n| Cell | Cell |\n\n",
    );
  });
});

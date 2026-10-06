import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";

/** `insert-link {href, text?}` / `insert-image {src, alt?}` (run spec
 *  "Command list"). Insert-only. */

describe("insert-link", () => {
  test("non-empty selection: wraps the selection as the link text", () => {
    const text = "click here to continue";
    const result = applyCommand(
      { text, version: 0 },
      { start: 6, endExclusive: 10 },
      { kind: "insert-link", href: "url" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("click [here](url) to continue");
  });

  test("explicit text overrides the selection", () => {
    const text = "click here";
    const result = applyCommand(
      { text, version: 0 },
      { start: 6, endExclusive: 10 },
      { kind: "insert-link", href: "https://example.com", text: "the docs" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("click [the docs](https://example.com)");
  });

  test("caret-only with no override: falls back to a generic placeholder", () => {
    const text = "";
    const result = applyCommand({ text, version: 0 }, { start: 0, endExclusive: 0 }, { kind: "insert-link", href: "url" });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("[text](url)");
  });

  test("commandState: always applicable, never active", () => {
    const state = commandState({ text: "x", version: 0 }, { start: 0, endExclusive: 0 });
    expect(state["insert-link"]).toEqual({ applicable: true, active: false });
  });
});

describe("insert-image", () => {
  test("non-empty selection: wraps the selection as alt text", () => {
    const text = "a photo of a cat";
    const result = applyCommand(
      { text, version: 0 },
      { start: 2, endExclusive: 7 },
      { kind: "insert-image", src: "cat.jpg" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("a ![photo](cat.jpg) of a cat");
  });

  test("explicit alt overrides the selection", () => {
    const text = "x";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 1 },
      { kind: "insert-image", src: "art.png", alt: "A painting" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("![A painting](art.png)");
  });

  test("caret-only with no override: empty alt text", () => {
    const text = "";
    const result = applyCommand({ text, version: 0 }, { start: 0, endExclusive: 0 }, { kind: "insert-image", src: "img.png" });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("![](img.png)");
  });
});

import { test, expect } from "bun:test";
import {
  extractVariables,
  substituteVariables,
} from "../../src/lib/editor/snippet-vars";

test("extractVariables finds unique names in first-seen order", () => {
  expect(
    extractVariables("Hi {{name}} of {{place}}, bye {{name}}"),
  ).toEqual(["name", "place"]);
});

test("extractVariables handles whitespace and returns [] for none", () => {
  expect(extractVariables("a {{ x }} b")).toEqual(["x"]);
  expect(extractVariables("no vars here")).toEqual([]);
});

test("substituteVariables replaces every occurrence; missing → empty", () => {
  expect(substituteVariables("{{a}}-{{a}}-{{b}}", { a: "1" })).toBe("1-1-");
});

test("substituteVariables leaves single braces untouched", () => {
  expect(substituteVariables("a {single} b", {})).toBe("a {single} b");
});

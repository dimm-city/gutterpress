import { test, expect } from "bun:test";
import { resolvePort } from "./preview";

test("resolvePort defaults to 3579 when undefined", () => {
  expect(resolvePort(undefined)).toBe(3579);
});

test("resolvePort defaults to 3579 when empty string", () => {
  expect(resolvePort("")).toBe(3579);
});

test("resolvePort passes through a normal port", () => {
  expect(resolvePort("8080")).toBe(8080);
});

// Regression test for defect preview-port-zero-falsy:
// --port 0 (OS-assigned free port) must NOT be coerced to the default 3579.
test("resolvePort('0') yields 0, not the default", () => {
  expect(resolvePort("0")).toBe(0);
});

test("resolvePort(0) yields 0", () => {
  expect(resolvePort(0)).toBe(0);
});

import { test, expect } from "bun:test";
import { platform } from "node:os";
import { isToolAvailable, findTool } from "./tool-probe";

// bun itself is guaranteed to be on PATH in this test environment (the test
// runner is `bun test`), so it's a safe stand-in for "a real, installed tool".
const REAL_TOOL = "bun";
const FAKE_TOOL = "gutterpress-definitely-not-a-real-binary-xyz";

test("isToolAvailable resolves true for a tool that is actually on PATH", async () => {
  expect(await isToolAvailable(REAL_TOOL)).toBe(true);
});

test("isToolAvailable resolves false for a nonexistent tool", async () => {
  expect(await isToolAvailable(FAKE_TOOL)).toBe(false);
});

test("findTool returns an absolute path for a tool that is actually on PATH", async () => {
  const found = await findTool(REAL_TOOL);
  expect(found).toBeDefined();
  expect(found!.length).toBeGreaterThan(0);
  // where.exe/which both print absolute paths.
  if (platform() !== "win32") {
    expect(found!.startsWith("/")).toBe(true);
  }
});

test("findTool resolves undefined for a nonexistent tool", async () => {
  expect(await findTool(FAKE_TOOL)).toBeUndefined();
});

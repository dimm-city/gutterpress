/**
 * #239 — `resolveDeclaredStyles` is the ONE resolver a plugin's `styles`
 * export (#238, `plugins.ts`) and a theme's `styles`/`engineStyles.native`
 * (`theme-manager.ts`, `theme-import.ts`) both call. These tests pin down the
 * shared contract directly, independent of either caller.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { resolveDeclaredStyles } from "./style-declarations";

const TMP_ROOT = join(process.cwd(), ".tmp", `style-declarations-tests-${Date.now()}`);

describe("resolveDeclaredStyles", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  test("returns undefined for undefined input (zero-cost no-op)", () => {
    expect(resolveDeclaredStyles(undefined, TMP_ROOT, "Subject")).toBeUndefined();
  });

  test("returns undefined for an empty array", () => {
    expect(resolveDeclaredStyles([], TMP_ROOT, "Subject")).toBeUndefined();
  });

  test("resolves each declared path to an absolute path, in declared order", () => {
    writeFileSync(join(TMP_ROOT, "a.css"), "", "utf8");
    mkdirSync(join(TMP_ROOT, "nested"), { recursive: true });
    writeFileSync(join(TMP_ROOT, "nested", "b.css"), "", "utf8");

    const resolved = resolveDeclaredStyles(["a.css", "nested/b.css"], TMP_ROOT, "Subject");
    expect(resolved).toEqual([join(TMP_ROOT, "a.css"), join(TMP_ROOT, "nested", "b.css")]);
  });

  test("an already-absolute entry passes through resolve() unchanged (path.resolve is a no-op on it)", () => {
    writeFileSync(join(TMP_ROOT, "abs.css"), "", "utf8");
    const abs = join(TMP_ROOT, "abs.css");
    expect(resolveDeclaredStyles([abs], TMP_ROOT, "Subject")).toEqual([abs]);
  });

  test("throws naming the subject, the declared (relative) path, and the resolved (absolute) path", () => {
    expect(() => resolveDeclaredStyles(["missing.css"], TMP_ROOT, 'Plugin "demo"')).toThrow(
      /Plugin "demo" declares stylesheet "missing\.css" but no file exists at .*missing\.css/,
    );
  });

  test("throws on the FIRST missing entry even when later entries would exist", () => {
    writeFileSync(join(TMP_ROOT, "exists-after.css"), "", "utf8");
    expect(() =>
      resolveDeclaredStyles(["missing.css", "exists-after.css"], TMP_ROOT, "Theme \"t\""),
    ).toThrow(/missing\.css/);
  });
});

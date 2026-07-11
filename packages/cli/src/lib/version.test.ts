import { test, expect } from "bun:test";
import { PACKAGE_VERSION, PACKAGE_META } from "./version";
import pkg from "../../package.json";

test("PACKAGE_VERSION matches package.json's version field via a static import", () => {
  expect(PACKAGE_VERSION).toBe(pkg.version);
  expect(PACKAGE_VERSION).not.toBe("unknown");
  expect(PACKAGE_VERSION).toMatch(/^\d+\.\d+\.\d+/);
});

test("PACKAGE_META exposes the dependency versions build-fingerprint needs", () => {
  expect(PACKAGE_META.version).toBe(pkg.version);
  expect(PACKAGE_META.dependencies["puppeteer-core"]).toBeDefined();
});

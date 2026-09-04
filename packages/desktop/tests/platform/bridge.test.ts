import { afterEach, beforeEach, expect, test } from "bun:test";
import { bridge, DesktopHostRequiredError, isDesktop } from "../../src/lib/platform/bridge";

// SFE-P5b: this file replaces tests/platform/adapter.test.ts — `getPlatform()`
// and `ElectronAdapter` are deleted, so the fail-loudly host-selection tests
// they used to carry move here, to the one shared accessor every capability
// module now calls instead of a service locator.

beforeEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("isDesktop()/bridge() see the Electron bridge when window.electron is present", () => {
  const electron = { apiVersion: 1 };
  // @ts-expect-error test global
  globalThis.window = { electron };
  expect(isDesktop()).toBe(true);
  // bridge() returns the exact window.electron object — no wrapping, no
  // adapter class, no mutation (SFE-P5b: the whole point of deleting
  // ElectronAdapter is that every capability module reaches window.electron
  // directly through this one accessor).
  expect(bridge()).toBe(electron as never);
});

test("bridge() fails loudly with a named error when no Electron bridge is present (SFE-P5a/P5b)", () => {
  // @ts-expect-error test global
  globalThis.window = {};
  expect(isDesktop()).toBe(false);
  expect(() => bridge()).toThrow(DesktopHostRequiredError);
  expect(() => bridge()).toThrow(/desktop host required/i);
});

test("isDesktop() is false and bridge() throws when window itself is undefined", () => {
  expect(isDesktop()).toBe(false);
  expect(() => bridge()).toThrow(DesktopHostRequiredError);
});

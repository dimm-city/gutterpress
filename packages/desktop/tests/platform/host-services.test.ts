import { test, expect } from "bun:test";
import { registerHostServices, getHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";

// The host/route seam is ONE `__gutterpressHost__` globalThis object written
// once by main.ts before `app.whenReady`. `getHostServices()` returns exactly
// that object, and throws (never returns null) if nothing was registered —
// a route running before registration is a startup-ordering bug, not a state
// routes reason about.
//
// `__gutterpressHost__` is a single fixed globalThis key, so ordering within
// this file matters: the "before registration" assertion runs FIRST.

test("getHostServices() throws before registration", () => {
  registerHostServices(undefined as never);
  expect(() => getHostServices()).toThrow(/not registered/);
});

test("registerHostServices() makes getHostServices() return the exact object reference", () => {
  const fakeServices = makeHostServices({
    fsGuard: { projectRoots: () => ["/fake/project"], readOnlyRoots: () => ["/fake/recovery"] },
  });
  registerHostServices(fakeServices);
  expect(getHostServices()).toBe(fakeServices);
  expect(getHostServices().fsGuard).toBe(fakeServices.fsGuard);
});

test("makeHostServices: a partial domain override merges over the base", () => {
  // Pins the shared builder's override semantics for its consumer suites
  // (pure function — registers nothing). Deep-ish merge: the overridden member
  // wins, untouched siblings stay.
  const services = makeHostServices({ desktop: { getUserDataPath: () => "/custom" } });
  expect(services.desktop.getUserDataPath()).toBe("/custom");
  expect(services.desktop.getNativeTheme()).toEqual({ shouldUseDarkColors: false });
});

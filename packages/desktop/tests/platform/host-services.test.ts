import { test, expect } from "bun:test";
import { registerHostServices, getHostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { getAppHooks } from "../../electron/server-bridge/app-hooks";
import { getDesktopHooks, getDoctorHooks } from "../../electron/server-bridge/host-hooks";
import { getFsGuardHooks } from "../../electron/server-bridge/fs-guard";
import { getMediaHooks } from "../../electron/server-bridge/media-hooks";
import { getPickedFilesHooks } from "../../electron/server-bridge/picked-files";
import { getPrefsHooks } from "../../electron/server-bridge/prefs-hooks";
import { getRecoveryHooks } from "../../electron/server-bridge/recovery-hooks";
import { getRemoteHooks } from "../../electron/server-bridge/remote-hooks";
import { getVcsHooks } from "../../electron/server-bridge/vcs-hooks";
import { getWatchHooks } from "../../electron/server-bridge/watch-hooks";
import { getWriteHooks } from "../../electron/server-bridge/write-hooks";

// ARCH review #31: 11 independent globalThis service locators (one
// `createHostBridge` call per server-bridge/*-hooks.ts module, each with its
// own `__gutterpress*Hooks__` key) collapse into ONE `__gutterpressHost__` object.
// These tests lock:
//   1. getHostServices() returns null before any registration, and every
//      domain accessor (getAppHooks/getPrefsHooks/etc.) agrees — nothing is
//      independently registerable any more, so there is no "half
//      registered" state.
//   2. ONE registerHostServices() call populates every domain accessor
//      atomically, each reading the exact same object reference back off
//      the single stored HostServices.
//   3. getPrefsHooks/getRemoteHooks/getVcsHooks keep their generic
//      call-site narrowing (unaffected by the storage collapse).
//
// IMPORTANT: `__gutterpressHost__` is a single fixed globalThis key (unlike
// host-bridge.test.ts, which parameterizes a fresh key per test), so ordering
// within this file matters: the "before registration" assertions run FIRST,
// before the one register call every later test relies on.

test("getHostServices() and every domain accessor return null before registration", () => {
  // Route suites share this process-global seam, so establish the state this
  // assertion is specifically testing instead of depending on file order.
  registerHostServices(undefined as never);
  expect(getHostServices()).toBeNull();
  expect(getAppHooks()).toBeNull();
  expect(getDesktopHooks()).toBeNull();
  expect(getDoctorHooks()).toBeNull();
  expect(getFsGuardHooks()).toBeNull();
  expect(getMediaHooks()).toBeNull();
  expect(getPickedFilesHooks()).toBeNull();
  expect(getPrefsHooks()).toBeNull();
  expect(getRecoveryHooks()).toBeNull();
  expect(getRemoteHooks()).toBeNull();
  expect(getVcsHooks()).toBeNull();
  expect(getWatchHooks()).toBeNull();
  expect(getWriteHooks()).toBeNull();
});

// One fake per domain field (the shared support builder), built once and
// registered in a single call — mirrors main.ts's real "one
// registerHostServices() call, once every dependency exists" shape. The
// identity assertions below read each domain back off THIS object, so the
// builder returning fresh per-call sub-objects is exactly what they need.
const fakeServices = makeHostServices({
  fsGuard: { projectRoots: () => ["/fake/project"], readOnlyRoots: () => ["/fake/recovery"] },
});

test("registerHostServices() populates getHostServices() with the exact object reference", () => {
  registerHostServices(fakeServices);
  expect(getHostServices()).toBe(fakeServices);
});

test("every domain accessor reads its own field off the single registered object", () => {
  expect(getAppHooks()).toBe(fakeServices.app);
  expect(getDesktopHooks()).toBe(fakeServices.desktop);
  expect(getDoctorHooks()).toBe(fakeServices.doctor);
  expect(getFsGuardHooks()).toBe(fakeServices.fsGuard);
  expect(getMediaHooks()).toBe(fakeServices.media);
  expect(getPickedFilesHooks()).toBe(fakeServices.pickedFiles);
  expect(getPrefsHooks()).toBe(fakeServices.prefs as never);
  expect(getRecoveryHooks()).toBe(fakeServices.recovery);
  expect(getRemoteHooks()).toBe(fakeServices.remote as never);
  expect(getVcsHooks()).toBe(fakeServices.vcs as never);
  expect(getWatchHooks()).toBe(fakeServices.watch);
  expect(getWriteHooks()).toBe(fakeServices.write);
});

test("getPrefsHooks/getRemoteHooks/getVcsHooks keep their generic call-site narrowing after the collapse", () => {
  // These don't change behavior at runtime (same object back either way) —
  // this just locks that the generic signatures still compile/callable the
  // way ~40 route files already use them.
  interface NarrowLib { ping(): string }
  const prefs = getPrefsHooks<NarrowLib>();
  const remote = getRemoteHooks<NarrowLib, { token: string }>();
  const vcs = getVcsHooks<NarrowLib>();
  expect(prefs).toBe(fakeServices.prefs as never);
  expect(remote).toBe(fakeServices.remote as never);
  expect(vcs).toBe(fakeServices.vcs as never);
});

test("makeHostServices: a partial domain override merges over the base; an explicit undefined un-registers the domain", () => {
  // Pins the shared builder's override semantics for its 10 consumer suites
  // (pure function — registers nothing, so this file's ordering constraint
  // doesn't apply). Deep-ish merge: the overridden member wins, untouched
  // siblings stay; `undefined` = the 503 "hooks not registered" default.
  const services = makeHostServices({
    desktop: { getUserDataPath: () => "/custom" },
    remote: undefined,
  });
  expect(services.desktop.getUserDataPath()).toBe("/custom");
  expect(services.desktop.getNativeTheme()).toEqual({ shouldUseDarkColors: false });
  expect(services.remote).toBeUndefined();
});

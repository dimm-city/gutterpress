import { test, expect } from "bun:test";
import { createHostBridge } from "../../electron/server-bridge/create-host-bridge";

// createHostBridge encapsulates the globalThis register/get service-locator that
// the 10 server-bridge/*-hooks.ts modules previously hand-rolled. register(hooks)
// must stash the exact object so a later get() returns the same reference, and
// get() before any register() must return null (never undefined).

interface DemoHooks {
  ping: () => string;
}

test("get() before register() returns null", () => {
  const bridge = createHostBridge<DemoHooks>("__printMdTestBridgeUnset__");
  expect(bridge.get()).toBeNull();
});

test("register() then get() returns the same object reference", () => {
  const bridge = createHostBridge<DemoHooks>("__printMdTestBridgeSet__");
  const hooks: DemoHooks = { ping: () => "pong" };
  bridge.register(hooks);
  expect(bridge.get()).toBe(hooks);
  expect(bridge.get()!.ping()).toBe("pong");
});

test("two bridges with different keys do not share state", () => {
  const a = createHostBridge<DemoHooks>("__printMdTestBridgeA__");
  const b = createHostBridge<DemoHooks>("__printMdTestBridgeB__");
  const hooksA: DemoHooks = { ping: () => "a" };
  a.register(hooksA);
  expect(a.get()).toBe(hooksA);
  expect(b.get()).toBeNull();
});

test("two bridges sharing the same key share the same slot", () => {
  const first = createHostBridge<DemoHooks>("__printMdTestBridgeShared__");
  const second = createHostBridge<DemoHooks>("__printMdTestBridgeShared__");
  const hooks: DemoHooks = { ping: () => "shared" };
  first.register(hooks);
  expect(second.get()).toBe(hooks);
});

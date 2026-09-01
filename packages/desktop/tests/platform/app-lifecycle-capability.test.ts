import { afterEach, expect, test } from "bun:test";
import {
  onFlushBeforeClose,
  onFolderChanged,
  onOpenMarkdownFile,
  watchFolder,
} from "../../src/lib/app-lifecycle/app-lifecycle-capability";

// SFE-P5b: replaces the #44 unsaved-changes / Markdown-file-launch slice of
// tests/platform/adapter.test.ts's "ElectronAdapter" delegation tests, now
// exercising the capability module directly. All four members are real 1:1
// forwards to the bridge (no marshalling) — this proves each subscribes
// through the bridge and returns a working unsubscribe fn, same shape the
// old adapter test asserted.

function makeBridge() {
  const calls: Array<{ method: string; args: unknown[] }> = [];
  const rec =
    (method: string, ret: unknown) =>
    (...args: unknown[]) => {
      calls.push({ method, args });
      return ret;
    };
  return {
    calls,
    bridge: {
      watchFolder: rec("watchFolder", () => {}),
      onFlushBeforeClose: rec("onFlushBeforeClose", () => {}),
      onFolderChanged: rec("onFolderChanged", () => {}),
      onOpenMarkdownFile: rec("onOpenMarkdownFile", () => {}),
    },
  };
}

afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("watchFolder/onFlushBeforeClose/onFolderChanged/onOpenMarkdownFile delegate 1:1 to the bridge", () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };

  const unwatch = watchFolder("/p", () => {});
  expect(typeof unwatch).toBe("function");
  const offFlush = onFlushBeforeClose(() => {});
  expect(typeof offFlush).toBe("function");
  const offFolder = onFolderChanged(() => {});
  expect(typeof offFolder).toBe("function");
  const offLaunch = onOpenMarkdownFile(() => {});
  expect(typeof offLaunch).toBe("function");

  expect(calls.map((c) => c.method)).toEqual([
    "watchFolder",
    "onFlushBeforeClose",
    "onFolderChanged",
    "onOpenMarkdownFile",
  ]);
  expect(calls.find((c) => c.method === "watchFolder")?.args[0]).toBe("/p");
});

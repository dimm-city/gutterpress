import { afterEach, expect, test } from "bun:test";
import {
  build,
  cancelExport,
  getPlatformCapabilities,
  onBuildProgress,
  onUrlPreviewBlocked,
  startPreview,
  stopPreview,
} from "../../src/lib/export/build-preview-capability";
import { DesktopHostRequiredError } from "../../src/lib/platform/bridge";

// SFE-P5b: replaces the build/preview slice of tests/platform/adapter.test.ts's
// "ElectronAdapter" delegation tests — including its "maps openFolder →
// openDirectory and delegates 1:1" test's build()/startPreview() assertions,
// which is where the REAL marshalling this module preserves (#49's FolderRef
// unwrap) was originally proven. `openFolder` itself is dead (deleted, zero
// real consumers — see capability-map.md), so only the build/startPreview
// portion of that old test moves here.

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
      build: rec("build", Promise.resolve({ outDir: "/out" })),
      startPreview: rec("startPreview", Promise.resolve({ url: "http://localhost:1" })),
      stopPreview: rec("stopPreview", Promise.resolve({ stopped: true })),
      cancelExport: rec("cancelExport", Promise.resolve({ canceled: true })),
      onBuildProgress: rec("onBuildProgress", () => {}),
      onUrlPreviewBlocked: rec("onUrlPreviewBlocked", () => {}),
    },
  };
}

afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("#49: build()/startPreview() unwrap FolderRef.key into the plain path string the IPC expects", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };

  await build({ input: { key: "/proj", displayName: "proj" }, format: "pdf" });
  await startPreview({ input: { key: "/proj", displayName: "proj" } });

  expect(calls.find((c) => c.method === "build")?.args).toEqual([{ input: "/proj", format: "pdf" }]);
  expect(calls.find((c) => c.method === "startPreview")?.args).toEqual([{ input: "/proj" }]);
});

test("stopPreview/cancelExport/onBuildProgress/onUrlPreviewBlocked delegate 1:1 to the bridge", async () => {
  const { bridge, calls } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };

  await stopPreview();
  await cancelExport("export-1");
  onBuildProgress(() => {});
  onUrlPreviewBlocked(() => {});

  expect(calls.map((c) => c.method)).toEqual([
    "stopPreview",
    "cancelExport",
    "onBuildProgress",
    "onUrlPreviewBlocked",
  ]);
  expect(calls.find((c) => c.method === "cancelExport")?.args).toEqual(["export-1"]);
});

test("getPlatformCapabilities() returns the fixed all-true flags and still fails loudly off-Electron", () => {
  const { bridge } = makeBridge();
  // @ts-expect-error test global
  globalThis.window = { electron: bridge };
  expect(getPlatformCapabilities()).toEqual({
    nativeSavePath: true,
    showInFolder: true,
    persistentFolderAccess: true,
  });

  // @ts-expect-error test global
  globalThis.window = {};
  expect(() => getPlatformCapabilities()).toThrow(DesktopHostRequiredError);
});

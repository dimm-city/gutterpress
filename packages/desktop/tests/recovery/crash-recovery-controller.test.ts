import { expect, test } from "bun:test";
import {
  CrashRecoveryController,
  type CrashRecoveryDeps,
  type CrashRecoveryEntry,
} from "../../src/lib/routes/crash-recovery-controller.svelte";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// recovery-ui-controller.test / project-lifecycle-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

type Spy<A extends unknown[] = unknown[]> = ((...a: A) => void) & { calls: A[] };
const spy = <A extends unknown[] = unknown[]>(): Spy<A> => {
  const fn = ((...a: A) => {
    fn.calls.push(a);
  }) as Spy<A>;
  fn.calls = [];
  return fn;
};

interface Harness {
  ctrl: CrashRecoveryController;
  deps: {
    isDesktop: Spy<[]> & { value: boolean };
    crashRecoveryEnabled: Spy<[]> & { value: boolean };
    listRecovery: Spy<[string]> & { impl: (dir: string) => Promise<CrashRecoveryEntry[]> };
    clearRecovery: Spy<[string]>;
    readRecoveryFile: Spy<[string]> & { impl: (path: string) => Promise<string> };
    restoreIntoBuffer: Spy<[string, string]> & { impl?: () => Promise<boolean> };
    showEditor: Spy<[]>;
    toastError: Spy<[string]>;
  };
}

function make(): Harness {
  const isDesktop = Object.assign(spy<[]>(), { value: true });
  const crashRecoveryEnabled = Object.assign(spy<[]>(), { value: true });
  const listRecovery = Object.assign(spy<[string]>(), {
    impl: async (): Promise<CrashRecoveryEntry[]> => [],
  });
  const clearRecovery = spy<[string]>();
  const readRecoveryFile = Object.assign(spy<[string]>(), {
    impl: async (): Promise<string> => "recovered text",
  });
  const restoreIntoBuffer = Object.assign(spy<[string, string]>(), {
    impl: async () => true,
  });
  const showEditor = spy<[]>();
  const toastError = spy<[string]>();

  const deps: CrashRecoveryDeps = {
    isDesktop: () => {
      isDesktop();
      return isDesktop.value;
    },
    crashRecoveryEnabled: () => {
      crashRecoveryEnabled();
      return crashRecoveryEnabled.value;
    },
    listRecovery: (dir) => {
      listRecovery(dir);
      return listRecovery.impl(dir);
    },
    clearRecovery: (filePath) => {
      clearRecovery(filePath);
      return Promise.resolve();
    },
    readRecoveryFile: (path) => {
      readRecoveryFile(path);
      return readRecoveryFile.impl(path);
    },
    restoreIntoBuffer: (filePath, content) => {
      restoreIntoBuffer(filePath, content);
      return restoreIntoBuffer.impl!();
    },
    showEditor: () => showEditor(),
    toast: () => ({ error: (msg) => toastError(msg) }),
    friendlyHostError: (msg) => `friendly: ${msg}`,
  };

  return {
    ctrl: new CrashRecoveryController(deps),
    deps: {
      isDesktop,
      crashRecoveryEnabled,
      listRecovery,
      clearRecovery,
      readRecoveryFile,
      restoreIntoBuffer,
      showEditor,
      toastError,
    },
  };
}

// ── scan ─────────────────────────────────────────────────────────────────────

test("scan() no-ops on the web", async () => {
  const { ctrl, deps } = make();
  deps.isDesktop.value = false;
  await ctrl.scan("/proj");
  expect(deps.listRecovery.calls.length).toBe(0);
});

test("scan() no-ops when crash recovery is disabled in settings (still marks the dir scanned)", async () => {
  const { ctrl, deps } = make();
  deps.crashRecoveryEnabled.value = false;
  await ctrl.scan("/proj");
  expect(deps.listRecovery.calls.length).toBe(0);
  expect(ctrl.items).toEqual([]);
});

test("scan() guards against re-scanning the same folder twice", async () => {
  const { ctrl, deps } = make();
  await ctrl.scan("/proj");
  await ctrl.scan("/proj");
  expect(deps.listRecovery.calls.length).toBe(1);
});

test("scan() a different folder re-scans", async () => {
  const { ctrl, deps } = make();
  await ctrl.scan("/proj-a");
  await ctrl.scan("/proj-b");
  expect(deps.listRecovery.calls.length).toBe(2);
});

test("an older project scan cannot replace a newer project's recovery items", async () => {
  const { ctrl, deps } = make();
  let releaseA!: (entries: CrashRecoveryEntry[]) => void;
  deps.listRecovery.impl = (dir) =>
    dir === "/proj-a"
      ? new Promise((resolve) => (releaseA = resolve))
      : Promise.resolve([
          { filePath: "/proj-b/b.md", recoveryPath: "/recovery/b", savedAt: 2 },
        ]);

  const scanA = ctrl.scan("/proj-a");
  await ctrl.scan("/proj-b");
  releaseA([{ filePath: "/proj-a/a.md", recoveryPath: "/recovery/a", savedAt: 1 }]);
  await scanA;

  expect(ctrl.items.map((item) => item.filePath)).toEqual(["/proj-b/b.md"]);
});

test("scan() maps entries to RecoveryItem with a derived fileName", async () => {
  const { ctrl, deps } = make();
  deps.listRecovery.impl = async () => [
    { filePath: "/proj/chapters/ch1.md", recoveryPath: "/userdata/rec1", savedAt: 100 },
  ];
  await ctrl.scan("/proj");
  expect(ctrl.items).toEqual([
    { filePath: "/proj/chapters/ch1.md", recoveryPath: "/userdata/rec1", fileName: "ch1.md", savedAt: 100 },
  ]);
});

test("scan() failure clears items instead of throwing", async () => {
  const { ctrl, deps } = make();
  deps.listRecovery.impl = () => Promise.reject(new Error("boom"));
  ctrl.items = [{ filePath: "/a", recoveryPath: "/b", fileName: "a", savedAt: 1 }];
  await ctrl.scan("/proj");
  expect(ctrl.items).toEqual([]);
});

// ── restore ──────────────────────────────────────────────────────────────────

const ITEM = { filePath: "/proj/ch1.md", recoveryPath: "/userdata/rec1", fileName: "ch1.md", savedAt: 100 };

test("restore() removes the item, restores the session, and opens the editor", async () => {
  const { ctrl, deps } = make();
  ctrl.items = [ITEM];
  await ctrl.restore(ITEM);
  expect(ctrl.items).toEqual([]);
  expect(deps.readRecoveryFile.calls).toEqual([[ITEM.recoveryPath]]);
  expect(deps.restoreIntoBuffer.calls).toEqual([[ITEM.filePath, "recovered text"]]);
  expect(deps.showEditor.calls.length).toBe(1);
});

test("restore() no-ops on the web after removing the item", async () => {
  const { ctrl, deps } = make();
  deps.isDesktop.value = false;
  ctrl.items = [ITEM];
  await ctrl.restore(ITEM);
  expect(ctrl.items).toEqual([]);
  expect(deps.readRecoveryFile.calls.length).toBe(0);
});

test("restore() read failure toasts and re-offers the still-safe recovery item", async () => {
  const { ctrl, deps } = make();
  deps.readRecoveryFile.impl = () => Promise.reject(new Error("disk error"));
  ctrl.items = [ITEM];
  await ctrl.restore(ITEM);
  expect(ctrl.items).toEqual([ITEM]);
  expect(deps.toastError.calls).toEqual([["Could not restore: friendly: disk error"]]);
});

test("reset during a recovery read prevents the stale project from restoring or opening", async () => {
  const { ctrl, deps } = make();
  let release!: (value: string) => void;
  deps.readRecoveryFile.impl = () => new Promise((resolve) => (release = resolve));
  const restoring = ctrl.restore(ITEM);
  ctrl.reset();
  release("recovered text");
  await restoring;
  expect(deps.restoreIntoBuffer.calls).toEqual([]);
  expect(deps.showEditor.calls).toEqual([]);
});

test("reset during a failed recovery read neither re-offers nor toasts the old project", async () => {
  const { ctrl, deps } = make();
  let reject!: (reason: Error) => void;
  deps.readRecoveryFile.impl = () => new Promise((_resolve, rejectPromise) => (reject = rejectPromise));
  ctrl.items = [ITEM];
  const restoring = ctrl.restore(ITEM);
  ctrl.reset();
  reject(new Error("old project read failed"));
  await restoring;
  expect(ctrl.items).toEqual([]);
  expect(deps.toastError.calls).toEqual([]);
});

test("a cancelled session restore does not open or focus the editor", async () => {
  const { ctrl, deps } = make();
  ctrl.items = [ITEM];
  deps.restoreIntoBuffer.impl = async () => false;
  await ctrl.restore(ITEM);
  expect(ctrl.items).toEqual([ITEM]);
  expect(deps.showEditor.calls).toEqual([]);
});

// ── discard ──────────────────────────────────────────────────────────────────

test("discard() removes the item and clears the sidecar on desktop", () => {
  const { ctrl, deps } = make();
  ctrl.items = [ITEM];
  ctrl.discard(ITEM);
  expect(ctrl.items).toEqual([]);
  expect(deps.clearRecovery.calls).toEqual([[ITEM.filePath]]);
});

test("discard() removes the item but does not call clearRecovery on the web", () => {
  const { ctrl, deps } = make();
  deps.isDesktop.value = false;
  ctrl.items = [ITEM];
  ctrl.discard(ITEM);
  expect(ctrl.items).toEqual([]);
  expect(deps.clearRecovery.calls.length).toBe(0);
});

// ── dismiss / reset ──────────────────────────────────────────────────────────

test("dismiss() clears all items ('decide later')", () => {
  const { ctrl } = make();
  ctrl.items = [ITEM];
  ctrl.dismiss();
  expect(ctrl.items).toEqual([]);
});

test("reset() clears items and the scan-dir guard, so the same folder can be re-scanned", async () => {
  const { ctrl, deps } = make();
  await ctrl.scan("/proj");
  ctrl.items = [ITEM];
  ctrl.reset();
  expect(ctrl.items).toEqual([]);
  await ctrl.scan("/proj");
  expect(deps.listRecovery.calls.length).toBe(2);
});

/**
 * Unit tests for electron/pdf-export.ts (ARCH review finding #27).
 *
 * `electronPdfRenderer`'s poll loop used to treat "Paged.js finished" and
 * "deadline elapsed" identically — both fell through to `printToPDF`, so a
 * timed-out render silently produced a TRUNCATED PDF reported as a success.
 * The loop is now extracted into `waitForPagedRendered`, a pure
 * dependency-injected helper with no BrowserWindow/webContents, so the
 * timeout-vs-done distinction is directly testable with fakes (no real
 * Electron process needed for these first tests).
 *
 * The "electron" package's default export outside a real Electron process is
 * just a path string (see tests/updater/electron-updater.test.ts), so
 * `import { BrowserWindow } from "electron"` in pdf-export.ts would
 * destructure to `undefined` under `bun test`. We mock it anyway (as that
 * suite does) so the later full-pipeline tests can supply a working fake
 * BrowserWindow.
 */
import { test, expect, mock } from "bun:test";
import { electronMock } from "../support/electron-mock";
import { BuildError } from "gutterpress";

class FakeWebContents {
  execCalls: string[] = [];
  printToPDFCalls = 0;
  constructor(
    private statusFn: () => { done: boolean; pages: number },
  ) {}
  async executeJavaScript(script: string): Promise<unknown> {
    this.execCalls.push(script);
    if (script.includes("document.fonts.ready")) return true;
    if (script.includes("__PAGED_RENDERED__")) return this.statusFn();
    if (script.includes("getComputedStyle")) {
      return { count: 1, w: 816, h: 1056 };
    }
    return null;
  }
  async printToPDF(): Promise<Buffer> {
    this.printToPDFCalls++;
    return Buffer.from("fake-pdf-bytes");
  }
}

class FakeBrowserWindow {
  static instances: FakeBrowserWindow[] = [];
  webContents: FakeWebContents;
  private destroyed = false;
  constructor(_opts: unknown, statusFn: () => { done: boolean; pages: number } = () => ({ done: true, pages: 1 })) {
    this.webContents = new FakeWebContents(statusFn);
    FakeBrowserWindow.instances.push(this);
  }
  async loadURL(): Promise<void> {}
  isDestroyed(): boolean {
    return this.destroyed;
  }
  destroy(): void {
    this.destroyed = true;
  }
}

// The test-specific status function each fake BrowserWindow should poll —
// swapped per-test via `nextStatusFn` since the "electron" mock factory below
// only runs once per module instance and can't take per-test params directly.
let nextStatusFn: () => { done: boolean; pages: number } = () => ({ done: true, pages: 1 });

// NOTE: `bun test --isolate` does not fully sandbox `mock.module("electron", …)`
// registrations between files that all touch the "electron" specifier — other
// electron-mocking suites in this run (tests/updater/electron-updater.test.ts,
// tests/platform/sveltekit-host.test.ts, tests/platform/credential-store.test.ts)
// can end up "winning" the shared registration for this specifier. So every
// such suite mocks the SAME superset of keys every electron/*.ts production
// module statically imports from "electron" (app.getPath, protocol,
// BrowserWindow, safeStorage) — whichever file's registration is actually
// live, every other suite's named imports still resolve. Keep this superset
// in sync with any new `from "electron"` import added to electron/*.ts.
mock.module("electron", () =>
  electronMock({
    BrowserWindow: class extends FakeBrowserWindow {
      constructor(opts: unknown) {
        super(opts, nextStatusFn);
      }
    },
  }),
);

const {
  electronPdfRenderer,
  waitForPagedRendered,
  setActiveExportSession,
  ExportCanceledError,
} = await import("../../electron/pdf-export");

// ── waitForPagedRendered (pure poll-loop helper) ────────────────────────────

test("waitForPagedRendered resolves with the final page count once done flips true", async () => {
  const progress: number[] = [];
  let calls = 0;
  const pages = await waitForPagedRendered(10_000, {
    getStatus: async () => {
      calls++;
      return { done: calls >= 3, pages: calls };
    },
    now: () => 0,
    sleep: async () => {},
    onProgress: (p) => progress.push(p),
    checkCanceled: () => {},
  });
  expect(pages).toBe(3);
  expect(progress).toEqual([1, 2, 3]);
});

test("waitForPagedRendered only reports progress when the page count changes", async () => {
  const progress: number[] = [];
  let calls = 0;
  await waitForPagedRendered(10_000, {
    getStatus: async () => {
      calls++;
      // Page count sticks at 2 for a few polls before finishing.
      return { done: calls >= 4, pages: 2 };
    },
    now: () => 0,
    sleep: async () => {},
    onProgress: (p) => progress.push(p),
    checkCanceled: () => {},
  });
  expect(progress).toEqual([2]);
});

test("waitForPagedRendered throws a typed, author-friendly BuildError on deadline instead of returning", async () => {
  let now = 0;
  const err = await waitForPagedRendered(60_000, {
    getStatus: async () => ({ done: false, pages: 5 }),
    now: () => now,
    sleep: async () => {
      now += 1000;
    },
    onProgress: () => {},
    checkCanceled: () => {},
  }).catch((e) => e);

  expect(err).toBeInstanceOf(BuildError);
  expect(err).toBeInstanceOf(Error);
  expect((err as Error).message).toContain("did not finish");
  expect((err as Error).message).toContain("1 minute");
  expect((err as Error).message).toContain("incomplete PDF");
});

test("waitForPagedRendered's deadline error scales the minute count with timeoutMs", async () => {
  let now = 0;
  const err = await waitForPagedRendered(20 * 60_000, {
    getStatus: async () => ({ done: false, pages: 1 }),
    now: () => now,
    sleep: async () => {
      now += 60_000;
    },
    onProgress: () => {},
    checkCanceled: () => {},
  }).catch((e) => e);
  expect((err as Error).message).toContain("20 minutes");
});

test("waitForPagedRendered propagates a cancellation check immediately, not a BuildError", async () => {
  class Canceled extends Error {}
  const err = await waitForPagedRendered(10_000, {
    getStatus: async () => ({ done: false, pages: 1 }),
    now: () => 0,
    sleep: async () => {},
    onProgress: () => {},
    checkCanceled: () => {
      throw new Canceled("canceled");
    },
  }).catch((e) => e);
  expect(err).toBeInstanceOf(Canceled);
  expect(err).not.toBeInstanceOf(BuildError);
});

// ── electronPdfRenderer (full pipeline, fake BrowserWindow) ─────────────────

test("electronPdfRenderer never calls printToPDF when rendering times out — no truncated PDF", async () => {
  nextStatusFn = () => ({ done: false, pages: 7 });
  setActiveExportSession({
    id: "exp-timeout",
    canceled: false,
    outPath: "/tmp/out.pdf",
    tempOutPath: "/tmp/out.tmp.pdf",
    win: null,
  });
  try {
    const err = await electronPdfRenderer({
      url: "http://127.0.0.1:1/book.html",
      outPdf: "/tmp/out.pdf",
      timeoutMs: 5, // effectively immediate deadline
    }).catch((e) => e);

    expect(err).toBeInstanceOf(BuildError);
    expect((err as Error).message).toContain("did not finish");
    const win = FakeBrowserWindow.instances.at(-1);
    expect(win?.webContents.printToPDFCalls).toBe(0);
  } finally {
    setActiveExportSession(null);
  }
});

test("electronPdfRenderer completes normally and calls printToPDF exactly once when Paged.js finishes in time", async () => {
  nextStatusFn = () => ({ done: true, pages: 4 });
  setActiveExportSession({
    id: "exp-ok",
    canceled: false,
    outPath: "/tmp/out2.pdf",
    tempOutPath: "/tmp/out2.tmp.pdf",
    win: null,
  });
  try {
    await electronPdfRenderer({
      url: "http://127.0.0.1:1/book.html",
      outPdf: "/tmp/out2.pdf",
      timeoutMs: 10_000,
    });
    const win = FakeBrowserWindow.instances.at(-1);
    expect(win?.webContents.printToPDFCalls).toBe(1);
  } finally {
    setActiveExportSession(null);
  }
});

test("electronPdfRenderer still throws ExportCanceledError (unrelated to the timeout path) when canceled mid-render", async () => {
  nextStatusFn = () => ({ done: false, pages: 1 });
  const session = {
    id: "exp-cancel",
    canceled: false,
    outPath: "/tmp/out3.pdf",
    tempOutPath: "/tmp/out3.tmp.pdf",
    win: null,
  };
  setActiveExportSession(session);
  try {
    const p = electronPdfRenderer({
      url: "http://127.0.0.1:1/book.html",
      outPdf: "/tmp/out3.pdf",
      timeoutMs: 10_000,
    });
    // Cancel shortly after the render starts polling.
    queueMicrotask(() => {
      session.canceled = true;
    });
    const err = await p.catch((e) => e);
    expect(err).toBeInstanceOf(ExportCanceledError);
  } finally {
    setActiveExportSession(null);
  }
});

import { afterEach, beforeEach, expect, test } from "bun:test";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createSavePathsService } from "../../electron/server-bridge/picked-files";
import { ExportController, type ExportControllerDeps } from "../../electron/export/controller";
import { POST as savePdfRoute } from "../../src/routes/api/dialog/save-pdf/+server";

// Finding #4 (2026-07-13 maintainer review): "PDF export accepts arbitrary
// output paths. The save dialog does not issue a capability, while api:build
// accepts renderer-controlled out and atomically replaces that destination."
//
// This suite pins the fix end-to-end: `dialog:savePdf` REGISTERS the
// absolute path the native Save dialog itself just returned
// (`electron/server-bridge/picked-files.ts`'s `SavePathHooks`); the export
// controller's `build()` must CONSUME that one-time capability for `out`
// before doing any work — an `out` the Save dialog never returned (or one
// already consumed) is rejected with `OUT_NOT_AUTHORIZED`, and never reaches
// the build/rename pipeline.

function request(body: unknown = {}): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

let savedHostServices: HostServices | null;
let savePaths: ReturnType<typeof createSavePathsService>;
/** What the mocked native Save dialog returns on its next call. */
let nextSaveResult: { canceled: boolean; filePath?: string };

beforeEach(() => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file (same convention as
  // picked-files-capability.test.ts).
  savedHostServices = getHostServices();

  savePaths = createSavePathsService();
  nextSaveResult = { canceled: true };
  const noop = () => {};
  const services = {
    app: { updateSplash: noop, showMainWindowAndCloseSplash: noop, setRendererDirty: noop, sendToRenderer: noop },
    conflictPreview: { getConflictPreview: async () => ({ mine: "", theirs: "", kind: "both-edited" as const, isBinary: false }) },
    desktop: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => nextSaveResult,
      openExternal: async () => {},
      showItemInFolder: noop,
      getNativeTheme: () => ({ shouldUseDarkColors: false }),
      getUserDataPath: () => "/fake",
    },
    doctor: { getViewerVersion: () => "0.0.0-test" },
    fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
    media: { createThumbnail: async () => null },
    pickedFiles: { register: noop, consume: () => false },
    prefs: {
      readPrefs: async () => ({}),
      writePrefs: async () => {},
      updatePrefs: async (mutate: (p: object) => object) => mutate({}),
      readSettings: async () => ({}),
      updateSettings: async () => ({}),
      existingDirectory: async () => null,
      readProjectState: () => null,
      writeProjectState: (states: unknown) => states,
      defaultProjectSearchRoots: () => [],
      scanForProjects: async () => [],
      toggleFavoriteFolder: (favorites: unknown) => ({ favorites: (favorites as []) ?? [], favorited: false }),
      removeRecentFolder: () => [],
      loadLib: async () => ({}),
    },
    recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] },
    remote: { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" },
    savePaths,
    vcs: { loadLib: async () => ({}), operationLogPath: () => "/fake/log" },
    watch: { startFolderWatch: noop, stopFolderWatch: noop, getWatchedDir: () => null },
    write: { scheduleAutoSnapshot: noop, scheduleAutoSync: noop, getWatchedDir: () => null },
  } as unknown as HostServices;
  registerHostServices(services);
});

afterEach(() => {
  registerHostServices(savedHostServices as HostServices);
});

// ── dialog/save-pdf registers what the native dialog returned ──────────────

test("dialog/save-pdf registers the path the native Save dialog returned as a one-time capability", async () => {
  const chosen = "/home/author/book.pdf";
  nextSaveResult = { canceled: false, filePath: chosen };

  const res = await savePdfRoute({ request: request({}) } as Parameters<typeof savePdfRoute>[0]);
  expect(await res.json()).toBe(chosen);

  // Registered by the route itself — consumable exactly once.
  expect(savePaths.consume(chosen)).toBe(true);
  expect(savePaths.consume(chosen)).toBe(false);
});

test("a cancelled Save dialog registers nothing", async () => {
  nextSaveResult = { canceled: true };
  await savePdfRoute({ request: request({}) } as Parameters<typeof savePdfRoute>[0]);
  expect(savePaths.consume("/home/author/book.pdf")).toBe(false);
});

// ── ExportController.build: the actual bypass, wired to the real capability ─

type LibModule = typeof import("@dimm-city/print-md");

/** Minimal ExportController harness wired to the REAL savePaths service above. */
function makeController(): ExportController {
  const lib = {
    detectProjectSource: async () => ({ type: "local-folder" }),
    diagnoseProjectRemote: async () => ({ canSync: false }),
    syncProject: async () => ({ status: "up-to-date" }),
    splitOutPath: (tempOutPath: string) => ({ outDir: `${tempOutPath}.dir` }),
    runBuild: async () => ({ outDir: "/out", htmlPath: "/out/x.html", fingerprintPath: "/out/fp.json" }),
    BuildError: class extends Error {},
  } as unknown as LibModule;

  let session: Awaited<ReturnType<ExportControllerDeps["getActiveExportSession"]>> = null;
  const deps: ExportControllerDeps = {
    loadLib: async () => lib,
    tokenStore: {} as ExportControllerDeps["tokenStore"],
    isOnline: () => true,
    usePuppeteer: () => false,
    pdfRenderer: (async () => {}) as ExportControllerDeps["pdfRenderer"],
    sync: { isConflictLatched: () => false, latchConflict: () => {} },
    getActiveExportSession: () => session,
    setActiveExportSession: (s) => {
      session = s;
    },
    sendProgress: () => {},
    throwIfCanceled: () => {},
    isExportCanceledError: () => false,
    rename: async () => {},
    rm: async () => {},
    // The exact seam finding #4 targets: wired to the REAL savePaths
    // service, exactly as electron/main.ts wires it.
    consumeSavePath: (absPath) => savePaths.consume(absPath),
  };
  return new ExportController(deps);
}

test("api:build with an arbitrary 'out' never issued by the Save dialog is rejected", async () => {
  const controller = makeController();
  const err = await controller
    .build({ input: "/book", out: "/etc/passwd" })
    .catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("OUT_NOT_AUTHORIZED");
});

test("api:build with an 'out' registered by the save-pdf route is accepted, and consumed exactly once", async () => {
  const chosen = "/home/author/book.pdf";
  nextSaveResult = { canceled: false, filePath: chosen };
  await savePdfRoute({ request: request({}) } as Parameters<typeof savePdfRoute>[0]);

  const controller = makeController();
  const res = await controller.build({ input: "/book", out: chosen });
  expect(res.pdfPath).toBe(chosen);

  // The capability was consumed by the first build — a replay of the SAME
  // out path, with no fresh Save dialog round-trip, must be rejected.
  const err = await controller.build({ input: "/book", out: chosen }).catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("OUT_NOT_AUTHORIZED");
});

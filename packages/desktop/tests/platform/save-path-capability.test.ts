import { afterEach, beforeEach, expect, test } from "bun:test";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import {
  createPickedFilesService,
  createSavePathsService,
} from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { ExportController, type ExportControllerDeps } from "../../electron/export/controller";
// dialog/save-pdf's own registration coverage moved to dialog-ipc.test.ts
// (SFE-P5c1: migrated to typed IPC, `electron/api/dialog.ts`'s
// `dialogSavePdf`). This file keeps only the ExportController.build half —
// the actual finding #4 bypass, wired to the REAL savePaths service.
import { dialogSavePdf } from "../../electron/api/dialog";

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

let savedHostServices: HostServices | null;
let savePaths: ReturnType<typeof createSavePathsService>;
let pickedFiles: ReturnType<typeof createPickedFilesService>;
/** What the mocked native Save dialog returns on its next call. */
let nextSaveResult: { canceled: boolean; filePath?: string };

beforeEach(() => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file (same convention as
  // picked-files-capability.test.ts).
  savedHostServices = getHostServices();

  savePaths = createSavePathsService();
  pickedFiles = createPickedFilesService();
  nextSaveResult = { canceled: true };
  registerHostServices(
    makeHostServices({
      desktop: {
        showSaveDialog: async () => nextSaveResult,
        getUserDataPath: () => "/fake",
      },
      savePaths,
    }),
  );
});

afterEach(() => {
  registerHostServices(savedHostServices as HostServices);
});

// ── ExportController.build: the actual bypass, wired to the real capability ─

type LibModule = typeof import("gutterpress");

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
    // Same faithfulness for the reveal capability (2026-07-29 audit): the
    // written PDF is registered as a picked path so the export's "Show in
    // Folder" action can reveal a destination outside the project.
    registerPickedPath: (absPath) => pickedFiles.register([absPath]),
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

test("api:build with an 'out' registered by dialog:savePdf is accepted, and consumed exactly once", async () => {
  const chosen = "/home/author/book.pdf";
  nextSaveResult = { canceled: false, filePath: chosen };
  await dialogSavePdf();

  const controller = makeController();
  const res = await controller.build({ input: "/book", out: chosen });
  expect(res.pdfPath).toBe(chosen);

  // The capability was consumed by the first build — a replay of the SAME
  // out path, with no fresh Save dialog round-trip, must be rejected.
  const err = await controller.build({ input: "/book", out: chosen }).catch((e) => e);
  expect((err as Error & { code?: string }).code).toBe("OUT_NOT_AUTHORIZED");
});

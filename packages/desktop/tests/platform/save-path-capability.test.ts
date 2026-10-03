import { afterEach, beforeEach, expect, test } from "bun:test";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import {
  createPickedFilesService,
  createSavePathsService,
} from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { ExportController, type ExportControllerDeps } from "../../electron/export/controller";
import { POST as savePdfRoute } from "../../src/routes/api/dialog/save-pdf/+server";
import { POST as pickOutputFolderRoute } from "../../src/routes/api/dialog/pick-output-folder/+server";

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
let pickedFiles: ReturnType<typeof createPickedFilesService>;
/** What the mocked native Save dialog returns on its next call. */
let nextSaveResult: { canceled: boolean; filePath?: string };
/** Options the mocked native Save dialog was last opened with. */
let lastSaveOptions: { defaultPath?: string } | null;
/** What the mocked native Open dialog returns on its next call. */
let nextOpenResult: { canceled: boolean; filePaths: string[] };
/** Options the mocked native Open dialog was last opened with. */
let lastOpenOptions: { title?: string; properties?: string[]; defaultPath?: string } | null;

beforeEach(() => {
  // Host services are process-global — save/restore so this file's fixture
  // never leaks into a sibling test file (same convention as
  // picked-files-capability.test.ts).
  savedHostServices = getHostServices();

  savePaths = createSavePathsService();
  pickedFiles = createPickedFilesService();
  nextSaveResult = { canceled: true };
  lastSaveOptions = null;
  nextOpenResult = { canceled: true, filePaths: [] };
  lastOpenOptions = null;
  registerHostServices(
    makeHostServices({
      desktop: {
        showSaveDialog: async (options: { defaultPath?: string }) => {
          lastSaveOptions = options;
          return nextSaveResult;
        },
        showOpenDialog: async (options: { title?: string; properties?: string[]; defaultPath?: string }) => {
          lastOpenOptions = options;
          return nextOpenResult;
        },
        getUserDataPath: () => "/fake",
      },
      savePaths,
      pickedFiles,
    }),
  );
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

test("dialog/save-pdf opens in defaultDir when one is given", async () => {
  await savePdfRoute({
    request: request({ defaultName: "MyBook.pdf", defaultDir: "/home/author/book/dist" }),
  } as Parameters<typeof savePdfRoute>[0]);
  expect(lastSaveOptions?.defaultPath).toBe("/home/author/book/dist/MyBook.pdf");

  await savePdfRoute({ request: request({ defaultDir: "/home/author/book/dist" }) } as Parameters<typeof savePdfRoute>[0]);
  expect(lastSaveOptions?.defaultPath).toBe("/home/author/book/dist/book.pdf");

  await savePdfRoute({ request: request({}) } as Parameters<typeof savePdfRoute>[0]);
  expect(lastSaveOptions?.defaultPath).toBe("book.pdf");
});

// ── dialog/pick-output-folder: a chosen save DESTINATION folder ────────────

test("dialog/pick-output-folder registers the chosen folder in BOTH the save-path and picked-file pools", async () => {
  const chosen = "/home/author/Exports";
  nextOpenResult = { canceled: false, filePaths: [chosen] };

  const res = await pickOutputFolderRoute({
    request: request({ defaultPath: "/home/author/book/dist" }),
  } as Parameters<typeof pickOutputFolderRoute>[0]);
  expect(await res.json()).toBe(chosen);
  expect(lastOpenOptions?.properties).toEqual(["openDirectory", "createDirectory"]);
  expect(lastOpenOptions?.defaultPath).toBe("/home/author/book/dist");

  // Write capability: api:build may use it as `out`, once.
  expect(savePaths.consume(chosen)).toBe(true);
  expect(savePaths.consume(chosen)).toBe(false);
  // Read capability: publish:run may read the artifact built there.
  expect(pickedFiles.consume(chosen)).toBe(true);
});

test("a cancelled output-folder dialog registers nothing and resolves null", async () => {
  nextOpenResult = { canceled: true, filePaths: [] };
  const res = await pickOutputFolderRoute({ request: request({}) } as Parameters<typeof pickOutputFolderRoute>[0]);
  expect(await res.json()).toBeNull();
  expect(savePaths.consume("/home/author/Exports")).toBe(false);
  expect(pickedFiles.consume("/home/author/Exports")).toBe(false);
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
    // Nothing is "inside the book" here, so only a dialog grant authorizes.
    isWithinProject: async () => false,
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

test("api:build accepts a folder from pick-output-folder as an html 'out'", async () => {
  const chosen = "/home/author/Exports";
  nextOpenResult = { canceled: false, filePaths: [chosen] };
  await pickOutputFolderRoute({ request: request({}) } as Parameters<typeof pickOutputFolderRoute>[0]);

  const controller = makeController();
  const res = await controller.build({ input: "/book", format: "html", out: chosen });
  expect(res.outDir).toBe(chosen);
  expect(res.pdfPath).toBeUndefined();
});

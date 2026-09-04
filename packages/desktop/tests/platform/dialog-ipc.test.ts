/**
 * IPC-handler contract for `electron/api/dialog.ts` (SFE-P5c1 — migrated off
 * `src/routes/api/dialog/{pick-image-file,pick-image-files,save-pdf}/
 * +server.ts`, deleted).
 *
 * Ports the dialog-route cases from the deleted `picked-files-capability
 * .test.ts` (pick-image-file/pick-image-files register what the native
 * dialog returned) and `save-path-capability.test.ts` (save-pdf registers
 * the Save dialog's result as a one-time capability) — both files' OTHER
 * cases (media/import-image, ExportController.build) test routes/modules
 * outside this subrun's scope and are untouched (see
 * media-routes-scoping.test.ts and save-path-capability.test.ts).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, getHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { createPickedFilesService, createSavePathsService } from "../../electron/server-bridge/picked-files";
import { makeHostServices } from "../support/host-services-fake";
import { dialogPickImageFile, dialogPickImageFiles, dialogSavePdf } from "../../electron/api/dialog";

let base: string;
let outsideDir: string;
let savedHostServices: HostServices | null;
let pickedFiles: ReturnType<typeof createPickedFilesService>;
let savePaths: ReturnType<typeof createSavePathsService>;
/** What the mocked native dialog returns on its next call. */
let nextFilePaths: string[];
let nextSaveResult: { canceled: boolean; filePath?: string };

beforeEach(async () => {
  savedHostServices = getHostServices();
  base = await mkdtemp(path.join(tmpdir(), "gutterpress-dialog-ipc-"));
  outsideDir = path.join(base, "elsewhere");
  await mkdir(outsideDir, { recursive: true });

  pickedFiles = createPickedFilesService();
  savePaths = createSavePathsService();
  nextFilePaths = [];
  nextSaveResult = { canceled: true };
  registerHostServices(
    makeHostServices({
      desktop: {
        showOpenDialog: async () => ({ canceled: nextFilePaths.length === 0, filePaths: nextFilePaths }),
        showSaveDialog: async () => nextSaveResult,
        getUserDataPath: () => base,
      },
      fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
      pickedFiles,
      savePaths,
    }),
  );
});

afterEach(async () => {
  await rm(base, { recursive: true, force: true });
  registerHostServices(savedHostServices as HostServices);
});

test("dialog:pickImageFile registers the path the native dialog returned as a one-time capability", async () => {
  const picked = path.join(outsideDir, "photo.jpg");
  nextFilePaths = [picked];
  expect(await dialogPickImageFile()).toBe(picked);
  expect(pickedFiles.consume(picked)).toBe(true);
  expect(pickedFiles.consume(picked)).toBe(false);
});

test("dialog:pickImageFiles registers every path the native dialog returned", async () => {
  const pickedA = path.join(outsideDir, "a.png");
  const pickedB = path.join(outsideDir, "b.png");
  nextFilePaths = [pickedA, pickedB];
  expect(await dialogPickImageFiles()).toEqual([pickedA, pickedB]);
  expect(pickedFiles.consume(pickedA)).toBe(true);
  expect(pickedFiles.consume(pickedB)).toBe(true);
});

test("a cancelled dialog:pickImageFile registers nothing", async () => {
  nextFilePaths = [];
  await dialogPickImageFile();
  expect(pickedFiles.consume(path.join(outsideDir, "photo.jpg"))).toBe(false);
});

test("dialog:savePdf registers the path the native Save dialog returned as a one-time capability", async () => {
  const chosen = "/home/author/book.pdf";
  nextSaveResult = { canceled: false, filePath: chosen };
  expect(await dialogSavePdf()).toBe(chosen);
  expect(savePaths.consume(chosen)).toBe(true);
  expect(savePaths.consume(chosen)).toBe(false);
});

test("a cancelled dialog:savePdf registers nothing", async () => {
  nextSaveResult = { canceled: true };
  await dialogSavePdf();
  expect(savePaths.consume("/home/author/book.pdf")).toBe(false);
});

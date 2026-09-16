/**
 * Native dialog operations for the "files/dialog" IPC capability (SFE-P5c1).
 *
 * Ports `src/routes/api/dialog/{open-directory,save-pdf,pick-image-file,
 * pick-pdf-file,pick-image-files}/+server.ts` verbatim, including the
 * picked-files/save-paths one-time-capability registration each dialog
 * performs — `electron/server-bridge/picked-files.ts` is unchanged
 * main-process state shared with the still-HTTP `media:importImage` route
 * (P5c4) and the export controller's `out` consumption, so registering here
 * keeps authorizing those call sites exactly as before.
 */
import { getDesktopHooks } from "../server-bridge/host-hooks";
import { getPickedFilesHooks, getSavePathsHooks } from "../server-bridge/picked-files";
import type { SecureHandle } from "../server-bridge/secure-handle";

function hooks() {
  const h = getDesktopHooks();
  if (!h) throw new Error("Desktop hooks not registered");
  return h;
}

/** Open native directory picker. Resolves null when cancelled. */
export async function dialogOpenDirectory(): Promise<string | null> {
  const res = await hooks().showOpenDialog({
    title: "Open Gutterpress project",
    properties: ["openDirectory"],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  // Two callers share this dialog: "open a project" and the Publish panel's
  // artifact-directory picker (see the deleted route's comment) — registering
  // the chosen path authorizes nothing else meaningful since the other
  // consumers (media:importImage's src) match exact file paths.
  getPickedFilesHooks()?.register(res.filePaths);
  return res.filePaths[0]!;
}

/** Open native PDF save dialog. Resolves null when cancelled. */
export async function dialogSavePdf(defaultName?: unknown): Promise<string | null> {
  const res = await hooks().showSaveDialog({
    title: "Save PDF",
    defaultPath: typeof defaultName === "string" ? defaultName : "book.pdf",
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (res.canceled || !res.filePath) return null;
  getSavePathsHooks()?.register(res.filePath);
  return res.filePath;
}

/** Open native single image file picker. Resolves null when cancelled. */
export async function dialogPickImageFile(): Promise<string | null> {
  const res = await hooks().showOpenDialog({
    title: "Insert image",
    properties: ["openFile"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "tiff"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  getPickedFilesHooks()?.register(res.filePaths);
  return res.filePaths[0]!;
}

/** Native open dialog for the publish artifact (PDF). Null when cancelled. */
export async function dialogPickPdfFile(): Promise<string | null> {
  const res = await hooks().showOpenDialog({
    title: "Choose the PDF to publish",
    properties: ["openFile"],
    filters: [{ name: "PDF", extensions: ["pdf"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return null;
  getPickedFilesHooks()?.register(res.filePaths);
  return res.filePaths[0]!;
}

/** Open native multi-select image file picker. Resolves [] when cancelled. */
export async function dialogPickImageFiles(): Promise<string[]> {
  const res = await hooks().showOpenDialog({
    title: "Add images",
    properties: ["openFile", "multiSelections"],
    filters: [{ name: "Images", extensions: ["jpg", "jpeg", "png", "gif", "webp", "svg", "avif", "tiff"] }],
  });
  if (res.canceled || res.filePaths.length === 0) return [];
  getPickedFilesHooks()?.register(res.filePaths);
  return res.filePaths;
}

/** Register the dialog:* IPC channels (SFE-P6b). */
export function registerDialogHandlers(secureHandle: SecureHandle): void {
  secureHandle("dialog:openDirectory", () => dialogOpenDirectory());
  secureHandle("dialog:savePdf", (_e, defaultName?: unknown) => dialogSavePdf(defaultName));
  secureHandle("dialog:pickImageFile", () => dialogPickImageFile());
  secureHandle("dialog:pickPdfFile", () => dialogPickPdfFile());
  secureHandle("dialog:pickImageFiles", () => dialogPickImageFiles());
}

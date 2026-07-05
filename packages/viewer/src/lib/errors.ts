/**
 * Shared, PWA-clean error helpers.
 *
 * Pure string operations — NO `node:*` imports (importing them as a value would
 * drag node code into the SPA and break the renderer/host split, §8 / ADR 0004).
 */

/**
 * Scrub Electron's IPC plumbing prefix off a host error message so the UI shows
 * the underlying cause, not the transport. Electron wraps `ipcMain.handle`
 * rejections as `Error invoking remote method '<ns:op>': <cause>` (sometimes with
 * a further `Error: ` prefix on the cause). This is the single source of truth
 * for that scrub, shared by `LeftPanel` and `ConflictChoicesDialog`.
 */
export function friendlyHostError(msg: string): string {
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

/**
 * Map a raw folder-open error message to plain-language guidance for the welcome
 * screen. Pure string classification — no host coupling.
 */
export function friendlyFolderError(msg: string): string {
  if (/manifest|print-md\.yaml|No such file/i.test(msg)) {
    return "This doesn't look like a print-md project — we couldn't find a manifest.yaml file. Make sure you're opening the right folder.";
  }
  if (/ENOENT|not found/i.test(msg)) {
    return "The folder couldn't be read. Check that it exists and you have permission to open it.";
  }
  if (/permission|EACCES/i.test(msg)) {
    return "Permission denied. Check that you have access to this folder.";
  }
  return "Something went wrong opening this folder. Try again, or choose a different folder.";
}

/**
 * Map a raw PDF-export error to plain-language guidance for a toast. Reads the
 * host error `code` when present and falls back to message pattern-matching.
 * Returns "" for a user-initiated cancel (EXPORT_CANCELED) so the caller can
 * suppress the toast entirely.
 */
export function friendlyPdfError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code === "EXPORT_CANCELED") {
    return "";
  }
  if (code === "BUILD_ERROR") {
    const firstLine = msg.split("\n")[0]?.trim() ?? msg;
    return `PDF generation failed: ${firstLine}. Open Help (?) for setup details.`;
  }
  if (code === "TOOL_MISSING") {
    const match = msg.match(/Required system tool not found: ([^\n]+)/);
    const tool = match?.[1]?.trim() ?? "a required tool";
    return `PDF export needs "${tool}" installed. Open Help (?) → System tools to see how to install it.`;
  }
  if (/chrome|chromium|browser/i.test(msg)) {
    return "PDF export needs a browser (Chrome or Edge) installed. Open Help (?) for setup details.";
  }
  if (/ENOENT|not found/i.test(msg)) {
    return "Could not find a required program. Open Help (?) → System tools to check what needs to be installed.";
  }
  if (/permission|EACCES/i.test(msg)) {
    return "Permission denied saving the PDF. Try saving to a different folder (like your Desktop).";
  }
  return "PDF export failed. Open Help (?) → System tools to check for issues.";
}

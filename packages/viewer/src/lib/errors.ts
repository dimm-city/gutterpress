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

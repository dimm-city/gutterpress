// ──────────────────────────────────────────────────────────────────────────
// app-log.ts — the app's own diagnostic log (main process only).
//
// Records two things an author can't otherwise see: RAW failures behind a
// friendly message (so an incident can be diagnosed after the fact instead of
// from "Update check failed" and a shrug — electron/updater.ts's check/
// download/install failures), and the app's own start/close, so the log
// exists on every run rather than only after something has gone wrong.
//
// It writes ONE `.log` file into userData/logs/, beside the per-project
// operation logs — which is the whole point: the start screen's Logs tab
// (electron/api/log.ts's logList/logRead IPC handlers + LogsPanel.svelte)
// already lists and reads every `.log` in that directory, so the app log
// appears there with no new IPC channel and no UI change. `recovery-paths.ts`'s
// appLogPath() names it.
//
// Deliberately NOT a logging framework: no levels, no transports, no config,
// no filtering. Two entry points sharing one writer, one file, one size cap.
// Nothing leaves the machine.
// ──────────────────────────────────────────────────────────────────────────

import { appendFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Restart the file rather than grow past this. A diagnostic file that fills a
 * disk is a worse bug than the one it documents; the newest faults are the
 * ones worth keeping, so the cap discards history rather than truncating the
 * entry being written.
 */
export const APP_LOG_MAX_BYTES = 256 * 1024;

/** Resolved per write so it can't capture a userData path before Electron has one. */
let resolveLogPath: (() => string) | null = null;

/**
 * Point the log at a real file. Until main.ts calls this — e.g. under
 * `bun test` — logging is console-only and touches no disk.
 */
export function initAppLog(resolve: () => string): void {
  resolveLogPath = resolve;
}

/**
 * Append one timestamped line to the app log, restarting the file at the
 * cap instead of growing without bound. Never rejects — a logging failure
 * must not break the operation that was already happening.
 */
async function writeLine(message: string): Promise<void> {
  const file = resolveLogPath?.();
  if (!file) return;
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    let size = 0;
    try {
      size = (await stat(file)).size;
    } catch {
      // No log yet — the first line on a fresh install.
    }
    // Bytes, not characters: an error string can carry multibyte characters
    // (electron-updater's own messages contain them), and stat().size — the
    // thing the cap is about — counts bytes.
    if (size + Buffer.byteLength(line) > APP_LOG_MAX_BYTES) await writeFile(file, line);
    else await appendFile(file, line);
  } catch {
    // Console already has it (both callers below log there first).
  }
}

/**
 * Record one app fault: always to the console (dev terminal), and to the log
 * file once initAppLog has run (packaged app).
 */
export async function logAppError(message: string): Promise<void> {
  console.error(message);
  await writeLine(message);
}

/**
 * Record one app lifecycle event (start, close): console.log, not
 * console.error — this is not a fault, and logAppError's console.error would
 * print a false error on every ordinary launch/quit.
 */
export async function logAppEvent(message: string): Promise<void> {
  console.log(message);
  await writeLine(message);
}

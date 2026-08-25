// ──────────────────────────────────────────────────────────────────────────
// app-log.ts — the app's own fault log (main process only).
//
// Records the RAW failure behind a friendly message, so an incident can be
// diagnosed after the fact instead of from "Update check failed" and a
// shrug. Today's only caller is electron/updater.ts (check/download/install
// failures).
//
// It writes ONE `.log` file into userData/logs/, beside the per-project
// operation logs — which is the whole point: the start screen's Logs tab
// (src/routes/api/log/{list,read} + LogsPanel.svelte) already lists and reads
// every `.log` in that directory, so the app log appears there with no new
// route and no UI change. `recovery-paths.ts`'s appLogPath() names it.
//
// Deliberately NOT a logging framework: no levels, no transports, no config,
// no filtering. One function, one file, one size cap. Nothing leaves the
// machine.
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
 * Record one app fault: always to the console (dev terminal), and to the log
 * file once initAppLog has run (packaged app). Never rejects — a logging
 * failure must not break the operation that was already failing.
 */
export async function logAppError(message: string): Promise<void> {
  console.error(message);
  const file = resolveLogPath?.();
  if (!file) return;
  const line = `${new Date().toISOString()} ${message}\n`;
  try {
    await mkdir(path.dirname(file), { recursive: true });
    let size = 0;
    try {
      size = (await stat(file)).size;
    } catch {
      // No log yet — the first fault on a fresh install.
    }
    // Bytes, not characters: an error string can carry multibyte characters
    // (electron-updater's own messages contain them), and stat().size — the
    // thing the cap is about — counts bytes.
    if (size + Buffer.byteLength(line) > APP_LOG_MAX_BYTES) await writeFile(file, line);
    else await appendFile(file, line);
  } catch {
    // Console already has it.
  }
}

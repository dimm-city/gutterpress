/**
 * operation-log.ts — structured file logger for git / sync / recovery / snapshot
 * operations.
 *
 * WHY this exists: when a sync or recovery operation fails, the user needs a
 * debuggable log file that records what was attempted, what steps ran, and
 * what went wrong — without having to reproduce the failure with verbose
 * console output enabled. The log is written incrementally (append mode) so
 * it survives even if the process crashes mid-operation.
 *
 * SECURITY INVARIANT: this logger NEVER writes secrets, tokens, credentials,
 * or full remote URLs with embedded auth. Callers must pass only sanitized
 * data (repo slug, branch name, short OIDs, error codes, outcome status).
 *
 * The logger is injectable: callers pass a `logFile` path and get a file
 * logger; omit it and a no-op logger is used (backward compatible — existing
 * callers that don't pass `logFile` see zero behavior change).
 *
 * LOG FORMAT (one line per entry, plain text for easy grep/tail):
 *   [ISO-timestamp] LEVEL  operation: step=<step> key=value ... | <message>
 *
 * Example:
 *   [2026-06-19T12:34:56.789Z] INFO  recovery: kind=unrelated_histories repo=my-book branch=main | starting recovery
 *   [2026-06-19T12:34:56.890Z] INFO  recovery: step=backup | backup created at /tmp/print-sync-recovery/my-book/...zip
 *   [2026-06-19T12:34:57.789Z] WARN  recovery: step=merge | merge conflicted files=manifest.yaml,notes.md
 *   [2026-06-19T12:34:57.890Z] INFO  recovery: result=needs_user | surfaced 2 conflicted files to user
 *
 * Cross-platform: uses `node:fs` appendFileSync + `node:path`. The caller
 * is responsible for providing a valid directory (the logger creates the
 * file but NOT the parent directory — that's the caller's job, e.g. the
 * desktop ensures `userData/logs/` exists before passing the path).
 *
 * Compatible with `bun build --compile`: no runtime package.json reads, no
 * computed-path dynamic imports, no native bindings — just `fs.appendFileSync`.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// ── Types ─────────────────────────────────────────────────────────────────────

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface OperationLogger {
  debug(step: string, message: string, data?: LogData): void;
  info(step: string, message: string, data?: LogData): void;
  warn(step: string, message: string, data?: LogData): void;
  error(step: string, message: string, data?: LogData): void;
}

/** Structured key-value fields appended after the step. No secrets. */
export type LogData = Record<string, string | number | boolean | string[] | undefined>;

// ── No-op logger (default when logFile is not configured) ────────────────────

const noop: OperationLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

// ── File logger ───────────────────────────────────────────────────────────────

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };

/**
 * Create a file-backed operation logger. Each call appends one line to
 * `logFile` (created if it doesn't exist; the parent directory is created
 * if missing). Writes are synchronous so the log survives a process crash
 * mid-operation.
 *
 * @param logFile  Absolute path to the log file.
 * @param minLevel Minimum level to write (default: "debug" — write everything).
 * @param operation  Operation name shown in each line (e.g. "sync", "recovery").
 */
export function createFileLogger(
  logFile: string,
  operation: string,
  minLevel: LogLevel = "debug",
): OperationLogger {
  // Ensure the parent directory exists so the first appendFileSync doesn't
  // throw ENOENT. The caller SHOULD have done this, but defense in depth.
  // Wrapped in try-catch: a logging failure must NEVER break the operation
  // it's logging (e.g. an unwritable path, a file-used-as-directory).
  try {
    mkdirSync(path.dirname(logFile), { recursive: true });
  } catch {
    // Can't create the directory — return a no-op logger so the caller
    // never sees an error from logging.
    return noop;
  }

  function write(level: LogLevel, step: string, message: string, data?: LogData): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) return;
    const ts = new Date().toISOString();
    const fields = formatData(data);
    const line = `[${ts}] ${level.toUpperCase().padEnd(5)} ${operation}: step=${step}${fields} | ${message}\n`;
    try {
      appendFileSync(logFile, line, "utf8");
    } catch {
      // A logging failure must NEVER break the operation it's logging.
      // Swallow the error silently — the operation is more important than
      // the log. (The caller can still check console.error for diagnostics.)
    }
  }

  return {
    debug: (step, message, data) => write("debug", step, message, data),
    info: (step, message, data) => write("info", step, message, data),
    warn: (step, message, data) => write("warn", step, message, data),
    error: (step, message, data) => write("error", step, message, data),
  };
}

/**
 * Resolve a logger from an optional `logFile` path. Returns a no-op logger
 * when `logFile` is undefined or empty (backward compatible — callers that
 * don't pass `logFile` see zero behavior change and zero file I/O).
 */
export function resolveLogger(
  logFile: string | undefined,
  operation: string,
): OperationLogger {
  if (!logFile) return noop;
  return createFileLogger(logFile, operation);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatData(data?: LogData): string {
  if (!data) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      parts.push(`${key}=${value.join(",")}`);
    } else {
      parts.push(`${key}=${String(value)}`);
    }
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

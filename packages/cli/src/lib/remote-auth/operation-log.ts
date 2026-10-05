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
 * or full remote URLs with embedded auth. All fields are sanitized at the
 * write boundary; callers must still avoid supplying arbitrary request data.
 *
 * The logger is injectable: callers pass a `logFile` path and get a file
 * logger; omit it and a no-op logger is used (backward compatible — existing
 * callers that don't pass `logFile` see zero behavior change).
 *
 * LOG FORMAT (one line per entry, plain text for easy grep/tail):
 *   [ISO-timestamp] LEVEL  operation: step=<step> key=value ... | <message>
 *
 * Example:
 *   [2026-06-19T12:34:56.789Z] INFO  sync: repo=my-book branch=main | starting sync
 *   [2026-06-19T12:34:56.890Z] INFO  sync: step=snapshot | committed 3 changed files
 *   [2026-06-19T12:34:57.789Z] WARN  sync: step=merge | combined files=manifest.yaml,notes.md
 *   [2026-06-19T12:34:57.890Z] INFO  sync: result=synced | pushed to the online copy
 *
 * Cross-platform: uses `node:fs` appendFileSync + `node:path`. The caller
 * is responsible for providing a valid directory (the logger creates the
 * file and its parent directory when needed).
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

interface LogOptions {
  context?: LogData;
  /** Mutable per-operation list; credentials may be resolved after logging starts. */
  secrets?: readonly string[];
}

/** One line, bounded, with credentials removed BEFORE truncation. */
export function sanitizeLogText(value: string, secrets: readonly string[] = []): string {
  let text = value;
  for (const secret of secrets) {
    if (!secret) continue;
    for (const form of [secret, encodeURIComponent(secret)]) {
      text = text.split(form).join("[redacted]");
    }
  }
  return text
    .replace(/\/\/[^/\s]*@/g, "//")
    .replace(/([?&](?:access_token|token|password|secret|key|code)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9+/_.=~-]+/gi, "$1 [redacted]")
    .replace(/\b(?:gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+)/g, "[redacted]")
    .replace(/[\s\x00-\x1f\x7f]+/g, " ")
    .trim()
    .slice(0, 6000);
}

/** Allowlist Git/OS diagnostic fields; never serialize request/config/credential objects. */
export function errorLogData(error: unknown): LogData {
  const out: LogData = { error: error == null ? String(error) : undefined };
  let current = error;
  const seen = new Set<unknown>();
  for (let depth = 0; depth < 3 && current != null && !seen.has(current); depth++) {
    seen.add(current);
    const prefix = depth === 0 ? "" : `cause${depth}_`;
    if (typeof current !== "object") {
      out[`${prefix}error`] = String(current);
      break;
    }
    const err = current as Record<string, unknown>;
    out[`${prefix}error`] = typeof err.message === "string" ? err.message : "Unknown error";
    for (const key of ["code", "name", "caller", "stack", "syscall", "path"]) {
      if (typeof err[key] === "string") out[`${prefix}${key}`] = err[key] as string;
    }
    const data = err.data as Record<string, unknown> | undefined;
    if (data && typeof data === "object") {
      for (const key of ["statusCode", "reason", "prettyDetails", "oid", "ref", "what", "filepath",
        "filepaths", "bothModified", "deleteByUs", "deleteByTheirs"]) {
        const value = data[key];
        if (typeof value === "string" || typeof value === "number") out[`${prefix}${key}`] = value;
        else if (Array.isArray(value)) {
          out[`${prefix}${key}`] = value.filter((v): v is string => typeof v === "string").slice(0, 50);
          if (value.length > 50) out[`${prefix}${key}Count`] = value.length;
        }
      }
    }
    current = err.cause;
  }
  return out;
}

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
  options: LogOptions = {},
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
    const clean = (value: string) => sanitizeLogText(value, options.secrets);
    const fields = formatData({ ...options.context, ...data }, clean);
    const line = `[${ts}] ${level.toUpperCase().padEnd(5)} ${clean(operation)}: step=${clean(step)}${fields} | ${clean(message)}\n`;
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
  options: LogOptions = {},
): OperationLogger {
  if (!logFile) return noop;
  return createFileLogger(logFile, operation, "debug", options);
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatData(data: LogData | undefined, clean: (value: string) => string): string {
  if (!data) return "";
  const parts: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) {
      parts.push(`${clean(key)}=${clean(value.join(","))}`);
    } else {
      parts.push(`${clean(key)}=${clean(String(value))}`);
    }
  }
  return parts.length > 0 ? " " + parts.join(" ") : "";
}

/**
 * Leveled logging utility for print-md.
 *
 * ONE logger for the whole CLI/lib. Two surfaces share a single level state:
 *
 *   - Leveled free functions (`debug`/`info`/`warn`/`error`/`success`) —
 *     timestamped, gated by the current level. Used by the preview server
 *     internals. `--verbose`/`--debug` calls `setLogLevel('DEBUG')` so
 *     `debug()` lines become visible; by default (INFO) they are suppressed.
 *   - The `log` facade object (`log.info`/`log.warn`/`log.error`/`log.success`)
 *     — clean, prefix-styled command output used by the CLI commands and
 *     re-exported from `index.ts` for the viewer. Always emitted (it carries
 *     user-facing command results, not diagnostic chatter), preserving the
 *     historical `lib/logger` behavior verbatim.
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

let currentLevel: LogLevel = 'INFO';

const LEVELS: Record<LogLevel, number> = {
  DEBUG: 0,
  INFO: 1,
  WARN: 2,
  ERROR: 3,
};

/**
 * Set the current log level. Messages below this level will be suppressed.
 */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

/**
 * Get the current log level.
 */
export function getLogLevel(): LogLevel {
  return currentLevel;
}

// ── Leveled free functions ───────────────────────────────────────────────────

/**
 * Emit a timestamped message at a specific level (gated by the current level).
 */
function emit(level: LogLevel, message: string, ...args: unknown[]): void {
  // Skip if below current level
  if (LEVELS[level] < LEVELS[currentLevel]) return;

  const colors: Record<LogLevel, string> = {
    DEBUG: '\x1b[36m', // Cyan
    INFO: '\x1b[32m', // Green
    WARN: '\x1b[33m', // Yellow
    ERROR: '\x1b[31m', // Red
  };
  const reset = '\x1b[0m';

  const timestamp = new Date().toISOString().slice(11, 19);
  const prefix = `${colors[level]}[${timestamp}] ${level}${reset}:`;

  if (level === 'ERROR') {
    console.error(prefix, message, ...args);
  } else {
    console.log(prefix, message, ...args);
  }
}

/**
 * Log a debug message (only shown when log level is DEBUG).
 */
export function debug(message: string, ...args: unknown[]): void {
  emit('DEBUG', message, ...args);
}

/**
 * Log an info message (shown at INFO level and above).
 */
export function info(message: string, ...args: unknown[]): void {
  emit('INFO', message, ...args);
}

/**
 * Log a warning message (shown at WARN level and above).
 */
export function warn(message: string, ...args: unknown[]): void {
  emit('WARN', message, ...args);
}

/**
 * Log an error message (always shown).
 */
export function error(message: string, ...args: unknown[]): void {
  emit('ERROR', message, ...args);
}

/**
 * Log a success message (shown at INFO level and above).
 */
export function success(message: string, ...args: unknown[]): void {
  emit('INFO', message, ...args);
}

/**
 * Silence all logs (useful for testing).
 * Sets to a level higher than WARN so only ERROR still shows.
 */
export function silence(): void {
  currentLevel = 'ERROR';
}

/**
 * Reset to default log level (INFO).
 */
export function reset(): void {
  currentLevel = 'INFO';
}

// ── Command-facing `log` facade ──────────────────────────────────────────────
// Clean prefix-styled output for CLI command results (and the viewer, via the
// `index.ts` re-export). Kept byte-for-byte compatible with the former
// `lib/logger` object so command output stays visually identical. Deliberately
// NOT level-gated: these are user-facing results, not diagnostics.

const RESET = '\x1b[0m';
const BOLD = '\x1b[1m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const GREEN = '\x1b[32m';
const CYAN = '\x1b[36m';

export const log = {
  info(msg: string, ...args: unknown[]) {
    console.log(`${CYAN}info${RESET}  ${msg}`, ...args);
  },
  warn(msg: string, ...args: unknown[]) {
    console.warn(`${YELLOW}warn${RESET}  ${msg}`, ...args);
  },
  error(msg: string, ...args: unknown[]) {
    console.error(`${RED}${BOLD}error${RESET} ${msg}`, ...args);
  },
  success(msg: string, ...args: unknown[]) {
    console.log(`${GREEN}ok${RESET}    ${msg}`, ...args);
  },
};

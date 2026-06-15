/**
 * Simple logging utility for dc-book-cli
 * Uses functions instead of classes to keep it simple
 */

export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

let currentLevel: LogLevel = 'INFO';

/**
 * Set the current log level
 * Messages below this level will be suppressed
 */
export function setLogLevel(level: LogLevel): void {
    currentLevel = level;
}

/**
 * Get the current log level
 */
export function getLogLevel(): LogLevel {
    return currentLevel;
}

/**
 * Log a message at a specific level
 * @param level Log level
 * @param message Message to log
 * @param args Additional arguments to log
 */
export function log(level: LogLevel, message: string, ...args: unknown[]): void {
    const levels: Record<LogLevel, number> = {
        DEBUG: 0,
        INFO: 1,
        WARN: 2,
        ERROR: 3
    };

    // Skip if below current level
    if (levels[level] < levels[currentLevel]) return;

    const colors: Record<LogLevel, string> = {
        DEBUG: '\x1b[36m', // Cyan
        INFO: '\x1b[32m',  // Green
        WARN: '\x1b[33m',  // Yellow
        ERROR: '\x1b[31m'  // Red
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
 * Log a debug message (only shown when log level is DEBUG)
 */
export function debug(message: string, ...args: unknown[]): void {
    log('DEBUG', message, ...args);
}

/**
 * Log an info message (shown at INFO level and above)
 */
export function info(message: string, ...args: unknown[]): void {
    log('INFO', message, ...args);
}

/**
 * Log a warning message (shown at WARN level and above)
 */
export function warn(message: string, ...args: unknown[]): void {
    log('WARN', message, ...args);
}

/**
 * Log an error message (always shown)
 */
export function error(message: string, ...args: unknown[]): void {
    log('ERROR', message, ...args);
}

/**
 * Silence all logs (useful for testing)
 */
export function silence(): void {
    // Set to a level higher than ERROR to suppress all output
    currentLevel = 'ERROR';
}

/**
 * Reset to default log level (INFO)
 */
export function reset(): void {
    currentLevel = 'INFO';
}

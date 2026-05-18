/**
 * Simple logging utility for dc-book-cli
 * Uses functions instead of classes to keep it simple
 */
export type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';
/**
 * Set the current log level
 * Messages below this level will be suppressed
 */
export declare function setLogLevel(level: LogLevel): void;
/**
 * Get the current log level
 */
export declare function getLogLevel(): LogLevel;
/**
 * Log a message at a specific level
 * @param level Log level
 * @param message Message to log
 * @param args Additional arguments to log
 */
export declare function log(level: LogLevel, message: string, ...args: unknown[]): void;
/**
 * Log a debug message (only shown when log level is DEBUG)
 */
export declare function debug(message: string, ...args: unknown[]): void;
/**
 * Log an info message (shown at INFO level and above)
 */
export declare function info(message: string, ...args: unknown[]): void;
/**
 * Log a warning message (shown at WARN level and above)
 */
export declare function warn(message: string, ...args: unknown[]): void;
/**
 * Log an error message (always shown)
 */
export declare function error(message: string, ...args: unknown[]): void;
/**
 * Silence all logs (useful for testing)
 */
export declare function silence(): void;
/**
 * Reset to default log level (INFO)
 */
export declare function reset(): void;

/**
 * Simplified error classes for print-md
 *
 * Just the basics - this is a personal tool, not enterprise software.
 * Use standard Error class for most cases.
 */

/**
 * Error thrown when a build operation fails
 */
export class BuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BuildError';
  }
}

/**
 * Error thrown when configuration is invalid
 */
export class ConfigError extends Error {
  suggestion?: string;

  constructor(message: string, suggestion?: string) {
    super(suggestion ? `${message}\nSuggestion: ${suggestion}` : message);
    this.name = 'ConfigError';
    this.suggestion = suggestion;
  }
}

/**
 * Type guard to check if an error has a code property (NodeJS.ErrnoException)
 * @param error Unknown error object
 * @returns True if error has a code property
 */
export function isErrorWithCode(error: unknown): error is Error & { code: string } {
  return (
    error instanceof Error &&
    typeof (error as Error & { code?: unknown }).code === 'string'
  );
}

/**
 * Type guard to check if an error has specific properties
 * @param error Unknown error object
 * @param properties Property names to check for
 * @returns True if error has all specified properties
 */
export function hasErrorProperties<T extends string>(
  error: unknown,
  ...properties: T[]
): error is Error & Record<T, unknown> {
  if (!(error instanceof Error)) {
    return false;
  }

  return properties.every(prop => prop in error);
}

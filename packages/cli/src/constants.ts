/**
 * Application-wide constants
 */

/**
 * Network-related constants
 */
export const NETWORK = {
  /** Default port for preview server */
  DEFAULT_PORT: 3579,
} as const;

/**
 * Debounce delays in milliseconds
 */
export const DEBOUNCE = {
  /** Debounce delay for file watch events */
  FILE_WATCH: 100,
} as const;

/**
 * File names
 */
export const FILENAMES = {
  /** Manifest configuration file */
  MANIFEST: 'manifest.yaml',
} as const;

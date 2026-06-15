/**
 * Preview server context and state management
 */

import type { FSWatcher } from 'chokidar';
import type { PreviewServerOptions } from '../types';
import type { ResolvedConfig } from '../schema/manifest.types';
import type { PreviewServer } from './http-server';

/**
 * Server lifecycle state
 */
export interface ServerState {
  /** Current input directory being previewed */
  currentInputPath: string;
  /** File watcher instance */
  currentWatcher: FSWatcher | null;
  /** Pending debounced rebuild timer scheduled by the file watcher */
  rebuildTimer: NodeJS.Timeout | null;
  /** Is currently rebuilding? (prevents overlapping builds) */
  isRebuilding: boolean;
  /** Bun-native preview HTTP/WebSocket server instance */
  previewServer: PreviewServer | null;
  /** Is server shutting down? (prevents multiple shutdown calls) */
  isShuttingDown: boolean;
  /** Temporary directory for preview files */
  tempDir: string;
  /** Resolved configuration */
  config: ResolvedConfig;
  /** Server options */
  options: PreviewServerOptions;
}

/**
 * Create initial server state
 */
export function createServerState(
  inputPath: string,
  tempDir: string,
  config: ResolvedConfig,
  options: PreviewServerOptions
): ServerState {
  return {
    currentInputPath: inputPath,
    currentWatcher: null,
    rebuildTimer: null,
    isRebuilding: false,
    previewServer: null,
    isShuttingDown: false,
    tempDir,
    config,
    options,
  };
}

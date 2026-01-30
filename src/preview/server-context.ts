/**
 * Preview server context and state management
 */

import type { FSWatcher } from 'chokidar';
import type { ViteDevServer } from 'vite';
import type { PreviewServerOptions } from '../types';
import type { ResolvedConfig } from '../schema/manifest.types';

/**
 * Server lifecycle state
 */
export interface ServerState {
  /** Current input directory being previewed */
  currentInputPath: string;
  /** File watcher instance */
  currentWatcher: FSWatcher | null;
  /** Is currently rebuilding? (prevents overlapping builds) */
  isRebuilding: boolean;
  /** Vite dev server instance */
  viteServer: ViteDevServer | null;
  /** Is server shutting down? (prevents multiple shutdown calls) */
  isShuttingDown: boolean;
  /** Temporary directory for preview files */
  tempDir: string;
  /** Assets source directory */
  assetsSourceDir: string;
  /** Resolved configuration */
  config: ResolvedConfig;
  /** Server options */
  options: PreviewServerOptions;
}

/**
 * Client connection tracking
 */
export interface ClientTracker {
  /** Set of connected client IDs */
  connectedClients: Set<string>;
  /** Auto-shutdown timer */
  autoShutdownTimer: NodeJS.Timeout | null;
  /** Delay before auto-shutdown (ms) */
  AUTO_SHUTDOWN_DELAY: number;
}

/**
 * Create initial server state
 */
export function createServerState(
  inputPath: string,
  tempDir: string,
  assetsSourceDir: string,
  config: ResolvedConfig,
  options: PreviewServerOptions
): ServerState {
  return {
    currentInputPath: inputPath,
    currentWatcher: null,
    isRebuilding: false,
    viteServer: null,
    isShuttingDown: false,
    tempDir,
    assetsSourceDir,
    config,
    options,
  };
}

/**
 * Create client tracker
 */
export function createClientTracker(): ClientTracker {
  return {
    connectedClients: new Set<string>(),
    autoShutdownTimer: null,
    AUTO_SHUTDOWN_DELAY: 5000, // 5 seconds
  };
}

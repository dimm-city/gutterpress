/**
 * Server lifecycle management
 *
 * Handles startup, restart, shutdown, and client connection tracking.
 * Uses the simplified manifest + config pipeline from lib/manifest.
 */
import type { PreviewServerOptions } from '../types';
import type { ResolvedConfig } from '../schema/manifest.types';
import type { ServerState } from './server-context';
/**
 * Initialize preview directories and copy source files.
 *
 * When `inputPath` is empty (no-input mode), the temp dir is still created
 * with the preview viewer assets so the browser has something to load; the
 * source-content copy and manifest-asset copy are skipped.
 */
export declare function initializePreviewDirectories(inputPath: string, assetsSourceDir: string, config?: ResolvedConfig): Promise<string>;
/**
 * Resolve the preview assets directory path. In dev this is `src/assets`;
 * in the standalone binary the assets are extracted to a temp dir so they
 * can be served from a real filesystem path.
 */
export declare function resolveAssetsDir(): Promise<string>;
/**
 * Validate that the input path exists on the filesystem.
 * No-op for empty input (no-input mode — the viewer desktop app
 * supplies the path via its own folder picker).
 */
export declare function validateInputPath(inputPath: string): Promise<void>;
/**
 * Initialize configuration by loading manifest and resolving config.
 * For empty input (no-input mode), skip manifest loading entirely and
 * return a default resolved config.
 */
export declare function initializeConfiguration(inputPath: string, _options: PreviewServerOptions): Promise<ResolvedConfig>;
/**
 * Restart the preview server with a new input directory
 */
export declare function restartPreview(newInputPath: string, state: ServerState): Promise<void>;
/**
 * Perform graceful server shutdown and cleanup.
 *
 * Each step runs independently so that a hang or throw in one (e.g.
 * `previewServer.close()` blocking on a stuck WebSocket client) cannot
 * prevent the temp-dir from being removed. Without this discipline,
 * SIGTERM during a wedged close leaks ~1GB of `/tmp` per session.
 */
export declare function shutdownServer(state: ServerState): Promise<void>;

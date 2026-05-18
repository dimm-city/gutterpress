/**
 * Bun-native preview HTTP server with WebSocket-based live reload.
 *
 * Replaces the previous Vite-based dev server. Provides:
 *   - Static file serving from `state.tempDir`
 *   - JSON API routes (delegated to `routes.ts` via `api-middleware.ts`)
 *   - A `/__print-md-hmr` WebSocket endpoint that broadcasts a
 *     `{ type: "full-reload" }` message to all subscribers when the file
 *     watcher fires
 *   - A tiny inline HMR client snippet injected into served HTML files
 *
 * This module deliberately avoids any bundler runtime (vite/rollup/esbuild)
 * — see ADR `docs/adr/0001-no-bundlers-at-runtime.md`.
 */
import type { ServerState } from './server-context.ts';
/**
 * Public handle for the running preview server. Owns the underlying
 * `Bun.Server` and exposes a small lifecycle surface.
 */
export interface PreviewServer {
    /** Port the server is listening on. */
    port: number;
    /** Stop the server (force-close active connections and websockets). */
    close(): Promise<void>;
    /**
     * Broadcast a `{ type: "full-reload" }` message to every connected HMR
     * client. Safe to call after `close()` (no-op).
     */
    broadcastReload(): void;
}
/**
 * Check if a TCP port is available for binding.
 *
 * Attempts to bind a temporary `Bun.serve` listener on the requested port.
 * The temporary server is forcibly stopped on success.
 */
export declare function isPortAvailable(port: number): Promise<boolean>;
/**
 * Find the next available port starting from `startPort`.
 *
 * Tries up to 10 consecutive ports before giving up. Useful when a preferred
 * port is in use and any nearby alternative is acceptable.
 *
 * @throws {Error} If no available port found after 10 attempts.
 */
export declare function findAvailablePort(startPort: number): Promise<number>;
/**
 * Create and start a preview HTTP+WebSocket server bound to `state.tempDir`.
 *
 * Behavior:
 *   - `GET ${HMR_PATH}` upgrades to a WebSocket subscribed to `HMR_TOPIC`.
 *   - `/api/*` requests dispatch to `handleApiRequest`.
 *   - Anything else serves a static file from `state.tempDir`. HTML files
 *     have the HMR client snippet injected.
 *   - Requests that escape `tempDir` (via `..`) get 404.
 *   - If `state.options.openBrowser` is true, `xdg-open`/`open` is invoked
 *     once the server is listening.
 *
 * @param state             Preview server state (temp dir, options, config).
 * @param port              TCP port to bind.
 * @param restartPreviewFn  Callback to switch the preview to a new directory.
 * @returns A handle exposing `close()` and `broadcastReload()`.
 */
export declare function createPreviewServer(state: ServerState, port: number, restartPreviewFn: (newPath: string) => Promise<void>): Promise<PreviewServer>;

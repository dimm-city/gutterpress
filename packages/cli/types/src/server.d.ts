/**
 * Preview server entry point.
 *
 * Loads config via lib/manifest, generates HTML via lib/markdown, and serves
 * the preview through a Bun-native HTTP+WebSocket server (see
 * `src/preview/http-server.ts`). Live reload is handled by broadcasting
 * `full-reload` over the HMR WebSocket whenever the file watcher fires.
 */
import type { PreviewServerOptions } from './types';
export interface PreviewServerHandle {
    url: string;
    port: number;
    host: string;
    inputPath: string;
    /** Stop the server, file watcher, and any signal handlers. */
    stop: () => Promise<void>;
    /** Switch the watched directory and regenerate HTML. */
    restart: (newInputPath: string) => Promise<void>;
}
export interface StartPreviewServerOptions extends PreviewServerOptions {
    /**
     * Install SIGINT/SIGTERM handlers that shut down the server on Ctrl+C.
     * Defaults to true (CLI usage). Library/embedded callers (Electron+SvelteKit)
     * should pass false and call handle.stop() themselves.
     */
    installSignalHandlers?: boolean;
}
/**
 * Start the preview server backed by a Bun-native HTTP/WebSocket server.
 *
 * Returns a handle the caller can use to introspect the URL or stop the server.
 * CLI callers can simply ignore the handle and rely on SIGINT/SIGTERM.
 */
export declare function startPreviewServer(options: StartPreviewServerOptions): Promise<PreviewServerHandle>;

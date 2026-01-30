/**
 * Vite server setup and configuration
 *
 * Creates and configures Vite dev server with custom middleware
 */

import { createServer as createViteServer, type ViteDevServer } from 'vite';
import { join } from 'path';
import { info } from '../utils/logger.ts';
import type { ServerState, ClientTracker } from './server-context.ts';
import { createApiMiddleware } from './api-middleware.ts';

/**
 * Check if a TCP port is available for binding
 *
 * Attempts to create a temporary server on the specified port. If successful,
 * the port is available. The temporary server is immediately stopped.
 *
 * @param port - Port number to check (1-65535)
 * @returns Promise resolving to true if port is available, false if in use
 *
 * @example
 * ```typescript
 * const available = await isPortAvailable(3000);
 * if (available) {
 *   console.log('Port 3000 is free');
 * } else {
 *   console.log('Port 3000 is in use');
 * }
 * ```
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      fetch() {
        return new Response();
      },
    });
    // Use stop(true) to forcefully close and clean up resources
    server.stop(true);
    // Give server time to fully release the port
    await new Promise((resolve) => setTimeout(resolve, 10));
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the next available port starting from a given port number
 *
 * Sequentially checks ports starting from `startPort` until an available
 * port is found. Attempts up to 10 consecutive ports before giving up.
 *
 * This is useful when the preferred port is in use and you need an
 * alternative (common in development environments with multiple servers).
 *
 * @param startPort - Port number to start searching from
 * @returns Promise resolving to the first available port number
 * @throws {Error} If no available port found after 10 attempts
 *
 * @example
 * ```typescript
 * const port = await findAvailablePort(3000);
 * // If 3000 is in use, tries 3001, 3002, etc.
 * // Returns first available: 3002
 * ```
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }

  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

/**
 * Create and configure a Vite development server with custom API middleware
 *
 * Sets up a Vite dev server that:
 * - Serves files from the temporary directory
 * - Provides Hot Module Replacement (HMR) for instant updates
 * - Injects custom API middleware for preview operations
 * - Opens browser automatically (if enabled in options)
 * - Handles proper caching for development
 *
 * The server binds to 0.0.0.0 to allow access from network (useful for
 * testing on mobile devices), but security is maintained through home
 * directory boundary enforcement in the API middleware.
 *
 * @param state - Server state containing temp directory and options
 * @param clientTracker - Client connection tracker for heartbeat/disconnect
 * @param port - Port number to bind the server to
 * @param restartPreviewFn - Callback function to restart preview with new directory
 * @param shutdownFn - Callback function to gracefully shutdown the server
 * @returns Promise resolving to a configured and listening ViteDevServer instance
 * @throws {Error} If server fails to start or port is already in use (strictPort: true)
 *
 * @example
 * ```typescript
 * const viteServer = await createConfiguredViteServer(
 *   serverState,
 *   clientTracker,
 *   3000,
 *   async (newPath) => await restartPreview(newPath, serverState),
 *   async () => await shutdownServer(serverState, clientTracker)
 * );
 * // Logs: "Preview server running at http://localhost:3000"
 * // Server is ready to handle requests
 * ```
 */
export async function createConfiguredViteServer(
  state: ServerState,
  clientTracker: ClientTracker,
  port: number,
  restartPreviewFn: (newPath: string) => Promise<void>,
  shutdownFn: () => Promise<void>
): Promise<ViteDevServer> {
  const middleware = createApiMiddleware(state, clientTracker, restartPreviewFn, shutdownFn);

  const viteServer = await createViteServer({
    configFile: false,
    root: state.tempDir,
    server: {
      port,
      strictPort: true,
      host: '0.0.0.0',
      open: state.options.openBrowser,
    },
    clearScreen: false,
    plugins: [
      {
        name: 'api-middleware',
        configureServer(server) {
          server.middlewares.use(middleware);
        },
      },
      {
        // Serve CSS as raw static files so Paged.js can parse them.
        // Without this, Vite transforms CSS into JS modules for HMR.
        name: 'raw-css',
        configureServer(server) {
          server.middlewares.use((req, res, next) => {
            if (req.url && req.url.endsWith('.css') && !req.url.includes('/preview/')) {
              // Serve the CSS file directly from the temp dir
              const filePath = join(state.tempDir, req.url);
              const file = Bun.file(filePath);
              file.exists().then(exists => {
                if (exists) {
                  file.text().then(text => {
                    res.setHeader('Content-Type', 'text/css');
                    res.end(text);
                  });
                } else {
                  next();
                }
              });
              return;
            }
            next();
          });
        },
      },
    ],
  });

  await viteServer.listen();

  const serverUrl = `http://localhost:${port}`;
  info(`Preview server running at ${serverUrl}`);
  info('Press Ctrl+C to stop');

  return viteServer;
}

/**
 * API middleware for preview server
 *
 * Handles all /api/* endpoints including directory navigation,
 * folder switching, client tracking, and GitHub integration
 */

import type { IncomingMessage, ServerResponse } from 'http';
import type { HeadersInit } from 'bun';
import { debug } from '../utils/logger.ts';
import {
  handleListDirectories,
  handleChangeFolder,
  handleGitHubStatus,
  handleGitHubLogin,
  handleGitHubClone,
  handleGitHubUser,
} from './routes.ts';
import type { ServerState } from './server-context.ts';

/**
 * Max request body size (1MB)
 */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * Read request body with size limit
 */
async function readRequestBody(req: IncomingMessage, maxSize = MAX_BODY_SIZE): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = '';
    let totalSize = 0;

    req.on('data', (chunk) => {
      totalSize += chunk.length;
      if (totalSize > maxSize) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      body += chunk;
    });

    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

/**
 * Send Response to client
 */
async function sendResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(await response.text());
}

/**
 * Create API middleware handler
 *
 * Routes /api/* requests to appropriate handlers
 *
 * @param state Server state
 * @param restartPreviewFn Function to restart preview
 * @returns Middleware function
 */
export function createApiMiddleware(
  state: ServerState,
  restartPreviewFn: (newPath: string) => Promise<void>
) {
  return async (
    req: IncomingMessage,
    res: ServerResponse,
    next: () => void
  ): Promise<void> => {
    const url = new URL(req.url!, `http://${req.headers.host}`);

    // Handle /api/directories
    if (url.pathname === '/api/directories') {
      const response = await handleListDirectories(
        new Request(url.toString(), {
          method: req.method,
          headers: req.headers as HeadersInit,
        })
      );
      await sendResponse(res, response);
      return;
    }

    // Handle /api/change-folder
    if (url.pathname === '/api/change-folder' && req.method === 'POST') {
      try {
        const body = await readRequestBody(req);
        const response = await handleChangeFolder(
          new Request(url.toString(), {
            method: 'POST',
            headers: req.headers as HeadersInit,
            body,
          }),
          restartPreviewFn
        );
        await sendResponse(res, response);
      } catch (error) {
        res.statusCode = 413;
        res.end(JSON.stringify({ error: 'Request body too large' }));
      }
      return;
    }

// Handle /api/gh/status
    if (url.pathname === '/api/gh/status' && req.method === 'GET') {
      const response = await handleGitHubStatus(
        new Request(url.toString(), {
          method: req.method,
          headers: req.headers as HeadersInit,
        })
      );
      await sendResponse(res, response);
      return;
    }

    // Handle /api/gh/login
    if (url.pathname === '/api/gh/login' && req.method === 'POST') {
      const response = await handleGitHubLogin(
        new Request(url.toString(), {
          method: req.method,
          headers: req.headers as HeadersInit,
        })
      );
      await sendResponse(res, response);
      return;
    }

    // Handle /api/gh/clone
    if (url.pathname === '/api/gh/clone' && req.method === 'POST') {
      const body = await readRequestBody(req);
      const response = await handleGitHubClone(
        new Request(url.toString(), {
          method: 'POST',
          headers: req.headers as HeadersInit,
          body,
        }),
        restartPreviewFn
      );
      await sendResponse(res, response);
      return;
    }

    // Handle /api/gh/user
    if (url.pathname === '/api/gh/user' && req.method === 'GET') {
      const response = await handleGitHubUser(
        new Request(url.toString(), {
          method: req.method,
          headers: req.headers as HeadersInit,
        })
      );
      await sendResponse(res, response);
      return;
    }

    // Let Vite handle everything else
    next();
  };
}

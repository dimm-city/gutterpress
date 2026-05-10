/**
 * API request dispatcher for the preview server.
 *
 * Bun-native: takes a `Request`, returns either a `Response` (matched a known
 * /api/* route) or `null` (let the static handler take it). The Vite/connect
 * `(req, res, next)` shape is gone — `Request` already exposes async body
 * helpers (`text()` / `json()`), so the middleware glue shrinks significantly.
 */

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
 * Max request body size (1MB).
 */
const MAX_BODY_SIZE = 1024 * 1024;

/**
 * Build a JSON error Response.
 */
function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Reject early when an inbound request advertises a body larger than our
 * cap. We can't always trust `Content-Length`, but it's a fast first check
 * that avoids buffering huge payloads only to reject them later.
 */
function exceedsBodyLimit(request: Request): boolean {
  const lenHeader = request.headers.get('content-length');
  if (!lenHeader) return false;
  const len = Number.parseInt(lenHeader, 10);
  if (!Number.isFinite(len)) return false;
  return len > MAX_BODY_SIZE;
}

/**
 * Dispatch a single inbound request.
 *
 * @returns The Response to send, or `null` if no /api/* route matched and
 *          the caller should fall through to the static handler.
 */
export async function handleApiRequest(
  request: Request,
  _state: ServerState,
  restartPreviewFn: (newPath: string) => Promise<void>
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (!pathname.startsWith('/api/')) {
    return null;
  }

  // GET /api/directories
  if (pathname === '/api/directories' && method === 'GET') {
    return handleListDirectories(request);
  }

  // POST /api/change-folder
  if (pathname === '/api/change-folder' && method === 'POST') {
    if (exceedsBodyLimit(request)) {
      return jsonError('Request body too large', 413);
    }
    // Body-size check is the precheck above; let any other thrown error
    // propagate to Bun.serve's `error()` handler (returns 500) rather than
    // misclassifying every failure as 413.
    return handleChangeFolder(request, restartPreviewFn);
  }

  // GET /api/gh/status
  if (pathname === '/api/gh/status' && method === 'GET') {
    return handleGitHubStatus(request);
  }

  // POST /api/gh/login
  if (pathname === '/api/gh/login' && method === 'POST') {
    return handleGitHubLogin(request);
  }

  // POST /api/gh/clone
  if (pathname === '/api/gh/clone' && method === 'POST') {
    if (exceedsBodyLimit(request)) {
      return jsonError('Request body too large', 413);
    }
    return handleGitHubClone(request, restartPreviewFn);
  }

  // GET /api/gh/user
  if (pathname === '/api/gh/user' && method === 'GET') {
    return handleGitHubUser(request);
  }

  return null;
}

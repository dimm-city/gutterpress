/**
 * API request dispatcher for the preview server.
 *
 * The preview server is now headless — viewer chrome (folder picker, GitHub
 * clone) lives in the desktop app (packages/viewer). The only remaining
 * endpoint is GET /api/status, kept for backwards compatibility with any
 * external tooling that checks server liveness.
 */

import { handleStatus } from './routes.ts';
import type { ServerState } from './server-context.ts';

/**
 * Dispatch a single inbound request.
 *
 * @returns The Response to send, or `null` if no /api/* route matched and
 *          the caller should fall through to the static handler.
 */
export async function handleApiRequest(
  request: Request,
  state: ServerState,
  _restartPreviewFn: (newPath: string) => Promise<void>
): Promise<Response | null> {
  const url = new URL(request.url);
  const { pathname } = url;
  const { method } = request;

  if (!pathname.startsWith('/api/')) {
    return null;
  }

  if (pathname === '/api/status' && method === 'GET') {
    return handleStatus(state.currentInputPath);
  }

  return null;
}

/**
 * Typed fetch client for SvelteKit +server.ts API routes.
 *
 * Each method corresponds to a route under src/routes/api/. Methods are added
 * here in each phase as IPC handlers are migrated to server routes. The
 * platform adapter (getPlatform()) remains in use for all handlers not yet
 * migrated.
 *
 * All methods throw on non-OK responses (with the response body as the message).
 */

async function post<T>(url: string, body?: unknown): Promise<T> {
  const r = await fetch(url, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || r.statusText);
  }
  return r.json() as Promise<T>;
}

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) {
    const msg = await r.text().catch(() => r.statusText);
    throw new Error(msg || r.statusText);
  }
  return r.json() as Promise<T>;
}

/**
 * Typed API client. Methods will be added here as IPC handlers are migrated
 * to +server.ts routes in Phase 2 and beyond.
 */
export const api = {
  /** Low-level helpers exposed for direct use when needed. */
  _post: post,
  _get: get,
};

import { json, error, isHttpError, isRedirect } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';

// Shared plumbing for the desktop's host API routes (packages/desktop/src/routes/api/**).
// These run in the SvelteKit host (Node), not the PWA-clean renderer, so node imports
// are allowed here (see CLAUDE.md §8).

/**
 * Handler passed to {@link jsonRoute}. Receives the safely-parsed JSON body and the
 * raw SvelteKit event, and returns the value to serialize with `json()`. Throw an
 * `error(status, msg)` (SvelteKit `HttpError`) for a specific status; any other thrown
 * value is mapped to a 500 with the same message-extraction rule every route used.
 */
export type JsonRouteFn<B = unknown> = (
  body: B,
  event: RequestEvent,
) => unknown | Promise<unknown>;

/**
 * Reclassify a caught (non-`HttpError`) exception into a specific `{ status, message }`
 * pair — e.g. an author-friendly lib message becoming a 422 passthrough instead of a
 * generic 500. Return `null` to fall through to the default 500 mapping (#38).
 */
export type ErrorClassifier = (e: unknown) => { status: number; message: string } | null;

export interface JsonRouteOptions {
  /** See {@link ErrorClassifier}. Only consulted for non-`HttpError`/redirect throws. */
  onError?: ErrorClassifier;
}

/**
 * Wrap a route handler so it: parses the JSON body safely (missing/invalid body -> `{}`;
 * a bodyless GET request parses the same way), runs `fn`, returns `json(result)`, and maps
 * a thrown non-`HttpError` to `error(500, msg)` with
 * `msg = e instanceof Error ? e.message : String(e)` — unless `options.onError` reclassifies
 * it first. A thrown `HttpError`/redirect (e.g. from `error(400, ...)` or
 * {@link requireAbsolute}) always propagates unchanged with its own status, bypassing
 * `onError` (#38).
 */
export function jsonRoute<B = unknown>(fn: JsonRouteFn<B>, options: JsonRouteOptions = {}) {
  return async (event: RequestEvent): Promise<Response> => {
    try {
      const body = ((await event.request.json().catch(() => ({}))) ?? {}) as B;
      const result = await fn(body, event);
      return json(result ?? null);
    } catch (e) {
      if (isHttpError(e) || isRedirect(e)) throw e;
      if (options.onError) {
        const classified = options.onError(e);
        if (classified) throw error(classified.status, classified.message);
      }
      const msg = e instanceof Error ? e.message : String(e);
      throw error(500, msg);
    }
  };
}

/**
 * Assert that `value` is an absolute filesystem path, throwing the standard 400 otherwise:
 * `${label} requires an absolute path, got: ${value}`. Returns the validated string so it
 * can be used inline. Callers that need a distinct "field is required" message should guard
 * for that first; this helper only owns the absolute-path check.
 */
export function requireAbsolute(value: unknown, label: string): string {
  if (typeof value !== 'string' || !isAbsolute(value)) {
    error(400, `${label} requires an absolute path, got: ${value ?? ''}`);
  }
  return value;
}

/**
 * Shared harness for exercising `defineRoute` handlers directly (review
 * finding: the `request()`/`caught()` pair was hand-copied into 13 route
 * suites; new suites should import from here instead of pasting a 14th copy —
 * the sibling electron-mock.ts exists for exactly the same reason).
 */
import { isHttpError } from "@sveltejs/kit";

/** Build the POST Request a defineRoute handler expects. */
export function request(body?: unknown): Request {
  return body === undefined
    ? new Request("http://local.test")
    : new Request("http://local.test", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
}

/**
 * Await a route call that MUST reject with a SvelteKit HttpError; returns its
 * status + message. A route that unexpectedly resolves fails loudly with a
 * plain Error (which the isHttpError guard rethrows straight to the runner —
 * never disguised as an HTTP status).
 */
export async function caught(p: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await p;
    throw new Error("expected the route to reject, but it resolved");
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return { status: e.status, message: (e.body as { message?: unknown }).message };
  }
}

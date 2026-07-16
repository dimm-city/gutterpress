/**
 * Idle-timeout wrapper for the isomorphic-git HTTP client (audit B1).
 *
 * Every git transport call in this subsystem (`git.fetch`/`git.push`/
 * `git.clone`) is invoked with no timeout: if the TCP connection succeeds but
 * the remote stalls mid-response (a flaky network, a captive portal, a
 * misbehaving proxy) the call never resolves or rejects — sync/pull/push/clone
 * hangs forever, and because the operation still holds the per-repo
 * `withRepoLock` FIFO, every subsequent git op for that project wedges too.
 *
 * The REST calls in the same subsystem (github-repos.ts, github-auth.ts) already
 * guard every fetch with `AbortSignal.timeout`; this brings the same discipline
 * to the git transport, at the one place a default client is chosen.
 *
 * We use an IDLE timeout, not a total-operation deadline: a legitimately large
 * clone/fetch streams for minutes but never stalls for a full minute mid-pack,
 * so a total deadline would kill honest large transfers while an idle deadline
 * only fires when the remote genuinely stops talking. The wrapper races (a) the
 * `request()` call itself — covers "connected but no response headers" — and
 * (b) each read of the streaming response body — covers "headers arrived then
 * the socket went silent". On timeout it throws an error whose message the
 * recovery classifier maps to `network_unavailable` (→ the friendly offline
 * message), exactly like a real ECONNRESET.
 *
 * Test HTTP clients injected via `httpClient`/`ctx.httpClient` are NOT wrapped
 * (they talk to in-memory fixtures that never stall); only the production
 * default is.
 */
import httpNode from "isomorphic-git/http/node";

/**
 * Idle timeout for git transport reads. Generous on purpose: a real transfer
 * streams steadily, so a full minute of total silence means the connection is
 * dead, not slow. The phrase "couldn't reach the remote" in the thrown message
 * is load-bearing — `recovery/classify.ts` scans for it to classify the failure
 * as offline.
 */
export const GIT_HTTP_IDLE_TIMEOUT_MS = 60_000;

function gitTimeoutError(what: string, ms: number): Error {
  // "couldn't reach" + "ETIMEDOUT" both match the network regex in
  // recovery/classify.ts, so this surfaces as the offline message, not a crash.
  return new Error(
    `Git network operation timed out after ${Math.round(ms / 1000)}s (${what}); ` +
      `couldn't reach the remote (ETIMEDOUT).`,
  );
}

/** Race a promise against an idle deadline, clearing the timer either way. */
function withDeadline<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(gitTimeoutError(what, ms)), ms);
  });
  return Promise.race([promise, deadline]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/** Wrap a response body iterator so each chunk read is bounded by an idle timeout. */
async function* idleGuardedBody(
  source: AsyncIterableIterator<Uint8Array>,
  ms: number,
): AsyncIterableIterator<Uint8Array> {
  const it = source[Symbol.asyncIterator]();
  try {
    for (;;) {
      const step = await withDeadline(it.next(), ms, "the remote stopped sending data");
      if (step.done) return;
      yield step.value;
    }
  } finally {
    // Best-effort release of the abandoned source. Do NOT await — on a stalled
    // socket `return()` can itself hang; fire-and-forget lets node reclaim it.
    try {
      void it.return?.();
    } catch {
      /* ignore */
    }
  }
}

/**
 * Return a client that behaves like `http` but aborts a stalled request/read
 * after `timeoutMs` of no progress.
 */
export function withIdleTimeout(
  http: typeof httpNode,
  timeoutMs: number = GIT_HTTP_IDLE_TIMEOUT_MS,
): typeof httpNode {
  return {
    async request(options) {
      const res = await withDeadline(
        http.request(options),
        timeoutMs,
        "the remote did not respond",
      );
      if (!res.body || typeof res.body[Symbol.asyncIterator] !== "function") {
        return res;
      }
      return { ...res, body: idleGuardedBody(res.body, timeoutMs) };
    },
  };
}

/**
 * The production default git HTTP client: `httpNode` with an idle timeout.
 * Use this in place of a bare `httpNode` wherever a caller did not inject its
 * own `httpClient`.
 */
export const defaultGitHttp: typeof httpNode = withIdleTimeout(httpNode);

/**
 * Timeout wrapper for the isomorphic-git HTTP client (audit B1).
 *
 * Every git transport call in this subsystem (`git.fetch`/`git.push`/
 * `git.clone`) is invoked with no timeout: if the TCP connection succeeds but
 * the remote stalls, the call never resolves or rejects — sync/pull/push/clone
 * hangs forever, and because the operation still holds the per-repo
 * `withRepoLock` FIFO, every subsequent git op for that project wedges too.
 *
 * The REST calls in the same subsystem (github-repos.ts, github-auth.ts) already
 * guard every fetch with `AbortSignal.timeout`; this brings the same discipline
 * to the git transport, at the one place a default client is chosen.
 *
 * Design (review finding: a naive deadline on `request()` is WRONG for pushes):
 * isomorphic-git passes upload bodies as an ARRAY of buffers, which the node
 * client collects and sends with Content-Length — `request()` then resolves
 * only when the response HEADERS arrive, i.e. after the ENTIRE pack upload.
 * There is no per-chunk progress signal for uploads, so an idle deadline on the
 * request phase of a push would be a TOTAL cap that kills legitimately slow
 * large pushes. Therefore:
 *
 *  - Body-less requests (the info/refs discovery GET — the classic
 *    "connected but silent" stall) get the short IDLE deadline.
 *  - Requests WITH a body (push receive-pack / fetch negotiation POSTs) get a
 *    LONG total backstop instead: generous enough that no realistic transfer
 *    hits it, but bounded so a truly dead connection can never wedge the repo
 *    lock forever.
 *  - Every response-body chunk read re-arms the short idle deadline, so a
 *    stall after headers is caught quickly on every request type while a
 *    slow-but-progressing download streams for as long as it needs.
 *
 * One timer serves the whole request (re-armed via `refresh()`; no per-chunk
 * allocation). On timeout the thrown error's message classifies as offline in
 * recovery/classify.ts. Known limitation (documented, not fixable at this
 * layer): isomorphic-git's client accepts no AbortSignal, so an abandoned
 * timed-out transfer's socket is left to the OS/agent to reap.
 *
 * Test HTTP clients injected via `httpClient`/`ctx.httpClient` are NOT wrapped
 * (they talk to in-memory fixtures that never stall); only the production
 * default is.
 */
import httpNode from "isomorphic-git/http/node";

/**
 * Idle deadline for silent phases: the wait for response headers on body-less
 * requests, and the gap between response-body chunks. A healthy transfer
 * produces SOMETHING within a minute; total silence for 60s means the
 * connection is dead, not slow.
 */
export const GIT_HTTP_IDLE_TIMEOUT_MS = 60_000;

/**
 * Total backstop for requests that upload a LARGE body (a push pack), whose
 * request phase exposes no progress signal (see header). 30 minutes
 * accommodates a multi-GB initial push on a slow uplink while still
 * guaranteeing the per-repo lock can never be wedged forever.
 */
export const GIT_HTTP_UPLOAD_TIMEOUT_MS = 30 * 60_000;

/**
 * Bodies at or below this size are "not an upload": they transfer in seconds
 * even on a very slow uplink (256 KiB ≈ 21s at 100 kbit/s), so the wait for
 * response headers is server silence, governed by the short idle deadline. A
 * pull's fetch-negotiation POST (want/have lines) is a few KB; push packs are
 * MBs+ and get the long backstop.
 */
export const SMALL_BODY_MAX_BYTES = 256 * 1024;

function gitTimeoutError(what: string, ms: number): Error {
  // "couldn't reach" + "ETIMEDOUT" both match the network regex in
  // recovery/classify.ts, so this surfaces as the offline message, not a crash.
  return new Error(
    `Git network operation timed out after ${Math.round(ms / 1000)}s (${what}); ` +
      `couldn't reach the remote (ETIMEDOUT).`,
  );
}

/**
 * Return a client that behaves like `http` but rejects when the transfer goes
 * silent (see the header for exactly which phases are guarded and why).
 */
export function withIdleTimeout(
  http: typeof httpNode,
  idleMs: number = GIT_HTTP_IDLE_TIMEOUT_MS,
  uploadMs: number = GIT_HTTP_UPLOAD_TIMEOUT_MS,
): typeof httpNode {
  return {
    async request(options) {
      // One trip-wire per request: a single timer + a single rejection promise,
      // re-armed with `refresh()` on progress. `tripped` gets a no-op catch so
      // a trip that fires while no race is pending can never surface as an
      // unhandled rejection.
      let timer: ReturnType<typeof setTimeout> | undefined;
      let trip!: (e: Error) => void;
      const tripped = new Promise<never>((_, reject) => {
        trip = reject;
      });
      tripped.catch(() => {});

      const arm = (ms: number, what: string): void => {
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => trip(gitTimeoutError(what, ms)), ms);
        timer.unref?.();
      };
      const disarm = (): void => {
        if (timer) clearTimeout(timer);
        timer = undefined;
      };
      /** Race `p` against the trip-wire; if the trip wins, make sure `p`'s own
       *  eventual rejection is consumed (never an unhandled rejection). */
      const race = <T>(p: Promise<T>): Promise<T> =>
        Promise.race([p, tripped]).catch((e) => {
          p.catch(() => {});
          throw e;
        }) as Promise<T>;

      // Which deadline governs the request phase? Only a LARGE upload needs
      // the long backstop — a pull's fetch-negotiation POST carries just a few
      // KB of want/have lines that upload instantly, so its wait-for-headers is
      // exactly the "connected but silent" stall the short idle deadline exists
      // for (gap-sweep finding: treating every body-carrying request as an
      // upload let a stalled pull wedge the repo lock for the full backstop).
      // isomorphic-git always passes bodies as arrays of byte chunks, so small
      // ones are sizable synchronously; anything unsizable is conservatively
      // treated as a large upload.
      const body: unknown = options.body;
      const smallBody =
        Array.isArray(body) &&
        body.reduce(
          (sum: number, c) => sum + (c && typeof c.byteLength === "number" ? c.byteLength : 0),
          0,
        ) <= SMALL_BODY_MAX_BYTES;
      const isLargeUpload = body != null && !smallBody;
      arm(
        isLargeUpload ? uploadMs : idleMs,
        isLargeUpload ? "the upload did not complete" : "the remote did not respond",
      );
      let res: Awaited<ReturnType<typeof http.request>>;
      try {
        res = await race(http.request(options));
      } finally {
        disarm();
      }

      const rawBody = res.body;
      if (!rawBody || typeof rawBody[Symbol.asyncIterator] !== "function") {
        return res;
      }
      const source = rawBody[Symbol.asyncIterator]();
      const guardedBody: AsyncIterableIterator<Uint8Array> = {
        async next() {
          // The timer only runs while a chunk read is pending, so a slow
          // CONSUMER between reads never counts as remote silence.
          arm(idleMs, "the remote stopped sending data");
          try {
            const step = await race(source.next());
            disarm();
            return step;
          } catch (e) {
            disarm();
            // Best-effort release of the abandoned source. Do NOT await — on a
            // stalled socket return() can itself hang; and route any async
            // rejection into a no-op catch (a bare `void` would leave it
            // unhandled).
            try {
              Promise.resolve(source.return?.()).catch(() => {});
            } catch {
              /* ignore synchronous throw */
            }
            throw e;
          }
        },
        return(value?: unknown) {
          disarm();
          try {
            return Promise.resolve(
              source.return?.(value) ?? { done: true as const, value: undefined },
            ) as Promise<IteratorResult<Uint8Array>>;
          } catch {
            return Promise.resolve({ done: true as const, value: undefined });
          }
        },
        [Symbol.asyncIterator]() {
          return this;
        },
      };
      return { ...res, body: guardedBody };
    },
  };
}

/**
 * The production default git HTTP client: `httpNode` with the timeout policy
 * above. Use this in place of a bare `httpNode` wherever a caller did not
 * inject its own `httpClient`.
 */
export const defaultGitHttp: typeof httpNode = withIdleTimeout(httpNode);

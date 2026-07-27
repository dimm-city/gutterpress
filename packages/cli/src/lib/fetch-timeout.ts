/**
 * Shared network deadline + author-friendly error mapping for the CLI's
 * direct `fetch` call sites (GitHub auth/API, the butler download). ONE copy
 * of the policy, so a fix here reaches every site (the old per-site clones
 * let the dropped-timeout bug below survive in two of three copies):
 *
 *  - The deadline is a TOTAL budget (`AbortSignal.timeout` keeps ticking
 *    through any body read done inside `run`), COMPOSED with the caller's
 *    cancellation signal via `AbortSignal.any` — the old
 *    `signal ?? AbortSignal.timeout(...)` pattern silently DROPPED the
 *    timeout whenever a caller passed a signal.
 *  - A caller abort ("AbortError") is rethrown untouched, so cancellation
 *    keeps its site-specific handling.
 *  - A fired deadline ("TimeoutError") maps to `timeoutMessage`.
 *  - Every other failure (DNS, TLS, socket reset) maps to `offlineMessage`,
 *    with the underlying error attached as `cause`.
 *
 * (The isomorphic-git transport has its own idle/total timer design —
 * remote-auth/git-http.ts — because that client accepts no AbortSignal.)
 */

/** An operation error that already has its final classification and message. */
export class FetchPassthroughError extends Error {}

/** An author-friendly HTTP status error that should not be remapped. */
export class FriendlyHttpError extends FetchPassthroughError {}

/** A timeout, DNS, TLS, or socket failure that an optional download may skip. */
export class FetchUnavailableError extends Error {}

export interface FetchTimeoutOptions {
  /** TOTAL deadline in ms, covering everything `run` does with the signal. */
  timeoutMs: number;
  /** Optional caller cancellation, composed with the deadline. */
  signal?: AbortSignal;
  /** Message when the deadline fires. Defaults to the offline mapping. */
  timeoutMessage?: string;
  /** Message for network-level failures (string, or built from the cause). */
  offlineMessage: string | ((cause: unknown) => string);
}

function composeSignal(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; timeout: AbortSignal } {
  // AbortSignal.any is guaranteed by the package's node >=22 engine floor
  // (PR #116 review: a feature-detect fallback here would silently drop the
  // deadline exactly when a caller supplies a cancellation signal).
  const timeout = AbortSignal.timeout(timeoutMs);
  return {
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    timeout,
  };
}

/** Run one fetch-shaped operation under the policy described in the header. */
export async function withFetchTimeout<T>(
  options: FetchTimeoutOptions,
  run: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const composed = composeSignal(options.signal, options.timeoutMs);
  try {
    return await run(composed.signal);
  } catch (cause) {
    if (cause instanceof FetchPassthroughError) throw cause;
    if (options.signal?.aborted) throw cause;
    const offline =
      typeof options.offlineMessage === "function"
        ? options.offlineMessage(cause)
        : options.offlineMessage;
    const timedOut =
      composed.timeout.aborted ||
      (cause instanceof Error && cause.name === "TimeoutError");
    if (cause instanceof Error && cause.name === "AbortError" && !timedOut) throw cause;
    throw new FetchUnavailableError(
      timedOut ? (options.timeoutMessage ?? offline) : offline,
      { cause },
    );
  }
}

import { test, expect } from "bun:test";
import { FriendlyHttpError, withFetchTimeout } from "./fetch-timeout";

/** A fetch stand-in that never resolves until its signal aborts. */
function hang(signal: AbortSignal): Promise<never> {
  return new Promise((_, reject) =>
    signal.addEventListener("abort", () => reject(signal.reason), { once: true }),
  );
}

async function rejectionOf(p: Promise<unknown>): Promise<Error> {
  return p.then(
    () => {
      throw new Error("expected rejection");
    },
    (e) => e as Error,
  );
}

test("deadline fires with the friendly timeout message EVEN when a caller signal is passed (the dropped-timeout bug class)", async () => {
  const controller = new AbortController(); // never aborted
  const err = await rejectionOf(
    withFetchTimeout(
      {
        timeoutMs: 10,
        signal: controller.signal,
        timeoutMessage: "took too long",
        offlineMessage: "offline",
      },
      hang,
    ),
  );
  expect(err.message).toBe("took too long");
});

test("deadline without a timeoutMessage falls back to the offline mapping", async () => {
  const err = await rejectionOf(
    withFetchTimeout({ timeoutMs: 10, offlineMessage: "offline" }, hang),
  );
  expect(err.message).toBe("offline");
});

test("a caller-supplied signal still cancels, rethrown raw (AbortSignal.any composition)", async () => {
  const controller = new AbortController();
  const promise = withFetchTimeout(
    { timeoutMs: 60_000, signal: controller.signal, offlineMessage: "offline" },
    hang,
  );
  controller.abort();
  const err = await rejectionOf(promise);
  expect(err.name).toBe("AbortError"); // not wrapped in the offline message
  expect(err.message).not.toBe("offline");
});

test("network-level failure maps to the offline message with the cause attached", async () => {
  const boom = new TypeError("fetch failed");
  const err = await rejectionOf(
    withFetchTimeout({ timeoutMs: 60_000, offlineMessage: "offline" }, async () => {
      throw boom;
    }),
  );
  expect(err.message).toBe("offline");
  expect(err.cause).toBe(boom);
});

test("offlineMessage can be built from the cause", async () => {
  const err = await rejectionOf(
    withFetchTimeout(
      {
        timeoutMs: 60_000,
        offlineMessage: (c) => `down: ${c instanceof Error ? c.message : String(c)}`,
      },
      async () => {
        throw new TypeError("ENOTFOUND example.com");
      },
    ),
  );
  expect(err.message).toBe("down: ENOTFOUND example.com");
});

test("a FriendlyHttpError from run passes through untouched (never double-wrapped)", async () => {
  const friendly = new FriendlyHttpError("HTTP 503, already friendly");
  const err = await rejectionOf(
    withFetchTimeout({ timeoutMs: 60_000, offlineMessage: "offline" }, async () => {
      throw friendly;
    }),
  );
  expect(err).toBe(friendly);
});

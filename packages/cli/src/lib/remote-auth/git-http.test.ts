import { describe, expect, it } from "bun:test";

import { classifyTransportFailure } from "./recovery/classify.ts";
import { withIdleTimeout } from "./git-http.ts";

// A fake isomorphic-git http client whose request() and/or body reads can be
// made to hang, so we can prove the idle-timeout wrapper unblocks them.
function neverResolvingRequest() {
  return {
    request() {
      return new Promise<never>(() => {
        /* never settles — simulates a connected-but-silent remote */
      });
    },
  } as unknown as Parameters<typeof withIdleTimeout>[0];
}

function stallingBodyRequest() {
  return {
    async request() {
      return {
        url: "http://example.test/info/refs",
        method: "GET",
        statusCode: 200,
        statusMessage: "OK",
        headers: {},
        // A body that yields nothing and never completes.
        body: {
          [Symbol.asyncIterator]() {
            return {
              next() {
                return new Promise<never>(() => {});
              },
            };
          },
        },
      };
    },
  } as unknown as Parameters<typeof withIdleTimeout>[0];
}

describe("withIdleTimeout", () => {
  it("rejects a body-less request() that never responds, with a network-classified error", async () => {
    const client = withIdleTimeout(neverResolvingRequest(), 25);
    let err: unknown;
    try {
      await client.request({ url: "http://example.test/info/refs" } as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    // The recovery classifier must map it to the offline path, not a raw crash.
    expect(classifyTransportFailure(err)).toBe("network_unavailable");
  });

  it("does NOT apply the short idle deadline to a request WITH a body (push upload)", async () => {
    // Review regression guard: isomorphic-git resolves request() only after the
    // whole pack upload for pushes, so the short idle deadline must not govern
    // it — only the long upload backstop does. Simulate an upload that takes
    // 4x the idle deadline and assert it completes.
    const slowUpload = {
      async request() {
        await new Promise((r) => setTimeout(r, 100));
        return {
          url: "http://example.test/git-receive-pack",
          method: "POST",
          statusCode: 200,
          statusMessage: "OK",
          headers: {},
        };
      },
    } as unknown as Parameters<typeof withIdleTimeout>[0];
    const client = withIdleTimeout(slowUpload, 25 /* idle */, 10_000 /* upload backstop */);
    const res = await client.request({
      url: "http://example.test/git-receive-pack",
      body: [new Uint8Array([1, 2, 3])],
    } as never);
    expect(res.statusCode).toBe(200);
  });

  it("still bounds a body-carrying request via the upload backstop", async () => {
    const client = withIdleTimeout(neverResolvingRequest(), 10_000 /* idle */, 25 /* upload */);
    let err: unknown;
    try {
      await client.request({
        url: "http://example.test/git-receive-pack",
        body: [new Uint8Array([1])],
      } as never);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(classifyTransportFailure(err)).toBe("network_unavailable");
  });

  it("rejects a response body that stalls mid-read", async () => {
    const client = withIdleTimeout(stallingBodyRequest(), 25);
    const res = await client.request({ url: "http://example.test/info/refs" } as never);
    let err: unknown;
    try {
      // Consume the (stalling) body — this is what isomorphic-git does.
      for await (const _chunk of res.body as AsyncIterable<Uint8Array>) {
        void _chunk;
      }
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(classifyTransportFailure(err)).toBe("network_unavailable");
  });

  it("passes healthy request/body through untouched", async () => {
    const chunks = [new Uint8Array([1, 2]), new Uint8Array([3])];
    const healthy = {
      async request() {
        async function* gen() {
          yield* chunks;
        }
        return {
          url: "http://example.test",
          method: "GET",
          statusCode: 200,
          statusMessage: "OK",
          headers: {},
          body: gen(),
        };
      },
    } as unknown as Parameters<typeof withIdleTimeout>[0];

    const client = withIdleTimeout(healthy, 1000);
    const res = await client.request({ url: "http://example.test" } as never);
    const got: Uint8Array[] = [];
    for await (const c of res.body as AsyncIterable<Uint8Array>) got.push(c);
    expect(got.map((c) => Array.from(c))).toEqual([
      [1, 2],
      [3],
    ]);
  });
});

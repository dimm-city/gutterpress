/**
 * #221 review findings C5/C6 — both disconnect routes AWAITED the best-effort
 * Google-credential revoke (a ~10s `withFetchTimeout` deadline) BEFORE
 * deleting the credential locally. `revokeGoogleCredential` is designed to
 * never throw, so the local delete was always safe either way — but an
 * OFFLINE disconnect could block the "Remove this key" button for up to 10s
 * for a result nobody even reads.
 *
 * C5: delete the local credential first/immediately; let the revoke run in
 * the background (fired, never awaited) on BOTH
 * `api/publish/disconnect` and `api/remote/disconnect-host`.
 * C6: `disconnect-host` must not pay for `loadLib()` at all for a host whose
 * stored credential isn't `google-oauth` (github.com, generic forges).
 *
 * Both routes share the SAME `remote` hooks domain (`getRemoteHooks()` — see
 * `api/publish/_hooks.ts`'s module doc), so one fake token store + lib serves
 * both suites. Follows the `registerHostServices`/`makeHostServices` route-test
 * convention (see remote-path-validation.test.ts).
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as publishDisconnectRoute } from "../../src/routes/api/publish/disconnect/+server";
import { POST as remoteDisconnectHostRoute } from "../../src/routes/api/remote/disconnect-host/+server";

function request(body?: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
    headers: { "content-type": "application/json" },
  });
}

interface StoredCredential {
  token: string;
  host: string;
  username?: string;
  kind: string;
  label?: string;
  createdAt: number;
}

/** A minimal, spyable TokenStore fake — tracks delete() calls in order. */
function makeTokenStore(initial: Record<string, StoredCredential> = {}) {
  const store = new Map(Object.entries(initial));
  const deleteCalls: string[] = [];
  return {
    deleteCalls,
    api: {
      get: async (key: string) => store.get(key) ?? null,
      set: async (key: string, cred: StoredCredential) => {
        store.set(key, cred);
      },
      delete: async (key: string) => {
        deleteCalls.push(key);
        store.delete(key);
      },
      status: async () => ({ connected: false }),
      listRedacted: async () => [],
    },
  };
}

/** A promise that never settles — stands in for a revoke call hung on a dead
 *  network (the scenario C5 is about: offline, mid the ~10s fetch timeout). */
function hangsForever<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/** Races `p` against a short timer so a regression (still awaiting the
 *  revoke) fails fast instead of hanging the whole test run. */
async function withinMs<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`did not resolve within ${ms}ms — still awaiting the revoke?`)), ms),
    ),
  ]);
}

const remoteBase = { GITHUB_HOST: "github.com", cloneRepository: undefined as never };

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

describe("POST /api/publish/disconnect — C5 (revoke must not block the local delete)", () => {
  test("resolves without waiting on a hung Google revoke, and deletes the local credential first", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "drive.google.com": {
        token: "refresh-token-value",
        host: "drive.google.com",
        kind: "google-oauth",
        createdAt: 0,
      },
    });
    let revokeCalled = false;
    registerHostServices({
      ...makeHostServices(),
      remote: {
        ...remoteBase,
        tokenStore,
        loadLib: async () => ({
          publishProviderFor: () => ({
            info: { credential: { host: "drive.google.com" } },
          }),
          revokeGoogleCredential: async () => {
            revokeCalled = true;
            return hangsForever<void>();
          },
        }),
      } as never,
    });

    const res = await withinMs(
      publishDisconnectRoute({ request: request({ providerId: "gdrive" }) } as never),
      500,
    );
    const body = await res.json();
    expect(body).toEqual({ ok: true });
    // The local delete already happened — the response didn't wait on the
    // (still-pending, never-resolving) revoke to decide anything.
    expect(deleteCalls).toEqual(["drive.google.com"]);
    expect(revokeCalled).toBe(true);
  });

  test("still deletes locally when there is no stored credential to revoke", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({});
    registerHostServices({
      ...makeHostServices(),
      remote: {
        ...remoteBase,
        tokenStore,
        loadLib: async () => ({
          publishProviderFor: () => ({
            info: { credential: { host: "itch.io" } },
          }),
        }),
      } as never,
    });
    const res = await withinMs(
      publishDisconnectRoute({ request: request({ providerId: "itch" }) } as never),
      500,
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteCalls).toEqual(["itch.io"]);
  });
});

describe("POST /api/remote/disconnect-host — C5 (revoke must not block the local delete)", () => {
  test("resolves without waiting on a hung Google revoke, and deletes the local credential first", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "drive.google.com": {
        token: "refresh-token-value",
        host: "drive.google.com",
        kind: "google-oauth",
        createdAt: 0,
      },
    });
    let revokeCalled = false;
    registerHostServices({
      ...makeHostServices(),
      remote: {
        ...remoteBase,
        tokenStore,
        loadLib: async () => ({
          revokeGoogleCredential: async () => {
            revokeCalled = true;
            return hangsForever<void>();
          },
        }),
      } as never,
    });

    const res = await withinMs(
      remoteDisconnectHostRoute({ request: request({ host: "drive.google.com" }) } as never),
      500,
    );
    expect(await res.json()).toEqual({ ok: true });
    expect(deleteCalls).toEqual(["drive.google.com"]);
    expect(revokeCalled).toBe(true);
  });
});

describe("POST /api/remote/disconnect-host — C6 (skip loadLib entirely for non-Google hosts)", () => {
  test("a github.com disconnect never calls loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "github.com": {
        token: "gh-token",
        host: "github.com",
        kind: "basic",
        createdAt: 0,
      },
    });
    let loadLibCalls = 0;
    registerHostServices({
      ...makeHostServices(),
      remote: {
        ...remoteBase,
        tokenStore,
        loadLib: async () => {
          loadLibCalls++;
          return {};
        },
      } as never,
    });

    const res = await remoteDisconnectHostRoute({ request: request({ host: "github.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(loadLibCalls).toBe(0);
    expect(deleteCalls).toEqual(["github.com"]);
  });

  test("a generic-forge (non-google-oauth) disconnect never calls loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "git.example.com": {
        token: "forge-token",
        host: "git.example.com",
        kind: "basic",
        createdAt: 0,
      },
    });
    let loadLibCalls = 0;
    registerHostServices({
      ...makeHostServices(),
      remote: {
        ...remoteBase,
        tokenStore,
        loadLib: async () => {
          loadLibCalls++;
          return {};
        },
      } as never,
    });

    const res = await remoteDisconnectHostRoute({ request: request({ host: "git.example.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(loadLibCalls).toBe(0);
    expect(deleteCalls).toEqual(["git.example.com"]);
  });

  test("no stored credential at all still skips loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({});
    let loadLibCalls = 0;
    registerHostServices({
      ...makeHostServices(),
      remote: {
        ...remoteBase,
        tokenStore,
        loadLib: async () => {
          loadLibCalls++;
          return {};
        },
      } as never,
    });

    const res = await remoteDisconnectHostRoute({ request: request({ host: "unknown.example.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(loadLibCalls).toBe(0);
    expect(deleteCalls).toEqual(["unknown.example.com"]);
  });
});

/**
 * #221 review findings C5/C6, ported from the deleted route-level
 * `publish-disconnect-routes.test.ts` (0.10.5) to the typed IPC handlers
 * that replaced `api/publish/disconnect` and `api/remote/disconnect-host`
 * on this branch (`electron/api/publish.ts`'s `publishDisconnect`,
 * `electron/api/remote.ts`'s `remoteDisconnectHost`).
 *
 * Both disconnect paths once AWAITED the best-effort Google-credential
 * revoke (a ~10s `withFetchTimeout` deadline) BEFORE deleting the credential
 * locally. `revokeGoogleCredential` never throws, so the local delete was
 * always safe either way — but an OFFLINE disconnect could block the "Remove
 * this key" button for up to 10s for a result nobody even reads.
 *
 * C5: delete the local credential first/immediately; let the revoke run in
 * the background (fired, never awaited) on BOTH handlers.
 * C6: `remote:disconnectHost` must not pay for `loadLib()` at all for a host
 * whose stored credential isn't `google-oauth` (github.com, generic forges).
 *
 * Both handlers share the SAME `remote` hooks domain (`getRemoteHooks()`), so
 * one fake token store + lib serves both suites. Follows the
 * `registerHostServices`/`makeHostServices` convention (publish-ipc.test.ts).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { publishDisconnect } from "../../electron/api/publish";
import { remoteDisconnectHost } from "../../electron/api/remote";

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

function register(remote: Record<string, unknown>): void {
  registerHostServices({ ...makeHostServices(), remote: { ...remoteBase, ...remote } as never });
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

describe("publish:disconnect — C5 (revoke must not block the local delete)", () => {
  test("resolves without waiting on a hung Google revoke, and deletes the local credential first", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "drive.google.com": { token: "refresh-token-value", host: "drive.google.com", kind: "google-oauth", createdAt: 0 },
    });
    let revokeCalled = false;
    register({
      tokenStore,
      loadLib: async () => ({
        publishProviderFor: () => ({ info: { credential: { host: "drive.google.com" } } }),
        revokeGoogleCredential: async () => {
          revokeCalled = true;
          return hangsForever<void>();
        },
      }),
    });

    await expect(withinMs(publishDisconnect("gdrive", undefined), 500)).resolves.toEqual({ ok: true });
    // The local delete already happened — the result didn't wait on the
    // (still-pending, never-resolving) revoke to decide anything.
    expect(deleteCalls).toEqual(["drive.google.com"]);
    expect(revokeCalled).toBe(true);
  });

  test("still deletes locally when there is no stored credential to revoke", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({});
    register({
      tokenStore,
      loadLib: async () => ({
        publishProviderFor: () => ({ info: { credential: { host: "itch.io" } } }),
      }),
    });
    await expect(withinMs(publishDisconnect("itch", undefined), 500)).resolves.toEqual({ ok: true });
    expect(deleteCalls).toEqual(["itch.io"]);
  });
});

describe("remote:disconnectHost — C5 (revoke must not block the local delete)", () => {
  test("resolves without waiting on a hung Google revoke, and deletes the local credential first", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "drive.google.com": { token: "refresh-token-value", host: "drive.google.com", kind: "google-oauth", createdAt: 0 },
    });
    let revokeCalled = false;
    register({
      tokenStore,
      loadLib: async () => ({
        revokeGoogleCredential: async () => {
          revokeCalled = true;
          return hangsForever<void>();
        },
      }),
    });

    await expect(withinMs(remoteDisconnectHost("drive.google.com"), 500)).resolves.toEqual({ ok: true });
    expect(deleteCalls).toEqual(["drive.google.com"]);
    expect(revokeCalled).toBe(true);
  });
});

describe("both handlers delegate to lib.disconnectPublishCredential when the lib provides it", () => {
  test("publish:disconnect awaits disconnectPublishCredential and passes the resolved key + tokenStore", async () => {
    const { api: tokenStore } = makeTokenStore({
      "drive.google.com": { token: "rt", host: "drive.google.com", kind: "google-oauth", createdAt: 0 },
    });
    const calls: Array<{ key: string; sawTokenStore: boolean }> = [];
    let settled = false;
    register({
      tokenStore,
      loadLib: async () => ({
        publishProviderFor: () => ({ info: { credential: { host: "drive.google.com" } } }),
        disconnectPublishCredential: async (key: string, deps: { tokenStore: unknown }) => {
          calls.push({ key, sawTokenStore: deps.tokenStore === tokenStore });
          settled = true;
        },
      }),
    });

    await expect(publishDisconnect("gdrive", undefined)).resolves.toEqual({ ok: true });
    expect(calls).toEqual([{ key: "drive.google.com", sawTokenStore: true }]);
    expect(settled).toBe(true); // genuinely awaited, not fire-and-forgot
  });

  test("remote:disconnectHost awaits disconnectPublishCredential for a google-oauth host", async () => {
    const { api: tokenStore } = makeTokenStore({
      "drive.google.com": { token: "rt", host: "drive.google.com", kind: "google-oauth", createdAt: 0 },
    });
    const calls: string[] = [];
    register({
      tokenStore,
      loadLib: async () => ({
        disconnectPublishCredential: async (key: string) => {
          calls.push(key);
        },
      }),
    });

    await expect(remoteDisconnectHost("drive.google.com")).resolves.toEqual({ ok: true });
    expect(calls).toEqual(["drive.google.com"]);
  });
});

describe("remote:disconnectHost — C6 (skip loadLib entirely for non-Google hosts)", () => {
  for (const [label, host, kind] of [
    ["a github.com disconnect", "github.com", "basic"],
    ["a generic-forge (non-google-oauth) disconnect", "git.example.com", "basic"],
  ] as const) {
    test(`${label} never calls loadLib`, async () => {
      const { api: tokenStore, deleteCalls } = makeTokenStore({
        [host]: { token: "tok", host, kind, createdAt: 0 },
      });
      let loadLibCalls = 0;
      register({
        tokenStore,
        loadLib: async () => {
          loadLibCalls++;
          return {};
        },
      });
      await expect(remoteDisconnectHost(host)).resolves.toEqual({ ok: true });
      expect(loadLibCalls).toBe(0);
      expect(deleteCalls).toEqual([host]);
    });
  }

  test("no stored credential at all still skips loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({});
    let loadLibCalls = 0;
    register({
      tokenStore,
      loadLib: async () => {
        loadLibCalls++;
        return {};
      },
    });
    await expect(remoteDisconnectHost("unknown.example.com")).resolves.toEqual({ ok: true });
    expect(loadLibCalls).toBe(0);
    expect(deleteCalls).toEqual(["unknown.example.com"]);
  });
});

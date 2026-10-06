/**
 * #221 review findings C5/C6 for the two disconnect routes,
 * `api/publish/disconnect` and `api/remote/disconnect-host`.
 *
 * C5: both routes delegate to the lib's `disconnectPublishCredential`, which
 * deletes the local credential first and fires the best-effort Google revoke
 * without awaiting it — the routes await the lib call itself (the local
 * delete), never a revoke.
 * C6: `disconnect-host` must not pay for `loadLib()` at all for a host whose
 * stored credential isn't `google-oauth` (github.com, generic forges).
 *
 * Both routes share the SAME `remote` host domain (`getHostServices().remote`),
 * so one fake token store + lib serves both suites. Follows the
 * `registerHostServices`/`makeHostServices` + `setLibForTests` route-test
 * convention (see remote-path-validation.test.ts).
 */
import { afterEach, describe, expect, test } from "bun:test";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
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
      list: async () => [...store.values()],
      status: async () => ({ connected: false }),
      listRedacted: async () => [],
    },
  };
}

function hostWith(tokenStore: ReturnType<typeof makeTokenStore>["api"]): void {
  registerHostServices(makeHostServices({ remote: { tokenStore: tokenStore as never } }));
}

function fakeLib(lib: Record<string, unknown>): void {
  setLibForTests(lib as Partial<LibModule>);
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

describe("both disconnect routes delegate to lib.disconnectPublishCredential (#221 C5)", () => {
  test("publish:disconnect awaits disconnectPublishCredential and passes the resolved key + tokenStore", async () => {
    const { api: tokenStore } = makeTokenStore({
      "drive.google.com": { token: "rt", host: "drive.google.com", kind: "google-oauth", createdAt: 0 },
    });
    const calls: Array<{ key: string; sawTokenStore: boolean }> = [];
    let settled = false;
    hostWith(tokenStore);
    fakeLib({
      publishProviderFor: () => ({ info: { credential: { host: "drive.google.com" } } }),
      publishCredentialKey: (host: string, account: string) => `${host}#${account}`,
      disconnectPublishCredential: async (key: string, deps: { tokenStore: unknown }) => {
        calls.push({ key, sawTokenStore: deps.tokenStore === tokenStore });
        settled = true;
      },
    });

    const res = await publishDisconnectRoute({ request: request({ providerId: "gdrive" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual([{ key: "drive.google.com", sawTokenStore: true }]);
    expect(settled).toBe(true); // the route genuinely awaited the call, not fire-and-forgot it
  });

  test("publish:disconnect resolves a named account to the compound key", async () => {
    const { api: tokenStore } = makeTokenStore({});
    const calls: string[] = [];
    hostWith(tokenStore);
    fakeLib({
      publishProviderFor: () => ({ info: { credential: { host: "itch.io" } } }),
      publishCredentialKey: (host: string, account: string) => `${host}#${account}`,
      disconnectPublishCredential: async (key: string) => {
        calls.push(key);
      },
    });

    const res = await publishDisconnectRoute({ request: request({ providerId: "itch", account: " work " }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual(["itch.io#work"]);
  });

  test("remote:disconnectHost awaits disconnectPublishCredential for a google-oauth host", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "drive.google.com": { token: "rt", host: "drive.google.com", kind: "google-oauth", createdAt: 0 },
    });
    const calls: string[] = [];
    hostWith(tokenStore);
    fakeLib({
      disconnectPublishCredential: async (key: string) => {
        calls.push(key);
      },
    });

    const res = await remoteDisconnectHostRoute({ request: request({ host: "drive.google.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(calls).toEqual(["drive.google.com"]);
    expect(deleteCalls).toEqual([]); // the lib owns the delete on this path
  });
});

describe("POST /api/remote/disconnect-host — C6 (skip loadLib entirely for non-Google hosts)", () => {
  /** A lib loader that counts how often the route reached for the lib. */
  function countingLib(): { calls: () => number } {
    let n = 0;
    setLibForTests(async () => {
      n++;
      return {};
    });
    return { calls: () => n };
  }

  test("a github.com disconnect never calls loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "github.com": { token: "gh-token", host: "github.com", kind: "basic", createdAt: 0 },
    });
    hostWith(tokenStore);
    const lib = countingLib();

    const res = await remoteDisconnectHostRoute({ request: request({ host: "github.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(lib.calls()).toBe(0);
    expect(deleteCalls).toEqual(["github.com"]);
  });

  test("a generic-forge (non-google-oauth) disconnect never calls loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({
      "git.example.com": { token: "forge-token", host: "git.example.com", kind: "basic", createdAt: 0 },
    });
    hostWith(tokenStore);
    const lib = countingLib();

    const res = await remoteDisconnectHostRoute({ request: request({ host: "git.example.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(lib.calls()).toBe(0);
    expect(deleteCalls).toEqual(["git.example.com"]);
  });

  test("no stored credential at all still skips loadLib", async () => {
    const { api: tokenStore, deleteCalls } = makeTokenStore({});
    hostWith(tokenStore);
    const lib = countingLib();

    const res = await remoteDisconnectHostRoute({ request: request({ host: "unknown.example.com" }) } as never);
    expect(await res.json()).toEqual({ ok: true });
    expect(lib.calls()).toBe(0);
    expect(deleteCalls).toEqual(["unknown.example.com"]);
  });
});

/**
 * The two routes the Accounts page leans on, against the REAL lib:
 *
 *  - `publish/connect` with no `projectDir` (no book open): the key is still
 *    verified with the provider and only then stored, a rejected one leaves
 *    the saved key alone, and a `projectDir` that is sent is still confined to
 *    the open project. Nothing here reaches the network (fetch is stubbed).
 *  - `remote/forge-token-url`: a lookup by address alone.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as publishConnect } from "../../src/routes/api/publish/connect/+server";
import { POST as forgeTokenUrl } from "../../src/routes/api/remote/forge-token-url/+server";

interface Stored {
  token: string;
  host: string;
  username?: string;
  kind: string;
}

const realFetch = globalThis.fetch;
let stored: Map<string, Stored>;
let fetchCalls: string[];

function request(body: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

/** No book is open: the fs guard has no roots, as on the start screen. */
beforeEach(() => {
  stored = new Map();
  fetchCalls = [];
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => [] as string[], readOnlyRoots: () => [] as string[] },
      remote: {
        tokenStore: {
          get: async (key: string) => stored.get(key) ?? null,
          set: async (key: string, cred: Stored) => void stored.set(key, cred),
          delete: async (key: string) => void stored.delete(key),
          list: async () => [...stored.values()],
        } as never,
      },
    }),
  );
  // itch.io accepts only "good-key".
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    fetchCalls.push(String(url));
    const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? "";
    return new Response("{}", { status: auth.includes("good-key") ? 200 : 401 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  registerHostServices(undefined as unknown as HostServices);
});

/** The message of an HttpError a route threw, or the Response it returned. */
async function outcome(p: Promise<Response>): Promise<{ ok: true; body: unknown } | { ok: false; status: number; message: string }> {
  try {
    return { ok: true, body: await (await p).json() };
  } catch (e) {
    if (isHttpError(e)) return { ok: false, status: e.status, message: e.body.message };
    throw e;
  }
}

test("publish/connect with no book verifies the key, then stores it as the default account", async () => {
  const res = await outcome(publishConnect({ request: request({ providerId: "itch", token: "good-key" }) } as never));
  expect(res).toEqual({ ok: true, body: { connected: true, providerId: "itch" } });
  expect(fetchCalls).toEqual(["https://api.itch.io/profile"]);
  expect(stored.get("itch.io")).toMatchObject({ host: "itch.io", kind: "token", token: "good-key" });
  // The response never carries the key.
  expect(JSON.stringify(res)).not.toContain("good-key");
});

test("publish/connect with no book stores a named account under the compound key", async () => {
  await publishConnect({ request: request({ providerId: "itch", token: "good-key", account: " Studio " }) } as never);
  expect(stored.get("itch.io#Studio")).toMatchObject({ host: "itch.io", username: "Studio" });
  expect(stored.has("itch.io")).toBe(false);
});

test("publish/connect with no book: a rejected key is not stored and leaves the saved one alone", async () => {
  stored.set("itch.io", { host: "itch.io", kind: "token", token: "old-key" });
  const res = await outcome(publishConnect({ request: request({ providerId: "itch", token: "bad-key" }) } as never));
  expect(res.ok).toBe(false);
  expect(res).toMatchObject({ message: expect.stringContaining("didn't accept") });
  expect(JSON.stringify(res)).not.toContain("bad-key");
  expect(stored.get("itch.io")?.token).toBe("old-key");
});

test("publish/connect with no book: a Shopify key is saved without a check, since the store is a book setting", async () => {
  const res = await outcome(publishConnect({ request: request({ providerId: "shopify", token: "shpat_x" }) } as never));
  expect(res.ok).toBe(true);
  expect(fetchCalls).toEqual([]);
  expect(stored.get("shopify")?.token).toBe("shpat_x");
});

test("publish/connect with no book still refuses a provider that needs no key, an empty key and Google Drive's pasted token", async () => {
  for (const body of [
    { providerId: "kdp", token: "x" },
    { providerId: "itch", token: "  " },
    { providerId: "gdrive", token: "x" },
  ]) {
    const res = await outcome(publishConnect({ request: request(body) } as never));
    expect(res.ok).toBe(false);
  }
  expect(stored.size).toBe(0);
});

test("publish/connect: a projectDir that is sent is still confined to the open project", async () => {
  const res = await outcome(publishConnect({ request: request({ projectDir: "/somewhere/else", providerId: "itch", token: "good-key" }) } as never));
  expect(res).toMatchObject({ ok: false, status: 403 });
  expect(stored.size).toBe(0);
});

test("remote/forge-token-url answers with a recognised server's token page, else null", async () => {
  const ask = async (body: unknown) => ((await (await forgeTokenUrl({ request: request(body) } as never)).json()) as { url: string | null }).url;
  expect(await ask({ host: "gitlab.com" })).toBe("https://gitlab.com/-/user_settings/personal_access_tokens");
  expect(await ask({ host: "https://Bitbucket.org/team/repo" })).toBe("https://bitbucket.org/account/settings/app-passwords/");
  expect(await ask({ host: "git.example.com" })).toBeNull();
  expect(await ask({ host: "github.com" })).toBeNull();
  expect(await ask({ host: "" })).toBeNull();
  expect(await ask({})).toBeNull();
});

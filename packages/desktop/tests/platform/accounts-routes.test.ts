/**
 * `publish/connect` with no `projectDir` (no book open, as from the Accounts
 * page), against the REAL lib: the key is still verified with the provider and
 * only then stored, a rejected one leaves the saved key alone, Shopify's check
 * takes its store address from the request, and a `projectDir` that is sent is
 * still confined to the open project. Nothing here reaches the network (fetch
 * is stubbed).
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as publishConnect } from "../../src/routes/api/publish/connect/+server";

interface Stored {
  token: string;
  host: string;
  username?: string;
  kind: string;
}

const realFetch = globalThis.fetch;
let stored: Map<string, Stored>;
let fetchCalls: string[];
let fetchHeaders: Array<Record<string, string>>;

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
  fetchHeaders = [];
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
  // itch.io and Shopify accept only a key that says "good".
  globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
    fetchCalls.push(String(url));
    const headers = (init?.headers as Record<string, string> | undefined) ?? {};
    fetchHeaders.push(headers);
    const sent = `${headers.Authorization ?? ""}${headers["X-Shopify-Access-Token"] ?? ""}`;
    return new Response("{}", { status: sent.includes("good") ? 200 : 401 });
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

test("publish/connect with no book: a Shopify key needs the store address, which is used for the check and never stored", async () => {
  // No address (or one that isn't text): refused in plain words, nothing asked of Shopify or stored.
  for (const shop of [undefined, "", 42]) {
    const res = await outcome(publishConnect({ request: request({ providerId: "shopify", token: "good-key", shop }) } as never));
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining("store's address") });
  }
  expect(fetchCalls).toEqual([]);
  expect(stored.size).toBe(0);

  const res = await outcome(publishConnect({ request: request({ providerId: "shopify", token: "good-key", shop: "my-store.myshopify.com" }) } as never));
  expect(res).toEqual({ ok: true, body: { connected: true, providerId: "shopify" } });
  expect(fetchCalls).toHaveLength(1);
  expect(fetchCalls[0]).toContain("https://my-store.myshopify.com/admin/api/");
  expect(fetchHeaders[0]?.["X-Shopify-Access-Token"]).toBe("good-key");
  expect(stored.get("shopify")?.token).toBe("good-key");
  expect(JSON.stringify([...stored.values()])).not.toContain("myshopify");

  // A rejected Shopify key is not stored over the saved one.
  const bad = await outcome(publishConnect({ request: request({ providerId: "shopify", token: "bad-key", shop: "my-store.myshopify.com" }) } as never));
  expect(bad.ok).toBe(false);
  expect(stored.get("shopify")?.token).toBe("good-key");
});

test("publish/connect: `shop` is taken only with no projectDir; a book's own settings are used when one is sent", async () => {
  const book = await mkdtemp(path.join(tmpdir(), "gutterpress-accounts-routes-"));
  try {
    await writeFile(path.join(book, "manifest.yaml"), "title: T\nauthors: [A]\n", "utf8"); // no Shopify store set
    registerHostServices(
      makeHostServices({
        fsGuard: { projectRoots: () => [book], readOnlyRoots: () => [] as string[] },
        remote: { tokenStore: { get: async () => null, set: async (k: string, c: Stored) => void stored.set(k, c), list: async () => [] } as never },
      }),
    );
    const res = await outcome(publishConnect({ request: request({ projectDir: book, providerId: "shopify", token: "good-key", shop: "my-store.myshopify.com" }) } as never));
    expect(res).toMatchObject({ ok: false, message: expect.stringContaining("Set the store first") });
    expect(fetchCalls).toEqual([]);
    expect(stored.size).toBe(0);
  } finally {
    await rm(book, { recursive: true, force: true });
  }
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

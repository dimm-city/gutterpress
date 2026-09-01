import { test, expect } from "bun:test";
import { connectGoogleDrive } from "./connect-google.ts";
import { publishCredentialKey, listPublishAccounts, resolvePublishCredential } from "./types.ts";
import { publishProviderFor } from "./registry.ts";
import type { HostCredential, TokenStore } from "../remote-auth/token-store.ts";

/**
 * Regression coverage for #221's default-connect account-label bug (found in
 * Phase 2 review): `connectGoogleDrive` used to spread `...credential`
 * straight from `GoogleAuthProvider.connect()` — which always carries the
 * connected account's EMAIL in `username`, mirroring GitHub's username=login
 * convention — into the stored entry. For a NAMED connect that's fine (it
 * gets overwritten), but for the DEFAULT (unnamed) connect nothing overrode
 * it, so `listPublishAccounts` (which reads `username` as the account label)
 * reported the email as if it were a named account. That broke the desktop
 * saved-accounts picker on the very first successful connect: the "Connected
 * — email" row never matched, and touching the picker wrote a manifest
 * credential label that resolved to a nonexistent store key.
 */

class FakeStore implements TokenStore {
  map = new Map<string, HostCredential>();
  async get(host: string) {
    return this.map.get(host.trim().toLowerCase()) ?? null;
  }
  async set(host: string, c: HostCredential) {
    this.map.set(host.trim().toLowerCase(), c);
  }
  async delete(host: string) {
    this.map.delete(host.trim().toLowerCase());
  }
  async list() {
    return [...this.map.values()];
  }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Drives the real loopback listener end-to-end (as google-auth.test.ts
 * does), scripting only the token + about.get calls, so this exercises the
 * REAL connectGoogleDrive() code path rather than faking its internals. */
async function runConnect(account: string | undefined, email: string) {
  const store = new FakeStore();
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({
        access_token: "access-token",
        refresh_token: "refresh-token-value",
        expires_in: 3599,
      });
    }
    if (u.includes("drive/v3/about")) {
      return jsonResponse({ user: { emailAddress: email } });
    }
    throw new Error(`unexpected url in test: ${u}`);
  }) as unknown as typeof fetch;

  let resolveAuthUrl!: (u: string) => void;
  const authUrlPromise = new Promise<string>((res) => {
    resolveAuthUrl = res;
  });
  const connectPromise = connectGoogleDrive(
    {
      ...(account ? { account } : {}),
      clientId: "test-client-id",
      clientSecret: "test-client-secret",
      openBrowser: async () => {}, // never spawn a browser in tests
    },
    { tokenStore: store, fetch: fetchImpl },
    { onAuthUrl: (u) => resolveAuthUrl(u) },
  );
  connectPromise.catch(() => {}); // park until awaited below

  const authUrl = await authUrlPromise;
  const parsed = new URL(authUrl);
  const state = parsed.searchParams.get("state")!;
  const redirectUri = parsed.searchParams.get("redirect_uri")!;
  await fetch(`${redirectUri}/?code=fake-code&state=${state}`);

  const result = await connectPromise;
  return { store, result };
}

test("default (unnamed) connect: the stored credential carries NO username, only a label — listPublishAccounts reports the default account, not the email", async () => {
  const { store, result } = await runConnect(undefined, "writer@example.com");
  expect(result).toEqual({ connected: true, email: "writer@example.com" });

  const stored = store.map.get("gdrive");
  expect(stored?.username).toBeUndefined();
  expect(stored?.label).toBe("Google Drive — writer@example.com");
  expect(stored?.kind).toBe("google-oauth");
  expect(stored?.token).toBe("refresh-token-value"); // the refresh token, D4

  const info = publishProviderFor("gdrive").info;
  const accounts = await listPublishAccounts(info, { tokenStore: store });
  expect(accounts).toHaveLength(1);
  expect(accounts[0]!.account).toBe(""); // NOT the email — this is the bug this test pins
  expect(accounts[0]!.label).toBe("Google Drive — writer@example.com");

  // The default credential must still resolve via the bare host key — the
  // exact lookup the wizard's "Connected" status and a bare `gutterpress
  // publish --provider gdrive` both depend on.
  const resolved = await resolvePublishCredential(info, { tokenStore: store }, "");
  expect(resolved?.credential.token).toBe("refresh-token-value");
});

test("named connect: the stored credential's username IS the account label, and the email survives in the label", async () => {
  const { store } = await runConnect("studio", "writer@example.com");

  const stored = store.map.get(publishCredentialKey("gdrive", "studio"));
  expect(stored?.username).toBe("studio");
  expect(stored?.label).toBe("studio (writer@example.com)");

  const info = publishProviderFor("gdrive").info;
  const accounts = await listPublishAccounts(info, { tokenStore: store });
  expect(accounts).toHaveLength(1);
  expect(accounts[0]!.account).toBe("studio");
});

test("connecting a default account, then a named account, keeps both distinctly addressable", async () => {
  const store = new FakeStore();
  const fetchImpl = (async (url: string | URL | Request) => {
    const u = String(url);
    if (u.includes("oauth2.googleapis.com/token")) {
      return jsonResponse({ access_token: "a", refresh_token: "r", expires_in: 3599 });
    }
    if (u.includes("drive/v3/about")) {
      return jsonResponse({ user: { emailAddress: "writer@example.com" } });
    }
    throw new Error(`unexpected url in test: ${u}`);
  }) as unknown as typeof fetch;

  async function connectOnce(account?: string) {
    let resolveAuthUrl!: (u: string) => void;
    const authUrlPromise = new Promise<string>((res) => {
      resolveAuthUrl = res;
    });
    const p = connectGoogleDrive(
      { ...(account ? { account } : {}), clientId: "id", clientSecret: "secret", openBrowser: async () => {} },
      { tokenStore: store, fetch: fetchImpl },
      { onAuthUrl: (u) => resolveAuthUrl(u) },
    );
    p.catch(() => {});
    const authUrl = await authUrlPromise;
    const parsed = new URL(authUrl);
    await fetch(
      `${parsed.searchParams.get("redirect_uri")}/?code=c&state=${parsed.searchParams.get("state")}`,
    );
    return p;
  }

  await connectOnce(undefined);
  await connectOnce("studio");

  const info = publishProviderFor("gdrive").info;
  const accounts = await listPublishAccounts(info, { tokenStore: store });
  const byAccount = Object.fromEntries(accounts.map((a) => [a.account, a]));
  expect(Object.keys(byAccount).sort()).toEqual(["", "studio"]);
  expect(byAccount[""]!.label).toBe("Google Drive — writer@example.com");
  expect(byAccount["studio"]!.label).toBe("studio (writer@example.com)");
});

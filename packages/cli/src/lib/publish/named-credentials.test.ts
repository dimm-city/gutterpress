import { describe, test, expect } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  publishCredentialKey,
  resolvePublishCredential,
  publishConnectionStatus,
  listPublishAccounts,
  type PublishDeps,
} from "./types.ts";
import { PublishSelectionsStore } from "./selections.ts";
import { publishProviderFor } from "./registry.ts";
import type { HostCredential, TokenStore } from "../remote-auth/token-store.ts";

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

const itch = publishProviderFor("itch").info;
const cred = (over: Partial<HostCredential>): HostCredential => ({
  host: "itch.io",
  kind: "token",
  token: "T",
  createdAt: 1,
  ...over,
});

test("publishCredentialKey uses a compound host#account key for named accounts", () => {
  expect(publishCredentialKey("itch.io")).toBe("itch.io");
  expect(publishCredentialKey("itch.io", "work")).toBe("itch.io#work");
  expect(publishCredentialKey("itch.io", "  ")).toBe("itch.io"); // blank → default
});

test("resolvePublishCredential picks the compound key for a named account", async () => {
  const store = new FakeStore();
  await store.set("itch.io", cred({ token: "DEFAULT", label: "itch.io" }));
  await store.set("itch.io#work", cred({ token: "WORK", username: "work", label: "work" }));
  const deps: PublishDeps = { tokenStore: store, env: {} };
  expect((await resolvePublishCredential(itch, deps))?.credential.token).toBe("DEFAULT");
  expect((await resolvePublishCredential(itch, deps, "work"))?.credential.token).toBe("WORK");
  // A selected-but-missing account is NOT connected (no silent fallback).
  expect(await resolvePublishCredential(itch, deps, "missing")).toBeNull();
  expect((await publishConnectionStatus(itch, deps, "missing")).connected).toBe(false);
  expect((await publishConnectionStatus(itch, deps, "work")).connected).toBe(true);
});

test("deps.credentialAccount is the default account when none is passed explicitly", async () => {
  const store = new FakeStore();
  await store.set("itch.io#work", cred({ token: "WORK", username: "work" }));
  const deps: PublishDeps = { tokenStore: store, env: {}, credentialAccount: "work" };
  expect((await resolvePublishCredential(itch, deps))?.credential.token).toBe("WORK");
});

test("the CI env var still wins over any stored named account", async () => {
  const store = new FakeStore();
  await store.set("itch.io#work", cred({ token: "WORK", username: "work" }));
  const deps: PublishDeps = { tokenStore: store, env: { BUTLER_API_KEY: "ENV" } };
  const r = await resolvePublishCredential(itch, deps, "work");
  expect(r?.source).toBe("env");
  expect(r?.credential.token).toBe("ENV");
});

test("listPublishAccounts returns the default + named accounts, redacted", async () => {
  const store = new FakeStore();
  await store.set("itch.io", cred({ token: "D", label: "itch.io" }));
  await store.set("itch.io#work", cred({ token: "W", username: "work", label: "work" }));
  await store.set("shopify", cred({ host: "shopify", token: "S" })); // other provider ignored
  const accounts = await listPublishAccounts(itch, { tokenStore: store });
  expect(accounts.map((a) => a.account).sort()).toEqual(["", "work"]);
  expect(JSON.stringify(accounts)).not.toContain('"D"');
  expect(JSON.stringify(accounts)).not.toContain('"W"');
});

describe("PublishSelectionsStore — project/global default precedence", () => {
  test("project wins over global; clears fall back correctly", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pmd-sel-"));
    try {
      const store = new PublishSelectionsStore(path.join(dir, "sel.json"));
      expect(await store.resolve("itch", "/p")).toBeUndefined();

      await store.setGlobal("itch", "personal");
      expect(await store.resolve("itch", "/p")).toBe("personal");

      await store.setProject("/p", "itch", "work");
      expect(await store.resolve("itch", "/p")).toBe("work"); // project wins
      expect(await store.resolve("itch", "/other")).toBe("personal"); // else global
      expect(await store.levels("itch", "/p")).toEqual({ project: "work", global: "personal" });

      await store.setProject("/p", "itch", ""); // clear project override
      expect(await store.resolve("itch", "/p")).toBe("personal");

      await store.setGlobal("itch", null); // clear global
      expect(await store.resolve("itch", "/p")).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a trailing slash on the project path doesn't create a separate bucket", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "pmd-sel-"));
    try {
      const store = new PublishSelectionsStore(path.join(dir, "sel.json"));
      await store.setProject("/p/", "itch", "work");
      expect(await store.resolve("itch", "/p")).toBe("work");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

/**
 * Tests for transport.ts — focused on onAuthFor, the ONE canonical
 * credential → { username, password } mapping used by every isomorphic-git
 * network call (clone, fetch, push) across sync + recovery.
 *
 * These lock the exact convention so the hand-copied inline versions in
 * clone.ts and recover-missing-git-dir.ts can be replaced by this shared
 * helper without any behavior drift:
 *   - github-oauth → username "x-access-token" (GitHub accepts any username
 *     when the token is the password)
 *   - token        → username = stored username, else the token itself
 *     (the token-as-username convention every smart-HTTPS forge accepts)
 *   - password is always the token
 *   - no credential → {} (no onAuth wired at all)
 *
 * TEST RUNNER: bun:test only.
 */

import { describe, expect, test } from "bun:test";

import * as fs from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";

import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import {
  failureOutcome,
  fetchRemoteTip,
  guardTrackingRef,
  isCredentialTransmissionSafe,
  onAuthFor,
} from "./transport.ts";
import {
  createFixtureRepo,
  packDroppingClient,
  startGitServer,
  tempDir,
} from "./test-support/git-http-server.ts";
import type { HostCredential } from "./token-store.ts";
import type { RemoteTransport } from "./sync-types.ts";

/** Invoke the wired onAuth callback (isomorphic-git passes it the URL). */
function callOnAuth(
  result: ReturnType<typeof onAuthFor>,
  url = "https://git.example.com/book.git",
) {
  const onAuth = (result as { onAuth?: (url: string) => { username?: string; password?: string } })
    .onAuth;
  expect(typeof onAuth).toBe("function");
  return onAuth!(url);
}

describe("onAuthFor", () => {
  test("github-oauth → username 'x-access-token', password = token", () => {
    const cred: HostCredential = {
      host: "github.com",
      kind: "github-oauth",
      token: "gho_secret",
      username: "alice",
      createdAt: 0,
    };
    // Even though a username is stored, github-oauth always uses the fixed
    // "x-access-token" login — GitHub keys on the token in the password slot.
    expect(callOnAuth(onAuthFor(cred))).toEqual({
      username: "x-access-token",
      password: "gho_secret",
    });
  });

  test("token with stored username → that username, password = token", () => {
    const cred: HostCredential = {
      host: "git.example.com",
      kind: "token",
      token: "s3cret",
      username: "bob",
      createdAt: 0,
    };
    expect(callOnAuth(onAuthFor(cred))).toEqual({
      username: "bob",
      password: "s3cret",
    });
  });

  test("token without username → username = token, password = token", () => {
    const cred: HostCredential = {
      host: "git.example.com",
      kind: "token",
      token: "tok_only",
      createdAt: 0,
    };
    expect(callOnAuth(onAuthFor(cred))).toEqual({
      username: "tok_only",
      password: "tok_only",
    });
  });

  test("no credential → {} (no onAuth wired)", () => {
    expect(onAuthFor(undefined)).toEqual({});
  });

  // SECURITY: the token must never be transmitted in cleartext to a remote host.
  const cred: HostCredential = {
    host: "git.example.com",
    kind: "token",
    token: "s3cret",
    username: "bob",
    createdAt: 0,
  };

  test("remote http:// URL → NO credential leaves the process (cleartext leak prevented)", () => {
    // Loud, not silent: withholding with {} let the server's 401 masquerade as
    // an auth failure ("reconnect" loop + credential deletion). See the typed
    // insecure-transport test below for the thrown error's contract.
    expect(() => callOnAuth(onAuthFor(cred), "http://git.example.com/book.git")).toThrow();
  });

  test("loopback http:// URL → credential IS sent (local server / test fixture)", () => {
    expect(callOnAuth(onAuthFor(cred), "http://127.0.0.1:4321/fixture.git")).toEqual({
      username: "bob",
      password: "s3cret",
    });
  });

  test("isCredentialTransmissionSafe: https anywhere, http only on loopback", () => {
    expect(isCredentialTransmissionSafe("https://git.example.com/x.git")).toBe(true);
    expect(isCredentialTransmissionSafe("http://127.0.0.1:9/x.git")).toBe(true);
    expect(isCredentialTransmissionSafe("http://localhost/x.git")).toBe(true);
    expect(isCredentialTransmissionSafe("http://git.example.com/x.git")).toBe(false);
    expect(isCredentialTransmissionSafe("http://192.168.1.5/x.git")).toBe(false);
    expect(isCredentialTransmissionSafe("not a url")).toBe(false);
  });

  test("isCredentialTransmissionSafe: IPv6 loopback http (WHATWG hostname keeps brackets)", () => {
    // new URL("http://[::1]:8080/x.git").hostname === "[::1]" — never "::1".
    expect(isCredentialTransmissionSafe("http://[::1]:8080/x.git")).toBe(true);
    expect(isCredentialTransmissionSafe("http://[::1]/x.git")).toBe(true);
    // Non-loopback IPv6 stays unsafe.
    expect(isCredentialTransmissionSafe("http://[2001:db8::1]/x.git")).toBe(false);
  });

  test("remote http:// URL with a credential → onAuth throws a typed insecure-transport error", () => {
    const wired = onAuthFor(cred) as { onAuth: (url: string) => unknown };
    let thrown: unknown;
    try {
      wired.onAuth("http://git.example.com/book.git");
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as { code?: string })?.code).toBe("InsecureTransport");
    // Author-friendly: points at https, never echoes the token.
    expect((thrown as Error).message).toMatch(/https/i);
    expect((thrown as Error).message).not.toContain(cred.token);
  });
});

describe("guardTrackingRef", () => {
  const REF = "refs/remotes/origin/main";
  const BOGUS_OID = "a".repeat(40); // never a real object

  /** Local repo with one commit; returns its oid. */
  async function makeRepo(dir: string): Promise<string> {
    await git.init({ fs, dir, defaultBranch: "main" });
    await writeFile(path.join(dir, "a.md"), "one\n");
    await git.add({ fs, dir, filepath: "a.md" });
    return git.commit({
      fs,
      dir,
      message: "one",
      author: { name: "T", email: "t@test.local" },
    });
  }

  async function refOrNull(dir: string): Promise<string | null> {
    return git.resolveRef({ fs, dir, ref: REF }).catch(() => null);
  }

  async function withRepo(fn: (dir: string, commit: string) => Promise<void>): Promise<void> {
    const dir = await tempDir("gutterpress-guard-");
    try {
      await fn(dir, await makeRepo(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("fn moves the ref to a MISSING oid and throws → previous oid restored, error rethrown", async () => {
    await withRepo(async (dir, commit) => {
      await git.writeRef({ fs, dir, ref: REF, value: commit, force: true });
      const boom = new Error("transfer aborted");
      let err: unknown;
      try {
        await guardTrackingRef(dir, REF, {}, async () => {
          await git.writeRef({ fs, dir, ref: REF, value: BOGUS_OID, force: true });
          throw boom;
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBe(boom);
      expect(await refOrNull(dir)).toBe(commit);
    });
  });

  test("ref did not exist; fn creates it dangling and throws → ref deleted", async () => {
    await withRepo(async (dir) => {
      let err: unknown;
      try {
        await guardTrackingRef(dir, REF, {}, async () => {
          await git.writeRef({ fs, dir, ref: REF, value: BOGUS_OID, force: true });
          throw new Error("transfer aborted");
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBeInstanceOf(Error);
      expect(await refOrNull(dir)).toBeNull();
    });
  });

  test("fn throws without touching the ref → ref untouched", async () => {
    await withRepo(async (dir, commit) => {
      await git.writeRef({ fs, dir, ref: REF, value: commit, force: true });
      await expect(
        guardTrackingRef(dir, REF, {}, async () => {
          throw new Error("early failure");
        }),
      ).rejects.toThrow("early failure");
      expect(await refOrNull(dir)).toBe(commit);
    });
  });

  test("fn moves the ref to an oid whose object EXISTS and throws → ref kept (pack landed)", async () => {
    await withRepo(async (dir, first) => {
      await git.writeRef({ fs, dir, ref: REF, value: first, force: true });
      await writeFile(path.join(dir, "a.md"), "two\n");
      await git.add({ fs, dir, filepath: "a.md" });
      const second = await git.commit({
        fs,
        dir,
        message: "two",
        author: { name: "T", email: "t@test.local" },
      });
      await expect(
        guardTrackingRef(dir, REF, {}, async () => {
          await git.writeRef({ fs, dir, ref: REF, value: second, force: true });
          throw new Error("failed after the pack landed");
        }),
      ).rejects.toThrow("failed after the pack landed");
      expect(await refOrNull(dir)).toBe(second);
    });
  });

  test("fn succeeds → ref never touched, result passed through", async () => {
    await withRepo(async (dir, commit) => {
      const out = await guardTrackingRef(dir, REF, {}, async () => {
        await git.writeRef({ fs, dir, ref: REF, value: commit, force: true });
        return "ok";
      });
      expect(out).toBe("ok");
      expect(await refOrNull(dir)).toBe(commit);
    });
  });
});

describe("guardTrackingRef — a damaged ref store never blocks the guarded fetch (PR #116)", () => {
  // The recovery handlers run guarded fetches on repos whose ref store may
  // itself be damaged; a pre-scan failure must not skip the repair fetch. An
  // unreadable pre-scan degrades to "the ref did not exist before", so a
  // dangling ref the aborted fetch created is still deleted.
  const REF = "refs/remotes/origin/main";
  const BOGUS = "a".repeat(40);

  /** Make the FIRST git.resolveRef call throw, as an unreadable ref store would. */
  function breakFirstResolveRef(): () => void {
    const real = git.resolveRef;
    let calls = 0;
    (git as unknown as { resolveRef: typeof git.resolveRef }).resolveRef = ((args) => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("EIO: ref store unreadable"));
      return real(args);
    }) as typeof git.resolveRef;
    return () => {
      (git as unknown as { resolveRef: typeof git.resolveRef }).resolveRef = real;
    };
  }

  async function withEmptyRepo(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await tempDir("gutterpress-guardref-damaged-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("pre-scan throws → fn still runs and its result is returned", async () => {
    await withEmptyRepo(async (dir) => {
      const restore = breakFirstResolveRef();
      let ran = false;
      try {
        const out = await guardTrackingRef(dir, REF, {}, async () => {
          ran = true;
          return "repaired";
        });
        expect(out).toBe("repaired");
      } finally {
        restore();
      }
      expect(ran).toBe(true);
    });
  });

  test("pre-scan throws, fn creates a dangling ref and throws → it is still deleted", async () => {
    await withEmptyRepo(async (dir) => {
      const restore = breakFirstResolveRef();
      const boom = new Error("transfer aborted");
      let err: unknown;
      try {
        await guardTrackingRef(dir, REF, {}, async () => {
          await git.writeRef({ fs, dir, ref: REF, value: BOGUS, force: true });
          throw boom;
        });
      } catch (e) {
        err = e;
      } finally {
        restore();
      }
      expect(err).toBe(boom);
      expect(await git.resolveRef({ fs, dir, ref: REF }).catch(() => null)).toBeNull();
    });
  });
});

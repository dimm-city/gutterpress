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
  guardRefs,
  guardRemoteRefs,
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
    const dir = await tempDir("pmd-guard-");
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

describe("guardRemoteRefs", () => {
  // Mirrors the guardTrackingRef suite for the remote-wide form used by the
  // singleBranch:false recovery fetch: EVERY refs/remotes/origin/* ref is
  // snapshotted, and refs CREATED by fn are covered too.
  const MAIN = "refs/remotes/origin/main";
  const TOPIC = "refs/remotes/origin/topic";
  const BOGUS_A = "a".repeat(40);
  const BOGUS_B = "b".repeat(40);

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

  async function refOrNull(dir: string, ref: string): Promise<string | null> {
    return git.resolveRef({ fs, dir, ref }).catch(() => null);
  }

  async function withRepo(fn: (dir: string, commit: string) => Promise<void>): Promise<void> {
    const dir = await tempDir("pmd-guard-multi-");
    try {
      await fn(dir, await makeRepo(dir));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("fn dangles several refs (moved + created) and throws → moved restored, created deleted", async () => {
    await withRepo(async (dir, commit) => {
      await git.writeRef({ fs, dir, ref: MAIN, value: commit, force: true });
      const boom = new Error("transfer aborted");
      let err: unknown;
      try {
        await guardRemoteRefs(dir, "origin", {}, async () => {
          await git.writeRef({ fs, dir, ref: MAIN, value: BOGUS_A, force: true });
          // TOPIC did not exist before fn — a ref the aborted fetch CREATED.
          await git.writeRef({ fs, dir, ref: TOPIC, value: BOGUS_B, force: true });
          throw boom;
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBe(boom);
      expect(await refOrNull(dir, MAIN)).toBe(commit);
      expect(await refOrNull(dir, TOPIC)).toBeNull();
    });
  });

  test("ref moved to an oid whose object EXISTS → kept; dangling sibling still rolled back", async () => {
    await withRepo(async (dir, first) => {
      await git.writeRef({ fs, dir, ref: MAIN, value: first, force: true });
      await writeFile(path.join(dir, "a.md"), "two\n");
      await git.add({ fs, dir, filepath: "a.md" });
      const second = await git.commit({
        fs,
        dir,
        message: "two",
        author: { name: "T", email: "t@test.local" },
      });
      await expect(
        guardRemoteRefs(dir, "origin", {}, async () => {
          await git.writeRef({ fs, dir, ref: MAIN, value: second, force: true });
          await git.writeRef({ fs, dir, ref: TOPIC, value: BOGUS_A, force: true });
          throw new Error("failed after the pack landed");
        }),
      ).rejects.toThrow("failed after the pack landed");
      expect(await refOrNull(dir, MAIN)).toBe(second);
      expect(await refOrNull(dir, TOPIC)).toBeNull();
    });
  });

  test("fn throws without touching any ref → refs untouched", async () => {
    await withRepo(async (dir, commit) => {
      await git.writeRef({ fs, dir, ref: MAIN, value: commit, force: true });
      await expect(
        guardRemoteRefs(dir, "origin", {}, async () => {
          throw new Error("early failure");
        }),
      ).rejects.toThrow("early failure");
      expect(await refOrNull(dir, MAIN)).toBe(commit);
    });
  });

  test("fn succeeds → refs never touched, result passed through", async () => {
    await withRepo(async (dir) => {
      const out = await guardRemoteRefs(dir, "origin", {}, async () => {
        await git.writeRef({ fs, dir, ref: TOPIC, value: BOGUS_A, force: true });
        return "ok";
      });
      expect(out).toBe("ok");
      // Success path never rolls back — even a dangling ref is left alone.
      expect(await refOrNull(dir, TOPIC)).toBe(BOGUS_A);
    });
  });
});

describe("guardRefs — a damaged ref store never blocks the guarded fetch (PR #116)", () => {
  // The recovery handlers run guarded fetches on repos whose ref store may
  // itself be damaged; a pre-scan failure must not skip the repair fetch.
  const REF = "refs/remotes/origin/main";
  const BOGUS = "a".repeat(40);

  async function withEmptyRepo(fn: (dir: string) => Promise<void>): Promise<void> {
    const dir = await tempDir("pmd-guardrefs-");
    try {
      await git.init({ fs, dir, defaultBranch: "main" });
      await fn(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  test("pre-scan lister throws → fn still runs and its result is returned", async () => {
    await withEmptyRepo(async (dir) => {
      let ran = false;
      const out = await guardRefs(
        dir,
        async () => {
          throw new Error("EIO: ref store unreadable");
        },
        {},
        async () => {
          ran = true;
          return "repaired";
        },
      );
      expect(ran).toBe(true);
      expect(out).toBe("repaired");
    });
  });

  test("pre-scan throws, fn creates a dangling ref and throws → post-throw rollback still deletes it", async () => {
    await withEmptyRepo(async (dir) => {
      let calls = 0;
      const flakyLister = async () => {
        calls += 1;
        if (calls === 1) throw new Error("EIO: ref store unreadable");
        return [REF];
      };
      const boom = new Error("transfer aborted");
      let err: unknown;
      try {
        await guardRefs(dir, flakyLister, {}, async () => {
          await git.writeRef({ fs, dir, ref: REF, value: BOGUS, force: true });
          throw boom;
        });
      } catch (e) {
        err = e;
      }
      expect(err).toBe(boom);
      expect(await git.resolveRef({ fs, dir, ref: REF }).catch(() => null)).toBeNull();
    });
  });

  test("both listings throw → fn's own error still surfaces unmasked", async () => {
    await withEmptyRepo(async (dir) => {
      const boom = new Error("transfer aborted");
      let err: unknown;
      try {
        await guardRefs(
          dir,
          async () => {
            throw new Error("EIO: ref store unreadable");
          },
          {},
          async () => {
            throw boom;
          },
        );
      } catch (e) {
        err = e;
      }
      expect(err).toBe(boom);
    });
  });
});

describe("fetchRemoteTip — dangling tracking ref after an aborted transfer (R15)", () => {
  test("a fetch that dies before the pack lands does not leave the tracking ref dangling", async () => {
    const serverDir = await tempDir("pmd-r15-server-");
    const localDir = await tempDir("pmd-r15-local-");
    try {
      await createFixtureRepo(serverDir);
      const server = await startGitServer(serverDir);
      try {
        // A local repo with its own history that has NEVER fetched: no
        // refs/remotes/origin/main yet (the common first-sync state).
        await git.init({ fs, dir: localDir, defaultBranch: "main" });
        await writeFile(path.join(localDir, "local.md"), "local draft\n");
        await git.add({ fs, dir: localDir, filepath: "local.md" });
        await git.commit({
          fs,
          dir: localDir,
          message: "local",
          author: { name: "Local", email: "local@test.local" },
        });
        await git.setConfig({
          fs,
          dir: localDir,
          path: "remote.origin.url",
          value: server.url,
        });
        await git.setConfig({
          fs,
          dir: localDir,
          path: "remote.origin.fetch",
          value: "+refs/heads/*:refs/remotes/origin/*",
        });

        const transport: RemoteTransport = {
          remote: "origin",
          url: server.url,
          host: "127.0.0.1",
        };
        let err: unknown;
        try {
          await fetchRemoteTip(localDir, "main", transport, packDroppingClient(httpNode), {});
        } catch (e) {
          err = e;
        }
        expect(err).toBeInstanceOf(Error);

        // The ref did not exist before the failed fetch, and the pack never
        // landed — so it must not exist after either. A leftover ref pointing
        // at an oid with no local object poisons the NEXT fetch: zero `have`s
        // → the server streams the entire repository (the OOM fetchRemoteTip's
        // `ref` choice exists to prevent) and resolving the ref reports
        // "corruption" on a never-corrupt repo.
        const after = await git
          .resolveRef({ fs, dir: localDir, ref: "refs/remotes/origin/main" })
          .catch(() => null);
        expect(after).toBeNull();
      } finally {
        await server.close();
      }
    } finally {
      await rm(serverDir, { recursive: true, force: true });
      await rm(localDir, { recursive: true, force: true });
    }
  });
});

describe("failureOutcome — insecure transport is NOT the auth arm", () => {
  test("insecure-transport error → status 'error' with the dedicated message", () => {
    const err = Object.assign(new Error("credential withheld"), {
      code: "InsecureTransport",
    });
    const out = failureOutcome(err);
    // Never "auth": that message tells the user to reconnect, and recover-auth
    // deletes the stored credential on it — an https-vs-http problem a
    // reconnect can never fix.
    expect(out.status).toBe("error");
    expect(out.message).toMatch(/https|secure/i);
  });
});

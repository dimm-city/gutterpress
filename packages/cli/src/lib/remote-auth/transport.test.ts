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

import { onAuthFor } from "./transport.ts";
import type { HostCredential } from "./token-store.ts";

/** Invoke the wired onAuth callback (isomorphic-git passes it the URL). */
function callOnAuth(result: ReturnType<typeof onAuthFor>) {
  const onAuth = (result as { onAuth?: () => { username: string; password: string } })
    .onAuth;
  expect(typeof onAuth).toBe("function");
  return onAuth!();
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
});

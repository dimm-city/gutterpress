import { test, expect, spyOn, afterEach } from "bun:test";
import {
  redactUrlCredentials,
  friendlyVcsError,
  handleRemoteErrors,
} from "../../electron/server-bridge/friendly-errors";

// These lock the security/UX error-filter behavior that was previously
// copy-pasted across electron/main.ts, routes/api/remote/_hooks.ts, and the
// four routes/api/vcs/*/+server.ts handlers. Consolidated into one shared
// host-side module; behavior must stay byte-identical.

afterEach(() => {
  // restore any console spies installed in a test
});

test("redactUrlCredentials strips userinfo from a credential-bearing URL", () => {
  expect(redactUrlCredentials("https://user:ghp_secret@github.com/o/r.git")).toBe(
    "https://(redacted)@github.com/o/r.git",
  );
});

test("redactUrlCredentials leaves credential-free text untouched", () => {
  expect(redactUrlCredentials("https://github.com/o/r.git")).toBe(
    "https://github.com/o/r.git",
  );
  expect(redactUrlCredentials("nothing to redact here")).toBe("nothing to redact here");
});

test("friendlyVcsError passes a lib author-friendly message through as 422", () => {
  const err = new Error("There are no changes since the last snapshot.");
  const result = friendlyVcsError(err, "saveSnapshot", "vcs/save-snapshot");
  expect(result.status).toBe(422);
  expect(result.message).toBe("There are no changes since the last snapshot.");
});

test("friendlyVcsError maps every known friendly phrase to 422", () => {
  const phrases = [
    "no changes since the last snapshot",
    "no version history yet",
    "your work is safe",
    "project files were not changed",
    "requires an absolute project path",
    "valid snapshot id",
    "already inside a versioned project",
  ];
  for (const p of phrases) {
    expect(friendlyVcsError(new Error(p), "op", "vcs/x").status).toBe(422);
  }
});

test("friendlyVcsError replaces an internal error with a terse 500 naming the op", () => {
  const err = new Error("ENOENT: .git/refs/heads/main isomorphic-git internals");
  const result = friendlyVcsError(err, "restoreSnapshot", "vcs/restore-snapshot");
  expect(result.status).toBe(500);
  expect(result.message).toBe(
    "Version history could not complete the restoreSnapshot operation. See the app log for details.",
  );
  // The raw internal message must NOT leak into the returned message.
  expect(result.message).not.toContain("isomorphic-git");
});

test("friendlyVcsError logs the failure under the supplied label", () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    friendlyVcsError(new Error("boom internal"), "listSnapshotsPage", "vcs/list-snapshots-page");
    expect(spy.mock.calls[0]?.[0]).toBe("[vcs/list-snapshots-page] failed: boom internal");
  } finally {
    spy.mockRestore();
  }
});

test("handleRemoteErrors returns the wrapped value on success", async () => {
  const out = await handleRemoteErrors("remote:test", async () => 42);
  expect(out).toBe(42);
});

test("handleRemoteErrors passes a lib author-friendly remote message through verbatim", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      handleRemoteErrors("remote:test", async () => {
        throw new Error("We couldn't reach GitHub. Please try again.");
      }),
    ).rejects.toThrow("We couldn't reach GitHub. Please try again.");
  } finally {
    spy.mockRestore();
  }
});

test("handleRemoteErrors replaces an unexpected internal failure with a terse safe message", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      handleRemoteErrors("remote:test", async () => {
        throw new Error("TypeError: cannot read property foo of undefined");
      }),
    ).rejects.toThrow(
      "The online repository operation could not be completed. See the app log for details.",
    );
  } finally {
    spy.mockRestore();
  }
});

test("handleRemoteErrors redacts credentials in the logged message", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    await handleRemoteErrors("remote:test", async () => {
      throw new Error("clone failed for https://user:ghp_secret@github.com/o/r.git");
    }).catch(() => {});
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("//(redacted)@github.com");
    expect(logged).not.toContain("ghp_secret");
  } finally {
    spy.mockRestore();
  }
});

test("handleRemoteErrors redacts credentials in a logged .cause", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    await handleRemoteErrors("remote:test", async () => {
      const e = new Error("request failed");
      (e as Error & { cause?: unknown }).cause = "url https://u:tok@host/x";
      throw e;
    }).catch(() => {});
    const logged = spy.mock.calls.map((c) => String(c[0])).join("\n");
    expect(logged).toContain("//(redacted)@host");
    expect(logged).not.toContain("u:tok@");
  } finally {
    spy.mockRestore();
  }
});

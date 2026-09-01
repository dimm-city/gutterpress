import { test, expect, spyOn, afterEach } from "bun:test";
import {
  redactUrlCredentials,
  friendlyVcsError,
  handleRemoteErrors,
  handlePublishErrors,
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

// handlePublishErrors (publish:* IPC channels) — regression coverage for the
// finding that `publish:connectGoogleStart`/`publish:connectGoogleWait` were
// wrapped in `handleRemoteErrors` (the git/remote-domain sanitizer) instead
// of `handlePublishErrors`, which discarded every one of google-auth.ts's
// friendly messages — including GOOGLE_NOT_CONFIGURED_MESSAGE, the default
// path on every build until Phase 0's Cloud registration lands — behind the
// wrong-domain "online repository" fallback.

test("handlePublishErrors returns the wrapped value on success", async () => {
  const out = await handlePublishErrors("publish:test", async () => 42);
  expect(out).toBe(42);
});

test("handlePublishErrors passes the Google not-configured message through verbatim", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  const msg =
    "Google Drive publishing isn't configured on this build yet. Set GUTTERPRESS_GOOGLE_CLIENT_ID and GUTTERPRESS_GOOGLE_CLIENT_SECRET to enable it.";
  try {
    await expect(
      handlePublishErrors("publish:connectGoogleStart", async () => {
        throw new Error(msg);
      }),
    ).rejects.toThrow(msg);
  } finally {
    spy.mockRestore();
  }
});

test("handlePublishErrors passes the Google missing-refresh-token message through verbatim", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  const msg =
    "Google didn't return a refresh token. Try connecting again — if this keeps happening, revoke Gutterpress's access at myaccount.google.com/permissions and reconnect.";
  try {
    await expect(
      handlePublishErrors("publish:connectGoogleWait", async () => {
        throw new Error(msg);
      }),
    ).rejects.toThrow(msg);
  } finally {
    spy.mockRestore();
  }
});

test("handlePublishErrors passes every google-auth.ts author-facing message through verbatim", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  const messages = [
    "Your Google Drive connection expired or was revoked. Connect Google Drive again.",
    "Google rejected the app's sign-in credentials. This build's Google OAuth client id/secret may be misconfigured.",
    "Google sign-in failed (HTTP 400: invalid_request). Please try again.",
    "Google sign-in was declined. You can connect Google Drive again whenever you're ready.",
    "Google sign-in failed a security check (state mismatch). Connect Google Drive again.",
    "Google sign-in didn't return an authorization code. Try again.",
    "Google sign-in was canceled.",
    "Google sign-in timed out waiting for the browser. Try again, or use GDRIVE_REFRESH_TOKEN for headless/CI use.",
    "Couldn't reach Google. Check your connection and try again.",
  ];
  try {
    for (const msg of messages) {
      await expect(
        handlePublishErrors("publish:connectGoogleStart", async () => {
          throw new Error(msg);
        }),
      ).rejects.toThrow(msg);
    }
  } finally {
    spy.mockRestore();
  }
});

test("handlePublishErrors replaces an unexpected internal failure with a terse publish-domain message", async () => {
  const spy = spyOn(console, "error").mockImplementation(() => {});
  try {
    await expect(
      handlePublishErrors("publish:test", async () => {
        throw new Error("TypeError: cannot read property foo of undefined");
      }),
    ).rejects.toThrow("Publishing could not be completed. See the app log for details.");
  } finally {
    spy.mockRestore();
  }
});

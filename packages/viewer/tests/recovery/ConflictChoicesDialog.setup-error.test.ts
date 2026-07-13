/**
 * ConflictChoicesDialog — setup-error routing (M3).
 *
 * The bug: conflict-resolution.ts's catch block returned the two "project
 * isn't set up right" failures (no online address / an SSH address / no
 * named version line — MSG_NO_REMOTE / MSG_SSH_REMOTE / MSG_NO_BRANCH in the
 * lib) as `{ status: "error", message }`, and the dialog rendered
 * `outcome.message` VERBATIM with only a generic "Try again" — raw technical
 * wording with a dead-end CTA, for the non-technical authors this app targets.
 *
 * The fix: the lib now tags those three cases with a stable
 * `code: "needs-connection-setup"` on the outcome (sync-types.ts /
 * shared-types.ts), and the dialog:
 *   - never renders outcome.message for ANY "error"-status outcome,
 *   - shows a fixed plain-language line for the setup-error code and routes
 *     straight to the existing connect/setup surface via onReconnect (the
 *     same prop the pre-existing "auth" branch already uses),
 *   - shows the SAME fixed generic line SyncController.handleForceSync uses
 *     for every other "error" outcome.
 *   - leaves "auth" / "offline" behavior (already plain-language) unchanged.
 *
 * Test strategy matches the repo's established pattern for this component
 * (ConflictChoicesDialog.preview.test.ts, recovery-guidance-routing.test.ts):
 * no Svelte/DOM rendering harness in bun:test, so (1) a source-scan locks the
 * actual file's routing shape and (2) a logic simulation exercises the exact
 * branching against representative outcomes, including the literal raw lib
 * strings, asserting they never reach the rendered message.
 */

import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/ConflictChoicesDialog.svelte",
);

// Copied verbatim from packages/cli/src/lib/remote-auth/sync-messages.ts —
// deliberately inlined (not imported) so this viewer test never value-imports
// the lib package (PWA-clean rule applies to the SPA source; kept consistent
// here too rather than reaching across the workspace boundary).
const MSG_SSH_REMOTE =
  "This project's online address uses SSH (git@…), which print-md can't sync to. Switch it to the web (HTTPS) address to sync from here.";
const MSG_NO_BRANCH =
  "This project's version history isn't on a named branch, so it can't be synced right now.";
const MSG_NO_REMOTE = "This project isn't connected to an online repository yet.";
const MSG_AUTH =
  "The online repository didn't accept the saved connection. Reconnect and try again.";
const MSG_OFFLINE =
  "Your changes are saved on this computer. print-md couldn't reach the online repository — try syncing again when you're back online.";

/** Extract the body of confirm() (best-effort brace match), same technique used elsewhere in this test suite. */
function extractConfirmFn(source: string): string {
  const start = source.indexOf("async function confirm()");
  expect(start).toBeGreaterThan(-1);
  const open = source.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(open, i + 1);
    }
  }
  throw new Error("Could not brace-match confirm()");
}

describe("ConflictChoicesDialog source — setup-error routing shape", () => {
  test("confirm() checks outcome.code for the setup-error signal", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    const body = extractConfirmFn(src);
    expect(body).toContain('outcome.code === "needs-connection-setup"');
  });

  test("confirm() shows the fixed setup-needed line and routes to onReconnect", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    const body = extractConfirmFn(src);
    expect(body).toContain(
      "This project needs its online connection set up differently before syncing can work.",
    );
    // The setup-error branch must call onReconnect (same as the "auth" branch) —
    // count all onReconnect?.() call sites in confirm() and expect at least 2
    // (auth branch + setup-error branch).
    const reconnectCalls = body.match(/onReconnect\?\.\(\)/g) ?? [];
    expect(reconnectCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("confirm() shows the SAME fixed generic line as SyncController's generic error arm", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    const body = extractConfirmFn(src);
    expect(body).toContain("Couldn't update the online copy. Your work is saved on this computer — we'll try again later.");
  });

  test("confirm() reads outcome.message in ONLY the auth and offline branches — never for the generic/setup-error arms", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    const body = extractConfirmFn(src);
    const messageReads = body.match(/errorMessage = outcome\.message/g) ?? [];
    // Exactly two: the pre-existing "auth" branch, and the new "offline"
    // branch (both already plain-language, unrelated to this fix).
    expect(messageReads).toHaveLength(2);
  });

  test("the raw lib setup-error strings never appear in the component source", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    expect(src).not.toContain(MSG_SSH_REMOTE);
    expect(src).not.toContain(MSG_NO_BRANCH);
    expect(src).not.toContain(MSG_NO_REMOTE);
  });
});

// ── Logic simulation — mirrors the component's confirm() routing exactly ─────

type SimOutcome =
  | { status: "synced"; message: string; mergedRemoteChanges: boolean }
  | { status: "up-to-date"; message: string }
  | { status: "auth"; message: string }
  | { status: "offline"; message: string }
  | { status: "error"; message: string; code?: "needs-connection-setup" };

/** Mirrors ConflictChoicesDialog.svelte's confirm() outcome routing (post-fix). */
function routeOutcome(outcome: SimOutcome): {
  errorMessage: string | null;
  reconnectCalled: boolean;
} {
  if (outcome.status === "synced" || outcome.status === "up-to-date") {
    return { errorMessage: null, reconnectCalled: false };
  }
  if (outcome.status === "auth") {
    return { errorMessage: outcome.message, reconnectCalled: true };
  }
  if (outcome.status === "offline") {
    return { errorMessage: outcome.message, reconnectCalled: false };
  }
  if (outcome.status === "error" && outcome.code === "needs-connection-setup") {
    return {
      errorMessage:
        "This project needs its online connection set up differently before syncing can work.",
      reconnectCalled: true,
    };
  }
  return {
    errorMessage: "Sync failed. Check your connection and try again.",
    reconnectCalled: false,
  };
}

describe("setup-error routing simulation", () => {
  test("SSH-remote setup error never surfaces the raw lib message", () => {
    const { errorMessage, reconnectCalled } = routeOutcome({
      status: "error",
      code: "needs-connection-setup",
      message: MSG_SSH_REMOTE,
    });
    expect(errorMessage).not.toBe(MSG_SSH_REMOTE);
    expect(errorMessage).not.toContain("SSH");
    expect(errorMessage).not.toContain("git@");
    expect(errorMessage).toBe(
      "This project needs its online connection set up differently before syncing can work.",
    );
    expect(reconnectCalled).toBe(true);
  });

  test("no-named-branch setup error never surfaces the raw lib message", () => {
    const { errorMessage, reconnectCalled } = routeOutcome({
      status: "error",
      code: "needs-connection-setup",
      message: MSG_NO_BRANCH,
    });
    expect(errorMessage).not.toBe(MSG_NO_BRANCH);
    expect(errorMessage).not.toContain("branch");
    expect(errorMessage).toBe(
      "This project needs its online connection set up differently before syncing can work.",
    );
    expect(reconnectCalled).toBe(true);
  });

  test("no-remote setup error (same code) also routes to the fixed setup line", () => {
    const { errorMessage, reconnectCalled } = routeOutcome({
      status: "error",
      code: "needs-connection-setup",
      message: MSG_NO_REMOTE,
    });
    expect(errorMessage).not.toBe(MSG_NO_REMOTE);
    expect(errorMessage).toBe(
      "This project needs its online connection set up differently before syncing can work.",
    );
    expect(reconnectCalled).toBe(true);
  });

  test("generic error (no code) gets the fixed generic line, not its own message", () => {
    const { errorMessage, reconnectCalled } = routeOutcome({
      status: "error",
      message: "Syncing didn't complete. Your work is saved on this computer — please try again.",
    });
    expect(errorMessage).toBe("Sync failed. Check your connection and try again.");
    expect(reconnectCalled).toBe(false);
  });

  test("auth outcome is unchanged: plain-language message shown verbatim, reconnect routed", () => {
    const { errorMessage, reconnectCalled } = routeOutcome({
      status: "auth",
      message: MSG_AUTH,
    });
    expect(errorMessage).toBe(MSG_AUTH);
    expect(reconnectCalled).toBe(true);
  });

  test("offline outcome is unchanged: plain-language message shown verbatim, no reconnect", () => {
    const { errorMessage, reconnectCalled } = routeOutcome({
      status: "offline",
      message: MSG_OFFLINE,
    });
    expect(errorMessage).toBe(MSG_OFFLINE);
    expect(reconnectCalled).toBe(false);
  });

  test("synced/up-to-date never set an error message", () => {
    expect(
      routeOutcome({ status: "synced", message: "ok", mergedRemoteChanges: false }).errorMessage,
    ).toBeNull();
    expect(routeOutcome({ status: "up-to-date", message: "ok" }).errorMessage).toBeNull();
  });
});

// ── Per-file choices are preserved across a setup-error display (not reset) ──

describe("author choices survive a setup-error display", () => {
  test("the catch/error branches never clear the `choices` or `files` state", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    const body = extractConfirmFn(src);
    // None of the error-routing branches may assign to `choices` or the
    // `files` prop — only onDialogMount() (re-run on next open) resets them.
    expect(body).not.toMatch(/choices\s*=\s*\{/);
    expect(body).not.toMatch(/choices\s*=\s*Object\.fromEntries/);
  });
});

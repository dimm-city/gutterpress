/**
 * ConflictChoicesDialog — outcome routing (M3 setup-error + the 2026-08
 * reconflict fix).
 *
 * HISTORY OF THIS FILE — read before weakening anything here:
 *
 * M3 (original): the lib's "project isn't set up right" failures used to be
 * rendered verbatim with a dead-end "Try again". Fixed with the
 * `needs-connection-setup` code + fixed copy + reconnect routing.
 *
 * 2026-08 field incident: the dialog's INLINE if/else routing silently
 * swallowed `status: "conflict"` — the lib's designed answer when the online
 * copy moves again while the dialog is open — into the generic error arm, so
 * a real author was dead-ended forever (every retry re-submitted the same
 * stale ids). This file's own "logic simulation" could not catch that,
 * because it asserted against a HAND-COPIED mirror of the routing whose type
 * also omitted "conflict": a mirror inherits the blind spots of what it
 * mirrors.
 *
 * The fix — and this file's current strategy — removes the mirror entirely:
 *
 *   1. The routing now lives in `src/lib/components/resolve-outcome.ts`, an
 *      exhaustively-switched pure module. These tests import THE REAL
 *      FUNCTION. Never re-add a local re-implementation of the routing.
 *   2. `routeResolveOutcome`'s switch takes `never` in its default arm, so a
 *      new `SyncOutcome` status that isn't routed is a COMPILE error before
 *      it can become a runtime fall-through.
 *   3. A source-scan locks the component to consuming the router (no inline
 *      status routing creeping back in).
 */

import { describe, test, expect } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";

import {
  routeResolveOutcome,
  RESOLVE_FAILED_MESSAGE,
  RESOLVE_SETUP_MESSAGE,
} from "../../src/lib/components/resolve-outcome";
import type { SyncOutcome } from "../../src/lib/platform/contract";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/ConflictChoicesDialog.svelte",
);

// Copied verbatim from packages/cli/src/lib/remote-auth/sync-messages.ts —
// deliberately inlined (not imported) so this desktop test never value-imports
// the lib package (PWA-clean rule applies to the SPA source; kept consistent
// here too rather than reaching across the workspace boundary).
const MSG_SSH_REMOTE =
  "This project's online address uses SSH (git@…), which Gutterpress can't sync to. Switch it to the web (HTTPS) address to sync from here.";
const MSG_NO_BRANCH =
  "This project's version history isn't on a named branch, so it can't be synced right now.";
const MSG_NO_REMOTE = "This project isn't connected to an online repository yet.";
const MSG_AUTH =
  "The online repository didn't accept the saved connection. Reconnect and try again.";
const MSG_OFFLINE =
  "Your changes are saved on this computer. Gutterpress couldn't reach the online repository — try syncing again when you're back online.";
const MSG_RACE =
  "Someone else synced changes at the same moment. Your work is saved on this computer — please try Sync again.";
const MSG_EXPIRED_CHOICES =
  "Those combine choices have expired. Please run Sync again.";

// ── The REAL router — every outcome the lib can return, no mirrors ───────────

describe("routeResolveOutcome (the real shared router)", () => {
  test("synced → done with mergedRemoteChanges", () => {
    expect(
      routeResolveOutcome({ status: "synced", message: "ok", mergedRemoteChanges: true }),
    ).toEqual({ kind: "done", mergedRemoteChanges: true });
  });

  test("up-to-date → done without merged changes", () => {
    expect(routeResolveOutcome({ status: "up-to-date", message: "ok" })).toEqual({
      kind: "done",
      mergedRemoteChanges: false,
    });
  });

  test("conflict → reconflict carrying the FRESH files and ids (2026-08 field incident)", () => {
    // The lib returns this when the online copy moved again mid-decision:
    // pushWithRaceRecovery hands back a fresh conflict with the NEW tip so
    // "the author never sees a dead-end 'try again'". The old inline routing
    // dropped it into the generic error arm.
    const files = [{ path: "chapter-02.md", kind: "both-edited" as const }];
    const outcome: SyncOutcome = {
      status: "conflict",
      message: "changed in two places",
      files,
      localId: "a".repeat(40),
      remoteId: "b".repeat(40),
    };
    expect(routeResolveOutcome(outcome)).toEqual({
      kind: "reconflict",
      files,
      localId: "a".repeat(40),
      remoteId: "b".repeat(40),
    });
  });

  test("auth → auth with the lib's plain-language message", () => {
    expect(routeResolveOutcome({ status: "auth", message: MSG_AUTH })).toEqual({
      kind: "auth",
      message: MSG_AUTH,
    });
  });

  test("offline → offline with the lib's plain-language message", () => {
    expect(routeResolveOutcome({ status: "offline", message: MSG_OFFLINE })).toEqual({
      kind: "offline",
      message: MSG_OFFLINE,
    });
  });

  test("error + needs-connection-setup → fixed setup copy, NEVER the raw lib message", () => {
    for (const raw of [MSG_SSH_REMOTE, MSG_NO_BRANCH, MSG_NO_REMOTE]) {
      const action = routeResolveOutcome({
        status: "error",
        code: "needs-connection-setup",
        message: raw,
      });
      expect(action.kind).toBe("connection-setup");
      if (action.kind !== "connection-setup") throw new Error("unreachable");
      expect(action.message).toBe(RESOLVE_SETUP_MESSAGE);
      expect(action.message).not.toContain("SSH");
      expect(action.message).not.toContain("git@");
      expect(action.message).not.toContain("branch");
    }
  });

  test('error + "race" → sync-again with the author-language race message', () => {
    // Retrying the SAME stale resolution can never succeed; the router must
    // demand a fresh sync, and the lib's message (author-language by
    // construction) says exactly that.
    expect(
      routeResolveOutcome({ status: "error", code: "race", message: MSG_RACE }),
    ).toEqual({ kind: "sync-again", message: MSG_RACE });
  });

  test('error + "expired-choices" → sync-again with the expired-choices message', () => {
    expect(
      routeResolveOutcome({
        status: "error",
        code: "expired-choices",
        message: MSG_EXPIRED_CHOICES,
      }),
    ).toEqual({ kind: "sync-again", message: MSG_EXPIRED_CHOICES });
  });

  test("error without a code → fixed friendly copy, never the raw message", () => {
    const action = routeResolveOutcome({
      status: "error",
      message: "TypeError: fetch failed at GitRemoteHTTP.discover (…)",
    });
    expect(action).toEqual({ kind: "failed", message: RESOLVE_FAILED_MESSAGE });
    expect(RESOLVE_FAILED_MESSAGE).not.toContain("TypeError");
    // The old copy promised "we'll try again later" — false for this dialog
    // (nothing retries a failed resolution on its own). The copy must state
    // the work is safe without promising an automatic retry.
    expect(RESOLVE_FAILED_MESSAGE).toContain("Your work is saved on this computer");
    expect(RESOLVE_FAILED_MESSAGE).not.toContain("we'll try again later");
  });
});

// ── Source scans — the component consumes the router, no inline routing ──────

describe("ConflictChoicesDialog source — routing shape", () => {
  test("confirm() routes through routeResolveOutcome (the shared exhaustive router)", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    expect(src).toContain('import { routeResolveOutcome } from "$lib/components/resolve-outcome"');
    expect(src).toContain("routeResolveOutcome(outcome)");
    // No inline status routing left in the component: every decision is the
    // router's. (`outcome.status`/`outcome.code` reads in the component were
    // exactly how the unrouted-"conflict" hole appeared.)
    expect(src).not.toContain("outcome.status ===");
    expect(src).not.toContain("outcome.code ===");
  });

  test("a reconflict re-renders the choices (fresh files/ids) — never the dead-end error", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    expect(src).toContain('case "reconflict":');
    expect(src).toContain("onReconflict?.(action.files, action.localId, action.remoteId)");
    // …and returns the dialog to the choosing phase with rebuilt defaults.
    expect(src).toMatch(/case "reconflict":[\s\S]*?phase = "choosing";/);
  });

  test('the sync-again error state offers "Sync again" (fresh ids), not a blind retry', async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    expect(src).toContain('errorKind === "sync-again"');
    // The affordance re-uses the ids-fetch path (fresh sync → fresh ids).
    expect(src).toMatch(/function syncAgain\(\)[\s\S]*?onRetryIds\?\.\(\)/);
  });

  test("the connection-setup and auth branches both route to onReconnect", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    const reconnectCalls = src.match(/onReconnect\?\.\(\)/g) ?? [];
    expect(reconnectCalls.length).toBeGreaterThanOrEqual(2);
  });

  test("the raw lib setup-error strings never appear in the component or router source", async () => {
    const routerSrc = await readFile(
      path.resolve(__dirname, "../../src/lib/components/resolve-outcome.ts"),
      "utf-8",
    );
    const componentSrc = await readFile(COMPONENT_PATH, "utf-8");
    for (const src of [routerSrc, componentSrc]) {
      expect(src).not.toContain(MSG_SSH_REMOTE);
      expect(src).not.toContain(MSG_NO_BRANCH);
      expect(src).not.toContain(MSG_NO_REMOTE);
    }
  });
});

// ── Author choices survive an error display (not reset) ──────────────────────

describe("author choices survive an error display", () => {
  test("only the reconflict branch may rebuild `choices` — error branches never touch them", async () => {
    const src = await readFile(COMPONENT_PATH, "utf-8");
    // Exactly three rebuild sites: onDialogMount (next open), setAll (an
    // explicit user action), and the reconflict branch (the file list itself
    // changed, so stale choices would be wrong). No error branch resets them.
    const rebuilds = src.match(/choices = Object\.fromEntries/g) ?? [];
    expect(rebuilds).toHaveLength(3);
    // The reconflict rebuild is inside the reconflict case, nowhere else in confirm().
    expect(src).toMatch(/case "reconflict":[\s\S]{0,400}choices = Object\.fromEntries/);
  });
});

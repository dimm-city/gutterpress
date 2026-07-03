/**
 * Unit tests for outcome-mapping.ts — the shared SyncOutcome/PullOutcome →
 * RecoveryResult translator used by the five thin recovery handlers.
 *
 * These pin:
 *   1. syncOptionsFrom(ctx) copies exactly the five sync fields.
 *   2. The DEFAULT outcome map (documented in the module header).
 *   3. Overrides win over the default for their status.
 *   4. An unknown/future status routes to the error builder (override first).
 *
 * Pure unit test — no on-disk git; outcomes are constructed literals and the
 * context is a minimal stub (only repoSlug/remoteUrl are read, by
 * makeManualGuidance).
 */

import { describe, expect, test } from "bun:test";

import {
  RETRY_AFTER_MS,
  mapOutcomeToResult,
  syncOptionsFrom,
} from "./outcome-mapping.ts";
import type { AnyOutcome } from "./outcome-mapping.ts";
import type { RecoveryContext } from "./types.ts";

function makeCtx(overrides: Partial<RecoveryContext> = {}): RecoveryContext {
  return {
    projectDir: "/proj",
    repoDir: "/proj",
    branch: "main",
    remoteUrl: "https://github.com/acme/book.git",
    repoSlug: "book",
    credential: { host: "github.com", token: "tok" } as any,
    tokenStore: { get: async () => null } as any,
    authorName: "Alice",
    httpClient: {} as any,
    confirmation: { confirmRepair: async () => true },
    ...overrides,
  };
}

describe("syncOptionsFrom", () => {
  test("copies exactly the five sync fields from the context", () => {
    const ctx = makeCtx();
    const opts = syncOptionsFrom(ctx);
    expect(opts).toEqual({
      projectDir: ctx.projectDir,
      credential: ctx.credential,
      tokenStore: ctx.tokenStore,
      authorName: ctx.authorName,
      httpClient: ctx.httpClient,
    });
    // No stray keys (e.g. repoDir/branch/confirmation) leak into sync options.
    expect(Object.keys(opts).sort()).toEqual([
      "authorName",
      "credential",
      "httpClient",
      "projectDir",
      "tokenStore",
    ]);
  });
});

describe("mapOutcomeToResult — DEFAULT map", () => {
  const ctx = makeCtx();

  test("synced → recovered with the outcome message", () => {
    const outcome: AnyOutcome = {
      status: "synced",
      message: "All synced.",
      mergedRemoteChanges: false,
    };
    expect(mapOutcomeToResult(ctx, outcome)).toEqual({
      status: "recovered",
      message: "All synced.",
    });
  });

  test("pulled → recovered with the outcome message", () => {
    const outcome: AnyOutcome = {
      status: "pulled",
      message: "Downloaded.",
      merged: false,
      filesChanged: true,
    };
    expect(mapOutcomeToResult(ctx, outcome)).toEqual({
      status: "recovered",
      message: "Downloaded.",
    });
  });

  test("up-to-date → recovered with the outcome message", () => {
    const outcome: AnyOutcome = { status: "up-to-date", message: "Nothing to do." };
    expect(mapOutcomeToResult(ctx, outcome)).toEqual({
      status: "recovered",
      message: "Nothing to do.",
    });
  });

  test("conflict → needs_user with merge_conflict guidance and files", () => {
    const outcome: AnyOutcome = {
      status: "conflict",
      message: "Clash.",
      files: [{ path: "a.md", kind: "both-modified" as any }],
      localId: "local1",
      remoteId: "remote1",
    };
    const result = mapOutcomeToResult(ctx, outcome);
    expect(result.status).toBe("needs_user");
    if (result.status !== "needs_user") throw new Error("unreachable");
    expect(result.message).toBe("Clash.");
    expect(result.files).toEqual([{ path: "a.md", kind: "both-modified" }] as any);
    expect(result.guidance.recommendedActionKey).toBe("resolve_conflict");
  });

  test("auth → needs_user with auth_required guidance", () => {
    const outcome: AnyOutcome = { status: "auth", message: "Rejected." };
    const result = mapOutcomeToResult(ctx, outcome);
    expect(result.status).toBe("needs_user");
    if (result.status !== "needs_user") throw new Error("unreachable");
    expect(result.message).toBe("Rejected.");
    expect(result.guidance.recommendedActionKey).toBe("reconnect");
  });

  test("offline → retry_later with the fixed backoff", () => {
    const outcome: AnyOutcome = { status: "offline", message: "No network." };
    expect(mapOutcomeToResult(ctx, outcome)).toEqual({
      status: "retry_later",
      message: "No network.",
      retryAfterMs: RETRY_AFTER_MS,
    });
  });

  test("error → failed_no_changes_made with unknown guidance", () => {
    const outcome: AnyOutcome = { status: "error", message: "Boom." };
    const result = mapOutcomeToResult(ctx, outcome);
    expect(result.status).toBe("failed_no_changes_made");
    if (result.status !== "failed_no_changes_made") throw new Error("unreachable");
    expect(result.message).toBe("Boom.");
    expect(result.guidance).toBeDefined();
  });

  test("unknown/future status routes to the error builder", () => {
    const outcome = { status: "totally-new", message: "Future." } as unknown as AnyOutcome;
    const result = mapOutcomeToResult(ctx, outcome);
    expect(result.status).toBe("failed_no_changes_made");
  });
});

describe("mapOutcomeToResult — overrides win", () => {
  const ctx = makeCtx();

  test("a per-status override replaces the default for that status", () => {
    const outcome: AnyOutcome = { status: "offline", message: "No network." };
    const result = mapOutcomeToResult(ctx, outcome, {
      offline: (_c, o) => ({
        status: "needs_user",
        message: `custom:${o.message}`,
        guidance: { } as any,
      }),
    });
    expect(result.status).toBe("needs_user");
    if (result.status !== "needs_user") throw new Error("unreachable");
    expect(result.message).toBe("custom:No network.");
  });

  test("statuses without an override still use the default", () => {
    const outcome: AnyOutcome = { status: "synced", message: "ok", mergedRemoteChanges: false };
    const result = mapOutcomeToResult(ctx, outcome, {
      offline: () => ({ status: "recovered", message: "unused" }),
    });
    expect(result).toEqual({ status: "recovered", message: "ok" });
  });

  test("an error override handles both 'error' and unknown statuses", () => {
    const errOverride = (_c: RecoveryContext, o: AnyOutcome) =>
      ({ status: "retry_later", message: o.message, retryAfterMs: 1 }) as const;

    const errResult = mapOutcomeToResult(
      ctx,
      { status: "error", message: "e" },
      { error: errOverride },
    );
    expect(errResult).toEqual({ status: "retry_later", message: "e", retryAfterMs: 1 });

    const unknownResult = mapOutcomeToResult(
      ctx,
      { status: "weird", message: "w" } as unknown as AnyOutcome,
      { error: errOverride },
    );
    expect(unknownResult).toEqual({ status: "retry_later", message: "w", retryAfterMs: 1 });
  });
});

/**
 * resolve-outcome.ts — the ONE routing table for a `resolveSyncConflicts`
 * outcome, consumed by `ConflictChoicesDialog.svelte`.
 *
 * WHY THIS MODULE EXISTS (2026-08 field incident)
 * -----------------------------------------------
 * The dialog used to route outcomes with an inline if/else chain whose final
 * `else` swallowed every status it didn't name — including `"conflict"`, the
 * lib's DESIGNED answer when the online copy moves again while the choices
 * dialog is open (see `pushWithRaceRecovery` in the lib's
 * conflict-resolution.ts: "the UI re-renders the choices screen from a
 * conflict outcome, so the author never sees a dead-end 'try again'"). The UI
 * half of that contract was never built, so a real author hit an unresolvable
 * loop: every choice → the generic error → "Try again" with the same stale
 * ids → the same error, forever.
 *
 * The unit test of the day could not catch it because it asserted against a
 * hand-copied SIMULATION of the routing whose type also omitted "conflict" —
 * a mirror inherits the blind spots of what it mirrors. This module fixes the
 * defect CLASS, not just the instance:
 *
 *   1. The routing is a real exported function; the component and the tests
 *      import the SAME code. No more mirrors.
 *   2. The `switch` is exhaustive at compile time (`assertRouted` takes
 *      `never`): adding a status to `SyncOutcome` without routing it here is
 *      a type error, not a silent fall-through.
 *   3. The `error` arm routes by the lib's machine-readable `code`, with its
 *      own exhaustiveness guard, instead of collapsing every cause into one
 *      misleading string.
 *
 * PWA-clean: type-only imports, zero host/Node code (CLAUDE.md §8).
 */
import type { ConflictFileInfo, SyncOutcome } from "../platform/contract";

/** Fixed copy for the connection-setup error (never the lib's raw wording). */
export const RESOLVE_SETUP_MESSAGE =
  "This project needs its online connection set up differently before syncing can work.";

/**
 * Fixed copy for an unexpected failure. Honest about what happens next: the
 * author decides to retry — nothing retries "later" on its own (the old copy
 * promised "we'll try again later", which was false for this dialog).
 */
export const RESOLVE_FAILED_MESSAGE =
  "Couldn't update the online copy. Your work is saved on this computer — nothing is lost. You can try again.";

/** What the dialog should do with a `resolveSyncConflicts` outcome. */
export type ResolveOutcomeAction =
  /** Resolved and synced (or nothing left to do) — close the dialog. */
  | { kind: "done"; mergedRemoteChanges: boolean }
  /**
   * The online copy changed again while the author was deciding: re-render
   * the choices screen against the FRESH files and ids. Never a dead end.
   */
  | {
      kind: "reconflict";
      files: ConflictFileInfo[];
      localId: string;
      remoteId: string;
    }
  /** Credential problem — show the lib's plain-language message, offer reconnect. */
  | { kind: "auth"; message: string }
  /** Offline — show the lib's plain-language message; retry when connected. */
  | { kind: "offline"; message: string }
  /** The project's online connection itself is wrong — route to setup. */
  | { kind: "connection-setup"; message: string }
  /**
   * The resolution can't succeed with the ids in hand (a race exhausted its
   * recovery pass, or the ids expired). The lib's message is author-language
   * by construction; the correct affordance is "Sync again" (fetch FRESH
   * ids), never a blind retry of the same stale resolution.
   */
  | { kind: "sync-again"; message: string }
  /** Unexpected failure — fixed friendly copy, plain retry offered. */
  | { kind: "failed"; message: string };

/** Compile-time exhaustiveness: unreachable when every status is routed. */
function assertRouted(outcome: never): ResolveOutcomeAction {
  void outcome;
  return { kind: "failed", message: RESOLVE_FAILED_MESSAGE };
}

/** Route one `resolveSyncConflicts` outcome to the dialog action it demands. */
export function routeResolveOutcome(outcome: SyncOutcome): ResolveOutcomeAction {
  switch (outcome.status) {
    case "synced":
      return { kind: "done", mergedRemoteChanges: outcome.mergedRemoteChanges };
    case "up-to-date":
      return { kind: "done", mergedRemoteChanges: false };
    case "conflict":
      return {
        kind: "reconflict",
        files: outcome.files,
        localId: outcome.localId,
        remoteId: outcome.remoteId,
      };
    case "auth":
      // Already plain-language (lib redaction invariant) — safe to render.
      return { kind: "auth", message: outcome.message };
    case "offline":
      return { kind: "offline", message: outcome.message };
    case "error": {
      const code = outcome.code;
      if (code === "needs-connection-setup") {
        // Never render outcome.message here — it carries the lib's technical
        // wording for the no-remote/SSH/no-branch cases.
        return { kind: "connection-setup", message: RESOLVE_SETUP_MESSAGE };
      }
      if (code === "race" || code === "expired-choices") {
        // Author-language by construction (MSG_RACE / MSG_EXPIRED_CHOICES).
        return { kind: "sync-again", message: outcome.message };
      }
      // Exhaustiveness over the code union: a NEW code added to SyncOutcome
      // without a route above turns this assignment into a type error.
      const unrouted: undefined = code;
      void unrouted;
      return { kind: "failed", message: RESOLVE_FAILED_MESSAGE };
    }
    default:
      return assertRouted(outcome);
  }
}

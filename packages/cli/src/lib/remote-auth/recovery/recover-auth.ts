/**
 * recover-auth.ts — Auth failure: clear the bad credential, ask the author
 * to reconnect.
 *
 * WHY this module exists: when the remote rejects the saved connection
 * (401 / 403), the right behavior is:
 *
 *   1. Attempt sync so the snapshot-first invariant (ADR 0006 D5) still runs
 *      if possible — any unsaved local work gets committed before the network
 *      call, so nothing is lost regardless of what the server says.
 *   2. If the result is `auth`, delete the stale credential from the token
 *      store so the next reconnect flow starts clean.
 *   3. Return `needs_user` with plain-language reconnect guidance.
 *      recommendedAction is always "Reconnect" — no git words, no tokens.
 *   4. Never create a backup zip (policy.createBackup = false for auth_required
 *      — there is nothing locally at risk; the author's work is already
 *      committed by the snapshot-first step in sync.ts).
 *   5. Never ask for confirmation (no repair changes anything).
 *   6. Never force-push (syncProject / pushChanges never does this either).
 *
 * This is a THIN WRAPPER around syncProject from sync.ts. The snapshot step,
 * the network call, and the "auth" classification all live there. The only
 * delta this module adds is:
 *   - Calling ctx.tokenStore.delete(host) when the outcome is `auth`.
 *   - Translating SyncOutcome { status: "auth" } → RecoveryResult { status:
 *     "needs_user" } with the auth_required ManualGuidance.
 */

import { syncProject } from "../sync.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { mapOutcomeToResult, syncOptionsFrom } from "./outcome-mapping.ts";
import type { RecoveryContext, RecoveryResult } from "./types.ts";

// ── Host extraction ──────────────────────────────────────────────────────────

/**
 * Extract the host key that the token store uses from a remote URL or from
 * ctx.credential. Returns null when neither is available (best-effort clear).
 *
 * The token store keys credentials by host, optionally including the port:
 *   "github.com"          → "github.com"
 *   "127.0.0.1:9418"      → "127.0.0.1:9418"
 *
 * We prefer ctx.credential.host (already normalized by the store at save
 * time) over a freshly parsed URL so the key matches exactly.
 */
function hostKeyFor(ctx: RecoveryContext): string | null {
  // Prefer the credential's stored host — it was already normalized by the
  // token store when the credential was written.
  if (ctx.credential?.host) {
    return ctx.credential.host.toLowerCase();
  }
  // Fall back to parsing the remote URL.
  if (ctx.remoteUrl) {
    try {
      const parsed = new URL(ctx.remoteUrl);
      return (
        parsed.port
          ? `${parsed.hostname}:${parsed.port}`
          : parsed.hostname
      ).toLowerCase();
    } catch {
      return null;
    }
  }
  return null;
}

// ── RecoverFn implementation ─────────────────────────────────────────────────

/**
 * Handle an `auth_required` classification.
 *
 * - Delegates the sync attempt (including the snapshot-first step) to
 *   `syncProject` from sync.ts.
 * - On `auth` outcome: clears the bad credential from ctx.tokenStore (best-
 *   effort — missing store is silently ignored) and returns `needs_user` with
 *   author-friendly reconnect guidance.
 * - On any successful outcome (the good-credential path): returns `recovered`
 *   so the host can refresh. The credential is NOT cleared on success.
 * - On other failure outcomes (offline, conflict, error): passes through an
 *   appropriate RecoveryResult without touching the credential store.
 */
export async function recover(
  ctx: RecoveryContext,
  _error?: unknown,
): Promise<RecoveryResult> {
  const outcome = await syncProject(syncOptionsFrom(ctx));

  if (outcome.status === "auth") {
    // Clear the stale credential so the next reconnect flow starts fresh.
    // Best-effort — a store failure must not block the guidance response.
    const host = hostKeyFor(ctx);
    if (host && ctx.tokenStore) {
      try {
        await ctx.tokenStore.delete(host);
      } catch {
        // Ignored on purpose.
      }
    }
  }

  // Default map handles synced/up-to-date → recovered and conflict →
  // needs_user (merge_conflict). This handler intentionally differs on:
  //   - auth:    author-friendly reconnect copy (not outcome.message).
  //   - offline: needs_user with network guidance (not retry_later) — an auth
  //              recovery pass should hand a network problem to the user.
  //   - error:   needs_user with a safe generic fallback (not
  //              failed_no_changes_made) — nothing changed.
  return mapOutcomeToResult(ctx, outcome, {
    auth: (c) => ({
      status: "needs_user",
      message:
        "The online repository didn't accept the saved connection. Please reconnect your account to continue syncing.",
      guidance: makeManualGuidance(c, "auth_required"),
    }),
    offline: (c) => ({
      status: "needs_user",
      message:
        "Your work is saved on this computer. Check your connection and try syncing again.",
      guidance: makeManualGuidance(c, "network_unavailable"),
    }),
    error: (c) => ({
      status: "needs_user",
      message:
        "Something went wrong while trying to sync. Your work is saved on this computer.",
      guidance: makeManualGuidance(c, "unknown"),
    }),
  });
}

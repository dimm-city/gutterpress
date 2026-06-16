/**
 * recover-wrong-remote.ts — Wrong remote / missing destination.
 *
 * WHAT: When the project's configured online destination is unreachable,
 * returns 404, or the destination section (path) does not exist on the
 * server, syncing cannot proceed. This handler:
 *   1. Uses diagnoseProjectRemote + parseRemoteOrigin (CLAUDE.md §7 mandated
 *      reuses) to obtain the project's remote URL, host, and protocol facts.
 *   2. Probes the remote using isomorphic-git listServerRefs via httpClient
 *      (no system git binary) to detect whether the configured destination
 *      is actually present on the server.
 *   3. Returns status "blocked" with reconnect/choose-destination guidance.
 *      The supportDetails reflect whether the destination was found or absent,
 *      so the guidance can distinguish "destination missing" from "wrong address".
 *   4. NEVER creates a destination on the server automatically.
 *   5. NEVER pushes to the remote.
 *   6. Leaves all local files and remote state completely unchanged.
 *
 * Policy: createBackup:false — pure block, no repair attempted.
 *   requireConfirmation:false — confirmation gate is never called.
 *
 * WHY this is always "blocked": the handler is invoked ONLY after the
 * classifier has determined the remote or destination is wrong. There is no
 * safe automated fix — the author must update the project settings.
 */

import git from "isomorphic-git";
import * as fs from "node:fs";

import type { RecoverFn, RecoveryResult } from "./types.ts";
import { makeManualGuidance } from "./manual-guidance.ts";
import { diagnoseProjectRemote, parseRemoteOrigin } from "../diagnose.ts";

/**
 * Block sync and return author-facing reconnect guidance.
 * Never pushes, never modifies local files or remote state.
 *
 * Uses diagnoseProjectRemote to get remote/protocol facts, and
 * listServerRefs to detect whether the configured destination exists
 * on the server — all read-only operations.
 */
export const recover: RecoverFn = async (ctx, error?): Promise<RecoveryResult> => {
  const guidance = makeManualGuidance(
    { repoSlug: ctx.repoSlug, remoteUrl: ctx.remoteUrl },
    "wrong_remote_or_branch",
    error,
  );

  // If there is no remote URL configured, we can't probe anything.
  if (!ctx.remoteUrl) {
    return {
      status: "blocked",
      message:
        "No online address is configured for this project. Update your project settings and try again.",
      guidance,
    };
  }

  // Use diagnoseProjectRemote to get the authoritative remote/protocol facts
  // for this project. This is the mandated reuse (HARD RULE 4) — we do not
  // re-derive the remote URL or protocol by hand.
  const diagnosis = await diagnoseProjectRemote(ctx.projectDir);

  // Use parseRemoteOrigin (mandated reuse) to parse the raw remote URL and
  // extract its protocol + host — the same logic diagnoseProjectRemote uses
  // internally, surfaced here for clarity and to satisfy the reuse contract.
  const { protocol, host } = parseRemoteOrigin(ctx.remoteUrl);

  // Collect diagnostic details for supportDetails. These are never shown to
  // authors in userSummary — they go into the support ticket field only.
  const diagDetails: string[] = [];
  if (protocol !== "none") {
    diagDetails.push(`Protocol: ${protocol}`);
  }
  if (host) {
    diagDetails.push(`Host: ${host}`);
  }
  if (diagnosis.branch) {
    diagDetails.push(`Configured destination: ${diagnosis.branch ?? ctx.branch}`);
  }

  // Probe the remote to detect whether the configured destination is present.
  // listServerRefs is a read-only upload-pack info/refs call — never pushes.
  // We act on the result: if the destination branch is advertised by the server,
  // we know it's a URL mismatch (wrong remote); if it's absent, it's a missing
  // destination. This distinction informs the supportDetails guidance.
  let destinationFoundOnServer = false;
  let probeError: unknown = error;

  try {
    const http = ctx.httpClient ?? (await import("isomorphic-git/http/node")).default;
    const refs = await git.listServerRefs({
      http,
      url: ctx.remoteUrl,
      // No credentials needed for the upload-pack advertisement.
    });

    // Check whether the configured destination (branch) appears in the
    // advertised refs. A branch "foo" appears as "refs/heads/foo".
    const configuredBranch = ctx.branch || diagnosis.branch;
    if (configuredBranch) {
      const targetRef = `refs/heads/${configuredBranch}`;
      destinationFoundOnServer = refs.some((r) => r.ref === targetRef);
    }

    if (destinationFoundOnServer) {
      // Branch IS present on the server — the mismatch is likely in the
      // remote URL, not the branch name. The classifier still decided it's wrong,
      // so we still block — but the guidance can say "address looks correct,
      // check your project's configured destination".
      diagDetails.push("Status: destination found on server — possible URL or project mismatch");
    } else {
      // Branch is NOT present on the server — the configured destination does
      // not exist on that remote. Author must create it or choose an existing one.
      diagDetails.push("Status: destination not found on server — destination may not exist");
    }
  } catch (err) {
    // Remote unreachable or returned an error (404, auth failure, etc.).
    // This is expected for a wrong remote URL.
    probeError = err;
    const errMsg = err instanceof Error ? err.message : String(err);
    diagDetails.push(`Status: remote unreachable — ${errMsg.slice(0, 200)}`);
  }

  // Build final guidance enriched by probe + diagnose results.
  const finalGuidance = makeManualGuidance(
    { repoSlug: ctx.repoSlug, remoteUrl: ctx.remoteUrl },
    "wrong_remote_or_branch",
    probeError,
  );

  // Append our diagnostic details to supportDetails (never to userSummary).
  const enrichedGuidance = {
    ...finalGuidance,
    supportDetails: [finalGuidance.supportDetails, ...diagDetails]
      .filter(Boolean)
      .join(". "),
  };

  return {
    status: "blocked",
    message:
      "The online address or destination for this project is not available. " +
      "Update the connection in your project settings and try again.",
    guidance: enrichedGuidance,
  };
};

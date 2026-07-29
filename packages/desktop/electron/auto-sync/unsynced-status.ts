/**
 * unsynced-status.ts — the ONE rule for which ambient sync state a
 * local-git project that is NOT auto-syncing should surface.
 *
 * The old behavior collapsed three different situations into a single
 * `"local"` emit ("kept on this computer"): no remote at all, an SSH-only
 * remote, and — the modal case for repos cloned outside Gutterpress — an HTTPS
 * remote that Gutterpress simply holds no credential for. The last one is a
 * single connect step away from syncing, and telling that writer their book
 * is "kept on this computer" misread as a remote-detection bug (it was
 * reported as exactly that). The `"connect"` state lets the renderer surface
 * a Connect action instead.
 *
 * Shared by the preview-open one-shot status emit (preview/controller.ts) and
 * the credential-change re-diagnosis (main.ts) so the two emit sites cannot
 * drift. Node/host-side only.
 */

/** The diagnosis slice this rule reads (lib `ProjectRemoteDiagnosis` subset). */
export interface UnsyncedDiagnosis {
  canSync: boolean;
  remoteProtocol: "https" | "ssh" | "none";
  credentialPresent: boolean;
}

/**
 * Pick the ambient state for a project the auto-sync engine will NOT sync
 * (`diag.canSync === false`):
 *
 *   - HTTPS remote, no credential → `"connect"` (one step from syncing)
 *   - anything else (no remote / SSH-only) → `"local"` (version history only)
 */
export function unsyncedStateFor(diag: UnsyncedDiagnosis): "connect" | "local" {
  if (diag.remoteProtocol === "https" && !diag.credentialPresent) return "connect";
  return "local";
}

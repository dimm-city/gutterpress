/**
 * remote:connectGitHubStart / remote:connectGitHubWait /
 * remote:connectGitHubCancel — IPC handlers for the managed GitHub OAuth
 * device flow (#15), extracted from electron/main.ts (SFE-P6b). "ADR 0006"
 * does not exist in this repository (`docs/adr/` holds 0008 through 0016 —
 * see ADR 0009's "Note on predecessors" and the deletion ledger's SFE-P6c
 * "Stale ADR references NOT resolved" entry); no ADR added by this run
 * covers the managed-GitHub-integration/device-flow topic either, so this
 * comment names the feature by issue number only rather than repeating a
 * citation to a record that was never authored.
 *
 * These three channels are the one part of the "remote" bounded context
 * `electron/api/remote.ts` does NOT register (see that module's header):
 * they close over a live `GitHubDeviceFlow` instance and the Linux-keyring
 * protection notice dialog, both composed in main.ts from resources
 * (`mainWindow`, `electronTokenStore`) `electron/api/remote.ts`'s
 * `getRemoteHooks()` pattern doesn't carry. main.ts passes both in
 * explicitly rather than this module reaching back into main.ts's private
 * scope.
 */
import { handleRemoteErrors } from "./server-bridge/friendly-errors";
import type { GitHubDeviceFlow } from "./github-device-flow";
import type { SecureHandle } from "./server-bridge/secure-handle";

export interface GitHubDeviceFlowRegistrarDeps {
  githubDeviceFlow: GitHubDeviceFlow;
  /** Shows the Linux basic-text-storage protection notice at most once. */
  showLinuxCredentialStorageNoticeOnce(): Promise<void>;
}

export function registerGitHubDeviceFlowHandlers(
  secureHandle: SecureHandle,
  deps: GitHubDeviceFlowRegistrarDeps,
): void {
  secureHandle("remote:connectGitHubStart", () =>
    handleRemoteErrors("remote:connectGitHubStart", async () => {
      const info = await deps.githubDeviceFlow.start();
      await deps.showLinuxCredentialStorageNoticeOnce();
      return info;
    }),
  );

  secureHandle("remote:connectGitHubWait", () =>
    handleRemoteErrors("remote:connectGitHubWait", () => deps.githubDeviceFlow.wait()),
  );

  secureHandle("remote:connectGitHubCancel", async () => deps.githubDeviceFlow.cancel());
}

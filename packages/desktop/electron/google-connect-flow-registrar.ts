/**
 * publish:connectGoogleStart / publish:connectGoogleWait /
 * publish:connectGoogleCancel — IPC handlers for the Google Drive publish
 * provider's OAuth connect trio (#221, docs/gdrive-publish-plan.md D10), the
 * publish-side twin of ./github-device-flow-registrar.ts.
 *
 * Like that registrar, this is the one part of its bounded context
 * `electron/api/publish.ts` does NOT register: the three channels close over
 * a live `GoogleConnectFlow` instance composed in main.ts from resources
 * (`electronTokenStore`, the http(s)-only `shell.openExternal` gate) that
 * `electron/api/publish.ts`'s `getRemoteHooks()` pattern doesn't carry, so
 * main.ts passes the instance in explicitly rather than this module reaching
 * back into main.ts's private scope.
 */
import { handlePublishErrors } from "./server-bridge/friendly-errors";
import type { GoogleConnectFlow } from "./google-connect-flow";
import type { SecureHandle } from "./server-bridge/secure-handle";

export function registerGoogleConnectFlowHandlers(
  secureHandle: SecureHandle,
  googleConnectFlow: GoogleConnectFlow,
): void {
  secureHandle("publish:connectGoogleStart", (_e, account?: unknown) =>
    handlePublishErrors("publish:connectGoogleStart", () =>
      googleConnectFlow.start(typeof account === "string" && account.trim() ? account.trim() : undefined),
    ),
  );

  secureHandle("publish:connectGoogleWait", () =>
    handlePublishErrors("publish:connectGoogleWait", () => googleConnectFlow.wait()),
  );

  secureHandle("publish:connectGoogleCancel", async () => googleConnectFlow.cancel());
}

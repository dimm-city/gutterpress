/**
 * OS shell integration for the "files/dialog" IPC capability (SFE-P5c1).
 *
 * Ports `src/routes/api/shell/{open-external,show-in-folder}/+server.ts`
 * verbatim.
 */
import { getDesktopHooks } from "../server-bridge/host-hooks";
import { isHttpUrl } from "../navigation-policy";
import { requireAbsolute, requireContainedOrPicked } from "./validation";
import type { SecureHandle } from "../server-bridge/secure-handle";

function hooks() {
  const h = getDesktopHooks();
  if (!h) throw new Error("Desktop hooks not registered");
  return h;
}

/** Open a URL in the system browser. http(s) only (audit C1) — the app's
 *  single http(s)-only gate, shared with decideNavigation/decideWindowOpen. */
export async function shellOpenExternal(rawUrl: unknown): Promise<{ ok: true }> {
  if (!rawUrl || typeof rawUrl !== "string") throw new Error("url is required");
  if (!isHttpUrl(rawUrl)) throw new Error("url must be http(s)");
  await hooks().openExternal(rawUrl);
  return { ok: true };
}

/**
 * Reveal a file in the OS file manager. Accepts a path inside the open
 * project, a read-only root (crash-recovery backup), OR one a native dialog
 * just produced (the exported PDF, at the author-chosen Save destination) —
 * see `requireContainedOrPicked`'s own doc comment for the full policy.
 */
export async function shellShowInFolder(rawFilePath: unknown): Promise<{ ok: true }> {
  const filePath = requireAbsolute(rawFilePath, "shell:showInFolder");
  await requireContainedOrPicked(filePath, "shell:showInFolder", { includeReadOnlyRoots: true });
  hooks().showItemInFolder(filePath);
  return { ok: true };
}

/** Register the shell:* IPC channels (SFE-P6b). */
export function registerShellHandlers(secureHandle: SecureHandle): void {
  secureHandle("shell:openExternal", (_e, url: unknown) => shellOpenExternal(url));
  secureHandle("shell:showInFolder", (_e, filePath: unknown) => shellShowInFolder(filePath));
}

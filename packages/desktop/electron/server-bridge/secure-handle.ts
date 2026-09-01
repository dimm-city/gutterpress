/**
 * `secureHandle` — the shared, sender-validating replacement for
 * `ipcMain.handle`, extracted from electron/main.ts (SFE-P6b) so every
 * per-context registrar module (electron/api/*.ts, and the other thin
 * registrars main.ts composes at startup) can register its own channels
 * without reaching back into main.ts's module-private scope.
 *
 * Every channel in the app is registered through this wrapper, not raw
 * `ipcMain.handle`, so that ALL of them — not some hand-picked subset —
 * reject invocations whose sender frame isn't the app's own origin (ARCH
 * review finding #1). This is what stands between the preload's full IPC
 * bridge (PDF-write, repo clone, preview/watch control, …) and any remote
 * origin that a navigation/popup bug might otherwise let load into a frame.
 *
 * The origin policy itself (which origins count as "trusted") stays a
 * main.ts-owned security-policy concern (it depends on `app.isPackaged` and
 * the dev-server URL gate — see main.ts's own `originPolicyConfig()`).
 * `createSecureHandle` takes it as an injected getter rather than reading
 * Electron `app` state itself, so this module has no lifecycle dependency of
 * its own and every registrar receives the exact same `secureHandle`
 * function main.ts constructs once at startup.
 */
import { ipcMain } from "electron";
import { isTrustedIpcSender, type OriginPolicyConfig } from "../navigation-policy";

/** The generic signature every registrar receives — identical to the
 *  pre-extraction `function secureHandle<Args, R>(...)` main.ts declared
 *  locally, now shared instead of module-private. */
export type SecureHandle = <Args extends unknown[], R>(
  channel: string,
  listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => R,
) => void;

/**
 * Build the shared `secureHandle` function. Called exactly once, in
 * main.ts, with a getter for the live origin policy — every registrar below
 * it (electron/api/*.ts and friends) is handed the SAME function, so there
 * is exactly one sender-validation mechanism for the whole app, not one
 * duplicated per registrar.
 */
export function createSecureHandle(getOriginPolicyConfig: () => OriginPolicyConfig): SecureHandle {
  function secureHandle<Args extends unknown[], R>(
    channel: string,
    listener: (event: Electron.IpcMainInvokeEvent, ...args: Args) => R,
  ): void {
    ipcMain.handle(channel, (event, ...args: Args) => {
      if (!isTrustedIpcSender(event.senderFrame?.url, getOriginPolicyConfig())) {
        console.warn(
          `[ipc] blocked "${channel}" from untrusted sender: ${event.senderFrame?.url ?? "unknown"}`,
        );
        throw new Error(`Blocked: untrusted sender for "${channel}"`);
      }
      return listener(event, ...args);
    });
  }
  return secureHandle;
}

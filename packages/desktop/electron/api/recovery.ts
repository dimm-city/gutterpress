/**
 * Crash-recovery IPC handlers for the "recovery" capability (SFE-P5c4).
 * Ports `src/routes/api/recovery/{write,clear,list}/+server.ts` verbatim:
 * same `RecoveryHooks` bag (`electron/server-bridge/recovery-hooks.ts`,
 * unchanged — its sidecar-store storage lives in the collapsed host object,
 * same rationale as vcs/media/updater), same "hooks not registered" fail-
 * closed check run BEFORE validation (matching the deleted routes'
 * `defineRoute({ hooks, validate, call })` order exactly — same discipline
 * `vcs.ts`/`fs.ts` document), same field validation.
 *
 * D7 (crash-recovery semantics): a recovery-listing failure must not look
 * like an empty store — `recoveryList` THROWS when hooks aren't registered
 * or the underlying store read fails; it never silently resolves to `[]`.
 * `CrashRecoveryController.scan()` (the sole consumer, via
 * `$lib/recovery/recovery-capability.ts`) is the layer that already chose to
 * present a scan failure as "no pending recoveries shown" — that UI decision
 * is unchanged by this transport migration, and is not this module's
 * concern.
 */
import { getRecoveryHooks } from "../server-bridge/recovery-hooks";
import { requireAbsolute } from "./validation";
import type { RecoveryEntry } from "../../src/lib/platform/dtos";
import type { SecureHandle } from "../server-bridge/secure-handle";

function requireHooks() {
  const hooks = getRecoveryHooks();
  if (!hooks) throw new Error("Recovery hooks not registered");
  return hooks;
}

/** Write a debounced crash-recovery snapshot of the open buffer (#44). */
export async function recoveryWrite(
  rawFilePath: unknown,
  rawContent: unknown,
  rawBaseMtimeMs: unknown,
): Promise<{ ok: boolean }> {
  const hooks = requireHooks();
  if (rawContent === undefined) throw new Error("content is required");
  if (typeof rawBaseMtimeMs !== "number") throw new Error("baseMtimeMs must be a number");
  const filePath = requireAbsolute(rawFilePath, "recovery:write");
  return hooks.write(filePath, rawContent as string, rawBaseMtimeMs);
}

/** Clear a recovery snapshot after a successful disk save (#44). */
export async function recoveryClear(rawFilePath: unknown): Promise<{ ok: boolean }> {
  const hooks = requireHooks();
  const filePath = requireAbsolute(rawFilePath, "recovery:clear");
  return hooks.clear(filePath);
}

/** List pending recovery snapshots for an opened project, newest first (#44). */
export async function recoveryList(rawProjectDir: unknown): Promise<RecoveryEntry[]> {
  const hooks = requireHooks();
  const projectDir = requireAbsolute(rawProjectDir, "recovery:list");
  return hooks.list(projectDir);
}

/** Register the recovery:* IPC channels (SFE-P6b). */
export function registerRecoveryHandlers(secureHandle: SecureHandle): void {
  secureHandle("recovery:write", (_e, filePath: unknown, content: unknown, baseMtimeMs: unknown) =>
    recoveryWrite(filePath, content, baseMtimeMs),
  );
  secureHandle("recovery:clear", (_e, filePath: unknown) => recoveryClear(filePath));
  secureHandle("recovery:list", (_e, projectDir: unknown) => recoveryList(projectDir));
}

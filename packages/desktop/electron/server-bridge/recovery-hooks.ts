/**
 * Shared crash-recovery hooks for the recovery:* IPC handlers in
 * `electron/api/recovery.ts` (SFE-P5c4; the `recovery/*​/+server.ts` routes
 * they replaced are deleted).
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getRecoveryHooks()` is a thin derived selector
 * over it.
 */

import { getHostServices } from './host-services';

interface RecoveryEntry {
  filePath: string;
  recoveryPath: string;
  savedAt: number;
  baseMtimeMs: number;
}

export interface RecoveryHooks {
  write(filePath: string, content: string, baseMtimeMs: number): Promise<{ ok: boolean }>;
  clear(filePath: string): Promise<{ ok: boolean }>;
  list(projectDir: string): Promise<RecoveryEntry[]>;
}

/** The live `RecoveryHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getRecoveryHooks(): RecoveryHooks | null {
  return getHostServices()?.recovery ?? null;
}

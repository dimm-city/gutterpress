/**
 * Shared crash-recovery hooks for recovery:* server routes.
 */

import { createHostBridge } from './create-host-bridge';

export interface RecoveryEntry {
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

export const { register: registerRecoveryHooks, get: getRecoveryHooks } =
  createHostBridge<RecoveryHooks>('__printMdRecoveryHooks__');

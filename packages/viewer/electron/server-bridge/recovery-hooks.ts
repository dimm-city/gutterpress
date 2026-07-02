/**
 * Shared crash-recovery hooks for recovery:* server routes.
 */

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

const GLOBAL_KEY = '__printMdRecoveryHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdRecoveryHooks__: RecoveryHooks | undefined;
}

export function registerRecoveryHooks(hooks: RecoveryHooks): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getRecoveryHooks(): RecoveryHooks | null {
  return globalThis[GLOBAL_KEY] ?? null;
}

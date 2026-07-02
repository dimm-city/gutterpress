/**
 * Shared version-history hooks for vcs:* server routes.
 */

export interface VcsHooks<LibModule = unknown> {
  loadLib: () => Promise<LibModule>;
  operationLogPath: (slug: string) => string;
}

const GLOBAL_KEY = '__printMdVcsHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdVcsHooks__: VcsHooks | undefined;
}

export function registerVcsHooks<LibModule>(hooks: VcsHooks<LibModule>): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getVcsHooks<LibModule = unknown>(): VcsHooks<LibModule> | null {
  return (globalThis[GLOBAL_KEY] as VcsHooks<LibModule> | undefined) ?? null;
}

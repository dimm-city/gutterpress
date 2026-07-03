/**
 * Shared version-history hooks for vcs:* server routes.
 */

import { createHostBridge } from './create-host-bridge';

export interface VcsHooks<LibModule = unknown> {
  loadLib: () => Promise<LibModule>;
  operationLogPath: (slug: string) => string;
}

// Generic per call-site; the bridge stores the base shape and the wrappers
// re-apply the LibModule parameter so callers keep `getVcsHooks<LibModule>()`.
const bridge = createHostBridge<VcsHooks>('__printMdVcsHooks__');

export function registerVcsHooks<LibModule>(hooks: VcsHooks<LibModule>): void {
  bridge.register(hooks as VcsHooks);
}

export function getVcsHooks<LibModule = unknown>(): VcsHooks<LibModule> | null {
  return bridge.get() as VcsHooks<LibModule> | null;
}

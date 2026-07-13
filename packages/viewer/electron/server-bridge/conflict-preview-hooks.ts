/**
 * Shared conflict-preview hooks for sync:* server routes.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getConflictPreviewHooks()` is a thin derived
 * selector over it.
 */

import { getHostServices } from './host-services';

export type ConflictKind = 'both-edited' | 'you-deleted' | 'online-deleted';

export interface ConflictPreviewResult {
  mine: string;
  theirs: string;
  kind: ConflictKind;
  isBinary: boolean;
}

export interface ConflictPreviewHooks {
  getConflictPreview(
    projectDir: string,
    relativePath: string,
    kind: ConflictKind,
  ): Promise<ConflictPreviewResult>;
}

/** The live `ConflictPreviewHooks` slice of the collapsed host object, or null before `registerHostServices` runs. */
export function getConflictPreviewHooks(): ConflictPreviewHooks | null {
  return getHostServices()?.conflictPreview ?? null;
}

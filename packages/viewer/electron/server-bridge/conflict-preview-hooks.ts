/**
 * Shared conflict-preview hooks for sync:* server routes.
 */

import { createHostBridge } from './create-host-bridge';

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

export const {
  register: registerConflictPreviewHooks,
  get: getConflictPreviewHooks,
} = createHostBridge<ConflictPreviewHooks>('__printMdConflictPreviewHooks__');

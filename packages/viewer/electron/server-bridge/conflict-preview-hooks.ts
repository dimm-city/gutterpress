/**
 * Shared conflict-preview hooks for sync:* server routes.
 */

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

const GLOBAL_KEY = '__printMdConflictPreviewHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdConflictPreviewHooks__: ConflictPreviewHooks | undefined;
}

export function registerConflictPreviewHooks(hooks: ConflictPreviewHooks): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getConflictPreviewHooks(): ConflictPreviewHooks | null {
  return globalThis[GLOBAL_KEY] ?? null;
}

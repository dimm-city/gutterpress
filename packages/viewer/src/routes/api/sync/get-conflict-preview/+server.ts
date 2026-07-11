import { error } from '@sveltejs/kit';
import {
  getConflictPreviewHooks,
  type ConflictKind,
  type ConflictPreviewHooks,
} from '../../../../../electron/server-bridge/conflict-preview-hooks';
import { defineRoute, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

const VALID_KINDS: ReadonlySet<string> = new Set(['both-edited', 'you-deleted', 'online-deleted']);

export const POST: RequestHandler = defineRoute<
  { projectDir: string; path: string; kind: ConflictKind },
  ConflictPreviewHooks
>({
  hooks: getConflictPreviewHooks,
  hooksUnavailableMessage: 'Conflict preview hooks not registered',
  validate: (raw) => {
    const body = raw as { projectDir?: string; path?: string; kind?: string };
    if (!body?.projectDir || !body?.path) {
      error(400, 'sync:getConflictPreview requires { projectDir, path }');
    }
    const projectDir = requireAbsolute(body.projectDir, 'sync:getConflictPreview');
    const rawKind = body.kind ?? 'both-edited';
    if (!VALID_KINDS.has(rawKind)) {
      error(400, `sync:getConflictPreview: invalid kind "${rawKind}"; must be both-edited | you-deleted | online-deleted`);
    }
    return { projectDir, path: body.path!, kind: rawKind as ConflictKind };
  },
  call: async ({ body, hooks }) => hooks.getConflictPreview(body.projectDir, body.path, body.kind),
});

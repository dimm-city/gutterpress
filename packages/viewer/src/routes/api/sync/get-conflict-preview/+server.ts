import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import {
  getConflictPreviewHooks,
  type ConflictKind,
} from '../../../../../electron/server-bridge/conflict-preview-hooks';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      projectDir?: string;
      path?: string;
      kind?: string;
    };
    if (!body?.projectDir || !body?.path) return error(400, 'sync:getConflictPreview requires { projectDir, path }');
    if (!path.isAbsolute(body.projectDir)) return error(400, 'sync:getConflictPreview requires an absolute project path');

    const hooks = getConflictPreviewHooks();
    if (!hooks) return error(503, 'Conflict preview hooks not registered');

    const VALID_KINDS: ReadonlySet<string> = new Set(['both-edited', 'you-deleted', 'online-deleted']);
    const rawKind = body.kind ?? 'both-edited';
    if (!VALID_KINDS.has(rawKind)) return error(400, `sync:getConflictPreview: invalid kind "${rawKind}"; must be both-edited | you-deleted | online-deleted`);
    const kind = rawKind as ConflictKind;
    const result = await hooks.getConflictPreview(body.projectDir, body.path, kind);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

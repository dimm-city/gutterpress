import { error } from '@sveltejs/kit';
import path from 'node:path';
import {
  getConflictPreviewHooks,
  type ConflictKind,
} from '../../../../../electron/server-bridge/conflict-preview-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  projectDir?: string;
  path?: string;
  kind?: string;
}) => {
  if (!body?.projectDir || !body?.path) error(400, 'sync:getConflictPreview requires { projectDir, path }');
  if (!path.isAbsolute(body.projectDir)) error(400, 'sync:getConflictPreview requires an absolute project path');

  const hooks = getConflictPreviewHooks();
  if (!hooks) error(503, 'Conflict preview hooks not registered');

  const VALID_KINDS: ReadonlySet<string> = new Set(['both-edited', 'you-deleted', 'online-deleted']);
  const rawKind = body.kind ?? 'both-edited';
  if (!VALID_KINDS.has(rawKind)) error(400, `sync:getConflictPreview: invalid kind "${rawKind}"; must be both-edited | you-deleted | online-deleted`);
  const kind = rawKind as ConflictKind;
  return hooks.getConflictPreview(body.projectDir, body.path, kind);
});

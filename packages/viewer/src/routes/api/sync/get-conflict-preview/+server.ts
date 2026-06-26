import { json, error } from '@sveltejs/kit';
import path from 'node:path';
import type { RequestHandler } from './$types';

type ConflictKind = 'both-edited' | 'you-deleted' | 'online-deleted';

interface ConflictPreviewResult {
  mine: string;
  theirs: string;
  kind: ConflictKind;
  isBinary: boolean;
}

interface ConflictPreviewHooks {
  getConflictPreview(
    projectDir: string,
    relativePath: string,
    kind: ConflictKind,
  ): Promise<ConflictPreviewResult>;
}

function getHooks(): ConflictPreviewHooks | null {
  return (
    (globalThis as unknown as { __printMdConflictPreviewHooks__?: ConflictPreviewHooks })
      .__printMdConflictPreviewHooks__ ?? null
  );
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      projectDir?: string;
      path?: string;
      kind?: string;
    };
    if (!body?.projectDir || !body?.path) return error(400, 'sync:getConflictPreview requires { projectDir, path }');
    if (!path.isAbsolute(body.projectDir)) return error(400, 'sync:getConflictPreview requires an absolute project path');

    const hooks = getHooks();
    if (!hooks) return error(503, 'Conflict preview hooks not registered');

    const kind = (body.kind ?? 'both-edited') as ConflictKind;
    const result = await hooks.getConflictPreview(body.projectDir, body.path, kind);
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

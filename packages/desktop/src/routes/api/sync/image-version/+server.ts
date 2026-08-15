/**
 * GET /api/sync/image-version?projectDir=…&path=…&oid=…
 *
 * Raw bytes of ONE version of a clashing image, by blob oid — feeds the
 * <img> tags in ImageClashPicker (the only chooser left after the 2026-08-14
 * convergence simplification). Read-only; both oids are pinned by the merge
 * commit's parents so this can never go stale.
 */
import { error } from '@sveltejs/kit';
import { getVcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface LibModule {
  readImageVersion(options: { projectDir: string; oid: string }): Promise<Uint8Array>;
}

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
};

export const GET: RequestHandler = async ({ url }) => {
  const hooks = getVcsHooks<LibModule>();
  if (!hooks) error(503, 'VCS hooks not registered');
  const projectDir = await requireProjectDir(url.searchParams.get('projectDir'), 'sync:imageVersion');
  const filePath = url.searchParams.get('path') ?? '';
  const oid = url.searchParams.get('oid') ?? '';
  if (!/^[0-9a-f]{40}$/.test(oid)) error(400, 'sync:imageVersion requires a valid version id');
  const lib = await hooks.loadLib();
  let bytes: Uint8Array;
  try {
    bytes = await lib.readImageVersion({ projectDir, oid });
  } catch {
    error(404, 'That image version is not available.');
  }
  const ext = (filePath.match(/\.[a-z0-9]+$/i)?.[0] ?? '').toLowerCase();
  const body = new Uint8Array(bytes);
  return new Response(body, {
    headers: {
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'content-length': String(body.byteLength),
      'cache-control': 'no-store',
    },
  });
};

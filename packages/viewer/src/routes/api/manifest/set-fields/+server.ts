import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  projectDir?: string;
  updates?: Record<string, unknown>;
}) => {
  if (!body.projectDir || !isAbsolute(body.projectDir)) {
    error(400, 'manifest/set-fields requires an absolute projectDir');
  }
  if (!body.updates || typeof body.updates !== 'object') {
    error(400, 'manifest/set-fields requires an updates object');
  }
  const lib = await import('@dimm-city/print-md/api');
  return lib.setManifestFields(body.projectDir, body.updates as Parameters<typeof lib.setManifestFields>[1]);
});

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      projectDir?: string;
      updates?: Record<string, unknown>;
    };
    if (!body.projectDir || !isAbsolute(body.projectDir)) {
      return error(400, 'manifest/set-fields requires an absolute projectDir');
    }
    if (!body.updates || typeof body.updates !== 'object') {
      return error(400, 'manifest/set-fields requires an updates object');
    }
    const lib = await import('@dimm-city/print-md/api');
    return json(await lib.setManifestFields(body.projectDir, body.updates as Parameters<typeof lib.setManifestFields>[1]));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

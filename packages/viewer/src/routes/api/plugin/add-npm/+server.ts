import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { isAbsolute } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const { projectDir, packageName } = await request.json().catch(() => ({})) as {
      projectDir?: string;
      packageName?: string;
    };
    if (!projectDir || !isAbsolute(projectDir)) {
      return error(400, 'plugin/add-npm requires an absolute projectDir');
    }
    if (typeof packageName !== 'string' || !packageName) {
      return error(400, 'plugin/add-npm requires a packageName');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.addNpmPlugin(projectDir, packageName));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

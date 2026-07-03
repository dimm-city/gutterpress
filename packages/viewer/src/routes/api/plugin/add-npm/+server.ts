import { error } from '@sveltejs/kit';
import { isAbsolute } from 'node:path';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: {
  projectDir?: string;
  packageName?: string;
}) => {
  const { projectDir, packageName } = body;
  if (!projectDir || !isAbsolute(projectDir)) {
    error(400, 'plugin/add-npm requires an absolute projectDir');
  }
  if (typeof packageName !== 'string' || !packageName) {
    error(400, 'plugin/add-npm requires a packageName');
  }
  const lib = await import('@dimm-city/print-md');
  return lib.addNpmPlugin(projectDir, packageName);
});

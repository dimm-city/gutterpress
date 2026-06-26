import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    if (typeof body.projectDir !== 'string') {
      return error(400, 'saveAsTemplate requires { projectDir: string }');
    }
    const projectDir: string = body.projectDir;
    const name: string = typeof body.name === 'string' ? body.name : '';
    const { app } = await import('electron');
    const templatesRoot = join(app.getPath('userData'), 'templates');
    const lib = await import('@dimm-city/print-md');
    const result = await lib.saveProjectAsTemplate({ projectDir, name, templatesRoot });
    return json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

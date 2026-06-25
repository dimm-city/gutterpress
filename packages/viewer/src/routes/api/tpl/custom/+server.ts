import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { join } from 'node:path';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { templatesRoot?: string };
    let templatesRoot: string;
    if (typeof body.templatesRoot === 'string') {
      templatesRoot = body.templatesRoot;
    } else {
      const { app } = await import('electron');
      templatesRoot = join(app.getPath('userData'), 'templates');
    }
    const lib = await import('@dimm-city/print-md');
    return json(await lib.listCustomTemplates(templatesRoot));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

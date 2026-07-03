import { error } from '@sveltejs/kit';
import { readdir } from 'node:fs/promises';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const projectDir = body.projectDir;
  if (!projectDir) error(400, 'projectDir is required');
  requireAbsolute(projectDir, 'fs:listProjectFiles');
  const entries = await readdir(projectDir, { withFileTypes: true });
  const md: string[] = [];
  const css: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const lower = entry.name.toLowerCase();
    if (lower.endsWith('.md')) md.push(entry.name);
    else if (lower.endsWith('.css')) css.push(entry.name);
  }
  md.sort((a, b) => a.localeCompare(b));
  css.sort((a, b) => a.localeCompare(b));
  return { md, css };
});

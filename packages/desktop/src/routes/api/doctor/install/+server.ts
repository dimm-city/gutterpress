import { error } from '@sveltejs/kit';
import { spawn } from 'node:child_process';
import { binOnPath, isToolId, planToolInstall, type ToolId } from '$lib/server/tool-install.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

const TIMEOUT_MS = 10 * 60 * 1000;

/**
 * Install a missing optional tool. The renderer sends only a tool id; the
 * command is planned here, so nothing the renderer supplies is ever executed.
 */
export const POST: RequestHandler = defineRoute<{ toolId: ToolId }>({
  validate: async (raw) => {
    const toolId = (raw as { toolId?: unknown } | null)?.toolId;
    if (!isToolId(toolId)) error(400, 'doctor:install: unknown tool id');
    return { toolId };
  },
  call: async ({ body }) => {
    const plan = planToolInstall(body.toolId, process.platform, binOnPath);
    if (!plan) error(400, 'doctor:install: no supported package manager found');
    return await new Promise<{ ok: boolean; exitCode: number | null; output: string }>((resolve) => {
      let output = '';
      const done = (exitCode: number | null) =>
        resolve({ ok: exitCode === 0, exitCode, output: output.split('\n').slice(-40).join('\n').trim() });
      const child = spawn(plan.command, plan.args, { timeout: TIMEOUT_MS });
      child.stdout.on('data', (d) => (output += d));
      child.stderr.on('data', (d) => (output += d));
      child.on('error', (e) => {
        output += String(e);
        done(null);
      });
      child.on('close', (code) => done(code));
    });
  },
});

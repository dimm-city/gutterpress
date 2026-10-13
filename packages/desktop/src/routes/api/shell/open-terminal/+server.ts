import { spawn } from 'node:child_process';
import { findOnPath, terminalLaunch } from '$lib/server/open-terminal.js';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Open a terminal window in the open book's folder (Troubleshooting →
 * Diagnostics). Only the open book's own folder is accepted.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: unknown } | null)?.projectDir, 'shell:openTerminal'),
  }),
  call: async ({ body }) => {
    const launch = terminalLaunch(process.platform, body.projectDir, (name) =>
      findOnPath(name, process.env, process.platform),
    );
    if (!launch) {
      throw new Error('No terminal app was found. Install one (for example xterm or GNOME Terminal) and try again.');
    }
    await new Promise<void>((resolve, reject) => {
      const child = spawn(launch.command, launch.args, {
        cwd: body.projectDir,
        detached: true,
        stdio: 'ignore',
        windowsVerbatimArguments: launch.windowsVerbatimArguments,
      });
      child.once('error', reject);
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
    });
    return { ok: true, label: launch.label };
  },
});

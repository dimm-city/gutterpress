/**
 * POST /api/log/prune — delete every log file `log/list` would list: regular
 * `.log` files directly inside the fs-guard's read-only roots. Never touches
 * directories or other files. Both log writers append per write with no held
 * file handle, so deleting is safe.
 */
import { readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { getFsGuardHooks } from '../../../../../electron/server-bridge/fs-guard';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute({
  call: async (): Promise<{ removed: number }> => {
    let removed = 0;
    for (const root of getFsGuardHooks()?.readOnlyRoots() ?? []) {
      let names: string[];
      try {
        names = await readdir(root);
      } catch {
        continue; // a root that doesn't exist yet simply has no logs
      }
      for (const name of names) {
        if (!name.endsWith('.log')) continue;
        const abs = path.join(root, name);
        try {
          if (!(await stat(abs)).isFile()) continue;
          await rm(abs);
          removed++;
        } catch {
          // vanished or locked — skip
        }
      }
    }
    return { removed };
  },
});

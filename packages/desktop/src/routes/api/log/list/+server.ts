/**
 * POST /api/log/list — enumerate the app's diagnostic log files.
 *
 * Feeds the start screen's Logs tab (easy copy/paste sharing of diagnostics).
 * Lists ONLY `.log` files inside the fs-guard's read-only roots — the same
 * allow-list `log/read` confines reads to (userData/logs holds the per-repo
 * operation logs) — so this can never become a directory-listing primitive
 * for arbitrary paths.
 */
import { readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { getFsGuardHooks } from '../../../../../electron/server-bridge/fs-guard';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface LogFileEntry {
  name: string;
  path: string;
  sizeBytes: number;
  modifiedAt: string;
}

export const POST: RequestHandler = defineRoute({
  call: async (): Promise<LogFileEntry[]> => {
    const roots = getFsGuardHooks()?.readOnlyRoots() ?? [];
    const entries: LogFileEntry[] = [];
    for (const root of roots) {
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
          const s = await stat(abs);
          if (!s.isFile()) continue;
          entries.push({
            name,
            path: abs,
            sizeBytes: s.size,
            modifiedAt: new Date(s.mtimeMs).toISOString(),
          });
        } catch {
          // vanished between readdir and stat — skip
        }
      }
    }
    entries.sort((a, b) => (a.modifiedAt < b.modifiedAt ? 1 : -1));
    return entries;
  },
});

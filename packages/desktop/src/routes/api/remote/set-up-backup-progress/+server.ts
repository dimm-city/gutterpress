import { getBackupProgress } from '../../_lib/backup-progress';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/** Which step setting up a backup is on for this book, or `null` when none is running. Poll while `setUpBackup` is pending. */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string } | null)?.projectDir, 'remote:setUpBackupProgress'),
  }),
  call: ({ body }) => ({ progress: getBackupProgress(body.projectDir) }),
});

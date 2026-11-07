import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * What "Repair the online copy" would set aside, for the confirm text: the
 * revisions and versions that exist only on this computer. A repair keeps the
 * old history in a repair copy but starts from the online one, so these are
 * what would be left out. Reads this computer's history only (no network,
 * nothing written).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string } | null)?.projectDir, 'remote:repair-preview'),
  }),
  call: async ({ body }) => {
    const lib = await loadLib();
    const { revisions, versions, unreadable, repairCopies } = await lib.previewRepair(body.projectDir, {
      tokenStore: getHostServices().remote.tokenStore,
    });
    return {
      setAside: { revisions, versions },
      ...(repairCopies ? { repairCopies } : {}),
      ...(unreadable ? { unreadable: true } : {}),
    };
  },
});

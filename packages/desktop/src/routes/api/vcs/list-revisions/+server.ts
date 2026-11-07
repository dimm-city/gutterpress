import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * The book's revisions and where each is kept (#448); `null` for a plain
 * folder. `refresh` first asks the online copy which revisions it has. That is
 * best-effort: offline, signed out or no online copy just leaves the list as
 * this computer last knew it, and `checkedOnline` says whether the check
 * worked. Only remote-tracking refs are written, so it is safe with unsaved
 * work open.
 */
/** An online check this recent is reused (the versions list shares it); `maxAgeMs: 0` forces a real one. */
const ONLINE_CHECK_FRESH_MS = 20_000;

export const POST: RequestHandler = defineRoute<{ projectDir: string; refresh: boolean; maxAgeMs: number }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; refresh?: unknown; maxAgeMs?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'vcs/list-revisions'),
      refresh: body.refresh === true,
      maxAgeMs:
        typeof body.maxAgeMs === 'number' && Number.isFinite(body.maxAgeMs) && body.maxAgeMs >= 0
          ? Math.min(body.maxAgeMs, 10 * 60_000)
          : ONLINE_CHECK_FRESH_MS,
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    // A switch the app died in the middle of is put right first; `repairNotice`
    // tells the author, once. A repair that keeps failing must not hide the
    // card: the list still comes back, with `unfinishedSwitch` saying what is
    // wrong so the author can try again or keep the files as they are.
    await lib.repairInterruptedSwitch(body.projectDir).catch(() => null);
    const repairNotice = await lib.takeSwitchRepairNotice(body.projectDir).catch(() => null);
    const unfinishedSwitch = await lib.unfinishedSwitchState(body.projectDir).catch(() => null);
    // `checkedAt`: when the online copy was last asked (ISO; null if never this session).
    // `checkedOnline`: whether THIS call's check worked.
    let checkedOnline = false;
    let checkedAt: string | null;
    let reason: string | undefined;
    if (body.refresh) {
      const checked = await lib.refreshRemoteCopies({
        projectDir: body.projectDir,
        tokenStore: getHostServices().remote.tokenStore,
        maxAgeMs: body.maxAgeMs,
      });
      checkedOnline = checked.refreshed;
      checkedAt = checked.checkedAt;
      reason = checked.reason;
    } else {
      checkedAt = await lib.lastOnlineCheck(body.projectDir);
    }
    const list = await lib.listRevisions(body.projectDir);
    return (
      list && {
        ...list,
        checkedAt,
        checkedOnline,
        ...(reason ? { reason } : {}),
        ...(repairNotice ? { repairNotice } : {}),
        ...(unfinishedSwitch ? { unfinishedSwitch } : {}),
      }
    );
  },
  onError: (e) => friendlyVcsError(e, 'vcs/list-revisions'),
});

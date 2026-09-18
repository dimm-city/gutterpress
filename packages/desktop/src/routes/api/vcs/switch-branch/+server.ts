import { error } from '@sveltejs/kit';
import { gitIdentityArgs } from '$lib/server/settings';
import { getVcsHooks, type VcsHooks } from '../../../../../electron/server-bridge/vcs-hooks';
import { getRecoveryHooks } from '../../../../../electron/server-bridge/recovery-hooks';
import { friendlyVcsError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface SwitchBranchResult {
  current: string;
  changedFiles: string[];
}

// Local type — do NOT import from contract.ts or the lib (keeps SPA bundle clean).
interface LibModule {
  switchBranch: (opts: {
    projectDir: string;
    branch: string;
    authorName?: string;
    authorEmail?: string;
  }) => Promise<SwitchBranchResult>;
}

export const POST: RequestHandler = defineRoute<
  { projectDir: string; branch: string },
  VcsHooks<LibModule>
>({
  hooks: () => getVcsHooks<LibModule>(),
  hooksUnavailableMessage: 'VCS hooks not registered',
  validate: async (raw) => {
    const body = raw as { projectDir?: string; branch?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'vcs/switch-branch');
    if (typeof body.branch !== 'string' || !body.branch.trim()) {
      error(400, 'vcs/switch-branch requires a branch name');
    }
    return { projectDir, branch: body.branch.trim() };
  },
  call: async ({ body, hooks }) => {
    const lib = await hooks.loadLib();
    // Pause the auto-snapshot/auto-sync host timers around the checkout (#273
    // — see VcsHooks.pauseTimers's doc comment) so neither fires against the
    // mid-switch working tree or the wrong branch; always resume, whether the
    // switch succeeds or fails.
    hooks.pauseTimers?.(body.projectDir);
    let result: SwitchBranchResult;
    try {
      result = await lib.switchBranch({
        projectDir: body.projectDir,
        branch: body.branch,
        ...(await gitIdentityArgs()),
      });
    } finally {
      hooks.resumeTimers?.(body.projectDir);
    }
    // Crash-recovery drafts are keyed by absolute file path, not by copy —
    // drop the ones for files the checkout just changed so a draft taken on
    // the copy just left behind can never be offered over the NEW copy's
    // version of the same file (recovery.ts's header documents the rule).
    // Best-effort: a failure here must never turn an already-successful
    // switch into a reported error.
    const recovery = getRecoveryHooks();
    if (recovery) {
      await Promise.all(
        result.changedFiles.map((filePath) => recovery.clear(filePath).catch(() => {})),
      );
    }
    return result;
  },
  onError: (e) => friendlyVcsError(e, 'switchBranch', 'vcs/switch-branch'),
});

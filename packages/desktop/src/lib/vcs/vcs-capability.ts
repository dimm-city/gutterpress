/**
 * Local version-history capability (SFE-P5c2). Replaces `api.vcs.*`
 * (deleted `src/routes/api/vcs/**` HTTP routes) with typed IPC through the
 * one shared `bridge()` accessor — same shape as every other capability
 * module (SFE-P5b), its own small file per this run's dispatch note ("vcs
 * joins app-lifecycle or its own small module"): SFE-P5b's capability map
 * found nothing that ties `vcs` to `$lib/project-config/
 * project-config-capability.ts`'s bounded context (project/manifest/tpl/
 * snip/media/plugin/theme/style all feed the Project Settings composition
 * root; `vcs` feeds `ProjectActivityView`/`StatusBar`/`+page.svelte`'s
 * Save Version action instead), and it carries its own weight worth keeping
 * separate — see the crash-safety note below.
 *
 * SPECIAL WEIGHT (run note — the checkout-journal crash-safety guarantee):
 * `restoreSnapshot` calls the exact same host function
 * (`electron/api/vcs.ts`'s `vcsRestoreSnapshot`, which in turn calls the
 * lib's `restoreVersionWithBackup`) the deleted route called — a pull that
 * dies between merge and checkout must not publish a wholesale revert. That
 * guarantee's implementation and unit tests live in `packages/cli` (outside
 * this lane's write ownership); this module's job is only to keep the
 * desktop entry point wired unchanged across the transport change.
 *
 * Error semantics (run rule 2): every function scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection's message before
 * re-throwing — the same discipline `files-capability.ts`/
 * `project-config-capability.ts` use.
 */
import { bridge } from "../platform/bridge";
import { friendlyHostError } from "../errors";
import type { RestoreVersionResult, SnapshotEntry, SnapshotPage } from "../platform/contract";

async function call<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    throw new Error(friendlyHostError(e instanceof Error ? e.message : String(e)));
  }
}

/** Turn a plain local-folder project into a versioned one (CLAUDE.md §7's escape hatch). */
export async function vcsEnableVersionHistory(projectDir: string): Promise<unknown> {
  return call(bridge().vcs.enableVersionHistory(projectDir));
}

/** Page through the project's snapshot history, newest first. */
export async function vcsListSnapshotsPage(
  projectDir: string,
  options?: { limit?: number; before?: string },
): Promise<SnapshotPage> {
  return call(bridge().vcs.listSnapshotsPage(projectDir, options));
}

/**
 * Restore the project to a prior snapshot. The host snapshots the CURRENT
 * state before restoring, so a restore can never lose the author's
 * in-progress work.
 */
export async function vcsRestoreSnapshot(projectDir: string, id: string): Promise<RestoreVersionResult> {
  return call(bridge().vcs.restoreSnapshot(projectDir, id));
}

/** Save a snapshot of the project's current working tree. */
export async function vcsSaveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry> {
  return call(bridge().vcs.saveSnapshot(projectDir, message));
}

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
 * SPECIAL WEIGHT (run note — the snapshot-before-restore safety guarantee):
 * `restoreSnapshot` calls the exact same host function
 * (`electron/api/vcs.ts`'s `vcsRestoreSnapshot`, which in turn calls the
 * lib's `restoreVersionWithBackup`,
 * `packages/cli/src/lib/source-provider.ts`) the deleted route called — a
 * restore first snapshots the CURRENT dirty working tree, so it can never
 * lose in-progress author work. That guarantee's implementation and unit
 * tests (`source-provider.test.ts`'s `restoreVersionWithBackup` cases) live
 * in `packages/cli` (outside this lane's write ownership); this module's
 * job is only to keep the desktop entry point wired unchanged across the
 * transport change.
 *
 * Error semantics (run rule 2): every function scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection's message before
 * re-throwing — the same discipline `files-capability.ts`/
 * `project-config-capability.ts` use.
 */
import { bridge } from "../platform/bridge";
import { hostCall } from "../errors";
import type { RestoreVersionResult, SnapshotEntry, SnapshotPage } from "../platform/contract";

/** Turn a plain local-folder project into a versioned one (CLAUDE.md §7's escape hatch). */
export async function vcsEnableVersionHistory(projectDir: string): Promise<unknown> {
  return hostCall(bridge().vcs.enableVersionHistory(projectDir));
}

/** Page through the project's snapshot history, newest first. */
export async function vcsListSnapshotsPage(
  projectDir: string,
  options?: { limit?: number; before?: string },
): Promise<SnapshotPage> {
  return hostCall(bridge().vcs.listSnapshotsPage(projectDir, options));
}

/**
 * Restore the project to a prior snapshot. The host snapshots the CURRENT
 * state before restoring, so a restore can never lose the author's
 * in-progress work.
 */
export async function vcsRestoreSnapshot(projectDir: string, id: string): Promise<RestoreVersionResult> {
  return hostCall(bridge().vcs.restoreSnapshot(projectDir, id));
}

/** Save a snapshot of the project's current working tree. */
export async function vcsSaveSnapshot(projectDir: string, message?: string): Promise<SnapshotEntry> {
  return hostCall(bridge().vcs.saveSnapshot(projectDir, message));
}

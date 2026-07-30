import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, requireAbsolute, requireContainedOrPicked } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * Reveal a file in the OS file manager.
 *
 * Used to take ANY string and hand it straight to `showItemInFolder` — no
 * containment check, not even `requireAbsolute` (2026-07-29 audit). It has
 * exactly three legitimate callers, and the third is why it can't simply be
 * confined to the project:
 *
 *   1. a project media file (MediaPanel) — inside `projectRoots()`
 *   2. a crash-recovery backup zip under userData — inside `readOnlyRoots()`
 *   3. the exported PDF, at the destination the author chose in the Save
 *      dialog — deliberately OUTSIDE the project
 *
 * So case 3 is authorized the same way `publish:run`'s artifact and
 * `fs:copyFile`'s `src` are — via the shared `requireContainedOrPicked`
 * (in-project, or read-only roots, OR a path a NATIVE dialog produced this
 * session). The export controller registers the PDF it actually wrote once the
 * atomic rename succeeds, so the reveal never has to trust a renderer-supplied
 * path; the shared helper's consume-then-re-register lets the "Show in Folder"
 * toast be clicked more than once.
 */
export const POST: RequestHandler = defineRoute<{ filePath: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: async (raw) => {
    const body = raw as { filePath?: unknown };
    const filePath = requireAbsolute(body.filePath, 'shell:showInFolder');
    await requireContainedOrPicked(filePath, 'shell:showInFolder', { includeReadOnlyRoots: true });
    return { filePath };
  },
  call: async ({ body, hooks }) => {
    hooks.showItemInFolder(body.filePath);
    return { ok: true };
  },
});

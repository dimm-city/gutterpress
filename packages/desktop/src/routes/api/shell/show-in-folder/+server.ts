import { error } from '@sveltejs/kit';
import { getDesktopHooks, type DesktopHooks } from '$lib/server/host-hooks.js';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { getPickedFilesHooks } from '../../../../../electron/server-bridge/picked-files';
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
 * `fs:copyFile`'s `src` are: by a path a NATIVE dialog produced in this
 * session (`electron/server-bridge/picked-files.ts`). The export controller
 * registers the PDF it actually wrote once the atomic rename succeeds, so the
 * reveal never has to trust a renderer-supplied path — and the capability is
 * consumed and immediately RE-REGISTERED, because "Show in Folder" is a toast
 * action the author can click more than once.
 */
export const POST: RequestHandler = defineRoute<{ filePath: string }, DesktopHooks>({
  hooks: getDesktopHooks,
  hooksUnavailableMessage: 'Desktop hooks not registered',
  validate: async (raw) => {
    const body = raw as { filePath?: unknown };
    const filePath = requireAbsolute(body.filePath, 'shell:showInFolder');
    try {
      await requireWithinProjectRoot(filePath, 'shell:showInFolder', {
        includeReadOnlyRoots: true,
      });
    } catch {
      const picked = getPickedFilesHooks();
      if (!picked?.consume(filePath)) {
        error(403, 'shell:showInFolder: path is outside the open project and was not chosen from a file dialog');
      }
      picked.register([filePath]);
    }
    return { filePath };
  },
  call: async ({ body, hooks }) => {
    hooks.showItemInFolder(body.filePath);
    return { ok: true };
  },
});

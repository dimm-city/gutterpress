import { error } from '@sveltejs/kit';
import { stat } from 'node:fs/promises';
import { scheduleAutoWriteEffects } from '../../../../../electron/server-bridge/write-hooks';
import { defineRoute, requireWithinProjectRoot } from '../../_lib/route';
import { heldItem, restoreHeld } from '../_shared/recently-deleted';
import type { RequestHandler } from './$types';

// The "Undo" on the FileTree's "Deleted …" toast (#313): moves the item
// fs/delete set aside back to where it was. The original path is re-checked
// against the open book, and an item is never restored over something that
// has since taken its place.
export const POST: RequestHandler = defineRoute<{ token: string }>({
  call: async ({ body }) => {
    const item = await heldItem((body as { token?: unknown }).token);
    if (!item) error(410, 'This delete can no longer be undone.');
    const origin = await requireWithinProjectRoot(item.origin, 'fs:undo-delete');
    if (await stat(origin).then(() => true, () => false)) {
      error(409, 'Something with that name is there again — nothing was restored.');
    }
    await restoreHeld({ ...item, origin });

    scheduleAutoWriteEffects(origin);

    return { path: origin };
  },
});

import { error } from '@sveltejs/kit';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  notifyPreviewSettledWrite,
  scheduleAutoWriteEffects,
} from '../../../../../electron/server-bridge/write-hooks';
import { defineRoute, loadLib, requireAbsolute, requireProjectDir, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

interface TokenUpdate {
  name: string;
  value: string | null;
}

const isUpdate = (u: unknown): u is TokenUpdate =>
  !!u &&
  typeof (u as TokenUpdate).name === 'string' &&
  (u as TokenUpdate).name.startsWith('--') &&
  (typeof (u as TokenUpdate).value === 'string' || (u as TokenUpdate).value === null);

// Book setup's design settings write here (#454): a postcss edit of the
// book's own `styles:` sheets (`bookTokenEdits`). A token is changed in place
// in the sheet that declares it, a new one goes into the `:root` of `file`
// (the book's first stylesheet), and a removal takes it out of every sheet.
// Each changed sheet is written like `fs/write-file` writes: inside the
// project's roots only, then the preview and the automatic versions hear of it.
export const POST: RequestHandler = defineRoute<{ projectDir: string; file: string; updates: TokenUpdate[] }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; file?: string; updates?: unknown };
    const projectDir = await requireProjectDir(body.projectDir, 'style/edit-tokens');
    const file = requireAbsolute(body.file, 'style/edit-tokens');
    if (!Array.isArray(body.updates) || !body.updates.every(isUpdate)) {
      error(400, 'style/edit-tokens requires an updates array of { name, value }');
    }
    return { projectDir, file, updates: body.updates };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    const edits = await lib.bookTokenEdits(body.projectDir, body.file, body.updates);
    for (const edit of edits) await requireWithinProjectRoot(edit.path, 'style/edit-tokens');
    for (const edit of edits) {
      await mkdir(path.dirname(edit.path), { recursive: true });
      await writeFile(edit.path, edit.content, 'utf-8');
      notifyPreviewSettledWrite(edit.path, edit.content);
      scheduleAutoWriteEffects(edit.path);
    }
    return { written: edits.map((edit) => edit.path) };
  },
});

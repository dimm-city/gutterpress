import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  try {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return json([]);
    const res = await dialog.showOpenDialog(win, {
      title: 'Add images',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'avif', 'tiff'],
        },
      ],
    });
    if (res.canceled || res.filePaths.length === 0) return json([]);
    return json(res.filePaths);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

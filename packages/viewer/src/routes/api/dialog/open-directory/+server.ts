import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async () => {
  try {
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return json(null);
    const res = await dialog.showOpenDialog(win, {
      title: 'Open print-md project',
      properties: ['openDirectory'],
    });
    if (res.canceled || res.filePaths.length === 0) return json(null);
    return json(res.filePaths[0]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

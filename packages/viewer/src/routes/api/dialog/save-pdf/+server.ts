import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { defaultName?: string };
    const { dialog, BrowserWindow } = await import('electron');
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
    if (!win) return json(null);
    const res = await dialog.showSaveDialog(win, {
      title: 'Save PDF',
      defaultPath: body.defaultName ?? 'book.pdf',
      filters: [{ name: 'PDF', extensions: ['pdf'] }],
    });
    if (res.canceled || !res.filePath) return json(null);
    return json(res.filePath);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

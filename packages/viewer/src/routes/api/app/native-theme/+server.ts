import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => {
  try {
    const { nativeTheme } = await import('electron');
    return json({ shouldUseDarkColors: nativeTheme.shouldUseDarkColors });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

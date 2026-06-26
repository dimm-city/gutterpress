import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';

interface AppHooks {
  updateSplash: (status?: string, progress?: number, sub?: string) => void;
  showMainWindowAndCloseSplash: () => void;
  setRendererDirty: (isDirty: boolean) => void;
  resolveFlush: () => void;
  sendToRenderer: (channel: string, ...args: unknown[]) => void;
}

function getHooks(): AppHooks | null {
  return (globalThis as unknown as { __printMdAppHooks__?: AppHooks }).__printMdAppHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as {
      status?: string;
      progress?: number;
      sub?: string;
    };
    const hooks = getHooks();
    if (hooks) {
      hooks.updateSplash(body.status, body.progress, body.sub);
    }
    return json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

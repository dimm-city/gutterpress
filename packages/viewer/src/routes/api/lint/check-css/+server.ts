import { error } from '@sveltejs/kit';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

interface CssLintLibModule {
  checkCss: (css: string, from?: string) => Array<{
    rule: string;
    severity: 'error' | 'warning';
    message: string;
    line: number;
    column: number;
  }>;
}

export const POST: RequestHandler = jsonRoute(async (body: { cssPath?: string; content?: string }) => {
  const { cssPath, content } = body;
  if (typeof content !== 'string') error(400, "'content' string is required");

  const hooks = getPrefsHooks<CssLintLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const lib = await hooks.loadLib();
  return lib.checkCss(content, cssPath);
});

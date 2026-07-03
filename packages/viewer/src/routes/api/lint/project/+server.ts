import { error } from '@sveltejs/kit';
import path from 'node:path';
import { getPrefsHooks } from '../../../../../electron/server-bridge/prefs-hooks';
import { jsonRoute, requireAbsolute } from '../../_lib/handler';
import type { RequestHandler } from './$types';

interface LintCheckResult {
  checkId: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  file?: string;
  line?: number;
  column?: number;
  detail?: string;
}

interface ValidationLibModule {
  executeValidation: (args: {
    input?: string;
    category?: string;
    phase?: string;
  }) => Promise<{ report: { results: LintCheckResult[] } }>;
}

export const POST: RequestHandler = jsonRoute(async (body: { projectDir?: string }) => {
  const projectDir = body.projectDir;
  if (!projectDir || typeof projectDir !== 'string') error(400, "'projectDir' string is required");
  requireAbsolute(projectDir, 'lint:project');

  const hooks = getPrefsHooks<ValidationLibModule>();
  if (!hooks) error(503, 'Prefs hooks not registered');
  const lib = await hooks.loadLib();
  const execution = await lib.executeValidation({
    input: projectDir,
    category: 'source',
    phase: 'pre-build',
  });
  const dirPrefix = projectDir.replace(/[\\/]+$/, '') + path.sep;
  return execution.report.results.map((r) => {
    const abs = r.file ? path.resolve(r.file) : undefined;
    const rel =
      abs && abs.startsWith(dirPrefix)
        ? abs.slice(dirPrefix.length).split(path.sep).join('/')
        : abs
          ? path.basename(abs)
          : undefined;
    return {
      filePath: abs,
      file: rel,
      line: r.line,
      column: r.column,
      severity: r.severity,
      message: r.message,
      source: r.checkId,
    };
  });
});

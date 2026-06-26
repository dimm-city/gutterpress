import { json, error } from '@sveltejs/kit';
import path from 'node:path';
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

interface PrefsHooks {
  loadLib: () => Promise<{
    executeValidation: (args: {
      input?: string;
      category?: string;
      phase?: string;
    }) => Promise<{ report: { results: LintCheckResult[] } }>;
  }>;
}

function getHooks(): PrefsHooks | null {
  return (globalThis as unknown as { __printMdPrefsHooks__?: PrefsHooks }).__printMdPrefsHooks__ ?? null;
}

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json().catch(() => ({})) as { projectDir?: string };
    const projectDir = body.projectDir;
    if (!projectDir || typeof projectDir !== 'string') return error(400, "'projectDir' string is required");
    if (!path.isAbsolute(projectDir)) return error(400, `lint:project requires an absolute path, got: ${projectDir}`);

    const hooks = getHooks();
    if (!hooks) return error(503, 'Prefs hooks not registered');
    const lib = await hooks.loadLib();
    const execution = await lib.executeValidation({
      input: projectDir,
      category: 'source',
      phase: 'pre-build',
    });
    const dirPrefix = projectDir.replace(/[\\/]+$/, '') + path.sep;
    const problems = execution.report.results.map((r) => {
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
    return json(problems);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return error(500, msg);
  }
};

import path from 'node:path';
import { defineRoute, loadLib, requireAbsolute } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: (raw) => ({
    projectDir: requireAbsolute((raw as { projectDir?: string }).projectDir, 'lint:project'),
  }),
  call: async ({ body }) => {
    const projectDir = body.projectDir;
    const lib = await loadLib();
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
  },
});

import path from 'node:path';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

export const POST: RequestHandler = defineRoute<{ projectDir: string }>({
  validate: async (raw) => ({
    projectDir: await requireProjectDir((raw as { projectDir?: string }).projectDir, 'lint:project'),
  }),
  call: async ({ body }) => {
    const projectDir = body.projectDir;
    const lib = await loadLib();
    let execution;
    try {
      execution = await lib.executeValidation({
        input: projectDir,
        category: 'source',
        phase: 'pre-build',
      });
    } catch (e) {
      // The check run first downloads the book's missing pinned extensions
      // (like a build does) and cannot go on without them. Say which one and
      // why as the problem, rather than the panel's generic "couldn't check".
      if (e instanceof lib.BuildError) {
        return [{ severity: 'error', message: e.message, source: 'extensions.restore' }];
      }
      throw e;
    }
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

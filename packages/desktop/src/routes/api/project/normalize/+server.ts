import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import { planNormalize, type NormalizeReport } from '$lib/editor/normalize-project';
import type { RequestHandler } from './$types';

/**
 * Project-wide normalize-on-adoption.
 *
 * Rich editing saves canonically, so the first save on a project that has
 * never been normalized reformats that one file — and doing that file by file
 * scatters formatting churn through every later diff. This does the whole
 * project once instead.
 *
 * TWO PHASES, and the split is the point: `apply: false` (the default) reads
 * and PLANS, writing nothing, so the author can see exactly what would change
 * before agreeing to it. Only `apply: true` writes, and only the files the
 * plan listed as changed.
 *
 * Runs host-side because it touches the filesystem. `planNormalize` itself is
 * pure and is unit-tested without any of this.
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; apply: boolean }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; apply?: unknown };
    return {
      // Confined to the open project, exactly like fs:listProjectFiles — this
      // both enumerates and WRITES, so it must never become a way to reach
      // files outside the book.
      projectDir: await requireWithinProjectRoot(
        requireAbsolute(body.projectDir, 'project:normalize'),
        'project:normalize',
      ),
      apply: body.apply === true,
    };
  },
  call: async ({ body }) => {
    const entries = await readdir(body.projectDir, { withFileTypes: true });
    const names = entries
      .filter((e) => e.isFile() && e.name.toLowerCase().endsWith('.md'))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));

    const files = await Promise.all(
      names.map(async (name) => ({
        path: name,
        text: await readFile(join(body.projectDir, name), 'utf-8'),
      })),
    );

    const report: NormalizeReport = planNormalize(files);

    if (body.apply) {
      await Promise.all(
        report.changed.map((c) =>
          writeFile(join(body.projectDir, c.path), c.text, 'utf-8'),
        ),
      );
    }

    // The before/after text is what the confirm dialog shows per file, so the
    // author agrees to a diff rather than to a number.
    const before = new Map(files.map((f) => [f.path, f.text]));
    return {
      applied: body.apply,
      changed: report.changed.map((c) => ({
        path: c.path,
        before: before.get(c.path) ?? '',
        after: c.text,
      })),
      unchanged: report.unchanged,
      refused: report.refused,
    };
  },
});

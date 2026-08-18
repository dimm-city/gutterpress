import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import { planNormalize, type NormalizeReport } from '$lib/editor/normalize-project';
import { createEditorRenderer } from '$lib/editor/markdown-doc';
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
export const POST: RequestHandler = defineRoute<{
  projectDir: string;
  apply: boolean;
  expected?: Record<string, string>;
}>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; apply?: unknown; expected?: unknown };
    return {
      // Confined to the open project, exactly like fs:listProjectFiles — this
      // both enumerates and WRITES, so it must never become a way to reach
      // files outside the book.
      projectDir: await requireProjectDir(body.projectDir, 'project:normalize'),
      apply: body.apply === true,
      expected:
        body.expected && typeof body.expected === 'object'
          ? (body.expected as Record<string, string>)
          : undefined,
    };
  },
  call: async ({ body }) => {
    // The SAME resolver the renderer and lint use, so this rewrites exactly
    // the book's files — no more and no fewer. A hand-rolled `readdir` for
    // top-level `.md` stood here and missed every manifest that lists nested
    // sources (`chapters/intro.md`), which produced a partial plan that still
    // recorded the project as normalized. `markdown/index.ts`'s own header
    // warns against exactly this re-derivation.
    const lib = await loadLib();
    const { manifest } = await lib.loadManifestWithPath(body.projectDir);
    let names: string[] = await lib.resolveActiveMarkdownFiles(
      body.projectDir,
      manifest.source?.files ?? null,
    );

    // An apply that carries the reviewed plan works on EXACTLY that plan's
    // files. Re-planning the whole project doubled every read and parse for
    // nothing (~140ms on the user guide, twice) — and, worse, a file that was
    // UNCHANGED at plan time but edited on disk before the click landed in
    // the fresh plan with no `expected` entry, and was written without anyone
    // having reviewed it. Restricting to the reviewed set fixes both; the
    // intersection with the resolver's list keeps path safety intact.
    if (body.apply && body.expected) {
      const reviewed = new Set(Object.keys(body.expected));
      names = names.filter((name) => reviewed.has(name));
    }

    const files = await Promise.all(
      names.map(async (name: string) => ({
        path: name,
        text: await readFile(join(body.projectDir, name), 'utf-8'),
      })),
    );

    // The PROJECT'S dialect, plugins included — normalize writes files, and
    // planning a plugin-using book with the bare pipeline would judge its
    // marker structure as plain paragraphs. FAIL-FAST (no onError): a plugin
    // that cannot load host-side aborts the plan with its own message rather
    // than rewriting the book with an incomplete dialect — the loader's
    // build/export rule, because this is a write path, not a preview.
    const config = lib.resolveConfig({}, manifest ?? {});
    const loaded = await lib.loadPlugins(config.plugins ?? [], body.projectDir);
    const report: NormalizeReport = planNormalize(files, createEditorRenderer(loaded));

    // Every write is attempted, and each result is reported. A bare
    // `Promise.all` rejected on the first failure while the writes that had
    // already resolved stayed on disk — so a permission error or a full disk
    // left the book half-reformatted, and the only thing the author saw was a
    // generic error naming no file. Nothing here can lose content (every
    // `changed` entry is an already-verified meaning-preserving rewrite), but
    // "which files actually changed?" has to be answerable.
    const before = new Map(files.map((f) => [f.path, f.text]));

    // Only write what the author actually reviewed.
    //
    // The apply call re-reads and re-plans, so a file that changed between the
    // dialog being shown and the button being pressed — a git sync, an
    // external editor, a collaborator — would have been rewritten from content
    // nobody saw. That defeats the whole point of the confirm step. The client
    // sends back the `before` text it displayed; anything that no longer
    // matches is skipped and named, so the author can re-open the dialog on
    // the current state.
    const stale: string[] = [];
    const toWrite = report.changed.filter((c) => {
      const expected = body.expected?.[c.path];
      if (expected === undefined) return true;
      if (expected === before.get(c.path)) return true;
      stale.push(c.path);
      return false;
    });

    const failed: Array<{ path: string; error: string }> = [];
    if (body.apply) {
      const results = await Promise.allSettled(
        toWrite.map((c) => writeFile(join(body.projectDir, c.path), c.text, 'utf-8')),
      );
      results.forEach((r, i) => {
        if (r.status === 'rejected') {
          failed.push({
            path: toWrite[i]!.path,
            error: r.reason instanceof Error ? r.reason.message : String(r.reason),
          });
        }
      });
    }

    // The before/after text is what the confirm dialog shows per file, so the
    // author agrees to a diff rather than to a number — and it is what comes
    // back as `expected` on the apply call.
    return {
      applied: body.apply,
      changed: report.changed.map((c) => ({
        path: c.path,
        before: before.get(c.path) ?? '',
        after: c.text,
      })),
      unchanged: report.unchanged,
      refused: report.refused,
      failed,
      stale,
    };
  },
});

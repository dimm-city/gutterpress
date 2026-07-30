import { defineRoute, loadLib, requireProjectDir } from '../../_lib/route';
import type { RequestHandler } from './$types';

/**
 * The project's editable stylesheets for the Design panel's picker.
 *
 * `repoRoot` (optional) lets a book that lives inside a repository also offer the
 * repository's SHARED stylesheets. Without it, discovery was book-only, so a
 * `../../shared/...` entry appeared only while it sat in the manifest —
 * unchecking one removed it from the UI permanently, leaving hand-editing
 * `manifest.yaml` as the only way back (2026-07-29 audit).
 *
 * It is guarded exactly like `projectDir`, so it cannot become a
 * directory-enumeration primitive: only a path inside the host-owned
 * `projectRoots()` allow-list is accepted, and the real repo root always is
 * (the fs guard registers it).
 */
export const POST: RequestHandler = defineRoute<{ projectDir: string; repoRoot?: string }>({
  validate: async (raw) => {
    const body = raw as { projectDir?: unknown; repoRoot?: unknown };
    return {
      projectDir: await requireProjectDir(body.projectDir, 'project/list-styles'),
      ...(typeof body.repoRoot === 'string' && body.repoRoot
        ? { repoRoot: await requireProjectDir(body.repoRoot, 'project/list-styles') }
        : {}),
    };
  },
  call: async ({ body }) => {
    const lib = await loadLib();
    return lib.listProjectStyles(
      body.projectDir,
      body.repoRoot ? { repoRoot: body.repoRoot } : {},
    );
  },
});

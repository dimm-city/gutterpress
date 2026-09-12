import { error } from '@sveltejs/kit';
import path from 'node:path';
import { getDesktopHooks } from '../../../../../electron/server-bridge/host-hooks';
import { defineRoute, loadLib, requireProjectDir, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

// #265: add ONE extension by specifier — a bundled feature name, an npm
// package (`name` or `name@version`), or a project-relative path (`./x`,
// `../x`). The three differ only in what the lib does with them: write the
// name, download + verify + vendor + pin, or reference the folder in place.
//
// Path discipline (see tests/platform/route-scoping.test.ts): a relative
// path resolves against the project and must stay inside the open project
// (or its repo root), and an ABSOLUTE path is refused outright — the native
// picker route (`extension/add-local`) is the only way an absolute path
// reaches `addExtension`, because that path came from the host's own dialog,
// never from the renderer. Without this, any same-origin script could name an
// arbitrary JS file on disk and have `extension/validate` import() it.
//
// An npm install goes through the native trust gate first (third-party code
// runs with the app's full privileges); a bundled name or a path never
// prompts. `null` means the author cancelled that gate.
interface Body {
  projectDir: string;
  specifier: string;
  kind: 'bundled' | 'path' | 'npm';
  exportName?: string;
}

export const POST: RequestHandler = defineRoute<Body>({
  validate: async (raw) => {
    const body = raw as { projectDir?: string; specifier?: string; exportName?: string };
    const projectDir = await requireProjectDir(body.projectDir, 'extension/add');
    if (typeof body.specifier !== 'string' || !body.specifier.trim()) {
      error(400, 'extension/add requires a specifier');
    }
    if (body.exportName !== undefined && (typeof body.exportName !== 'string' || !body.exportName.trim())) {
      error(400, 'extension/add exportName must be a non-empty string');
    }
    const specifier = body.specifier.trim();
    const lib = await loadLib();
    let kind: Body['kind'];
    try {
      kind = lib.parseExtensionSpecifier(specifier).kind;
    } catch (e) {
      error(400, e instanceof Error ? e.message : String(e));
    }
    if (kind === 'path') {
      if (!specifier.startsWith('./') && !specifier.startsWith('../')) {
        error(400, 'extension/add takes a project-relative path (./x or ../x) — choose an absolute path with extension/add-local');
      }
      await requireWithinProjectRoot(path.resolve(projectDir, specifier), 'extension/add');
    }
    return {
      projectDir,
      specifier,
      kind,
      ...(body.exportName ? { exportName: body.exportName.trim() } : {}),
    };
  },
  call: async ({ body }) => {
    if (body.kind === 'npm') {
      const hooks = getDesktopHooks();
      if (!hooks) error(503, 'Desktop hooks not registered');
      if (!(await hooks.confirmNpmPluginInstall(body.specifier))) return null;
    }
    const lib = await loadLib();
    return lib.addExtension(body.projectDir, body.specifier, body.exportName ? { exportName: body.exportName } : {});
  },
});

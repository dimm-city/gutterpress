import { error } from '@sveltejs/kit';
import path from 'node:path';
import {
  getConflictPreviewHooks,
  type ConflictKind,
  type ConflictPreviewHooks,
} from '../../../../../electron/server-bridge/conflict-preview-hooks';
import { defineRoute, requireAbsolute, requireWithinProjectRoot } from '../../_lib/route';
import type { RequestHandler } from './$types';

const VALID_KINDS: ReadonlySet<string> = new Set(['both-edited', 'you-deleted', 'online-deleted']);

export const POST: RequestHandler = defineRoute<
  { projectDir: string; path: string; kind: ConflictKind },
  ConflictPreviewHooks
>({
  hooks: getConflictPreviewHooks,
  hooksUnavailableMessage: 'Conflict preview hooks not registered',
  // P1 review, PR #98 finding #5: `projectDir` used to only be checked for
  // `isAbsolute` (via `requireAbsolute`) — ANY absolute directory was
  // accepted and handed straight to the host's `getConflictPreviewImpl`,
  // which reads it as the "mine" copy of the conflicted file. A same-origin
  // renderer script (preview XSS, malicious plugin, compromised dep) could
  // call this route with `projectDir` pointed at e.g. the user's home
  // directory to read arbitrary files on disk. `requireWithinProjectRoot`
  // (ARCH #37, realpath-based) confines it to the currently-open project,
  // the same guard every other fs-touching route uses.
  //
  // Confining `projectDir` alone is not enough: the caller-supplied relative
  // `path` is joined to a directory and read. Two layers check it, and which
  // one is AUTHORITATIVE changed with the 2026-07-29 audit:
  //
  //   - Here: `resolve(projectDir, path)` must stay inside the open project,
  //     canonically (symlink-safe via `realpathTolerant`). This is
  //     defense-in-depth on the renderer's own framing — it catches a `..` or
  //     a project-local symlink escape (`projectDir/alias -> /etc`) one layer
  //     early, and cannot false-reject a genuine conflict path, which is
  //     repo-relative and so always resolves *inside* whatever directory it is
  //     joined to.
  //   - In the host: `getConflictPreviewImpl` repeats the canonical check
  //     against the base it ACTUALLY resolves against — the detected repo
  //     root, because conflict paths are repo-root-relative (see
  //     `conflictBaseDir`). That base is host state, not `projectDir`, so only
  //     the host can check the path it really opens.
  validate: async (raw) => {
    const body = raw as { projectDir?: string; path?: string; kind?: string };
    if (!body?.projectDir || !body?.path) {
      error(400, 'sync:getConflictPreview requires { projectDir, path }');
    }
    const projectDir = await requireWithinProjectRoot(
      requireAbsolute(body.projectDir, 'sync:getConflictPreview'),
      'sync:getConflictPreview',
    );
    const rawKind = body.kind ?? 'both-edited';
    if (!VALID_KINDS.has(rawKind)) {
      error(400, `sync:getConflictPreview: invalid kind "${rawKind}"; must be both-edited | you-deleted | online-deleted`);
    }
    await requireWithinProjectRoot(path.resolve(projectDir, body.path!), 'sync:getConflictPreview');
    return { projectDir, path: body.path!, kind: rawKind as ConflictKind };
  },
  call: async ({ body, hooks }) => hooks.getConflictPreview(body.projectDir, body.path, body.kind),
});

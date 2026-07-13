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
  // Confining `projectDir` alone is not enough: `getConflictPreviewImpl`
  // (electron/recovery-bridge.ts) joins it with the caller-supplied relative
  // `path` using a LEXICAL `path.resolve` + `startsWith` check, which does
  // not follow symlinks — a project-local symlink aliasing an outside
  // directory (`projectDir/alias -> /etc`) passes that lexical check but is
  // then followed outside the project by the actual `readFile`/
  // `existsSync` calls. So the derived file target is independently
  // confined here too, canonically (`requireWithinProjectRoot` again,
  // symlink-safe via `realpathTolerant`) before the request ever reaches the
  // host handler.
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

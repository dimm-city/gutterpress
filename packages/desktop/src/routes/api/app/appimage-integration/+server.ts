/**
 * Linux AppImage application-menu integration (#119).
 *
 * `GET` reports status; `POST { action }` performs one of exactly two fixed
 * actions. The route accepts NO path input — the managed destinations are
 * computed host-side (electron/appimage-integration.ts) from the real home
 * directory and `$XDG_DATA_HOME`, so a renderer cannot redirect the install.
 */
import { error } from '@sveltejs/kit';
import { friendlyAppImageError } from '../../../../../electron/server-bridge/friendly-errors';
import { defineRoute, getHostServices } from '../../_lib/route';
import type { RequestHandler } from './$types';

const ACTIONS = ['install', 'remove'] as const;
type Action = (typeof ACTIONS)[number];

export const GET: RequestHandler = defineRoute<Record<string, never>>({
  call: async () => getHostServices().appImage.getStatus(),
});

export const POST: RequestHandler = defineRoute<{ action: Action }>({
  validate: (body) => {
    const action = (body as { action?: unknown } | null)?.action;
    if (typeof action !== 'string' || !ACTIONS.includes(action as Action)) {
      error(400, `action must be one of: ${ACTIONS.join(', ')}`);
    }
    return { action: action as Action };
  },
  call: async ({ body }) =>
    body.action === 'install' ? getHostServices().appImage.install() : getHostServices().appImage.remove(),
  // Every realistic failure here is a raw node:fs error (EACCES on a locked-down
  // home, EROFS, ENOSPC mid-copy). Without this the author would see
  // "EACCES: permission denied, copyfile '/home/…' -> '/home/…'" in the
  // Settings panel — see friendly-errors.ts's vcs/remote/publish siblings.
  onError: (e) => friendlyAppImageError(e, 'app/appimage-integration'),
});

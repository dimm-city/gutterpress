/**
 * Linux AppImage application-menu integration (#119).
 *
 * `GET` reports status; `POST { action }` performs one of exactly two fixed
 * actions. The route accepts NO path input — the managed destinations are
 * computed host-side (electron/appimage-integration.ts) from the real home
 * directory and `$XDG_DATA_HOME`, so a renderer cannot redirect the install.
 */
import { error } from '@sveltejs/kit';
import { getAppImageHooks, type AppImageHooks } from '$lib/server/host-hooks.js';
import { defineRoute } from '../../_lib/route';
import type { RequestHandler } from './$types';

const ACTIONS = ['install', 'remove'] as const;
type Action = (typeof ACTIONS)[number];

export const GET: RequestHandler = defineRoute<Record<string, never>, AppImageHooks>({
  hooks: getAppImageHooks,
  hooksUnavailableMessage: 'AppImage integration hooks not registered',
  call: async ({ hooks }) => hooks.getStatus(),
});

export const POST: RequestHandler = defineRoute<{ action: Action }, AppImageHooks>({
  hooks: getAppImageHooks,
  hooksUnavailableMessage: 'AppImage integration hooks not registered',
  validate: (body) => {
    const action = (body as { action?: unknown } | null)?.action;
    if (typeof action !== 'string' || !ACTIONS.includes(action as Action)) {
      error(400, `action must be one of: ${ACTIONS.join(', ')}`);
    }
    return { action: action as Action };
  },
  call: async ({ body, hooks }) =>
    body.action === 'install' ? hooks.install() : hooks.remove(),
});

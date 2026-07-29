// Thin re-export so updater server routes reach the hooks accessor through a
// short `$lib/server/*` path (same shim pattern as settings.ts/host-hooks.ts).
export { getUpdaterHooks, type UpdaterHooks } from '../../../electron/server-bridge/updater-hooks';

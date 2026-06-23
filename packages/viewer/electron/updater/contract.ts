// ──────────────────────────────────────────────────────────────────────────
// contract.ts — shared constant for the runtime update system
//
// The runtime (UI + engine) is distributed as the npm package
// `@dimm-city/print-md`. Trust comes from the registry `dist.integrity` (SSRI,
// verified in integrity.ts) over HTTPS with 2FA-protected publish — there is no
// app-managed signing key. This module is the single source of truth for the
// IPC-surface contract version. Main-process only; the renderer never imports it.
// ──────────────────────────────────────────────────────────────────────────

/**
 * Integer IPC-surface contract version shared between the Electron shell and
 * the runtime package (SPA + engine). Bump ONLY when an ipcMain.handle() method
 * that the SPA calls is added or removed, and publish the package with a
 * matching `printmd.requiresDesktopApi`. The updater refuses to activate a
 * downloaded version whose `requiresDesktopApi` exceeds this value, so an older
 * shell never loads a too-new runtime.
 */
export const DESKTOP_API = 2;

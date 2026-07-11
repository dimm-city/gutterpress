/**
 * Pure navigation / origin policy decisions for the Electron main process
 * (Phase 0 security hardening — ARCH review findings #1 (critical) and #33).
 *
 * Deliberately dependency-free (no `electron` import) so the policy can be
 * unit-tested with plain `bun test` and reasoned about without a live
 * BrowserWindow. main.ts wires these pure decisions to the real Electron
 * APIs: `will-navigate`, `setWindowOpenHandler`, and a single sender-checking
 * wrapper around every `ipcMain.handle` registration — one mechanism instead
 * of hand-rolled checks per channel.
 */

/** The production app:// origin the SvelteKit SPA is served from (registerAppProtocol). */
export const APP_ORIGIN = "app://local";

export interface OriginPolicyConfig {
  /** The production app:// origin the SPA is served from. */
  appOrigin: string;
  /**
   * The Vite dev server origin (`process.env.VITE_DEV_SERVER_URL`), set only
   * when running `electron-vite dev`. `null`/`undefined` in production.
   */
  devServerOrigin?: string | null;
}

/**
 * Scheme+host "origin" for comparison purposes. Deliberately NOT
 * `new URL(url).origin`: WHATWG origin computation treats any scheme it
 * doesn't recognize as "special" (http/https/ws/wss/ftp/file) — including
 * Electron's privileged custom `app:` scheme — as an opaque origin that
 * serializes to the literal string `"null"` regardless of host, and `file:`
 * origins are opaque too. Both would make every custom-scheme/file URL
 * compare equal to every other one. Comparing `protocol + "//" + host`
 * directly distinguishes `app://local` from `app://evil` and from `file://`.
 */
function originOf(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/**
 * True if `url`'s origin is the app's own origin (prod) or the configured
 * dev-server origin (dev only — absent in production so a stray env var
 * can't widen the trust boundary of a packaged build).
 */
export function isTrustedAppUrl(url: string, config: OriginPolicyConfig): boolean {
  const origin = originOf(url);
  if (!origin) return false;
  if (origin === originOf(config.appOrigin)) return true;
  if (config.devServerOrigin && origin === originOf(config.devServerOrigin)) return true;
  return false;
}

export type NavigationDecision =
  | { action: "allow" }
  | { action: "open-external"; url: string }
  | { action: "deny" };

/**
 * Decide what should happen when the main window's top frame attempts to
 * navigate to `url` (the `will-navigate` event). App/dev URLs are allowed to
 * navigate in place; http(s) URLs never load inside the BrowserWindow — they
 * are routed to the system browser instead; anything else (file:,
 * javascript:, data:, arbitrary custom schemes…) is denied outright.
 */
export function decideNavigation(url: string, config: OriginPolicyConfig): NavigationDecision {
  if (isTrustedAppUrl(url, config)) return { action: "allow" };
  if (/^https?:/i.test(url)) return { action: "open-external", url };
  return { action: "deny" };
}

export type WindowOpenDecision =
  | { action: "deny" }
  | { action: "open-external"; url: string };

/**
 * Decide what should happen for a `window.open()` / `target="_blank"`
 * request (`setWindowOpenHandler`). No in-app popup flow is required by any
 * current feature — the GitHub device-flow connect and every external link
 * already go through `shell.openExternal` (see AdvancedSetupDialog,
 * GitHubDialog, HelpDialog, +page.svelte). The simplest safe policy is to
 * never grant a popup its own BrowserWindow (so there is nothing that could
 * inherit, or need to be stripped of, the preload bridge): http(s) requests
 * are opened in the system browser, everything else is denied.
 */
export function decideWindowOpen(url: string): WindowOpenDecision {
  if (/^https?:/i.test(url)) return { action: "open-external", url };
  return { action: "deny" };
}

/**
 * Validate that an `ipcMain.handle` invocation's sender frame belongs to the
 * trusted app origin (or the dev server origin, in dev). `frameUrl` is
 * `event.senderFrame?.url` — a missing/empty value means the frame could not
 * be identified and the call must be rejected.
 */
export function isTrustedIpcSender(
  frameUrl: string | undefined | null,
  config: OriginPolicyConfig,
): boolean {
  if (!frameUrl) return false;
  return isTrustedAppUrl(frameUrl, config);
}

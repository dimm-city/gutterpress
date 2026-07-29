import { test, expect } from "bun:test";
import {
  APP_ORIGIN,
  decideNavigation,
  decideWindowOpen,
  isTrustedAppUrl,
  isTrustedIpcSender,
  resolveDevServerUrl,
  type OriginPolicyConfig,
} from "../../electron/navigation-policy";

// Phase 0 security hardening (ARCH review findings #1 + #33). These are pure
// decisions with no Electron dependency, so main.ts's will-navigate handler,
// setWindowOpenHandler, and the ipcMain.handle sender-validation wrapper can
// all defer to the same tested logic instead of 19 hand-rolled checks.

const PROD_CONFIG: OriginPolicyConfig = { appOrigin: APP_ORIGIN, devServerOrigin: null };
const DEV_CONFIG: OriginPolicyConfig = {
  appOrigin: APP_ORIGIN,
  devServerOrigin: "http://localhost:5173",
};

// ── isTrustedAppUrl ──────────────────────────────────────────────────────

test("isTrustedAppUrl accepts the app:// origin", () => {
  expect(isTrustedAppUrl("app://local/", PROD_CONFIG)).toBe(true);
  expect(isTrustedAppUrl("app://local/some/route?x=1", PROD_CONFIG)).toBe(true);
});

test("isTrustedAppUrl rejects the app origin when devServerOrigin is unset (prod)", () => {
  expect(isTrustedAppUrl("http://localhost:5173/", PROD_CONFIG)).toBe(false);
});

test("isTrustedAppUrl accepts the dev server origin only when configured (dev)", () => {
  expect(isTrustedAppUrl("http://localhost:5173/", DEV_CONFIG)).toBe(true);
  expect(isTrustedAppUrl("http://localhost:5173/foo", DEV_CONFIG)).toBe(true);
});

test("isTrustedAppUrl rejects a different host on the same scheme", () => {
  expect(isTrustedAppUrl("app://evil/", PROD_CONFIG)).toBe(false);
});

test("isTrustedAppUrl rejects an unparsable URL", () => {
  expect(isTrustedAppUrl("not a url", PROD_CONFIG)).toBe(false);
  expect(isTrustedAppUrl("", PROD_CONFIG)).toBe(false);
});

// ── decideNavigation (will-navigate) ────────────────────────────────────

test("decideNavigation allows the app origin", () => {
  expect(decideNavigation("app://local/settings", PROD_CONFIG)).toEqual({ action: "allow" });
});

test("decideNavigation allows the dev server URL only in dev", () => {
  expect(decideNavigation("http://localhost:5173/", DEV_CONFIG)).toEqual({ action: "allow" });
  expect(decideNavigation("http://localhost:5173/", PROD_CONFIG)).toEqual({
    action: "open-external",
    url: "http://localhost:5173/",
  });
});

test("decideNavigation routes http(s) URLs to the system browser instead of navigating in-place", () => {
  expect(decideNavigation("https://evil.example/phish", PROD_CONFIG)).toEqual({
    action: "open-external",
    url: "https://evil.example/phish",
  });
  expect(decideNavigation("http://example.com/", PROD_CONFIG)).toEqual({
    action: "open-external",
    url: "http://example.com/",
  });
});

test("decideNavigation denies arbitrary non-http schemes outright", () => {
  expect(decideNavigation("file:///etc/passwd", PROD_CONFIG)).toEqual({ action: "deny" });
  expect(decideNavigation("javascript:alert(1)", PROD_CONFIG)).toEqual({ action: "deny" });
  expect(decideNavigation("data:text/html,<script>1</script>", PROD_CONFIG)).toEqual({
    action: "deny",
  });
});

// ── decideWindowOpen (setWindowOpenHandler) ─────────────────────────────
// No in-app popup flow exists (GitHub device-flow + every external link already
// route through shell.openExternal), so the simplest safe policy denies every
// popup a BrowserWindow and instead opens http(s) externally.

test("decideWindowOpen routes http(s) popups to the system browser, not an in-app window", () => {
  expect(decideWindowOpen("https://github.com/login/oauth")).toEqual({
    action: "open-external",
    url: "https://github.com/login/oauth",
  });
  expect(decideWindowOpen("http://example.com/")).toEqual({
    action: "open-external",
    url: "http://example.com/",
  });
});

test("decideWindowOpen denies non-http popup schemes", () => {
  expect(decideWindowOpen("file:///etc/passwd")).toEqual({ action: "deny" });
  expect(decideWindowOpen("app://local/")).toEqual({ action: "deny" });
});

// ── isTrustedIpcSender (ipcMain.handle sender validation) ──────────────

test("isTrustedIpcSender accepts a senderFrame.url on the app origin", () => {
  expect(isTrustedIpcSender("app://local/index.html", PROD_CONFIG)).toBe(true);
});

test("isTrustedIpcSender accepts the dev server origin in dev only", () => {
  expect(isTrustedIpcSender("http://localhost:5173/", DEV_CONFIG)).toBe(true);
  expect(isTrustedIpcSender("http://localhost:5173/", PROD_CONFIG)).toBe(false);
});

test("isTrustedIpcSender rejects a foreign origin (the exploit chain in finding #1)", () => {
  expect(isTrustedIpcSender("https://evil.example/", PROD_CONFIG)).toBe(false);
});

test("isTrustedIpcSender rejects a missing/undefined senderFrame url", () => {
  expect(isTrustedIpcSender(undefined, PROD_CONFIG)).toBe(false);
  expect(isTrustedIpcSender(null, PROD_CONFIG)).toBe(false);
  expect(isTrustedIpcSender("", PROD_CONFIG)).toBe(false);
});

// ── resolveDevServerUrl (ARCH review finding #1, CRITICAL) ─────────────────
//
// A packaged app must NEVER trust VITE_DEV_SERVER_URL. Without this gate, an
// attacker who launches the packaged binary with that env var set (e.g.
// `VITE_DEV_SERVER_URL=https://evil.example ./gutterpress`) can point the
// window at remote content AND have that origin added to the trusted-origin
// policy that guards the full IPC bridge (secureHandle / isTrustedIpcSender)
// and top-frame navigation (decideNavigation). `isPackaged` must come from
// `app.isPackaged` in the caller (main.ts) — this function stays
// electron-dependency-free so the gate itself is directly unit-testable.

test("resolveDevServerUrl: packaged build ignores VITE_DEV_SERVER_URL entirely, even when set", () => {
  expect(resolveDevServerUrl(true, "http://localhost:5173")).toBeNull();
  expect(resolveDevServerUrl(true, "https://evil.example")).toBeNull();
});

test("resolveDevServerUrl: packaged build with no env var is also null", () => {
  expect(resolveDevServerUrl(true, undefined)).toBeNull();
  expect(resolveDevServerUrl(true, "")).toBeNull();
});

test("resolveDevServerUrl: unpackaged (dev) build honors VITE_DEV_SERVER_URL", () => {
  expect(resolveDevServerUrl(false, "http://localhost:5173")).toBe(
    "http://localhost:5173",
  );
});

test("resolveDevServerUrl: unpackaged build with no env var is null (prod-style load, still dev binary)", () => {
  expect(resolveDevServerUrl(false, undefined)).toBeNull();
  expect(resolveDevServerUrl(false, "")).toBeNull();
});

test("exploit chain from finding #1: a packaged app launched with VITE_DEV_SERVER_URL set must not trust that origin for IPC or navigation", () => {
  const attackerUrl = "https://evil.example/";
  const isPackaged = true; // the packaged-build scenario the finding describes

  const config: OriginPolicyConfig = {
    appOrigin: APP_ORIGIN,
    devServerOrigin: resolveDevServerUrl(isPackaged, attackerUrl),
  };

  // The origin policy must never pick up the attacker-controlled env var...
  expect(config.devServerOrigin).toBeNull();
  // ...so the IPC bridge rejects a sender on that origin...
  expect(isTrustedIpcSender(attackerUrl, config)).toBe(false);
  // ...and top-frame navigation to it is routed to the system browser, not
  // allowed to load in place with the preload bridge intact.
  expect(decideNavigation(attackerUrl, config)).toEqual({
    action: "open-external",
    url: attackerUrl,
  });
});

test("dev build launched normally still trusts its own dev server (no regression)", () => {
  const devUrl = "http://localhost:5173/";
  const isPackaged = false;

  const config: OriginPolicyConfig = {
    appOrigin: APP_ORIGIN,
    devServerOrigin: resolveDevServerUrl(isPackaged, devUrl),
  };

  expect(config.devServerOrigin).toBe(devUrl);
  expect(isTrustedIpcSender(devUrl, config)).toBe(true);
  expect(decideNavigation(devUrl, config)).toEqual({ action: "allow" });
});

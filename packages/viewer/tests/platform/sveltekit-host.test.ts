/**
 * Unit tests for electron/sveltekit-host.ts's buildHostErrorPage (ARCH review
 * #28) — the extracted, pure HTML-page builder behind the app:// protocol's
 * 503 ("server not started") and 502 ("proxy error") responses.
 *
 * Previously both responses were a raw text body with no explanation and no
 * way to recover short of force-quitting the app. buildHostErrorPage() is a
 * pure function (no `protocol`/`Response`/Electron dependency) — this file
 * only ever calls that one export, never registerAppProtocol()/
 * startSvelteKitServer() (which do touch `protocol`/`app`).
 *
 * sveltekit-host.ts still imports `{ app, protocol } from "electron"` at
 * module scope though, so importing it at all requires a mock: outside a
 * real Electron process "electron" resolves to the real npm package's
 * launcher stub, whose `getElectronPath()` tries to download/locate the
 * Electron binary and throws (see tests/updater/electron-updater.test.ts's
 * note on the same hazard for `app`).
 */
import { test, expect, mock } from "bun:test";
import { electronMock } from "../support/electron-mock";

// NOTE: `bun test --isolate` does not fully sandbox `mock.module("electron", …)`
// registrations between files that all touch the "electron" specifier — other
// electron-mocking suites in this run (tests/updater/electron-updater.test.ts,
// tests/platform/pdf-export.test.ts, tests/platform/credential-store.test.ts)
// can end up "winning" the shared registration for this specifier. So every
// such suite mocks the SAME superset of keys every electron/*.ts production
// module statically imports from "electron" (app.getPath, protocol,
// BrowserWindow, safeStorage) — whichever file's registration is actually
// live, every other suite's named imports still resolve. Keep this superset
// in sync with any new `from "electron"` import added to electron/*.ts.
mock.module("electron", () => electronMock());

const { buildHostErrorPage } = await import("../../electron/sveltekit-host");

test("buildHostErrorPage renders the title and message as plain, readable HTML", () => {
  const html = buildHostErrorPage({
    title: "print-md is still starting",
    message: "The app's internal server hasn't started yet.",
  });
  expect(html).toContain("<!doctype html>");
  expect(html).toContain("print-md is still starting");
  expect(html).toContain("The app&#39;s internal server hasn&#39;t started yet.".replace(/&#39;/g, "'"));
});

test("buildHostErrorPage always includes retry guidance and a working retry action", () => {
  const html = buildHostErrorPage({
    title: "print-md ran into a problem",
    message: "A request to the app's internal server failed.",
  });
  expect(html.toLowerCase()).toContain("try again");
  expect(html).toContain('onclick="location.reload()"');
  expect(html.toLowerCase()).toContain("retry");
});

test("buildHostErrorPage omits the detail block when no detail is given", () => {
  const html = buildHostErrorPage({ title: "t", message: "m" });
  expect(html).not.toContain("<code>");
});

test("buildHostErrorPage includes an escaped detail block when detail is given", () => {
  const html = buildHostErrorPage({
    title: "print-md ran into a problem",
    message: "A request to the app's internal server failed.",
    detail: "TypeError: fetch failed",
  });
  expect(html).toContain("<code>TypeError: fetch failed</code>");
});

test("buildHostErrorPage HTML-escapes title/message/detail so host error text can't break the page", () => {
  const html = buildHostErrorPage({
    title: "<script>alert(1)</script>",
    message: "safe & sound",
    detail: "<img src=x onerror=alert(2)>",
  });
  expect(html).not.toContain("<script>alert(1)</script>");
  expect(html).toContain("&lt;script&gt;");
  expect(html).toContain("safe &amp; sound");
  expect(html).not.toContain("<img src=x");
  expect(html).toContain("&lt;img src=x onerror=alert(2)&gt;");
});

test("buildHostErrorPage has no external asset/script/font references (must render standalone)", () => {
  const html = buildHostErrorPage({ title: "t", message: "m", detail: "d" });
  expect(html).not.toMatch(/<link/i);
  expect(html).not.toMatch(/<script\s+src/i);
  expect(html).not.toMatch(/https?:\/\//i);
});

import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const main = readFileSync(
  path.resolve(import.meta.dir, "../../electron/main.ts"),
  "utf8",
);

test("the GitHub connect handler shows the host-side basic_text notice after obtaining a device code", () => {
  const start = main.indexOf('secureHandle("remote:connectGitHubStart"');
  expect(start).toBeGreaterThan(-1);
  const handler = main.slice(start, start + 500);
  expect(handler).toContain("const info = await githubDeviceFlow.start()");
  expect(handler).toContain("await showLinuxCredentialStorageNoticeOnce()");
  expect(handler.indexOf("githubDeviceFlow.start()")).toBeLessThan(
    handler.indexOf("showLinuxCredentialStorageNoticeOnce()"),
  );
});

test("the warning is marked shown only after the native dialog succeeds", () => {
  const start = main.indexOf("async function showLinuxCredentialStorageNoticeOnce");
  expect(start).toBeGreaterThan(-1);
  const fn = main.slice(start, main.indexOf('secureHandle("remote:connectGitHubStart"', start));
  expect(fn).toContain("shouldShowLinuxBasicTextStorageNotice()");
  expect(fn).toContain("dialog.showMessageBox");
  expect(fn).toContain("markLinuxBasicTextStorageNoticeShown()");
  expect(fn.indexOf("dialog.showMessageBox")).toBeLessThan(
    fn.indexOf("markLinuxBasicTextStorageNoticeShown()"),
  );
  expect(fn).toContain("Your Linux desktop keyring isn't available");
  expect(fn).not.toMatch(/\btoken\b/i);
});

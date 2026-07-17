/**
 * shell/open-external must only ever hand http(s) URLs to the OS (audit C1),
 * via the shared isHttpUrl gate it now shares with navigation-policy.ts and
 * the host-side openExternal hook. The scheme check lives in the route's
 * validate step, so a foreign-scheme URL is rejected before any host hook is
 * reached.
 */
import { beforeEach, expect, test } from "bun:test";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { POST as openExternalRoute } from "../../src/routes/api/shell/open-external/+server";
import { caught, request } from "../support/route-test-helpers";

// The scheme check runs in validate, AFTER defineRoute's hooks-availability
// gate. Register a minimal host whose `desktop` slice exists (openExternal is
// never reached for the rejection cases) so the route reaches validate.
let openedUrls: string[] = [];
beforeEach(() => {
  openedUrls = [];
  registerHostServices({
    desktop: { openExternal: async (url: string) => void openedUrls.push(url) },
  } as unknown as HostServices);
});

function call(url: unknown) {
  return openExternalRoute({ request: request({ url }) } as Parameters<typeof openExternalRoute>[0]);
}

test("rejects a file:// URL with 400", async () => {
  const { status } = await caught(call("file:///etc/passwd"));
  expect(status).toBe(400);
});

test("rejects a custom-scheme URL with 400", async () => {
  const { status } = await caught(call("app://internal/secret"));
  expect(status).toBe(400);
});

test("rejects a mailto: URL with 400", async () => {
  const { status } = await caught(call("mailto:someone@example.com"));
  expect(status).toBe(400);
});

test("rejects a missing url with 400", async () => {
  const { status } = await caught(call(undefined));
  expect(status).toBe(400);
});

test("accepts an https URL and forwards it to the host", async () => {
  await call("https://example.com/docs");
  expect(openedUrls).toEqual(["https://example.com/docs"]);
});

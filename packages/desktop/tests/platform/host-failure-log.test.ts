/**
 * Failures the app log must record so there is something to diagnose from:
 * a host route that fails unexpectedly, and a publish that ran but failed.
 * The author sees one sentence of each; a packaged app has no console.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { error } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { jsonRoute } from "../../src/routes/api/_lib/handler";

let logged: string[];
const quiet = console.error;

beforeEach(() => {
  logged = [];
  console.error = () => {};
  registerHostServices({ app: { logFailure: (line: string) => logged.push(line) } } as unknown as HostServices);
});
afterEach(() => {
  console.error = quiet;
  registerHostServices(undefined as unknown as HostServices);
});

const event = (pathname: string) =>
  ({
    url: new URL(`app://local${pathname}`),
    request: new Request(`app://local${pathname}`, { method: "POST", body: "{}" }),
  }) as never;

test("a route that fails unexpectedly is logged with its path, message and stack", async () => {
  const route = jsonRoute(async () => {
    throw new Error("ENOSPC: no space left on device");
  });
  await expect(route(event("/api/manifest/set-fields"))).rejects.toMatchObject({ status: 500 });
  expect(logged[0]).toBe("[/api/manifest/set-fields] failed: ENOSPC: no space left on device");
  expect(logged[1]).toContain("host-failure-log.test.ts");
});

test("a refusal the route chose itself is not a fault, and is not logged", async () => {
  const route = jsonRoute(async () => {
    throw error(400, "projectDir requires an absolute path");
  });
  await expect(route(event("/api/manifest/read"))).rejects.toMatchObject({ status: 400 });
  expect(logged).toEqual([]);
});

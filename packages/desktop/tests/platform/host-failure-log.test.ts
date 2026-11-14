/**
 * Failures the app log must record so there is something to diagnose from:
 * a host route that fails unexpectedly, and a publish that ran but failed.
 * The author sees one sentence of each; a packaged app has no console.
 */
import { afterEach, beforeEach, expect, test } from "bun:test";
import { error } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { logPublishOutcome } from "../../electron/server-bridge/friendly-errors";
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

test("a publish that ran but failed is logged with the destination and the reason", () => {
  logPublishOutcome("itch", { ok: false, error: "butler push failed (exit 1)\nstderr: invalid API key" });
  expect(logged).toEqual(["[publish] itch failed: butler push failed (exit 1)\nstderr: invalid API key"]);
});

test("a publish blocked by its own checks is logged with each blocking problem", () => {
  logPublishOutcome("itch", {
    ok: false,
    error: "Preflight found problems that block publishing.",
    issues: [
      { severity: "error", id: "itch/target-missing", message: "Set publish.itch.target to user/game." },
      { severity: "info", id: "itch/tip", message: "A tip, not a problem." },
    ],
  });
  expect(logged).toEqual([
    "[publish] itch failed: Preflight found problems that block publishing.",
    "  itch/target-missing: Set publish.itch.target to user/game.",
  ]);
});

test("a publish that worked logs nothing", () => {
  logPublishOutcome("itch", { ok: true });
  expect(logged).toEqual([]);
});

test("a sign-in carried in a URL never reaches the log", () => {
  logPublishOutcome("gdrive", { ok: false, error: "GET https://me:tok3n@www.googleapis.com/x failed" });
  expect(logged.join("\n")).not.toContain("tok3n");
});

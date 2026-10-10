import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices } from "../../electron/server-bridge/host-services";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { makeHostServices } from "../support/host-services-fake";
import { POST } from "../../src/routes/api/lint/project/+server";

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "gp-lint-route-"));
  registerHostServices(
    makeHostServices({ fsGuard: { projectRoots: () => [dir], readOnlyRoots: () => [] as string[] } }),
  );
});
afterEach(async () => {
  setLibForTests(null);
  await rm(dir, { recursive: true, force: true });
});

const call = () =>
  POST({ request: new Request("http://local.test/api/lint/project", { method: "POST", body: JSON.stringify({ projectDir: dir }) }) } as Parameters<typeof POST>[0]);

class FakeBuildError extends Error {}

test("a check run that cannot download a pinned extension reports why as a problem, not as a failed check", async () => {
  const message = "Could not download gp-x@1.0.0 (pinned in manifest.yaml): ECONNREFUSED. Check your internet connection and try again.";
  setLibForTests({
    BuildError: FakeBuildError,
    executeValidation: async () => {
      throw new FakeBuildError(message);
    },
  } as unknown as Partial<LibModule>);

  const res = await call();

  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ severity: "error", message, source: "extensions.restore" }]);
});

test("any other failure stays a failure", async () => {
  setLibForTests({
    BuildError: FakeBuildError,
    executeValidation: async () => {
      throw new Error("boom");
    },
  } as unknown as Partial<LibModule>);

  await expect(call()).rejects.toMatchObject({ status: 500 });
});

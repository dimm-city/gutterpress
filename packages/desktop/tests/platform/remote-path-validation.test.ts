/**
 * remote/sync and remote/diagnose-project validate absolute paths with the
 * shared `requireAbsolute()` helper in `validate()`, same as their
 * remote/clone-repository sibling. A hand-rolled `isAbsolute(...)` +
 * `throw new Error(...)` INSIDE the `handleRemoteErrors`-wrapped call would
 * be replaced with the generic "could not be completed" message and default
 * to a 500 (a plain Error, not an HttpError) — a relative-path typo surfacing
 * as a mystery 500 instead of a clear 400. With `validate()` the check runs (and throws its `error(400, ...)` HttpError) BEFORE
 * handleRemoteErrors ever wraps the call.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as remoteSyncRoute } from "../../src/routes/api/remote/sync/+server";
import { POST as diagnoseProjectRoute } from "../../src/routes/api/remote/diagnose-project/+server";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";

function request(body?: unknown): Request {
  return body === undefined
    ? new Request("http://local.test")
    : new Request("http://local.test", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
}

async function caught(p: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return { status: e.status, message: (e.body as { message?: unknown }).message };
  }
}

/** The shared base fake — each test overrides `remote` with the hook it's exercising. */
function baseServices(): HostServices {
  return makeHostServices();
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

const remoteBase = { tokenStore: {} as never, GITHUB_HOST: "github.com" };

describe("POST /api/remote/sync", () => {
  test("400 (not 500) when projectDir is relative", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, syncProject: async () => ({ status: "synced" }) } as never,
    });
    const { status, message } = await caught(
      remoteSyncRoute({ request: request({ projectDir: "rel/path" }) } as never),
    );
    expect(status).toBe(400);
    expect(message).toBe("remote:sync requires an absolute path, got: rel/path");
  });

  test("400 (not 500) when projectDir is missing", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, syncProject: async () => ({ status: "synced" }) } as never,
    });
    const { status } = await caught(remoteSyncRoute({ request: request({}) } as never));
    expect(status).toBe(400);
  });
});

describe("POST /api/remote/sync: Bring them in (#524)", () => {
  /** The options the route handed the lib's sync, for each request. */
  async function optionsFor(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    registerHostServices(makeHostServices({ fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] } }));
    let seen: Record<string, unknown> = {};
    setLibForTests({
      syncProject: async (options: Record<string, unknown>) => {
        seen = options;
        return { status: "up-to-date", message: "" };
      },
    } as unknown as Partial<LibModule>);
    await remoteSyncRoute({ request: request({ projectDir: "/abs/project", ...body }) } as never);
    return seen;
  }

  test("bringInMainDraft: true reaches the lib's pass", async () => {
    const seen = await optionsFor({ push: false, bringInMainDraft: true });
    expect(seen).toMatchObject({ projectDir: "/abs/project", push: false, bringInMainDraft: true });
  });

  test("anything but true leaves it out, so an ordinary pass never combines the Main draft", async () => {
    expect(await optionsFor({ push: false })).not.toHaveProperty("bringInMainDraft");
    expect(await optionsFor({ push: false, bringInMainDraft: "yes" })).not.toHaveProperty("bringInMainDraft");
  });
});

describe("POST /api/remote/diagnose-project", () => {
  test("400 (not 500) when projectDir is relative", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, diagnoseProjectRemote: async () => ({}) } as never,
    });
    const { status, message } = await caught(
      diagnoseProjectRoute({ request: request({ projectDir: "rel/path" }) } as never),
    );
    expect(status).toBe(400);
    expect(message).toBe("remote:diagnoseProject requires an absolute path, got: rel/path");
  });

  test("400 (not 500) when projectDir is missing", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, diagnoseProjectRemote: async () => ({}) } as never,
    });
    const { status } = await caught(diagnoseProjectRoute({ request: request({}) } as never));
    expect(status).toBe(400);
  });
});

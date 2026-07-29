/**
 * ARCH review #36 — "some routes enforce absolute paths via requireAbsolute(),
 * some hand-roll isAbsolute()" inconsistency. remote/sync and
 * remote/diagnose-project hand-rolled `isAbsolute(...)` + `throw new Error(...)`
 * INSIDE the `handleRemoteErrors`-wrapped call. Since that thrown Error's
 * message ("...requires an absolute project path") doesn't match
 * REMOTE_FRIENDLY_ERROR, handleRemoteErrors replaced it with the generic
 * "could not be completed" message and (because it's a plain Error, not an
 * HttpError) jsonRoute defaulted the status to 500 — a relative-path typo
 * surfaced as a mystery 500 instead of a clear 400. Both routes now validate
 * with the shared `requireAbsolute()` helper in `validate()`, same as their
 * remote/clone-repository and remote/resolve-sync-conflicts siblings: the
 * check runs (and throws its `error(400, ...)` HttpError) BEFORE
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

/** The shared base fake, with remote/sync/updater "not registered" — each test overrides `remote` with the hook it's exercising. */
function baseServices(): HostServices {
  return makeHostServices({ remote: undefined, sync: undefined, updater: undefined });
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };

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

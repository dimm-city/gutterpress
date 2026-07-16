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

const noop = () => {};
function baseServices(): HostServices {
  return {
    app: { updateSplash: noop, showMainWindowAndCloseSplash: noop, setRendererDirty: noop, sendToRenderer: noop },
    conflictPreview: { getConflictPreview: async () => ({ mine: "", theirs: "", kind: "both-edited" as const, isBinary: false }) },
    desktop: {
      showOpenDialog: async () => ({ canceled: true, filePaths: [] }),
      showSaveDialog: async () => ({ canceled: true }),
      openExternal: async () => {},
      showItemInFolder: noop,
      getNativeTheme: () => ({ shouldUseDarkColors: false }),
      getUserDataPath: () => "/fake/userData",
    },
    doctor: { getViewerVersion: () => "0.0.0-test" },
    fsGuard: { projectRoots: () => [], readOnlyRoots: () => [] },
    media: { createThumbnail: async () => null },
    prefs: {
      readPrefs: async () => ({}),
      writePrefs: async () => {},
      updatePrefs: async (mutate: (p: object) => object) => mutate({}),
      readSettings: async () => ({}),
      writeSettings: async () => {},
      updateSettings: async () => ({}),
      existingDirectory: async () => null,
      readProjectState: () => null,
      writeProjectState: (states: unknown) => states,
      mergeSettings: (b: unknown) => b,
      defaultProjectSearchRoots: () => [],
      scanForProjects: async () => [],
      toggleFavoriteFolder: (favorites: unknown) => ({ favorites: (favorites as []) ?? [], favorited: false }),
      removeRecentFolder: () => [],
      loadLib: async () => ({}),
    },
    recovery: { write: async () => ({ ok: true }), clear: async () => ({ ok: true }), list: async () => [] },
    remote: undefined as never,
    sync: undefined as never,
    updater: undefined as never,
    vcs: { loadLib: async () => ({}), operationLogPath: () => "/fake/log" },
    watch: { startFolderWatch: noop, stopFolderWatch: noop, getWatchedDir: () => null },
    write: { scheduleAutoSnapshot: noop, scheduleAutoSync: noop, getWatchedDir: () => null },
  } as unknown as HostServices;
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

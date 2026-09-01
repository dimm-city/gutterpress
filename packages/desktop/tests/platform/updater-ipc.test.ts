/**
 * IPC-handler tests for `electron/api/updater.ts` (SFE-P5c4 — migrated off
 * `src/routes/api/updater/{get-status,check,download}/+server.ts`, deleted).
 * `applyNow`/`onEvent` were already IPC and are untouched.
 *
 * Ports the "updater server routes" describe block from the deleted
 * `migrated-ipc-routes.test.ts` — same 503-equivalent "hooks not
 * registered" (host-disconnected) coverage and same pass-through
 * assertions, now calling `electron/api/updater.ts` directly instead of a
 * SvelteKit route handler.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { updaterGetStatus, updaterCheck, updaterDownload } from "../../electron/api/updater";

async function messageOf(p: Promise<unknown>): Promise<string | null> {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** The shared base fake, with updater defaulting to "not registered" (undefined). */
function baseServices(): HostServices {
  return makeHostServices({ updater: undefined });
}

afterEach(() => {
  // Fully UN-register — bun's test file execution order is not
  // alphabetical/deterministic, and `__gutterpressHost__` is one
  // process-wide globalThis key, so leaving even a "safe" fake object
  // registered here would leak into a sibling suite.
  registerHostServices(undefined as unknown as HostServices);
});

describe("updater:getStatus / updater:check / updater:download", () => {
  test("getStatus: rejects when updater hooks are not registered (host-disconnected)", async () => {
    registerHostServices(baseServices());
    const message = await messageOf(updaterGetStatus());
    expect(message).toBe("Updater hooks not registered");
  });

  test("check: rejects when updater hooks are not registered (host-disconnected)", async () => {
    registerHostServices(baseServices());
    const message = await messageOf(updaterCheck());
    expect(message).toBe("Updater hooks not registered");
  });

  test("download: rejects when updater hooks are not registered (host-disconnected)", async () => {
    registerHostServices(baseServices());
    const message = await messageOf(updaterDownload());
    expect(message).toBe("Updater hooks not registered");
  });

  test("getStatus: calls hooks.getStatus and returns its result", async () => {
    const fakeStatus = {
      currentVersion: "1.0.0",
      stagedVersion: null,
      availableVersion: null,
      availableAction: null,
      phase: "idle" as const,
      error: null,
    };
    registerHostServices({
      ...baseServices(),
      updater: { getStatus: () => fakeStatus, check: async () => fakeStatus, download: async () => fakeStatus },
    });
    expect(await updaterGetStatus()).toEqual(fakeStatus);
  });

  test("check: calls hooks.check (the non-silent, user-initiated form)", async () => {
    let calls = 0;
    const fakeStatus = {
      currentVersion: "1.0.0",
      stagedVersion: null,
      availableVersion: "1.1.0",
      availableAction: "download" as const,
      phase: "available" as const,
      error: null,
    };
    registerHostServices({
      ...baseServices(),
      updater: {
        getStatus: () => fakeStatus,
        check: async () => {
          calls++;
          return fakeStatus;
        },
        download: async () => fakeStatus,
      },
    });
    expect(await updaterCheck()).toEqual(fakeStatus);
    expect(calls).toBe(1);
  });

  test("download: calls hooks.download and returns its result", async () => {
    const fakeStatus = {
      currentVersion: "1.0.0",
      stagedVersion: "1.1.0",
      availableVersion: null,
      availableAction: null,
      phase: "staged" as const,
      error: null,
    };
    registerHostServices({
      ...baseServices(),
      updater: { getStatus: () => fakeStatus, check: async () => fakeStatus, download: async () => fakeStatus },
    });
    expect(await updaterDownload()).toEqual(fakeStatus);
  });
});

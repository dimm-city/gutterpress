/**
 * IPC-handler contract for `electron/api/app.ts`'s `discoverProjects` and
 * `recordFlushFailure`/`acknowledgeFlushFailure` (SFE-P5c1 — migrated off
 * `src/routes/api/app/{discover-projects,flush-failure}/+server.ts`,
 * deleted). Ports the deleted `discover-projects-route.test.ts` and
 * `flush-failure-route.test.ts` verbatim, calling the IPC handler functions
 * directly. The rest of `app.ts`'s surface (prefs/settings/native-theme/
 * recents/favorites/classify/create/adopt/dirty-state) had no dedicated
 * route-level security tests beyond what `electron/api/app.ts`'s own
 * validation reuse already proves — see the run report.
 */
import { afterEach, expect, test } from "bun:test";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { appDiscoverProjects, appAcknowledgeFlushFailure, appRecordFlushFailure } from "../../electron/api/app";

async function caught(p: Promise<unknown>): Promise<{ message: string }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    return { message: e instanceof Error ? e.message : String(e) };
  }
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

// ── app:discoverProjects — M20: a scan failure must not resolve as `[]` ─────

function servicesWith(prefsOverrides: {
  scanForProjects: (roots: string[], exclude: Set<string>) => Promise<unknown[]>;
}): HostServices {
  return makeHostServices({
    prefs: {
      defaultProjectSearchRoots: () => ["/fake/root"],
      scanForProjects: prefsOverrides.scanForProjects,
    },
  });
}

test("app:discoverProjects rejects (host-disconnected) when prefs hooks are not registered", async () => {
  const { message } = await caught(appDiscoverProjects());
  expect(message).toBe("Prefs hooks not registered");
});

test("app:discoverProjects resolves with the scan result on success — including a genuinely empty scan", async () => {
  registerHostServices(servicesWith({ scanForProjects: async () => [] }));
  expect(await appDiscoverProjects()).toEqual([]);
});

test("app:discoverProjects resolves with discovered projects when the scan finds some", async () => {
  registerHostServices(
    servicesWith({ scanForProjects: async () => [{ path: "/root/book", title: "book" }] }),
  );
  expect(await appDiscoverProjects()).toEqual([{ path: "/root/book", title: "book" }]);
});

test("app:discoverProjects: a scan failure propagates as a rejection — NOT a silent [] indistinguishable from empty", async () => {
  registerHostServices(
    servicesWith({
      scanForProjects: async () => {
        throw new Error("EACCES: permission denied");
      },
    }),
  );
  const { message } = await caught(appDiscoverProjects());
  expect(message).toBe("EACCES: permission denied");
});

// ── 2026-07-29 audit: exclude a recent's ACTIVE BOOK, not just its key ───────

test("app:discoverProjects: the exclusion set carries each recent's lastActiveBook alongside its repo root", async () => {
  let seen: Set<string> | null = null;
  registerHostServices(
    makeHostServices({
      prefs: {
        defaultProjectSearchRoots: () => ["/fake/root"],
        readPrefs: async () => ({
          recentFolders: [
            { path: "/repo", title: "repo", lastActiveBook: "/repo/books/field-guide" },
            { path: "/plain-book", title: "plain" },
          ],
          favorites: [{ path: "/fav-repo", title: "fav" }],
        }),
        scanForProjects: async (_roots: string[], exclude: Set<string>) => {
          seen = exclude;
          return [];
        },
      },
    }),
  );

  await appDiscoverProjects();

  expect(seen).not.toBeNull();
  expect([...seen!].sort()).toEqual(
    ["/fav-repo", "/plain-book", "/repo", "/repo/books/field-guide"].sort(),
  );
});

// ── app:recordFlushFailure / app:acknowledgeFlushFailure ────────────────────

function prefsHarness(initial: Record<string, unknown> = {}) {
  let prefs = initial;
  let updates = 0;
  registerHostServices(
    makeHostServices({
      prefs: {
        readPrefs: async () => prefs,
        updatePrefs: async (mutate) => {
          updates += 1;
          prefs = mutate(prefs);
          return prefs;
        },
      },
    }),
  );
  return {
    get prefs() {
      return prefs;
    },
    get updates() {
      return updates;
    },
    replace(next: Record<string, unknown>) {
      prefs = next;
    },
  };
}

test("app:recordFlushFailure stores a minimal project/timestamp marker with one atomic prefs update", async () => {
  const h = prefsHarness({ sidebarOpen: true });
  const marker = await appRecordFlushFailure("/books/field-guide");

  expect(marker.projectDir).toBe("/books/field-guide");
  expect(Number.isNaN(new Date(marker.failedAt).getTime())).toBe(false);
  expect(h.prefs).toEqual({ sidebarOpen: true, lastFlushFailed: marker });
  expect(h.updates).toBe(1);
});

test("app:acknowledgeFlushFailure clears only the surfaced marker, preserving a newer raced failure", async () => {
  const oldMarker = { projectDir: "/books/old", failedAt: "2026-07-26T10:00:00.000Z" };
  const newMarker = { projectDir: "/books/new", failedAt: "2026-07-26T11:00:00.000Z" };
  const h = prefsHarness({ lastFlushFailed: oldMarker, sidebarOpen: true });

  expect(await appAcknowledgeFlushFailure(oldMarker.failedAt)).toEqual({ acknowledged: true });
  expect(h.prefs).toEqual({ sidebarOpen: true });

  h.replace({ lastFlushFailed: newMarker, sidebarOpen: true });
  expect(await appAcknowledgeFlushFailure(oldMarker.failedAt)).toEqual({ acknowledged: false });
  expect(h.prefs).toEqual({ lastFlushFailed: newMarker, sidebarOpen: true });
});

test("app:recordFlushFailure rejects a relative project context", async () => {
  prefsHarness();
  const { message } = await caught(appRecordFlushFailure("relative/book" as unknown as string));
  expect(message).toBe(
    "app/flush-failure:record requires an absolute path, got: relative/book",
  );
});

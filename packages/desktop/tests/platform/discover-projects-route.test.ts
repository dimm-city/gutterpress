/**
 * M20 (route half): POST /api/app/discover-projects must NOT resolve `[]` on
 * a scan failure — that's indistinguishable from a genuinely empty scan for
 * every caller (ProjectsListBody's "Discovered" section, and any future
 * consumer). The route now lets a `scanForProjects` throw propagate through
 * `defineRoute`/`jsonRoute`'s existing error-response mapping instead of
 * swallowing it — no bespoke error envelope needed (api.ts's `post()`
 * already turns a non-OK response into a rejected promise, so the client can
 * already tell "empty" (resolved `[]`) apart from "failed" (rejected)).
 */
import { afterEach, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as discoverProjectsRoute } from "../../src/routes/api/app/discover-projects/+server";

function request(body: unknown = {}): Request {
  return new Request("http://local.test", {
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

/** Only `prefs` is ever read by this route — everything else stays the shared base fake. */
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

afterEach(() => {
  // See migrated-ipc-routes.test.ts: `__gutterpressHost__` is one process-wide
  // globalThis key, so always fully un-register rather than leaving a fake
  // registered that could leak into another test file's assertions.
  registerHostServices(undefined as unknown as HostServices);
});

test("503 when prefs hooks are not registered", async () => {
  const { status, message } = await caught(discoverProjectsRoute({ request: request() } as never));
  expect(status).toBe(503);
  expect(message).toBe("Prefs hooks not registered");
});

test("resolves 200 with the scan result on success — including a genuinely empty scan", async () => {
  registerHostServices(servicesWith({ scanForProjects: async () => [] }));
  const res = await discoverProjectsRoute({ request: request() } as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});

test("resolves 200 with discovered projects when the scan finds some", async () => {
  registerHostServices(
    servicesWith({ scanForProjects: async () => [{ path: "/root/book", title: "book" }] }),
  );
  const res = await discoverProjectsRoute({ request: request() } as never);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([{ path: "/root/book", title: "book" }]);
});

test("a scan failure propagates as an error response — NOT a silent [] indistinguishable from empty", async () => {
  registerHostServices(
    servicesWith({
      scanForProjects: async () => {
        throw new Error("EACCES: permission denied");
      },
    }),
  );
  const { status, message } = await caught(discoverProjectsRoute({ request: request() } as never));
  // Any non-200 error status is the discriminant the client (api.ts's post(),
  // which throws on !r.ok) already maps to a rejected promise — this test
  // only needs to lock that the route no longer swallows the throw into a
  // 200 `[]`.
  expect(status).toBeGreaterThanOrEqual(400);
  expect(message).toBe("EACCES: permission denied");
});

// ── 2026-07-29 audit: exclude a recent's ACTIVE BOOK, not just its key ───────
//
// For a repo-backed entry `recentFolders[].path` is the REPO ROOT, while
// discovery returns BOOK folders (any dir holding a manifest). Excluding by
// `path` alone therefore never matched, and a book already sitting in Recents
// was suggested again under "Discovered". `lastActiveBook` is the folder that
// entry actually reopens, so it belongs in the same exclusion set.

test("the exclusion set carries each recent's lastActiveBook alongside its repo root", async () => {
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

  await discoverProjectsRoute({ request: request() } as never);

  expect(seen).not.toBeNull();
  expect([...seen!].sort()).toEqual(
    ["/fav-repo", "/plain-book", "/repo", "/repo/books/field-guide"].sort(),
  );
});

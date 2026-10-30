/**
 * Route-level coverage for the Versions view's data (#408):
 *  - `vcs/list-snapshots-page` describes each version (backed-up flag) for a
 *    versioned book and passes a plain folder's page through untouched;
 *  - `vcs/version-changes` validates the id, then lists one version's
 *    changed files;
 *  - `vcs/online-versions` forwards to the lib with the host's token store;
 *  - `vcs/compare-file` validates the id and the path before the lib sees
 *    them;
 *  - `vcs/open-version-preview` / `close-version-preview` reach the host's
 *    version-preview seam.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { POST as listSnapshotsPage } from "../../src/routes/api/vcs/list-snapshots-page/+server";
import { POST as onlineVersions } from "../../src/routes/api/vcs/online-versions/+server";
import { POST as versionChanges } from "../../src/routes/api/vcs/version-changes/+server";
import { POST as compareFile } from "../../src/routes/api/vcs/compare-file/+server";
import { POST as openVersionPreview } from "../../src/routes/api/vcs/open-version-preview/+server";
import { POST as closeVersionPreview } from "../../src/routes/api/vcs/close-version-preview/+server";

const SHA = "a".repeat(40);

function request(body?: unknown): Request {
  return new Request("http://local.test", {
    method: "POST",
    body: JSON.stringify(body ?? {}),
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

function openProject(overrides: Parameters<typeof makeHostServices>[0] = {}): HostServices {
  const services = makeHostServices({
    fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
    ...overrides,
  });
  registerHostServices(services);
  return services;
}

function fakeLib(lib: Record<string, unknown>): void {
  setLibForTests(lib as Partial<LibModule>);
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

const entry = { id: SHA, message: "Version saved by you", timestamp: 1 };

describe("POST /api/vcs/list-snapshots-page", () => {
  test("describes each version of a versioned book", async () => {
    openProject();
    const described: string[] = [];
    fakeLib({
      detectProjectSource: async () => ({ type: "local-git-folder", path: "/abs/project", repoRoot: "/abs/project", subPath: "" }),
      providerFor: () => ({ listHistoryPage: async () => ({ entries: [entry], hasMore: false }) }),
      describeVersions: async (dir: string, entries: Array<{ id: string }>) => {
        described.push(dir, ...entries.map((e) => e.id));
        return entries.map((e) => ({ ...e, backedUp: false }));
      },
    });
    const res = await listSnapshotsPage({ request: request({ projectDir: "/abs/project" }) } as never);
    const page = await res.json();
    expect(described).toEqual(["/abs/project", SHA]);
    expect(page.entries[0].backedUp).toBe(false);
  });

  test("a plain folder's page passes through without describing", async () => {
    openProject();
    fakeLib({
      detectProjectSource: async () => ({ type: "local-folder", path: "/abs/project" }),
      providerFor: () => ({ listHistoryPage: async () => ({ entries: [], hasMore: false }) }),
      describeVersions: async () => {
        throw new Error("must not be called");
      },
    });
    const res = await listSnapshotsPage({ request: request({ projectDir: "/abs/project" }) } as never);
    expect(await res.json()).toEqual({ entries: [], hasMore: false });
  });
});

describe("POST /api/vcs/version-changes", () => {
  test("400 on a bad id; otherwise lists that one version's changed files", async () => {
    openProject();
    const calls: unknown[] = [];
    const changes = { files: [{ path: "a.md", kind: "changed", hint: "1 paragraph changed", text: true }], more: 0 };
    fakeLib({
      listVersionChanges: async (...args: unknown[]) => {
        calls.push(args);
        return changes;
      },
    });
    for (const id of ["abc", undefined, 42]) {
      const { status } = await caught(versionChanges({ request: request({ projectDir: "/abs/project", id }) } as never));
      expect(status).toBe(400);
    }
    expect(calls).toEqual([]);
    const res = await versionChanges({ request: request({ projectDir: "/abs/project", id: SHA }) } as never);
    expect(await res.json()).toEqual(changes);
    expect(calls).toEqual([["/abs/project", SHA]]);
  });
});

describe("POST /api/vcs/online-versions", () => {
  test("forwards to lib.listOnlineVersions with the host's token store", async () => {
    const services = openProject();
    let seen: unknown = null;
    fakeLib({
      listOnlineVersions: async (options: unknown) => {
        seen = options;
        return { entries: [], reason: "offline" };
      },
    });
    const res = await onlineVersions({ request: request({ projectDir: "/abs/project" }) } as never);
    expect(await res.json()).toEqual({ entries: [], reason: "offline" });
    expect((seen as { projectDir: string }).projectDir).toBe("/abs/project");
    expect((seen as { tokenStore: unknown }).tokenStore).toBe(services.remote.tokenStore);
  });
});

describe("POST /api/vcs/compare-file", () => {
  test("400 on a bad id or a path outside the book; otherwise forwards", async () => {
    openProject();
    const calls: unknown[] = [];
    fakeLib({
      compareVersionFile: async (...args: unknown[]) => {
        calls.push(args);
        return { binary: false, rows: [] };
      },
    });
    for (const id of ["abc", undefined, 42]) {
      const { status } = await caught(compareFile({ request: request({ projectDir: "/abs/project", id, path: "a.md" }) } as never));
      expect(status).toBe(400);
    }
    for (const path of ["", "  ", "/etc/passwd", "../x.md", "a/../../x.md", "C:\\x.md", undefined]) {
      const { status, message } = await caught(compareFile({ request: request({ projectDir: "/abs/project", id: SHA, path }) } as never));
      expect(status).toBe(400);
      expect(message).toBe("vcs/compare-file requires a file path inside the book");
    }
    expect(calls).toEqual([]);
    const res = await compareFile({ request: request({ projectDir: "/abs/project", id: SHA, path: "chapters/a.md" }) } as never);
    expect(await res.json()).toEqual({ binary: false, rows: [] });
    expect(calls).toEqual([["/abs/project", SHA, "chapters/a.md"]]);
  });
});

describe("POST /api/vcs/open-version-preview + close-version-preview", () => {
  test("open validates the id and returns the host's URL; close reaches the host", async () => {
    const opened: Array<[string, string]> = [];
    let closed = 0;
    openProject({
      vcs: {
        openVersionPreview: async (dir: string, id: string) => {
          opened.push([dir, id]);
          return { url: "http://127.0.0.1:4242" };
        },
        closeVersionPreview: async () => {
          closed++;
        },
      },
    });
    fakeLib({});
    const { status } = await caught(openVersionPreview({ request: request({ projectDir: "/abs/project", id: "nope" }) } as never));
    expect(status).toBe(400);
    const res = await openVersionPreview({ request: request({ projectDir: "/abs/project", id: SHA }) } as never);
    expect(await res.json()).toEqual({ url: "http://127.0.0.1:4242" });
    expect(opened).toEqual([["/abs/project", SHA]]);
    const closeRes = await closeVersionPreview({ request: request({}) } as never);
    expect(await closeRes.json()).toEqual({ closed: true });
    expect(closed).toBe(1);
  });
});

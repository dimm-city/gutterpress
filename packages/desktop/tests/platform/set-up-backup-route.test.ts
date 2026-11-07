/**
 * POST /api/remote/set-up-backup (#358): body validation, the host wiring
 * (project guard, saved-connection store, git identity) and that the lib's
 * result — including its plain-language failures — reaches the renderer
 * untouched. The lib itself is faked; its behaviour is covered by the lib's
 * online-backup.test.ts.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { setLibForTests, type LibModule } from "../../src/routes/api/_lib/route";
import { POST as setUpBackup } from "../../src/routes/api/remote/set-up-backup/+server";
import { POST as setUpBackupProgress } from "../../src/routes/api/remote/set-up-backup-progress/+server";
import { POST as showRepairBackup } from "../../src/routes/api/remote/show-repair-backup/+server";
import { POST as defaultCloneParent } from "../../src/routes/api/remote/default-clone-parent/+server";
import { POST as repairPreview } from "../../src/routes/api/remote/repair-preview/+server";
import { POST as listRepositories } from "../../src/routes/api/remote/list-repositories/+server";

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

const tokenStore = { marker: "token-store" };

function openProject(): void {
  registerHostServices(
    makeHostServices({
      fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
      remote: { tokenStore, GITHUB_HOST: "github.com" } as never,
    }),
  );
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
  setLibForTests(null);
});

describe("POST /api/remote/set-up-backup", () => {
  test("400 for a missing or malformed target", async () => {
    openProject();
    for (const target of [undefined, { kind: "create" }, { kind: "existing", owner: "o" }, { kind: "other", name: "x" }]) {
      const { status } = await caught(
        setUpBackup({ request: request({ projectDir: "/abs/project", target }) } as never),
      );
      expect(status).toBe(400);
    }
  });

  test("403 for a project outside the open book", async () => {
    openProject();
    const { status } = await caught(
      setUpBackup({ request: request({ projectDir: "/elsewhere", target: { kind: "create", name: "x" } }) } as never),
    );
    expect(status).toBe(403);
  });

  test("forwards a create target with the saved-connection store", async () => {
    const calls: Array<Record<string, unknown>> = [];
    openProject();
    setLibForTests({
      setUpOnlineBackup: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return { status: "connected", repository: { fullName: "me/my-book" } };
      },
    } as unknown as Partial<LibModule>);
    const res = await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "create", name: "my-book", private: false, extra: 1 } }),
    } as never);
    expect(await res.json()).toEqual({ status: "connected", repository: { fullName: "me/my-book" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      projectDir: "/abs/project",
      target: { kind: "create", name: "my-book", private: false },
      tokenStore,
    });
    expect(calls[0]!.target).not.toHaveProperty("extra");
  });

  test("forwards an existing-repository target", async () => {
    const calls: Array<Record<string, unknown>> = [];
    openProject();
    setLibForTests({
      setUpOnlineBackup: async (opts: Record<string, unknown>) => {
        calls.push(opts);
        return { status: "connected", repository: { fullName: "me/empty" } };
      },
    } as unknown as Partial<LibModule>);
    await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "existing", owner: "me", name: "empty" } }),
    } as never);
    expect(calls[0]!.target).toEqual({ kind: "existing", owner: "me", name: "empty" });
  });

  test("a failed set-up comes back as data with its plain message intact", async () => {
    openProject();
    const failure = {
      status: "failed",
      reason: "name-taken",
      message: 'You already have a repository named "my-book" on GitHub.',
    };
    setLibForTests({ setUpOnlineBackup: async () => failure } as unknown as Partial<LibModule>);
    const res = await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "create", name: "my-book" } }),
    } as never);
    expect(await res.json()).toEqual(failure);
  });
});


describe("set-up-backup progress", () => {
  test("steps are visible to the progress route while the call runs, and gone when it ends", async () => {
    openProject();
    let during: unknown = "unset";
    setLibForTests({
      setUpOnlineBackup: async (opts: { onProgress: (s: string) => void }) => {
        opts.onProgress("creating");
        during = await (
          await setUpBackupProgress({ request: request({ projectDir: "/abs/project" }) } as never)
        ).json();
        opts.onProgress("sending");
        return { status: "connected", repository: { fullName: "me/my-book" } };
      },
    } as unknown as Partial<LibModule>);
    await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "create", name: "my-book" } }),
    } as never);
    expect(during).toMatchObject({ progress: { step: "creating", label: "Creating the online copy…" } });
    const after = await (await setUpBackupProgress({ request: request({ projectDir: "/abs/project" }) } as never)).json();
    expect(after).toEqual({ progress: null });
  });
});

describe("POST /api/remote/repair-preview", () => {
  test("says what a repair would set aside, from the lib, refreshing with the host's sign-ins", async () => {
    openProject();
    let options: { tokenStore?: unknown } | undefined;
    setLibForTests({
      previewRepair: async (_dir: string, o: { tokenStore?: unknown }) => {
        options = o;
        return { revisions: ["Second-edition"], versions: 3, repairCopies: 1 };
      },
    } as unknown as Partial<LibModule>);
    const res = await repairPreview({ request: request({ projectDir: "/abs/project" }) } as never);
    expect(await res.json()).toEqual({ setAside: { revisions: ["Second-edition"], versions: 3 }, repairCopies: 1 });
    expect(options?.tokenStore).toBe(tokenStore);
  });

  test("403 outside the open book", async () => {
    openProject();
    const { status } = await caught(repairPreview({ request: request({ projectDir: "/elsewhere" }) } as never));
    expect(status).toBe(403);
  });
});

describe("POST /api/remote/list-repositories", () => {
  test("without a page it lists everything, as before", async () => {
    registerHostServices(
      makeHostServices({
        remote: { tokenStore: { get: async () => ({ token: "ghp_all_test_token_5678" }) }, GITHUB_HOST: "github.com" } as never,
      }),
    );
    setLibForTests({
      listGitHubRepositories: async () => [{ fullName: "a/b" }],
    } as unknown as Partial<LibModule>);
    const res = await listRepositories({ request: request({}) } as never);
    expect(await res.json()).toEqual([{ fullName: "a/b" }]);
  });

  test("a page is returned on its own, and cached briefly unless refreshed", async () => {
    registerHostServices(
      makeHostServices({
        remote: { tokenStore: { get: async () => ({ token: "ghp_cache_test_token_1234" }) }, GITHUB_HOST: "github.com" } as never,
      }),
    );
    const asked: number[] = [];
    setLibForTests({
      listGitHubRepositoriesPage: async (_c: unknown, page: number) => {
        asked.push(page);
        return { repos: [{ fullName: `page/${page}` }], page, hasMore: page < 2 };
      },
    } as unknown as Partial<LibModule>);
    const ask = async (body: unknown) => (await listRepositories({ request: request(body) } as never)).json();
    expect(await ask({ page: 1 })).toEqual({ repos: [{ fullName: "page/1" }], page: 1, hasMore: true });
    await ask({ page: 1 });
    expect(asked).toEqual([1]);
    await ask({ page: 1, refresh: true });
    await ask({ page: 2 });
    expect(asked).toEqual([1, 1, 2]);
  });
});

describe("set-up-backup: double submit and the repository list", () => {
  test("a first call finishing does not clear a second call's progress", async () => {
    openProject();
    let finishFirst!: () => void;
    const firstDone = new Promise<void>((r) => (finishFirst = r));
    let calls = 0;
    setLibForTests({
      setUpOnlineBackup: async (opts: { onProgress: (s: string) => void }) => {
        const mine = ++calls;
        opts.onProgress(mine === 1 ? "creating" : "sending");
        if (mine === 1) await firstDone;
        else await new Promise((r) => setTimeout(r, 30));
        return { status: "connected", repository: { fullName: "me/my-book" } };
      },
    } as unknown as Partial<LibModule>);
    const body = { projectDir: "/abs/project", target: { kind: "create", name: "my-book" } };
    const first = setUpBackup({ request: request(body) } as never);
    await new Promise((r) => setTimeout(r, 5));
    const second = setUpBackup({ request: request(body) } as never);
    await new Promise((r) => setTimeout(r, 5));
    finishFirst();
    await first;
    const now = await (await setUpBackupProgress({ request: request({ projectDir: "/abs/project" }) } as never)).json();
    expect(now).toMatchObject({ progress: { step: "sending" } });
    await second;
  });

  test("creating an online copy forgets the cached repository pages", async () => {
    registerHostServices(
      makeHostServices({
        fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
        remote: { tokenStore: { get: async () => ({ token: "ghp_forget_test_token_9" }) }, GITHUB_HOST: "github.com" } as never,
      }),
    );
    let listed = 0;
    setLibForTests({
      listGitHubRepositoriesPage: async (_c: unknown, page: number) => (listed++, { repos: [], page, hasMore: false }),
      setUpOnlineBackup: async () => ({ status: "connected", repository: { fullName: "me/new" } }),
    } as unknown as Partial<LibModule>);
    const list = () => listRepositories({ request: request({ page: 1 }) } as never);
    await list();
    await list();
    expect(listed).toBe(1);
    await setUpBackup({
      request: request({ projectDir: "/abs/project", target: { kind: "create", name: "new" } }),
    } as never);
    await list();
    expect(listed).toBe(2);
  });
});

describe("POST /api/remote/show-repair-backup", () => {
  test("reveals a folder inside the repair backups, and nothing else", async () => {
    const shown: string[] = [];
    registerHostServices(
      makeHostServices({
        vcs: { repairBackupDir: (slug: string) => `/userdata/repair-backups/${slug}/2026-11-07T00-00-00Z` } as never,
        desktop: { showItemInFolder: (p: string) => void shown.push(p) } as never,
      }),
    );
    const ok = await showRepairBackup({
      request: request({ filePath: "/userdata/repair-backups/book/2026-11-07T00-00-00Z" }),
    } as never);
    expect(await ok.json()).toEqual({ ok: true });
    expect(shown).toEqual(["/userdata/repair-backups/book/2026-11-07T00-00-00Z"]);
    for (const filePath of ["/home/me/book", "/userdata/repair-backups", "/userdata/repair-backups/../secrets"]) {
      const { status } = await caught(showRepairBackup({ request: request({ filePath }) } as never));
      expect(status).toBe(403);
    }
    expect(shown.length).toBe(1);
  });
});

describe("set-up-backup follow-ups", () => {
  test("a second call failing fast does not clear the first call's live progress", async () => {
    openProject();
    let finishFirst!: () => void;
    const firstDone = new Promise<void>((r) => (finishFirst = r));
    let calls = 0;
    setLibForTests({
      setUpOnlineBackup: async (opts: { onProgress: (s: string) => void }) => {
        const mine = ++calls;
        if (mine === 1) {
          opts.onProgress("sending");
          await firstDone;
          return { status: "connected", repository: { fullName: "me/b" } };
        }
        throw new Error("refused");
      },
    } as unknown as Partial<LibModule>);
    const body = { projectDir: "/abs/project", target: { kind: "create", name: "b" } };
    const first = setUpBackup({ request: request(body) } as never);
    await new Promise((r) => setTimeout(r, 5));
    await caught(setUpBackup({ request: request(body) } as never)).catch(() => null);
    const now = await (await setUpBackupProgress({ request: request({ projectDir: "/abs/project" }) } as never)).json();
    expect(now).toMatchObject({ progress: { step: "sending" } });
    finishFirst();
    await first;
  });

  test("the cached repository list is forgotten even when sending the book failed", async () => {
    registerHostServices(
      makeHostServices({
        fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
        remote: { tokenStore: { get: async () => ({ token: "ghp_forget_fail_token_7" }) }, GITHUB_HOST: "github.com" } as never,
      }),
    );
    let listed = 0;
    setLibForTests({
      listGitHubRepositoriesPage: async (_c: unknown, page: number) => (listed++, { repos: [], page, hasMore: false }),
      setUpOnlineBackup: async () => ({ status: "failed", reason: "push-failed", message: "x", repository: { fullName: "me/new" } }),
    } as unknown as Partial<LibModule>);
    const list = () => listRepositories({ request: request({ page: 1 }) } as never);
    await list();
    await setUpBackup({ request: request({ projectDir: "/abs/project", target: { kind: "create", name: "new" } }) } as never);
    await list();
    expect(listed).toBe(2);
  });
});

describe("POST /api/remote/default-clone-parent", () => {
  test("reports the documents folder + Gutterpress, and creates nothing", async () => {
    openProject();
    const res = await defaultCloneParent({ request: request({}) } as never);
    expect(await res.json()).toEqual({ path: "/home/test/Documents/Gutterpress" });
  });
});


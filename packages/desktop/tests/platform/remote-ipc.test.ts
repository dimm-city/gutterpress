/**
 * SFE-P5c3 — the credentials-sensitive group's IPC handlers
 * (`electron/api/remote.ts`), ported from the deleted
 * `src/routes/api/{remote,sync}/**` `+server.ts` route-level suites
 * (`remote-path-validation.test.ts`, the sync/remote describe blocks of
 * `migrated-ipc-routes.test.ts`) and the remote/sync half of
 * `route-scoping.test.ts`'s project-scoping table. IPC has no status-code
 * concept (`electron/api/validation.ts`'s header) — every assertion here
 * checks the thrown `Error`'s message text, the one thing every real caller
 * (the capability module, itself `friendlyHostError`-scrubbed) reads.
 *
 * SECURITY (D12): the "no token in response" describe block proves the one
 * function that receives a raw token (`remoteConnectGenericHost`) never
 * echoes it back — the exact guarantee `handleRemoteErrors`'s redaction
 * comment and the deleted route both documented.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import { mkdtempSync, mkdirSync, symlinkSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import {
  remoteCloneRepository,
  remoteConnectGenericHost,
  remoteDiagnoseProject,
  remoteDisconnectGitHub,
  remoteDisconnectHost,
  remoteForgeTokenUrl,
  remoteGetConnection,
  remoteListBranches,
  remoteListConnections,
  remoteListRepoBooks,
  remoteListRepositories,
  remoteSync,
  remoteTestRemoteAccess,
  syncGetStatus,
  syncSetAutoSync,
} from "../../electron/api/remote";

const GENERIC_REMOTE_ERROR =
  "The online repository operation could not be completed. See the app log for details.";

function baseServices(overrides: Parameters<typeof makeHostServices>[0] = {}): HostServices {
  return makeHostServices({
    remote: undefined,
    sync: undefined,
    fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
    ...overrides,
  });
}

afterEach(() => {
  registerHostServices(undefined as unknown as HostServices);
});

// ── Hooks-not-registered (the 503-equivalent: "host disconnected") ────────

describe("hooks not registered", () => {
  const remoteFns: Array<[string, () => Promise<unknown>]> = [
    ["remoteDisconnectGitHub", () => remoteDisconnectGitHub()],
    ["remoteGetConnection", () => remoteGetConnection(undefined)],
    ["remoteListRepositories", () => remoteListRepositories()],
    ["remoteListBranches", () => remoteListBranches("o", "r")],
    ["remoteListRepoBooks", () => remoteListRepoBooks("o", "r", "b")],
    ["remoteDiagnoseProject", () => remoteDiagnoseProject("/abs/project")],
    ["remoteTestRemoteAccess", () => remoteTestRemoteAccess("https://x/y.git")],
    ["remoteConnectGenericHost", () => remoteConnectGenericHost({ host: "h", token: "t" })],
    ["remoteDisconnectHost", () => remoteDisconnectHost("h")],
    ["remoteListConnections", () => remoteListConnections()],
    ["remoteForgeTokenUrl", () => remoteForgeTokenUrl("h")],
    ["remoteSync", () => remoteSync("/abs/project", undefined)],
    ["remoteCloneRepository", () => remoteCloneRepository({ url: "https://x/y.git", parentDir: "/abs" })],
  ];
  for (const [name, fn] of remoteFns) {
    test(`${name} rejects with "Remote hooks not available"`, async () => {
      registerHostServices(baseServices());
      await expect(fn()).rejects.toThrow("Remote hooks not available");
    });
  }

  test('syncSetAutoSync rejects with "Sync settings hooks not registered"', async () => {
    registerHostServices(baseServices());
    await expect(syncSetAutoSync(true)).rejects.toThrow("Sync settings hooks not registered");
  });
  test('syncGetStatus rejects with "Sync settings hooks not registered"', async () => {
    registerHostServices(baseServices());
    await expect(syncGetStatus("/abs/project")).rejects.toThrow("Sync settings hooks not registered");
  });
});

// ── Validation errors that happen OUTSIDE handleRemoteErrors (literal text) ─

describe("validation outside handleRemoteErrors stays literal (not genericized)", () => {
  const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };

  test("remoteSync: 'not an absolute path' when projectDir is relative", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase, syncProject: async () => ({}) } as never });
    await expect(remoteSync("rel/path", undefined)).rejects.toThrow(
      "remote:sync requires an absolute path, got: rel/path",
    );
  });

  test("remoteDiagnoseProject: 'not an absolute path' when projectDir is relative", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, diagnoseProjectRemote: async () => ({}) } as never,
    });
    await expect(remoteDiagnoseProject("rel/path")).rejects.toThrow(
      "remote:diagnoseProject requires an absolute path, got: rel/path",
    );
  });

  test("remoteDiagnoseProject: outside the open project is rejected", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, diagnoseProjectRemote: async () => ({}) } as never,
    });
    await expect(remoteDiagnoseProject("/somewhere/else")).rejects.toThrow(
      "remote:diagnoseProject: path is outside the open project",
    );
  });

  test("remoteCloneRepository: requires { url, parentDir, folderName } (missing url)", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, cloneRepository: async () => ({ projectDir: "/x" }) } as never,
    });
    await expect(remoteCloneRepository({ parentDir: "/abs" })).rejects.toThrow(
      "remote:cloneRepository requires { url, parentDir, folderName }",
    );
  });

  test("remoteCloneRepository: requires an absolute destination path when parentDir is relative", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, cloneRepository: async () => ({ projectDir: "/x" }) } as never,
    });
    await expect(
      remoteCloneRepository({ url: "https://x/y.git", parentDir: "rel" }),
    ).rejects.toThrow("remote:cloneRepository requires an absolute path, got: rel");
  });

  test("syncSetAutoSync: requires a boolean", async () => {
    registerHostServices({ ...baseServices(), sync: { setAutoSync: async (e) => ({ ok: true, autoSync: e }) } });
    await expect(syncSetAutoSync("yes")).rejects.toThrow("sync:setAutoSync requires a boolean");
  });

  test("syncGetStatus: requires a projectDir", async () => {
    registerHostServices({ ...baseServices(), sync: { getStatus: async () => null } });
    await expect(syncGetStatus("")).rejects.toThrow("sync:status requires a projectDir");
  });
});

// ── Validation errors INSIDE handleRemoteErrors get genericized (existing,
// possibly surprising, behavior preserved verbatim across the transport
// change — see this file's header) ─────────────────────────────────────────

describe("validation inside handleRemoteErrors is genericized (preserved verbatim)", () => {
  const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };

  test("remoteListBranches: missing owner/repo", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(remoteListBranches(undefined, undefined)).rejects.toThrow(GENERIC_REMOTE_ERROR);
  });

  test("remoteListRepoBooks: missing owner/repo/branch", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(remoteListRepoBooks(undefined, undefined, undefined)).rejects.toThrow(GENERIC_REMOTE_ERROR);
  });

  test("remoteTestRemoteAccess: missing url", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(remoteTestRemoteAccess(undefined)).rejects.toThrow(GENERIC_REMOTE_ERROR);
  });

  test("remoteConnectGenericHost: missing host/token", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(remoteConnectGenericHost({})).rejects.toThrow(GENERIC_REMOTE_ERROR);
  });

  test("remoteDisconnectHost: missing host", async () => {
    registerHostServices({ ...baseServices(), remote: { ...remoteBase } as never });
    await expect(remoteDisconnectHost(undefined)).rejects.toThrow(GENERIC_REMOTE_ERROR);
  });

  test("a hooks failure is sanitized (handleRemoteErrors), not left raw", async () => {
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        cloneRepository: async () => {
          throw new Error("some internal isomorphic-git stack trace detail");
        },
      } as never,
    });
    await expect(
      remoteCloneRepository({ url: "https://x/y.git", parentDir: "/abs" }),
    ).rejects.toThrow(GENERIC_REMOTE_ERROR);
  });
});

// ── Success paths: calls the right lib method with the right args ─────────

describe("success paths call hooks/lib with validated args and return the result", () => {
  const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };

  test("remoteDisconnectGitHub deletes the GITHUB_HOST credential", async () => {
    const deleted: string[] = [];
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, tokenStore: { delete: async (h: string) => void deleted.push(h) } as never },
    });
    await expect(remoteDisconnectGitHub()).resolves.toEqual({ ok: true });
    expect(deleted).toEqual(["github.com"]);
  });

  test("remoteGetConnection defaults to GITHUB_HOST and never returns a token field", async () => {
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        tokenStore: { status: async (h: string) => ({ connected: true, username: h }) } as never,
      },
    });
    await expect(remoteGetConnection(undefined)).resolves.toEqual({ connected: true, username: "github.com" });
    await expect(remoteGetConnection("git.example.com")).resolves.toEqual({
      connected: true,
      username: "git.example.com",
    });
  });

  test("remoteListRepositories requires a stored GitHub credential first", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, tokenStore: { get: async () => null } as never },
    });
    await expect(remoteListRepositories()).rejects.toThrow("Connect GitHub first to see your repositories.");
  });

  test("remoteListRepositories calls lib.listGitHubRepositories with the stored credential", async () => {
    const calls: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        tokenStore: { get: async () => ({ token: "secret", host: "github.com" }) } as never,
        loadLib: async () => ({
          listGitHubRepositories: async (credential: unknown) => {
            calls.push(credential);
            return [{ fullName: "author/book" }];
          },
        }),
      } as never,
    });
    await expect(remoteListRepositories()).resolves.toEqual([{ fullName: "author/book" }]);
    expect(calls).toEqual([{ token: "secret", host: "github.com" }]);
  });

  test("remoteSync passes projectDir, tokenStore, git identity, and a trimmed message", async () => {
    const calls: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        loadLib: async () => ({
          syncProject: async (args: unknown) => {
            calls.push(args);
            return { status: "synced" };
          },
        }),
      } as never,
    });
    await expect(remoteSync("/abs/project", "  msg  ")).resolves.toEqual({ status: "synced" });
    expect(calls).toHaveLength(1);
    const call = calls[0] as { projectDir: string; tokenStore: unknown; message?: string };
    expect(call.projectDir).toBe("/abs/project");
    expect(call.message).toBe("msg");
  });

  test("remoteCloneRepository delegates to hooks.cloneRepository with the validated body", async () => {
    const calls: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        cloneRepository: async (args: unknown) => {
          calls.push(args);
          return { projectDir: "/abs/my-repo" };
        },
      } as never,
    });
    await expect(
      remoteCloneRepository({ url: "https://x/y.git", parentDir: "/abs", folderName: "my-repo" }),
    ).resolves.toEqual({ projectDir: "/abs/my-repo" });
    expect(calls).toEqual([{ url: "https://x/y.git", parentDir: "/abs", folderName: "my-repo" }]);
  });

  test("syncSetAutoSync/syncGetStatus call the sync hooks with the validated args", async () => {
    const setCalls: boolean[] = [];
    const getCalls: string[] = [];
    registerHostServices({
      ...baseServices(),
      sync: {
        setAutoSync: async (enabled: boolean) => {
          setCalls.push(enabled);
          return { ok: true as const, autoSync: enabled };
        },
        getStatus: async (dir: string) => {
          getCalls.push(dir);
          return { state: "idle", projectDir: dir, lastSyncAt: null };
        },
      },
    });
    await expect(syncSetAutoSync(false)).resolves.toEqual({ ok: true, autoSync: false });
    await expect(syncGetStatus("/abs/project")).resolves.toEqual({
      state: "idle",
      projectDir: "/abs/project",
      lastSyncAt: null,
    });
    expect(setCalls).toEqual([false]);
    expect(getCalls).toEqual(["/abs/project"]);
  });
});

// ── SECURITY (D12): no token ever crosses back out ─────────────────────────

describe("no token in response", () => {
  const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };
  const SECRET = "ghp_super-secret-token-value";

  test("remoteConnectGenericHost strips the token the lib echoes back", async () => {
    const stored: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        tokenStore: { set: async (host: string, cred: unknown) => void stored.push({ host, cred }) } as never,
        loadLib: async () => ({
          connectGenericHost: async () => ({
            host: "git.example.com",
            username: "author",
            kind: "generic",
            token: SECRET,
            createdAt: 0,
          }),
        }),
      } as never,
    });
    const result = await remoteConnectGenericHost({ host: "git.example.com", token: SECRET });
    expect(JSON.stringify(result)).not.toContain(SECRET);
    expect(result).toEqual({ connected: true, host: "git.example.com", username: "author" });
    // The credential DOES reach the token store (that's the point) — just
    // never comes back out to the renderer.
    expect(stored).toEqual([
      { host: "git.example.com", cred: { host: "git.example.com", username: "author", kind: "generic", token: SECRET, createdAt: 0 } },
    ]);
  });

  test("remoteGetConnection/remoteListConnections forward only what TokenStore's own redacted methods return", async () => {
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        tokenStore: {
          status: async () => ({ connected: true, username: "author" }),
          listRedacted: async () => [{ host: "github.com", kind: "github", username: "author", createdAt: 0 }],
        } as never,
      },
    });
    const conn = await remoteGetConnection(undefined);
    const list = await remoteListConnections();
    expect(JSON.stringify(conn)).not.toContain(SECRET);
    expect(JSON.stringify(list)).not.toContain(SECRET);
  });
});

// ── Path scoping (2026-07-29 audit, Theme 1 — ported from
// route-scoping.test.ts, now against the electron/api functions directly) ──

describe("project-scoping guard: remoteSync / remoteDiagnoseProject", () => {
  const remoteBase = {
    loadLib: async () => ({ syncProject: async () => ({}), diagnoseProjectRemote: async () => ({}) }),
    tokenStore: {} as never,
    GITHUB_HOST: "github.com",
  };

  const canSymlink = (() => {
    const base = mkdtempSync(path.join(tmpdir(), "gutterpress-remote-ipc-probe-"));
    try {
      const target = path.join(base, "target");
      mkdirSync(target);
      symlinkSync(target, path.join(base, "link"), "dir");
      return true;
    } catch {
      return false;
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  })();

  let dir: string;
  let repoRoot: string;
  let bookDir: string;
  let siblingRepo: string;
  let outsideDir: string;

  afterEach(async () => {
    if (dir) await rm(dir, { recursive: true, force: true });
  });

  async function setUp(): Promise<void> {
    dir = await mkdtemp(path.join(tmpdir(), "gutterpress-remote-ipc-"));
    repoRoot = path.join(dir, "repo");
    bookDir = path.join(repoRoot, "books", "field-guide");
    siblingRepo = path.join(dir, "repo2"); // "repo" + "2" — the sibling-prefix regression
    outsideDir = path.join(dir, "elsewhere");
    await mkdir(bookDir, { recursive: true });
    await mkdir(siblingRepo, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
  }

  function openProject(roots: string[]): void {
    registerHostServices(makeHostServices({ remote: remoteBase as never, fsGuard: { projectRoots: () => roots, readOnlyRoots: () => [] as string[] } }));
  }

  test("an unrelated outside path is rejected", async () => {
    await setUp();
    openProject([bookDir, repoRoot]);
    await expect(remoteSync(outsideDir, undefined)).rejects.toThrow("path is outside the open project");
    await expect(remoteDiagnoseProject(outsideDir)).rejects.toThrow("path is outside the open project");
  });

  test("a sibling repo with a shared string prefix is rejected (the /proj vs /proj2 regression)", async () => {
    await setUp();
    openProject([bookDir, repoRoot]);
    await expect(remoteSync(siblingRepo, undefined)).rejects.toThrow("path is outside the open project");
  });

  test("no project open rejects even the book dir itself", async () => {
    await setUp();
    openProject([]);
    await expect(remoteDiagnoseProject(bookDir)).rejects.toThrow("path is outside the open project");
  });

  test("the opened book dir and its enclosing repo root both pass the guard", async () => {
    await setUp();
    openProject([bookDir, repoRoot]);
    await expect(remoteSync(bookDir, undefined)).resolves.not.toBeUndefined();
    await expect(remoteSync(repoRoot, undefined)).resolves.not.toBeUndefined();
  });

  test.skipIf(!canSymlink)("a book-local symlink pointing outside the project is rejected", async () => {
    await setUp();
    openProject([bookDir, repoRoot]);
    const alias = path.join(bookDir, "alias");
    await symlink(outsideDir, alias, "dir");
    await expect(remoteDiagnoseProject(alias)).rejects.toThrow("path is outside the open project");
  });
});

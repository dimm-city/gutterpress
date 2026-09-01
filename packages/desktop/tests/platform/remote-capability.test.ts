import { afterEach, expect, test } from "bun:test";
import {
  cloneRemoteRepository,
  connectGenericHost,
  connectGitHubCancel,
  connectGitHubStart,
  connectGitHubWait,
  diagnoseProjectRemote,
  disconnectGitHub,
  disconnectHost,
  forgeTokenUrl,
  getRemoteConnection,
  getSyncStatus,
  listHostConnections,
  listRemoteBranches,
  listRemoteRepositories,
  listRepoBooks,
  onCloneProgress,
  onSyncStatus,
  setAutoSync,
  syncChanges,
  testRemoteAccess,
} from "../../src/lib/remote/remote-capability";

// SFE-P5b: replaces the GitHub/sync slice of tests/platform/adapter.test.ts's
// "ElectronAdapter" delegation tests, now exercising the capability module
// directly. connectGitHubStart/Wait/Cancel and onCloneProgress/onSyncStatus
// were always real bridge push/two-phase-flow members.
//
// SFE-P5c3: `remote`/`sync` (the deleted `src/routes/api/{remote,sync}/**`
// HTTP routes and their `api.remote.*`/`api.sync.*` client methods) JOINED
// this module — `cloneRemoteRepository`/`setAutoSync` now go through the
// bridge too (superseding the ARCH review #8 HTTP-route framing this file's
// header used to describe), and every new member below is real 1:1
// delegation, scrubbed of the Electron IPC transport prefix by the module's
// shared `call()` wrapper.

afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("connectGitHubStart/Wait/Cancel and onCloneProgress delegate 1:1 to the bridge", async () => {
  const calls: string[] = [];
  let progressHandler: ((data: unknown) => void) | null = null;
  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      connectGitHubStart: async () => {
        calls.push("connectGitHubStart");
        return { userCode: "ABCD-1234", verificationUri: "https://github.com/login/device" };
      },
      connectGitHubWait: async () => {
        calls.push("connectGitHubWait");
        return { connected: true, username: "author" };
      },
      connectGitHubCancel: async () => {
        calls.push("connectGitHubCancel");
        return { ok: true };
      },
      onCloneProgress: (cb: (data: unknown) => void) => {
        calls.push("onCloneProgress");
        progressHandler = cb;
        return () => {
          if (progressHandler === cb) progressHandler = null;
        };
      },
    },
  };

  await expect(connectGitHubStart()).resolves.toEqual({
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
  } as never);
  await expect(connectGitHubWait()).resolves.toEqual({ connected: true, username: "author" } as never);
  await expect(connectGitHubCancel()).resolves.toEqual({ ok: true });

  const seen: unknown[] = [];
  const off = onCloneProgress((data) => seen.push(data));
  progressHandler?.({ phase: "cloning", pct: 50 });
  expect(seen).toEqual([{ phase: "cloning", pct: 50 }]);
  off();
  expect(progressHandler).toBeNull();

  expect(calls).toEqual([
    "connectGitHubStart",
    "connectGitHubWait",
    "connectGitHubCancel",
    "onCloneProgress",
  ]);
});

test("onSyncStatus delegates 1:1 to the bridge (no scrub — a push payload, not a rejection)", async () => {
  const bridgeCalls: string[] = [];
  let statusHandler: ((data: unknown) => void) | null = null;
  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      onSyncStatus: (cb: (data: unknown) => void) => {
        bridgeCalls.push("onSyncStatus");
        statusHandler = cb;
        return () => {
          if (statusHandler === cb) statusHandler = null;
        };
      },
    },
  };
  const seen: unknown[] = [];
  const off = onSyncStatus((status) => seen.push(status));
  statusHandler?.({ state: "syncing", projectDir: "/book", lastSyncAt: null });
  expect(seen).toEqual([{ state: "syncing", projectDir: "/book", lastSyncAt: null }]);
  off();
  expect(statusHandler).toBeNull();
  expect(bridgeCalls).toEqual(["onSyncStatus"]);
});

/** One entry in the request/reply delegation table below. */
interface DelegationCase {
  name: string;
  /** Call the capability function under test. */
  call: (electron: Record<string, unknown>) => Promise<unknown>;
  /** The bridge member path this call is expected to reach, e.g. "remote.disconnectGitHub". */
  bridgeMember: string;
  args: unknown[];
  result: unknown;
}

const CASES: DelegationCase[] = [
  { name: "disconnectGitHub", call: () => disconnectGitHub(), bridgeMember: "remote.disconnectGitHub", args: [], result: { ok: true } },
  { name: "getRemoteConnection", call: () => getRemoteConnection("git.example.com"), bridgeMember: "remote.getConnection", args: ["git.example.com"], result: { connected: true } },
  { name: "listRemoteRepositories", call: () => listRemoteRepositories(), bridgeMember: "remote.listRepositories", args: [], result: [{ fullName: "a/b" }] },
  { name: "listRemoteBranches", call: () => listRemoteBranches("owner", "repo"), bridgeMember: "remote.listBranches", args: ["owner", "repo"], result: [{ name: "main" }] },
  { name: "listRepoBooks", call: () => listRepoBooks("owner", "repo", "main"), bridgeMember: "remote.listRepoBooks", args: ["owner", "repo", "main"], result: [{ path: "books/a" }] },
  { name: "diagnoseProjectRemote", call: () => diagnoseProjectRemote("/proj"), bridgeMember: "remote.diagnoseProject", args: ["/proj"], result: { guidance: "local-only" } },
  { name: "testRemoteAccess", call: () => testRemoteAccess("https://x/y.git"), bridgeMember: "remote.testRemoteAccess", args: ["https://x/y.git"], result: { ok: true } },
  {
    name: "connectGenericHost",
    call: () => connectGenericHost({ host: "git.example.com", token: "tok" }),
    bridgeMember: "remote.connectGenericHost",
    args: [{ host: "git.example.com", token: "tok" }],
    result: { connected: true, host: "git.example.com" },
  },
  { name: "disconnectHost", call: () => disconnectHost("git.example.com"), bridgeMember: "remote.disconnectHost", args: ["git.example.com"], result: { ok: true } },
  { name: "listHostConnections", call: () => listHostConnections(), bridgeMember: "remote.listConnections", args: [], result: [] },
  { name: "forgeTokenUrl", call: () => forgeTokenUrl("gitea.example.com"), bridgeMember: "remote.forgeTokenUrl", args: ["gitea.example.com"], result: "https://gitea.example.com/user/settings/applications" },
  { name: "syncChanges", call: () => syncChanges("/proj", "msg"), bridgeMember: "remote.sync", args: ["/proj", "msg"], result: { status: "synced" } },
  { name: "cloneRemoteRepository", call: () => cloneRemoteRepository({ url: "https://x/y.git", parentDir: "/parent", folderName: "repo" }), bridgeMember: "remote.cloneRepository", args: [{ url: "https://x/y.git", parentDir: "/parent", folderName: "repo" }], result: { projectDir: "/parent/repo" } },
  // setAutoSync's own signature discards the bridge result (Promise<void>,
  // matching the pre-existing capability contract) — this table's "result"
  // is what the bridge is stubbed to resolve, not what the call returns.
  { name: "setAutoSync", call: () => setAutoSync(true), bridgeMember: "sync.setAutoSync", args: [true], result: undefined },
  { name: "getSyncStatus", call: () => getSyncStatus("/proj"), bridgeMember: "sync.getStatus", args: ["/proj"], result: { state: "idle", projectDir: "/proj", lastSyncAt: null } },
];

function stubBridge(member: string, fn: (...args: unknown[]) => unknown): Record<string, unknown> {
  const [ns, method] = member.split(".");
  const electron: Record<string, unknown> = { [ns!]: { [method!]: fn } };
  // @ts-expect-error test global
  globalThis.window = { electron };
  return electron;
}

for (const c of CASES) {
  test(`${c.name} delegates 1:1 to bridge().${c.bridgeMember}`, async () => {
    const calls: unknown[][] = [];
    stubBridge(c.bridgeMember, (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve(c.result);
    });
    const result = await c.call({});
    expect(result).toEqual(c.result as never);
    expect(calls).toEqual([c.args]);
  });

  test(`${c.name} scrubs the Electron IPC transport prefix off a rejection`, async () => {
    stubBridge(c.bridgeMember, () =>
      Promise.reject(new Error("Error invoking remote method 'x': Error: something failed")),
    );
    await expect(c.call({})).rejects.toThrow("something failed");
  });
}

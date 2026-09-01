import { afterEach, expect, test } from "bun:test";
import {
  cloneRemoteRepository,
  connectGitHubCancel,
  connectGitHubStart,
  connectGitHubWait,
  onCloneProgress,
  onSyncStatus,
  setAutoSync,
} from "../../src/lib/remote/remote-capability";

// SFE-P5b: replaces the GitHub/sync slice of tests/platform/adapter.test.ts's
// "ElectronAdapter" delegation tests, now exercising the capability module
// directly. connectGitHubStart/Wait/Cancel and onCloneProgress/onSyncStatus
// stay on the IPC bridge (real push/two-phase-flow members); cloneRemoteRepository
// and setAutoSync go through the HTTP route client (ARCH review #8).

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
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

test("cloneRemoteRepository goes through the HTTP route client, not the bridge", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  // @ts-expect-error test global
  globalThis.fetch = async (url: string, init?: { body?: string }) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : undefined });
    return { ok: true, json: async () => ({ projectDir: "/proj" }) };
  };
  const args = {
    url: "https://github.com/owner/repo.git",
    parentDir: "/parent",
    folderName: "repo",
    branch: "main",
    owner: "owner",
    repo: "repo",
  };
  await expect(cloneRemoteRepository(args)).resolves.toEqual({ projectDir: "/proj" });
  expect(calls).toEqual([{ url: "/api/remote/clone-repository", body: args }]);
});

test("onSyncStatus delegates 1:1 to the bridge; setAutoSync goes through the HTTP route client", async () => {
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

  const fetchCalls: string[] = [];
  // @ts-expect-error test global
  globalThis.fetch = async (url: string) => {
    fetchCalls.push(url);
    return { ok: true, json: async () => ({ ok: true, autoSync: true }) };
  };
  await setAutoSync(true);
  expect(fetchCalls).toEqual(["/api/sync/set-auto-sync"]);
});

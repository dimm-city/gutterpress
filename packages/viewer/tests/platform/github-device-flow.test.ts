import { expect, test } from "bun:test";
import { GitHubDeviceFlow, type GitHubDeviceFlowDeps } from "../../electron/github-device-flow";
import type { DeviceCodeInfo, TokenStore } from "@dimm-city/print-md";

type LibModule = typeof import("@dimm-city/print-md");

interface FakeProviderOpts {
  /** Called with the resolved onUserCode callback so the test can trigger phase 1. */
  onConnect?: (args: { onUserCode: (info: DeviceCodeInfo) => void; signal?: AbortSignal }) => void;
  connect?: (args: {
    onUserCode: (info: DeviceCodeInfo) => void;
    signal?: AbortSignal;
  }) => Promise<{ host: string; kind: "github-oauth"; token: string; username?: string; createdAt: number }>;
}

function makeHarness(opts: FakeProviderOpts = {}) {
  const setCalls: Array<[string, unknown]> = [];
  const tokenStore: TokenStore = {
    get: async () => null,
    set: async (host, credential) => {
      setCalls.push([host, credential]);
    },
    delete: async () => {},
    list: async () => [],
  };

  class FakeProvider {
    constructor(public readonly config: { clientId: string }) {}
    connect(args: { onUserCode: (info: DeviceCodeInfo) => void; signal?: AbortSignal }) {
      opts.onConnect?.(args);
      if (opts.connect) return opts.connect(args);
      return new Promise<never>(() => {}); // hangs forever unless overridden
    }
  }

  const lib = {
    GitHubAuthProvider: FakeProvider,
  } as unknown as LibModule;

  const deps: GitHubDeviceFlowDeps = {
    loadLib: async () => lib,
    tokenStore,
    githubHost: "github.com",
    clientId: () => "client-123",
  };

  return { flow: new GitHubDeviceFlow(deps), setCalls };
}

test("wait() before start() rejects with a friendly message", async () => {
  const { flow } = makeHarness();
  await expect(flow.wait()).rejects.toThrow(/No GitHub sign-in is in progress/);
});

test("start() resolves with the user code as soon as the provider produces one", async () => {
  const code: DeviceCodeInfo = {
    userCode: "ABCD-1234",
    verificationUri: "https://github.com/login/device",
    expiresIn: 900,
    interval: 5,
  };
  const { flow } = makeHarness({
    onConnect: ({ onUserCode }) => {
      onUserCode(code);
    },
  });
  const result = await flow.start();
  expect(result).toEqual(code);
});

test("start() rejects immediately (never hangs) when connect fails before producing a code", async () => {
  const { flow } = makeHarness({
    connect: async () => {
      throw new Error("offline");
    },
  });
  await expect(flow.start()).rejects.toThrow(/offline/);
});

test("wait() resolves once the credential is approved and stores it under the configured host", async () => {
  const code: DeviceCodeInfo = {
    userCode: "WXYZ-9999",
    verificationUri: "https://github.com/login/device",
    expiresIn: 900,
    interval: 5,
  };
  const { flow, setCalls } = makeHarness({
    onConnect: ({ onUserCode }) => onUserCode(code),
    connect: async () => ({
      host: "github.com",
      kind: "github-oauth",
      token: "secret-token",
      username: "octocat",
      createdAt: 1,
    }),
  });
  await flow.start();
  const result = await flow.wait();
  expect(result).toEqual({ connected: true, username: "octocat" });
  expect(setCalls.length).toBe(1);
  expect(setCalls[0]![0]).toBe("github.com");
});

test("wait() clears the active attempt so a second wait() without a new start() rejects", async () => {
  const { flow } = makeHarness({
    onConnect: ({ onUserCode }) =>
      onUserCode({ userCode: "C", verificationUri: "https://x", expiresIn: 900, interval: 5 }),
    connect: async () => ({
      host: "github.com",
      kind: "github-oauth",
      token: "t",
      createdAt: 1,
    }),
  });
  await flow.start();
  await flow.wait();
  await expect(flow.wait()).rejects.toThrow(/No GitHub sign-in is in progress/);
});

test("a second start() aborts the first attempt's signal", async () => {
  let firstSignal: AbortSignal | undefined;
  const { flow } = makeHarness({
    onConnect: ({ signal }) => {
      firstSignal = signal;
    },
  });
  // First attempt never produces a code — hangs indefinitely.
  flow.start().catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  // Second start() replaces it; the first's AbortController must be aborted.
  const second = flow.start();
  expect(firstSignal?.aborted).toBe(true);
  // Clean up: don't leave the second attempt's promise dangling in the test process.
  second.catch(() => {});
});

test("cancel() aborts the active attempt and clears state", async () => {
  let signal: AbortSignal | undefined;
  const { flow } = makeHarness({
    onConnect: (args) => {
      signal = args.signal;
    },
  });
  void flow.start().catch(() => {});
  await new Promise((r) => setTimeout(r, 0));
  const res = flow.cancel();
  expect(res).toEqual({ ok: true });
  expect(signal?.aborted).toBe(true);
  await expect(flow.wait()).rejects.toThrow(/No GitHub sign-in is in progress/);
});

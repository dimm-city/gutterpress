import { expect, test } from "bun:test";
import { GoogleConnectFlow, type GoogleConnectFlowDeps } from "../../electron/google-connect-flow";
import type { TokenStore } from "gutterpress";

type LibModule = typeof import("gutterpress");

interface ConnectArgs {
  onAuthUrl: (url: string) => void;
  signal?: AbortSignal;
}

interface FakeLibOpts {
  /** Called with the resolved onAuthUrl callback so the test can trigger phase 1. */
  onConnect?: (args: ConnectArgs) => void;
  connect?: (args: ConnectArgs) => Promise<{ connected: true; email?: string }>;
}

function makeHarness(opts: FakeLibOpts = {}) {
  const setCalls: Array<[string, unknown]> = [];
  const tokenStore: TokenStore = {
    get: async () => null,
    set: async (host, credential) => {
      setCalls.push([host, credential]);
    },
    delete: async () => {},
    list: async () => [],
  };

  const openedUrls: string[] = [];
  const openExternal = async (url: string) => {
    openedUrls.push(url);
  };

  const lib = {
    connectGoogleDrive: async (
      options: { account?: string },
      deps: { tokenStore: TokenStore },
      callbacks: ConnectArgs,
    ) => {
      opts.onConnect?.(callbacks);
      const result = opts.connect
        ? await opts.connect(callbacks)
        : await new Promise<never>(() => {}); // hangs forever unless overridden
      // Mirror connect-google.ts's real behavior closely enough for the test:
      // it stores the credential under the account-scoped key.
      await deps.tokenStore.set(options.account ? `gdrive#${options.account}` : "gdrive", {
        host: "gdrive",
        kind: "google-oauth",
        token: "refresh-token",
        createdAt: 1,
      });
      return result;
    },
  } as unknown as LibModule;

  const deps: GoogleConnectFlowDeps = {
    loadLib: async () => lib,
    tokenStore,
    openExternal,
  };

  return { flow: new GoogleConnectFlow(deps), setCalls, openedUrls };
}

test("wait() before start() rejects with a friendly message", async () => {
  const { flow } = makeHarness();
  await expect(flow.wait()).rejects.toThrow(/No Google Drive sign-in is in progress/);
});

test("start() resolves with the auth URL as soon as the lib produces one", async () => {
  const { flow } = makeHarness({
    onConnect: ({ onAuthUrl }) => {
      onAuthUrl("https://accounts.google.com/o/oauth2/v2/auth?foo=bar");
    },
  });
  const result = await flow.start();
  expect(result).toEqual({ authUrl: "https://accounts.google.com/o/oauth2/v2/auth?foo=bar" });
});

test("start() opens the auth URL via the injected openExternal", async () => {
  const { flow, openedUrls } = makeHarness({
    onConnect: ({ onAuthUrl }) => onAuthUrl("https://accounts.google.com/auth?x=1"),
  });
  await flow.start();
  expect(openedUrls).toEqual(["https://accounts.google.com/auth?x=1"]);
});

test("start() rejects immediately (never hangs) when connect fails before producing an auth URL", async () => {
  const { flow } = makeHarness({
    connect: async () => {
      throw new Error("Google Drive publishing isn't configured on this build yet.");
    },
  });
  await expect(flow.start()).rejects.toThrow(/isn't configured on this build/);
});

test("wait() resolves once the credential is approved and stores it under the configured host", async () => {
  const { flow, setCalls } = makeHarness({
    onConnect: ({ onAuthUrl }) => onAuthUrl("https://accounts.google.com/auth"),
    connect: async () => ({ connected: true, email: "writer@example.com" }),
  });
  await flow.start();
  const result = await flow.wait();
  expect(result).toEqual({ connected: true, email: "writer@example.com" });
  expect(setCalls.length).toBe(1);
  expect(setCalls[0]![0]).toBe("gdrive");
});

test("wait() resolves without an email when Google didn't return one", async () => {
  const { flow } = makeHarness({
    onConnect: ({ onAuthUrl }) => onAuthUrl("https://accounts.google.com/auth"),
    connect: async () => ({ connected: true }),
  });
  await flow.start();
  const result = await flow.wait();
  expect(result).toEqual({ connected: true });
});

test("start() stores a NAMED account under the compound host#account key", async () => {
  const { flow, setCalls } = makeHarness({
    onConnect: ({ onAuthUrl }) => onAuthUrl("https://accounts.google.com/auth"),
    connect: async () => ({ connected: true, email: "studio@example.com" }),
  });
  await flow.start("studio");
  await flow.wait();
  expect(setCalls[0]![0]).toBe("gdrive#studio");
});

test("wait() clears the active attempt so a second wait() without a new start() rejects", async () => {
  const { flow } = makeHarness({
    onConnect: ({ onAuthUrl }) => onAuthUrl("https://accounts.google.com/auth"),
    connect: async () => ({ connected: true }),
  });
  await flow.start();
  await flow.wait();
  await expect(flow.wait()).rejects.toThrow(/No Google Drive sign-in is in progress/);
});

test("a second start() aborts the first attempt's signal", async () => {
  let firstSignal: AbortSignal | undefined;
  const { flow } = makeHarness({
    onConnect: ({ signal }) => {
      firstSignal = signal;
    },
  });
  // First attempt never produces an auth URL — hangs indefinitely.
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
  await expect(flow.wait()).rejects.toThrow(/No Google Drive sign-in is in progress/);
});

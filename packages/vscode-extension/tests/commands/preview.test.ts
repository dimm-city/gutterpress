// Unit tests for src/commands/preview.ts (SFE-P3c run spec deliverable 4).
//
// PreviewSession is `vscode`-free (see preview.ts's own header) and is
// tested directly with a fake starter — no mock.module at all for that
// half. registerPreviewCommand's own vscode wiring is tested with the
// shared vscode mock, injecting a PreviewSession built on the SAME fake
// starter.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import type { FakeOutputChannel, VscodeDisposableLike } from "../support/vscode-mock.ts";
import { vscodeMock } from "../support/vscode-mock.ts";
import type { PreviewServerHandleLike, PreviewServerStarter } from "../../src/commands/preview.ts";

// See build.test.ts's identical comment: registerPreviewCommand's own
// precondition check does a REAL filesystem read, so the success-wiring
// test needs a REAL directory with a REAL manifest.yaml, not a fake path.
let realProjectDir: string;
const disposableDirs: string[] = [];
afterAll(() => {
  for (const dir of disposableDirs) rmSync(dir, { recursive: true, force: true });
});

interface Captured {
  errorMessages: string[];
  registeredCommands: Map<string, (...args: unknown[]) => unknown>;
}

let captured: Captured;
let mockWorkspaceFolderPaths: string[];

mock.module("vscode", () =>
  vscodeMock({
    registerCommand: (command, callback): VscodeDisposableLike => {
      captured.registeredCommands.set(command, callback);
      return { dispose: () => {} };
    },
    showErrorMessage: async (message: string) => {
      captured.errorMessages.push(message);
      return undefined;
    },
    activeTextEditor: undefined,
    get workspaceFolders() {
      return mockWorkspaceFolderPaths.map((p) => ({ uri: { fsPath: p } }));
    },
  }),
);

const { PreviewSession, registerPreviewCommand } = await import("../../src/commands/preview.ts");
type StartOptions = Parameters<PreviewServerStarter>[0];

function fakeOutputChannel(): FakeOutputChannel {
  return { name: "Gutterpress", lines: [], appendLine: (v: string) => channelLines.push(v), dispose: () => {} };
}

function asOutputChannel(fake: FakeOutputChannel): vscode.OutputChannel {
  return fake as unknown as vscode.OutputChannel;
}

let channelLines: string[];

beforeEach(() => {
  captured = { errorMessages: [], registeredCommands: new Map() };
  channelLines = [];
  mockWorkspaceFolderPaths = [];
  realProjectDir = mkdtempSync(path.join(tmpdir(), "gp-vscode-preview-cmd-"));
  disposableDirs.push(realProjectDir);
  writeFileSync(path.join(realProjectDir, "manifest.yaml"), "title: Fixture\n", "utf8");
});

describe("PreviewSession — vscode-free", () => {
  test("starts a server on the first open, with port:0/host:127.0.0.1/openBrowser:false/installSignalHandlers:false", async () => {
    const starter = mock(
      async (options: StartOptions): Promise<PreviewServerHandleLike> => ({
        url: "http://127.0.0.1:5555",
        inputPath: options.input,
        stop: async () => {},
        restart: async (_newInputPath: string) => {},
      }),
    );
    const session = new PreviewSession(starter);
    const result = await session.open("/proj/a");

    expect(result.url).toBe("http://127.0.0.1:5555");
    expect(starter.mock.calls).toHaveLength(1);
    expect(starter.mock.calls[0]?.[0]).toMatchObject({
      input: "/proj/a",
      port: 0,
      host: "127.0.0.1",
      openBrowser: false,
      installSignalHandlers: false,
    });
  });

  test("a second open() for the SAME project reuses the handle — no second server started", async () => {
    const starter = mock(
      async (_options: StartOptions): Promise<PreviewServerHandleLike> => ({
        url: "http://127.0.0.1:5555",
        inputPath: "/proj/a",
        stop: async () => {},
        restart: async (_newInputPath: string) => {},
      }),
    );
    const session = new PreviewSession(starter);
    await session.open("/proj/a");
    const second = await session.open("/proj/a");

    expect(starter.mock.calls).toHaveLength(1); // still just one
    expect(second.url).toBe("http://127.0.0.1:5555");
  });

  test("a second open() for a DIFFERENT project calls the handle's own restart(), never a second server", async () => {
    const restart = mock(async (_newInputPath: string): Promise<void> => {});
    const starter = mock(
      async (_options: StartOptions): Promise<PreviewServerHandleLike> => ({
        url: "http://127.0.0.1:5555",
        inputPath: "/proj/a",
        stop: async () => {},
        restart: (newInputPath: string) => restart(newInputPath),
      }),
    );
    const session = new PreviewSession(starter);
    await session.open("/proj/a");
    await session.open("/proj/b");

    expect(starter.mock.calls).toHaveLength(1); // still just one server EVER started
    expect(restart.mock.calls).toHaveLength(1);
    expect(restart.mock.calls[0]?.[0]).toBe("/proj/b");
  });

  test("repair round 1: open(A) -> open(B) -> open(A) restarts on BOTH the second and third call — identity is tracked independently of the fake handle's own (never-updated) inputPath field", async () => {
    // The fake handle's `inputPath` never changes on restart() — this is
    // deliberate: it reproduces the REAL `PreviewServerHandle.inputPath`'s
    // own behavior exactly (a plain field captured once in the object
    // literal at start; `restart()` mutates the server's internal state,
    // never that already-returned object — see preview.ts's own header).
    // Before the fix, PreviewSession.open() compared against
    // `this.#handle.inputPath`, so this exact sequence would wrongly treat
    // the THIRD open(A) as a cache hit (since the handle's own stale
    // inputPath still read "A" from the very first start) and return the
    // cached URL WITHOUT restarting, even though the server was actually
    // still serving project B.
    const restart = mock(async (_newInputPath: string): Promise<void> => {});
    const starter = mock(
      async (_options: StartOptions): Promise<PreviewServerHandleLike> => ({
        url: "http://127.0.0.1:5555",
        inputPath: "/proj/a", // never updated by the fake restart() below
        stop: async () => {},
        restart: (newInputPath: string) => restart(newInputPath),
      }),
    );
    const session = new PreviewSession(starter);

    await session.open("/proj/a");
    await session.open("/proj/b");
    await session.open("/proj/a");

    expect(starter.mock.calls).toHaveLength(1); // still just one server EVER started
    expect(restart.mock.calls).toHaveLength(2); // B, then A again — NOT a cache hit the third time
    expect(restart.mock.calls[0]?.[0]).toBe("/proj/b");
    expect(restart.mock.calls[1]?.[0]).toBe("/proj/a");
  });

  test("dispose() stops the active server; a fresh session with no open() call is a safe no-op", async () => {
    const stop = mock(async (): Promise<void> => {});
    const starter = mock(
      async (_options: StartOptions): Promise<PreviewServerHandleLike> => ({
        url: "http://x",
        inputPath: "/proj/a",
        stop,
        restart: async (_newInputPath: string) => {},
      }),
    );
    const session = new PreviewSession(starter);
    await session.open("/proj/a");
    await session.dispose();
    expect(stop.mock.calls).toHaveLength(1);

    const empty = new PreviewSession(starter);
    await expect(empty.dispose()).resolves.toBeUndefined();
  });
});

describe("registerPreviewCommand — precondition refusal (D14)", () => {
  test("no workspace open -> a specific error message, the server is never started", async () => {
    const starter = mock(async (_options: StartOptions): Promise<PreviewServerHandleLike> => {
      throw new Error("must not be called");
    });
    const openExternal = mock(async (_url: string): Promise<boolean> => true);
    registerPreviewCommand({
      session: new PreviewSession(starter),
      outputChannel: asOutputChannel(fakeOutputChannel()),
      openExternal,
    });
    const handler = captured.registeredCommands.get("gutterpress.preview");
    expect(handler).toBeDefined();

    await handler?.();

    expect(starter.mock.calls).toHaveLength(0);
    expect(openExternal.mock.calls).toHaveLength(0);
    expect(captured.errorMessages).toHaveLength(1);
    expect(captured.errorMessages[0]).toContain("Gutterpress");
  });
});

describe("registerPreviewCommand — success wiring", () => {
  test("a resolved project starts the server and opens its URL externally", async () => {
    mockWorkspaceFolderPaths = [realProjectDir];
    const starter = mock(
      async (_options: StartOptions): Promise<PreviewServerHandleLike> => ({
        url: "http://127.0.0.1:4444",
        inputPath: realProjectDir,
        stop: async () => {},
        restart: async (_newInputPath: string) => {},
      }),
    );
    const openExternal = mock(async (_url: string): Promise<boolean> => true);
    registerPreviewCommand({
      session: new PreviewSession(starter),
      outputChannel: asOutputChannel(fakeOutputChannel()),
      openExternal,
    });
    const handler = captured.registeredCommands.get("gutterpress.preview");

    await handler?.();

    expect(starter.mock.calls[0]?.[0]).toMatchObject({ input: realProjectDir });
    expect(openExternal.mock.calls).toHaveLength(1);
    expect(openExternal.mock.calls[0]?.[0]).toBe("http://127.0.0.1:4444");
    expect(channelLines.some((l) => l.includes("http://127.0.0.1:4444"))).toBe(true);
    expect(captured.errorMessages).toHaveLength(0);
  });
});

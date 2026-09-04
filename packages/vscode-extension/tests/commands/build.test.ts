// Unit tests for src/commands/build.ts (SFE-P3c run spec deliverable 4).
//
// `deps.runBuild` is INJECTED (never the real gutterpress `runBuild`, which
// needs a real Chromium/Ghostscript toolchain this suite must not depend
// on) — see build.ts's own header for why this mirrors the
// ExportControllerDeps/PreviewOpenControllerDeps pattern already
// established for host-side gutterpress-calling commands in this codebase.

import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type * as vscode from "vscode";
import type { BuildRunnerOptions, BuildRunnerResult } from "gutterpress";
import type { FakeOutputChannel, VscodeDisposableLike } from "../support/vscode-mock.ts";
import { vscodeMock } from "../support/vscode-mock.ts";

// registerBuildCommand's own precondition check (../../src/project/discover.ts's
// resolveProjectForCommand) does a REAL `hasProjectManifest` filesystem read
// — a fake, nonexistent path like "/only/project" always resolves to "no
// project" there, regardless of what the vscode mock claims is open. The
// success-wiring tests below need a REAL directory with a REAL manifest.yaml
// (AP-25: disposable, never a committed fixture mutated in place).
let realProjectDir: string;
const disposableDirs: string[] = [];
afterAll(() => {
  for (const dir of disposableDirs) rmSync(dir, { recursive: true, force: true });
});

interface Captured {
  errorMessages: string[];
  infoMessages: string[];
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
    showInformationMessage: async (message: string) => {
      captured.infoMessages.push(message);
      return undefined;
    },
    activeTextEditor: undefined,
    get workspaceFolders() {
      return mockWorkspaceFolderPaths.map((p) => ({ uri: { fsPath: p } }));
    },
  }),
);

const { registerBuildCommand, runBuildForProject } = await import("../../src/commands/build.ts");

function fakeOutputChannel(): FakeOutputChannel {
  return { name: "Gutterpress", lines: [], appendLine: (v: string) => channelLines.push(v), dispose: () => {} };
}

/** `vscode.OutputChannel`'s real type also has `append`/`replace`/`clear`/
 *  `show`/`hide` — not implemented by the fake (nothing under test calls
 *  them). Cast at the one boundary that needs the real type, exactly
 *  mirroring `tests/provider.test.ts`'s own `asOutputChannel` helper. */
function asOutputChannel(fake: FakeOutputChannel): vscode.OutputChannel {
  return fake as unknown as vscode.OutputChannel;
}

let channelLines: string[];

beforeEach(() => {
  captured = { errorMessages: [], infoMessages: [], registeredCommands: new Map() };
  channelLines = [];
  mockWorkspaceFolderPaths = [];
  realProjectDir = mkdtempSync(path.join(tmpdir(), "gp-vscode-build-cmd-"));
  disposableDirs.push(realProjectDir);
  writeFileSync(path.join(realProjectDir, "manifest.yaml"), "title: Fixture\n", "utf8");
});

const SAMPLE_BUILD_RESULT: BuildRunnerResult = {
  outDir: "/proj/dist/book",
  htmlPath: "/proj/dist/book/book.html",
  pdfPath: null,
  fingerprintPath: null,
  diagnostics: [{ code: "engine.content.overheight", severity: "warning", message: "example warning" }],
};

describe("runBuildForProject — the injectable, vscode-command-free core", () => {
  test("success: reports the delivered path and logs every diagnostic", async () => {
    const outputChannel = fakeOutputChannel();
    const fakeRunBuild = mock(async (_options: BuildRunnerOptions): Promise<BuildRunnerResult> => SAMPLE_BUILD_RESULT);
    await runBuildForProject("/proj", { runBuild: fakeRunBuild, outputChannel: asOutputChannel(outputChannel) });

    expect(fakeRunBuild.mock.calls).toHaveLength(1);
    expect(fakeRunBuild.mock.calls[0]?.[0]).toEqual({ inputDir: "/proj", format: "pdf", rawArgs: {} });
    expect(channelLines.some((l) => l.includes("/proj/dist/book/book.html"))).toBe(true);
    expect(channelLines.some((l) => l.includes("engine.content.overheight"))).toBe(true);
    expect(captured.infoMessages).toHaveLength(1);
    expect(captured.errorMessages).toHaveLength(0);
  });

  test("failure: a rejected build is reported as a specific error, never a generic 'failed' (D14)", async () => {
    const outputChannel = fakeOutputChannel();
    const fakeRunBuild = mock(async (_options: BuildRunnerOptions): Promise<BuildRunnerResult> => {
      throw new Error("Chromium launch timed out");
    });
    await runBuildForProject("/proj", { runBuild: fakeRunBuild, outputChannel: asOutputChannel(outputChannel) });

    expect(captured.errorMessages).toHaveLength(1);
    expect(captured.errorMessages[0]).toContain("Chromium launch timed out");
    expect(captured.infoMessages).toHaveLength(0);
  });
});

describe("registerBuildCommand — precondition refusal (D14: specific, not generic)", () => {
  test("no workspace open -> a specific error message, runBuild never called", async () => {
    const fakeRunBuild = mock(async (_options: BuildRunnerOptions): Promise<BuildRunnerResult> => {
      throw new Error("must not be called");
    });
    registerBuildCommand({ runBuild: fakeRunBuild, outputChannel: asOutputChannel(fakeOutputChannel()) });
    const handler = captured.registeredCommands.get("gutterpress.build");
    expect(handler).toBeDefined();

    await handler?.();

    expect(fakeRunBuild.mock.calls).toHaveLength(0);
    expect(captured.errorMessages).toHaveLength(1);
    expect(captured.errorMessages[0]).toContain("Gutterpress");
    expect(captured.errorMessages[0]?.toLowerCase()).toContain("folder");
  });
});

describe("registerBuildCommand — success wiring", () => {
  test("a resolved project's directory reaches runBuild", async () => {
    mockWorkspaceFolderPaths = [realProjectDir];
    const fakeRunBuild = mock(
      async (_options: BuildRunnerOptions): Promise<BuildRunnerResult> => ({
        outDir: path.join(realProjectDir, "dist"),
        htmlPath: null,
        pdfPath: path.join(realProjectDir, "dist", "book.pdf"),
        fingerprintPath: null,
        diagnostics: [],
      }),
    );
    registerBuildCommand({ runBuild: fakeRunBuild, outputChannel: asOutputChannel(fakeOutputChannel()) });
    const handler = captured.registeredCommands.get("gutterpress.build");

    await handler?.();

    expect(fakeRunBuild.mock.calls).toHaveLength(1);
    expect(fakeRunBuild.mock.calls[0]?.[0]).toMatchObject({ inputDir: realProjectDir, format: "pdf" });
    expect(captured.errorMessages).toHaveLength(0);
  });
});

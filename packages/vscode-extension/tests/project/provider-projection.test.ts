// Wiring tests for the projection flow SFE-P3c Lane B added to
// src/provider.ts (run spec deliverables 2/3): project discovery ->
// resolveEditorProjectionMessage -> a "projection" message reaching the
// webview, resent on an accepted edit, an external change, and a trust
// grant — never sent for a source-fallback (oversized) document.
//
// Kept in tests/project/** (this lane's write boundary) rather than
// tests/provider.test.ts (Lane A's, frozen) — see this run's report for the
// one existing assertion in that file this run's own required feature
// necessarily outdates, which this file does not attempt to patch around.
//
// Uses the REAL (unmocked) gutterpress/plugins loader against this run's
// own local fixture (fixtures/plugin-project/) — the SPY-based "never
// invoked when untrusted" proof lives in projection.test.ts, against
// resolveEditorProjectionMessage's own injectable loader parameter (see
// that file's own comment for why a real package specifier is never
// mock.module()'d in this suite). THIS file instead proves provider.ts
// correctly THREADS trust/project through to that function, by observing
// the real projection's own shape (plugin-region blocks present or absent)
// — a different property than "was the loader called," already proven
// elsewhere.

import { beforeEach, describe, expect, mock, test } from "bun:test";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor/core";
import type * as vscode from "vscode";
import { vscodeMock, type FakeOutputChannel, type FakeWorkspaceEdit, type VscodeDisposableLike } from "../support/vscode-mock.ts";

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugin-project");
const HIGHLIGHT_CONTENT = "@@highlight Getting started\n\nSome ordinary paragraph text.\n";

if (!existsSync(path.join(FIXTURE_ROOT, "manifest.yaml"))) {
  throw new Error("provider-projection.test.ts: fixtures/plugin-project/manifest.yaml is missing.");
}

interface FakeApiCalls {
  applyEditCalls: FakeWorkspaceEdit[];
}

let apiCalls: FakeApiCalls;
let documentText: string;
let documentVersion: number;
let trustListener: (() => void) | undefined;
let mockWorkspaceFolderFsPath: string | undefined;
let mockIsTrusted: boolean;

mock.module("vscode", () =>
  vscodeMock({
    applyEdit: async (edit) => {
      const fake = edit as FakeWorkspaceEdit;
      apiCalls.applyEditCalls.push(fake);
      for (const r of fake.replacements) {
        const range = r.range as { start: { line: number; character: number }; end: { line: number; character: number } };
        const from = offsetOf(documentText, range.start);
        const to = offsetOf(documentText, range.end);
        documentText = documentText.slice(0, from) + r.newText + documentText.slice(to);
        documentVersion += 1;
      }
      return true;
    },
    onDidGrantWorkspaceTrust: (listener): VscodeDisposableLike => {
      trustListener = listener;
      return { dispose: () => {} };
    },
    getWorkspaceFolder: () =>
      mockWorkspaceFolderFsPath === undefined ? undefined : { uri: { fsPath: mockWorkspaceFolderFsPath } },
    get isTrusted() {
      return mockIsTrusted;
    },
  }),
);

const { createGutterpressMarkdownEditorProvider, RICH_MODE_MAX_CONTENT_BYTES } = await import("../../src/provider.ts");

function offsetOf(text: string, position: { line: number; character: number }): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < position.line; i++) offset += (lines[i]?.length ?? 0) + 1;
  return offset + position.character;
}

function fakeDocument(text: string): vscode.TextDocument {
  documentText = text;
  documentVersion = 0;
  return {
    uri: { toString: () => "fidelity://doc.md" },
    get version() {
      return documentVersion;
    },
    isClosed: false,
    getText: () => documentText,
    positionAt: (offset: number) => {
      let line = 0;
      let lineStart = 0;
      for (let i = 0; i < offset; i++) {
        if (documentText[i] === "\n") {
          line += 1;
          lineStart = i + 1;
        }
      }
      return { line, character: offset - lineStart };
    },
  } as unknown as vscode.TextDocument;
}

interface FakePanel {
  panel: vscode.WebviewPanel;
  fireMessage: (message: unknown) => void;
  sentToWebview: unknown[];
  /** Resolves with the NEXT "projection"-typed message posted, however
   *  long that takes (real plugin loading involves real disk I/O — no
   *  arbitrary timeout guessing). A safety timeout still bounds it so a
   *  broken implementation fails loudly instead of hanging (G-12/AP-20). */
  waitForNextProjection: () => Promise<{ readonly [key: string]: unknown }>;
}

function fakePanel(): FakePanel {
  const sentToWebview: unknown[] = [];
  let messageListener: ((message: unknown) => void) | undefined;
  const projectionWaiters: Array<(message: { readonly [key: string]: unknown }) => void> = [];

  const panel = {
    webview: {
      options: undefined,
      html: "",
      cspSource: "vscode-webview://fake-csp-source",
      asWebviewUri: (uri: unknown) => ({ toString: () => `vscode-webview://fake-csp-source/${String(uri)}` }),
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        messageListener = listener;
        return { dispose: () => {} };
      },
      postMessage: async (message: unknown) => {
        sentToWebview.push(message);
        const typed = message as { type?: string };
        if (typed.type === "projection") {
          while (projectionWaiters.length > 0) projectionWaiters.shift()?.(message as { readonly [key: string]: unknown });
        }
        return true;
      },
    },
    onDidDispose: () => ({ dispose: () => {} }),
  } as unknown as vscode.WebviewPanel;

  return {
    panel,
    sentToWebview,
    fireMessage: (message: unknown) => messageListener?.(message),
    waitForNextProjection: () =>
      Promise.race([
        new Promise<{ readonly [key: string]: unknown }>((resolve) => projectionWaiters.push(resolve)),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("waitForNextProjection: timed out after 5s")), 5000),
        ),
      ]),
  };
}

function fakeExtensionContext(): vscode.ExtensionContext {
  return { extensionUri: { toString: () => "fidelity://extension-root" } } as unknown as vscode.ExtensionContext;
}

function fakeOutputChannel(): FakeOutputChannel {
  return { name: "Gutterpress", lines: [], appendLine: () => {}, dispose: () => {} };
}

function asOutputChannel(fake: FakeOutputChannel): vscode.OutputChannel {
  return fake as unknown as vscode.OutputChannel;
}

beforeEach(() => {
  apiCalls = { applyEditCalls: [] };
  trustListener = undefined;
  mockWorkspaceFolderFsPath = undefined;
  mockIsTrusted = true;
});

describe("resolveCustomTextEditor — projection sent on the ready handshake (deliverable 2)", () => {
  test("trusted + project with a real plugin -> the sent projection has a plugin-region block and non-empty pluginCss", async () => {
    mockWorkspaceFolderFsPath = FIXTURE_ROOT;
    mockIsTrusted = true;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, waitForNextProjection } = fakePanel();
    provider.resolveCustomTextEditor(fakeDocument(HIGHLIGHT_CONTENT), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });

    const message = await waitForNextProjection();
    expect(message.protocolVersion).toBe(EDITOR_PROTOCOL_VERSION);
    const projection = message.projection as { blocks: Array<{ kind: string }> };
    expect(projection.blocks.some((b) => b.kind === "plugin-region")).toBe(true);
    expect(message.pluginCss).toContain(".gp-highlight");
    expect(message.pluginErrors).toEqual([]);
  });

  test("D9/D12: UNTRUSTED workspace + project present -> the sent projection has NO plugin-region block, even though the project has a real, loadable plugin", async () => {
    mockWorkspaceFolderFsPath = FIXTURE_ROOT;
    mockIsTrusted = false;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, waitForNextProjection } = fakePanel();
    provider.resolveCustomTextEditor(fakeDocument(HIGHLIGHT_CONTENT), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });

    const message = await waitForNextProjection();
    const projection = message.projection as { blocks: Array<{ kind: string }> };
    expect(projection.blocks.some((b) => b.kind === "plugin-region")).toBe(false);
    expect(message.pluginCss).toBe("");
  });

  test("D9: no Gutterpress project at this workspace folder -> base pipeline is still sent (never blocked)", async () => {
    mockWorkspaceFolderFsPath = undefined; // no workspace folder for this document
    mockIsTrusted = true;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, waitForNextProjection } = fakePanel();
    provider.resolveCustomTextEditor(fakeDocument("hello world"), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });

    const message = await waitForNextProjection();
    expect(message.type).toBe("projection");
    const projection = message.projection as { sourceVersion: number };
    expect(projection.sourceVersion).toBe(0);
  });

  test("D13: an oversized document (source-fallback mode) never sends a projection message at all", async () => {
    mockWorkspaceFolderFsPath = FIXTURE_ROOT;
    mockIsTrusted = true;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakePanel();
    const oversized = "x".repeat(RICH_MODE_MAX_CONTENT_BYTES + 1);
    provider.resolveCustomTextEditor(fakeDocument(oversized), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });

    // Bounded wait for anything that WOULD have arrived, then assert absence.
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(sentToWebview.some((m) => (m as { type?: string }).type === "projection")).toBe(false);
  });
});

describe("resolveCustomTextEditor — projection resend on authoritative snapshot changes (deliverable 2)", () => {
  test("an accepted edit triggers a resend reflecting the new content and version", async () => {
    mockWorkspaceFolderFsPath = undefined;
    mockIsTrusted = true;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, waitForNextProjection } = fakePanel();
    provider.resolveCustomTextEditor(fakeDocument("hello world"), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
    const first = await waitForNextProjection();
    expect((first.projection as { sourceVersion: number }).sourceVersion).toBe(0);

    fireMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 6, to: 11, insert: "there", expectedVersion: 0 },
    });

    const second = await waitForNextProjection();
    expect((second.projection as { sourceVersion: number }).sourceVersion).toBe(1);
  });

  test("a REJECTED edit (stale expectedVersion) does not trigger an extra resend", async () => {
    mockWorkspaceFolderFsPath = undefined;
    mockIsTrusted = true;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, waitForNextProjection, sentToWebview } = fakePanel();
    provider.resolveCustomTextEditor(fakeDocument("hello world"), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
    await waitForNextProjection(); // the initial projection from "ready"

    fireMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      // Wrong expectedVersion (document is at 0) — DocumentGateway's own
      // dry run rejects this locally, without ever calling
      // workspace.applyEdit, so the version never moves.
      edit: { from: 0, to: 5, insert: "X", expectedVersion: 99 },
    });
    // No REAL change occurred, so there is no next projection to await —
    // bounded wait, then assert exactly one projection was ever sent.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const projectionMessages = sentToWebview.filter((m) => (m as { type?: string }).type === "projection");
    expect(projectionMessages).toHaveLength(1);
  });
});

describe("resolveCustomTextEditor — trust grant re-resolves and resends (D9)", () => {
  test("granting trust moves an already-open project from base to plugin-aware and resends", async () => {
    mockWorkspaceFolderFsPath = FIXTURE_ROOT;
    mockIsTrusted = false;
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, waitForNextProjection } = fakePanel();
    provider.resolveCustomTextEditor(fakeDocument(HIGHLIGHT_CONTENT), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
    const beforeTrust = await waitForNextProjection();
    expect((beforeTrust.projection as { blocks: Array<{ kind: string }> }).blocks.some((b) => b.kind === "plugin-region")).toBe(
      false,
    );

    mockIsTrusted = true; // matches the real one-directional "trust granted" semantics
    const afterTrustPromise = waitForNextProjection();
    trustListener?.();
    const afterTrust = await afterTrustPromise;
    expect((afterTrust.projection as { blocks: Array<{ kind: string }> }).blocks.some((b) => b.kind === "plugin-region")).toBe(
      true,
    );
  });
});

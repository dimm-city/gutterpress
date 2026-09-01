// Unit tests for src/provider.ts (SFE-P3c run spec DETAILS #4, "PROVIDER +
// EXTENSION WIRING").
//
// provider.ts now imports "vscode" as a VALUE (constructs
// `new vscode.WorkspaceEdit()`/`new vscode.Range(...)`, calls
// `vscode.workspace.applyEdit`/`vscode.Uri.joinPath`/
// `vscode.window.createOutputChannel`, reads `vscode.workspace.isTrusted`) —
// unlike the SFE-P1a placeholder it replaces, which imported "vscode" as a
// TYPE only. This suite therefore now needs `mock.module("vscode", ...)`
// BEFORE its dynamic import, exactly like tests/extension.test.ts already
// does — see tests/support/vscode-mock.ts's header for the full account.

import { beforeEach, describe, expect, test } from "bun:test";
import { mock } from "bun:test";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor/core";
import { createEditorProjection } from "gutterpress/render";
import type * as vscode from "vscode";
import {
  vscodeMock,
  type FakeOutputChannel,
  type FakeWorkspaceEdit,
  type VscodeDisposableLike,
} from "./support/vscode-mock.ts";

interface FakeApiCalls {
  applyEditCalls: FakeWorkspaceEdit[];
  onDidChangeTextDocumentSubscriptions: number;
  onDidCloseTextDocumentSubscriptions: number;
}

let apiCalls: FakeApiCalls;
let documentText: string;
let documentVersion: number;

mock.module("vscode", () =>
  vscodeMock({
    applyEdit: async (edit) => {
      const fake = edit as FakeWorkspaceEdit;
      apiCalls.applyEditCalls.push(fake);
      // Actually mutate the backing fake document text/version so a
      // "success" reply in this suite reflects a REAL change, not merely
      // an unchanged echo — proves the full positionAt -> Range ->
      // WorkspaceEdit -> apply -> reply chain, not just that it didn't
      // crash. Single, non-overlapping replacement only (all this run's
      // own callers ever construct).
      for (const r of fake.replacements) {
        const range = r.range as { start: { line: number; character: number }; end: { line: number; character: number } };
        const from = offsetOf(documentText, range.start);
        const to = offsetOf(documentText, range.end);
        documentText = documentText.slice(0, from) + r.newText + documentText.slice(to);
        documentVersion += 1;
      }
      return true;
    },
    onDidChangeTextDocument: (): VscodeDisposableLike => {
      apiCalls.onDidChangeTextDocumentSubscriptions += 1;
      return { dispose: () => {} };
    },
    onDidCloseTextDocument: (): VscodeDisposableLike => {
      apiCalls.onDidCloseTextDocumentSubscriptions += 1;
      return { dispose: () => {} };
    },
    isTrusted: true,
  }),
);

const { createGutterpressMarkdownEditorProvider, renderWebviewHtml, RICH_MODE_MAX_CONTENT_BYTES } = await import(
  "../src/provider.ts"
);

function offsetOf(text: string, position: { line: number; character: number }): number {
  const lines = text.split("\n");
  let offset = 0;
  for (let i = 0; i < position.line; i++) offset += (lines[i]?.length ?? 0) + 1;
  return offset + position.character;
}

// ── renderWebviewHtml — CSP/nonce/base structure ───────────────────────────

describe("renderWebviewHtml", () => {
  const options = { cspSource: "vscode-webview://abc", baseUri: "vscode-webview://abc/dist", scriptUri: "vscode-webview://abc/dist/webview.js" };

  test("sets default-src 'none' and a nonce-scoped script-src", () => {
    const html = renderWebviewHtml(options);
    expect(html).toContain("default-src 'none'");
    const nonceMatch = html.match(/script-src 'nonce-([A-Za-z0-9+/=]+)'/);
    expect(nonceMatch).not.toBeNull();
    expect(nonceMatch?.[1]?.length).toBeGreaterThan(0);
  });

  test("the <script> tag carries the SAME nonce as the CSP directive", () => {
    const html = renderWebviewHtml(options);
    const cspNonce = html.match(/script-src 'nonce-([A-Za-z0-9+/=]+)'/)?.[1];
    const tagNonce = html.match(/<script nonce="([A-Za-z0-9+/=]+)"/)?.[1];
    expect(cspNonce).toBeTruthy();
    expect(cspNonce).toBe(tagNonce);
  });

  test("declares an explicit <base> as the FIRST element in <head>, restricted by a base-uri CSP directive", () => {
    const html = renderWebviewHtml(options);
    expect(html).toContain(`<base href="${options.baseUri}/">`);
    expect(html).toContain(`base-uri ${options.baseUri}`);
    const headIndex = html.indexOf("<head>");
    const baseIndex = html.indexOf("<base ");
    const otherTagIndex = html.indexOf("<meta", headIndex + "<head>".length);
    expect(baseIndex).toBeGreaterThan(headIndex);
    expect(baseIndex).toBeLessThan(otherTagIndex);
  });

  test("the script tag's src is the provided scriptUri", () => {
    const html = renderWebviewHtml(options);
    expect(html).toContain(`src="${options.scriptUri}"`);
  });

  test("img-src/font-src are scoped to cspSource only, never a remote origin", () => {
    const html = renderWebviewHtml(options);
    expect(html).toContain(`img-src ${options.cspSource}`);
    expect(html).toContain(`font-src ${options.cspSource}`);
    expect(html).not.toContain("https:");
  });

  test("two renders use different, unguessable nonces", () => {
    const first = renderWebviewHtml(options).match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    const second = renderWebviewHtml(options).match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    expect(first).not.toBe(second);
    expect(first?.length).toBeGreaterThanOrEqual(16); // base64 of 16 random bytes
  });

  test("never embeds document text (this shell has none to embed — content lives inside the mounted editor DOM)", () => {
    const html = renderWebviewHtml(options);
    expect(html).not.toContain("<pre>");
  });
});

// ── resolveCustomTextEditor — wiring ───────────────────────────────────────

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

interface FakeWebviewPanel {
  panel: vscode.WebviewPanel;
  getHtml: () => string;
  getOptions: () => unknown;
  sentToWebview: unknown[];
  fireMessage: (message: unknown) => void;
  fireDispose: () => void;
  disposeCallCounts: { messageSubscription: number };
}

function fakeWebviewPanel(): FakeWebviewPanel {
  let html = "";
  let options: unknown;
  const sentToWebview: unknown[] = [];
  let messageListener: ((message: unknown) => void) | undefined;
  let disposeListener: (() => void) | undefined;
  const disposeCallCounts = { messageSubscription: 0 };

  const panel = {
    webview: {
      set options(value: unknown) {
        options = value;
      },
      get options() {
        return options;
      },
      set html(value: string) {
        html = value;
      },
      get html() {
        return html;
      },
      cspSource: "vscode-webview://fake-csp-source",
      asWebviewUri: (uri: unknown) => ({ toString: () => `vscode-webview://fake-csp-source/${String(uri)}` }),
      onDidReceiveMessage: (listener: (message: unknown) => void) => {
        messageListener = listener;
        return { dispose: () => (disposeCallCounts.messageSubscription += 1) };
      },
      postMessage: async (message: unknown) => {
        sentToWebview.push(message);
        return true;
      },
    },
    onDidDispose: (listener: () => void) => {
      disposeListener = listener;
      return { dispose: () => {} };
    },
  } as unknown as vscode.WebviewPanel;

  return {
    panel,
    getHtml: () => html,
    getOptions: () => options,
    sentToWebview,
    fireMessage: (message: unknown) => messageListener?.(message),
    fireDispose: () => disposeListener?.(),
    disposeCallCounts,
  };
}

function fakeExtensionContext(): vscode.ExtensionContext {
  return { extensionUri: { toString: () => "fidelity://extension-root" } } as unknown as vscode.ExtensionContext;
}

function fakeOutputChannel(): FakeOutputChannel {
  const lines: string[] = [];
  return { name: "Gutterpress", lines, appendLine: (v: string) => lines.push(v), dispose: () => {} };
}

/**
 * Casts a structurally-narrow `FakeOutputChannel` to the real
 * `vscode.OutputChannel` type `createGutterpressMarkdownEditorProvider`
 * declares (provider.ts's SECOND parameter — provider.ts imports "vscode"
 * as a value now, so its TYPES come from the real `@types/vscode` .d.ts
 * regardless of what `mock.module` swaps in at runtime). Only
 * `appendLine`/`name` are ever called by provider.ts; this keeps the fake
 * itself to that real surface rather than implementing
 * `append`/`replace`/`clear`/`show`/`hide`, which nothing under test calls
 * — the cast is applied only at this one boundary, so every test can still
 * read `.lines` off its own `FakeOutputChannel`-typed value directly.
 */
function asOutputChannel(fake: FakeOutputChannel): vscode.OutputChannel {
  return fake as unknown as vscode.OutputChannel;
}

beforeEach(() => {
  apiCalls = { applyEditCalls: [], onDidChangeTextDocumentSubscriptions: 0, onDidCloseTextDocumentSubscriptions: 0 };
});

describe("resolveCustomTextEditor — webview options and html", () => {
  test("sets enableScripts:true and localResourceRoots scoped to the extension's own dist directory", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, getOptions } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken);

    const options = getOptions() as { enableScripts: boolean; localResourceRoots: Array<{ toString(): string }> };
    expect(options.enableScripts).toBe(true);
    expect(options.localResourceRoots).toHaveLength(1);
    expect(String(options.localResourceRoots[0])).toContain("dist");
  });

  test("html loads the webview bundle via webview.asWebviewUri", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, getHtml } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken);
    expect(getHtml()).toContain("vscode-webview://fake-csp-source");
    expect(getHtml()).toContain("webview.js");
  });
});

describe("resolveCustomTextEditor — 'ready' handshake", () => {
  test("replies with presentation-input, trust-state, and snapshot, in that order", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello world"), panel, {} as vscode.CancellationToken);

    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });

    expect(sentToWebview).toHaveLength(3);
    expect((sentToWebview[0] as { type: string }).type).toBe("presentation-input");
    expect((sentToWebview[1] as { type: string }).type).toBe("trust-state");
    expect((sentToWebview[2] as { type: string }).type).toBe("snapshot");
    expect(sentToWebview[2]).toEqual({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: { text: "hello world", version: 0 },
      // Reconciliation addendum: gateway.sendInitialSnapshot() (routed
      // through here by provider.ts's "ready" handler) deliberately does
      // NOT bump the base stamp — it reports the pre-session state, and
      // bumping would stale-reject an edit submitted before this reply
      // arrives (see that method's own doc comment). Stays at the
      // gateway's initial value.
      baseStamp: 0,
    });
  });

  test("presentation-input reports mode 'rich' for an ordinary-sized document", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("small"), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(sentToWebview[0]).toEqual({ type: "presentation-input", protocolVersion: EDITOR_PROTOCOL_VERSION, mode: "rich" });
  });

  test("D13: a document over the 2 MiB ceiling reports mode 'source-fallback' with EDITOR_FILE_TOO_LARGE", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakeWebviewPanel();
    const oversized = "x".repeat(RICH_MODE_MAX_CONTENT_BYTES + 1);
    provider.resolveCustomTextEditor(fakeDocument(oversized), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });

    const presentationInput = sentToWebview[0] as { mode: string; diagnostic?: { category: string } };
    expect(presentationInput.mode).toBe("source-fallback");
    expect(presentationInput.diagnostic?.category).toBe("EDITOR_FILE_TOO_LARGE");
  });

  test("D13 boundary: a document exactly AT the ceiling still mounts rich", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakeWebviewPanel();
    const atLimit = "x".repeat(RICH_MODE_MAX_CONTENT_BYTES);
    provider.resolveCustomTextEditor(fakeDocument(atLimit), panel, {} as vscode.CancellationToken);
    fireMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect((sentToWebview[0] as { mode: string }).mode).toBe("rich");
  });
});

describe("resolveCustomTextEditor — apply-edit end to end", () => {
  test("a valid apply-edit reaches workspace.applyEdit via document.positionAt and replies with the new snapshot, then a merged presentation-input projection resend", async () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello world"), panel, {} as vscode.CancellationToken);

    fireMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 6, to: 11, insert: "there", expectedVersion: 0 },
      // Matches the gateway's initial base stamp (0 — no "ready" was fired
      // in this test, so no authoritative send has happened yet to bump
      // it). Reconciliation addendum: `base`, not `edit.expectedVersion`,
      // is what DocumentGateway compares against its own stamp.
      base: 0,
    });
    // provider.ts's "apply-edit" handler calls `void gateway.applyEdit(...)`
    // (fire-and-forget: the message-listener contract is synchronous), and
    // DocumentGateway.applyEdit is itself async (it awaits
    // workspace.applyEdit before its single reply site) — flush pending
    // microtasks so that reply, AND the projection rebuild it triggers
    // (`../src/provider.ts`'s own `gatewayApi.postMessage` intercept calls
    // `sendProjection()` synchronously, which resolves via a microtask
    // chain with no real plugin I/O here — no workspace folder is mocked,
    // so `project` is `undefined` and the base pipeline resolves
    // immediately), have both landed before asserting.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiCalls.applyEditCalls).toHaveLength(1);
    // Reconciliation addendum's message merge: the accepted edit's own
    // snapshot reply is ONE message; the projection rebuild it triggers
    // (deliverable 2) is a SECOND, merged presentation-input resend — two
    // messages total, in that order, not the pre-merge single reply.
    expect(sentToWebview).toHaveLength(2);
    expect(sentToWebview[0]).toEqual({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: { text: "hello there", version: 1 },
      baseStamp: 1,
    });
    expect(sentToWebview[1]).toEqual({
      type: "presentation-input",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      mode: "rich",
      // No workspace folder is mocked in this suite (getWorkspaceFolder's
      // default), so `project` is `undefined` and this resend takes the
      // base (non-plugin-aware) pipeline — computed via the SAME real
      // function provider.ts itself calls, not a hand-typed shape.
      projection: createEditorProjection("hello there", { sourceVersion: 1 }),
      pluginCss: "",
      pluginErrors: [],
    });
  });
});

describe("resolveCustomTextEditor — D12: every inbound message is validated before dispatch", () => {
  test("a message with the wrong protocolVersion is dropped: no applyEdit call, no reply, no throw", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage, sentToWebview } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken);

    expect(() =>
      fireMessage({
        type: "apply-edit",
        protocolVersion: 999,
        edit: { from: 0, to: 1, insert: "X", expectedVersion: 0 },
      }),
    ).not.toThrow();

    expect(apiCalls.applyEditCalls).toHaveLength(0);
    expect(sentToWebview).toHaveLength(0);
  });

  test("a message with a missing required field is dropped, not coerced", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireMessage } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken);

    expect(() => fireMessage({ type: "apply-edit", protocolVersion: EDITOR_PROTOCOL_VERSION })).not.toThrow();
    expect(apiCalls.applyEditCalls).toHaveLength(0);
  });
});

describe("resolveCustomTextEditor — disposal", () => {
  test("disposing the panel disposes the message subscription", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireDispose, disposeCallCounts } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken);

    expect(disposeCallCounts.messageSubscription).toBe(0);
    fireDispose();
    expect(disposeCallCounts.messageSubscription).toBe(1);
  });

  test("resolving subscribes to onDidChangeTextDocument and onDidCloseTextDocument exactly once each", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken);
    expect(apiCalls.onDidChangeTextDocumentSubscriptions).toBe(1);
    expect(apiCalls.onDidCloseTextDocumentSubscriptions).toBe(1);
  });

  test("resolving does not throw, and disposing twice does not throw", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(fakeOutputChannel()));
    const { panel, fireDispose } = fakeWebviewPanel();
    expect(() => provider.resolveCustomTextEditor(fakeDocument("hello"), panel, {} as vscode.CancellationToken)).not.toThrow();
    expect(() => {
      fireDispose();
    }).not.toThrow();
  });
});

describe("resolveCustomTextEditor — D15: session logging never includes document text", () => {
  test("the output channel's logged lines never contain the document's own content", async () => {
    const outputChannel = fakeOutputChannel();
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext(), asOutputChannel(outputChannel));
    const { panel, fireMessage } = fakeWebviewPanel();
    const marker = `MARKER_${Math.random().toString(36).slice(2)}`;
    provider.resolveCustomTextEditor(fakeDocument(`before ${marker} after`), panel, {} as vscode.CancellationToken);
    fireMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 0, to: 6, insert: "AFTER ", expectedVersion: 0 },
      base: 0, // matches the gateway's initial stamp — no "ready" was fired, so it has not moved
    });
    await new Promise((resolve) => setTimeout(resolve, 0)); // let the full log sequence complete — see the apply-edit test above

    expect(outputChannel.lines.join("\n")).not.toContain(marker);
  });
});

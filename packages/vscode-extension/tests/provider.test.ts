// Unit tests for src/provider.ts (SFE-P1a behavior table: "resolveCustomTextEditor
// sets webview html containing the document text ... and a CSP meta tag
// with nonce").
//
// provider.ts imports "vscode" as `import type * as vscode` ONLY (erased at
// compile time — see its header), so this suite needs NO
// `mock.module("vscode", ...)`: it builds minimal fake TextDocument/
// WebviewPanel stubs (structurally cast, not full interface
// implementations — see EDITOR_PROTOCOL_VERSION's shape below) and imports
// provider.ts directly, no dynamic import ordering required.

import { describe, expect, test } from "bun:test";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor";
import type * as vscode from "vscode";
import { createGutterpressMarkdownEditorProvider, renderPlaceholderHtml } from "../src/provider.ts";

describe("renderPlaceholderHtml", () => {
  test("contains the exact document text", () => {
    const html = renderPlaceholderHtml("# Hello\n\nSome *markdown* text.");
    expect(html).toContain("# Hello");
    expect(html).toContain("Some *markdown* text.");
  });

  test("HTML-escapes document text (never raw-injects markup)", () => {
    const html = renderPlaceholderHtml("<script>alert(1)</script> & \"quoted\" 'text'");
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&amp;");
    expect(html).toContain("&quot;quoted&quot;");
    expect(html).toContain("&#39;text&#39;");
  });

  test("contains a Content-Security-Policy meta tag with a nonce", () => {
    const html = renderPlaceholderHtml("content");
    expect(html).toContain('http-equiv="Content-Security-Policy"');
    const nonceMatch = html.match(/nonce-([A-Za-z0-9+/=]+)/);
    expect(nonceMatch).not.toBeNull();
    expect(nonceMatch?.[1]?.length).toBeGreaterThan(0);
  });

  test("CSP forbids script execution and remote/local resource loading", () => {
    const html = renderPlaceholderHtml("content");
    expect(html).toContain("script-src 'none'");
    expect(html).toContain("img-src 'none'");
    expect(html).toContain("default-src 'none'");
  });

  test("two renders use different nonces (not a fixed/predictable value)", () => {
    const first = renderPlaceholderHtml("content")?.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    const second = renderPlaceholderHtml("content")?.match(/nonce-([A-Za-z0-9+/=]+)/)?.[1];
    expect(first).not.toBe(second);
  });

  test("shows EDITOR_PROTOCOL_VERSION imported from @dimm-city/gutterpress-editor", () => {
    const html = renderPlaceholderHtml("content");
    expect(html).toContain(`protocol v${EDITOR_PROTOCOL_VERSION}`);
    expect(EDITOR_PROTOCOL_VERSION).toBe(1);
  });
});

/** Minimal fake TextDocument — only `getText()` is ever called by the provider. */
function fakeDocument(text: string): vscode.TextDocument {
  return { getText: () => text } as unknown as vscode.TextDocument;
}

/** Minimal fake WebviewPanel — records what the provider assigns/registers. */
function fakeWebviewPanel(): {
  panel: vscode.WebviewPanel;
  getHtml: () => string;
  getOptions: () => unknown;
  fireDispose: () => void;
} {
  let html = "";
  let options: unknown;
  let disposeListener: (() => void) | undefined;
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
    fireDispose: () => disposeListener?.(),
  };
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const fakeExtensionContext = {} as unknown as vscode.ExtensionContext;

describe("createGutterpressMarkdownEditorProvider — resolveCustomTextEditor", () => {
  test("sets webview.html to contain the document's exact text", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext);
    const { panel, getHtml } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("@chapter Hello"), panel, fakeToken);
    expect(getHtml()).toContain("@chapter Hello");
  });

  test("sets webview.html to contain a CSP meta tag with a nonce", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext);
    const { panel, getHtml } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("content"), panel, fakeToken);
    expect(getHtml()).toContain('http-equiv="Content-Security-Policy"');
    expect(getHtml()).toMatch(/nonce-[A-Za-z0-9+/=]+/);
  });

  test("disables scripts and local resource roots (no filesystem/Node access from the webview — D9/D12)", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext);
    const { panel, getOptions } = fakeWebviewPanel();
    provider.resolveCustomTextEditor(fakeDocument("content"), panel, fakeToken);
    expect(getOptions()).toEqual({ enableScripts: false, localResourceRoots: [] });
  });

  test("resolving does not throw, and firing the registered onDidDispose listener does not throw", () => {
    const provider = createGutterpressMarkdownEditorProvider(fakeExtensionContext);
    const { panel, fireDispose } = fakeWebviewPanel();
    expect(() => provider.resolveCustomTextEditor(fakeDocument("content"), panel, fakeToken)).not.toThrow();
    expect(() => fireDispose()).not.toThrow();
  });
});

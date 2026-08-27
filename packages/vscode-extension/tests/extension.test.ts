// Unit tests for src/extension.ts (SFE-P1a behavior table: "Extension
// skeleton" — "gutterpress.markdownEditor provider registered on
// activation ... protocol version constant imported from
// @dimm-city/gutterpress-editor").
//
// src/extension.ts imports `vscode` as a VALUE (it calls
// `vscode.window.registerCustomEditorProvider`), and "vscode" is not a real
// runtime module under `bun test` — see tests/support/vscode-mock.ts's
// header. It must therefore be mocked via `mock.module` BEFORE the dynamic
// `import()` of extension.ts below, mirroring
// packages/desktop/tests/updater/electron-updater.test.ts's identical
// `mock.module("electron", ...)`-before-dynamic-import pattern for
// "electron".

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type * as vscode from "vscode";
import { vscodeMock, type VscodeDisposableLike } from "./support/vscode-mock.ts";

interface RegisterCall {
  viewType: string;
  provider: unknown;
  options: unknown;
}

const registerCalls: RegisterCall[] = [];
let disposeCallCount = 0;

mock.module("vscode", () =>
  vscodeMock({
    registerCustomEditorProvider: (viewType, provider, options): VscodeDisposableLike => {
      registerCalls.push({ viewType, provider, options });
      return {
        dispose: () => {
          disposeCallCount++;
        },
      };
    },
  }),
);

const { activate, deactivate } = await import("../src/extension.ts");

function fakeContext(): vscode.ExtensionContext {
  return { subscriptions: [] } as unknown as vscode.ExtensionContext;
}

beforeEach(() => {
  registerCalls.length = 0;
  disposeCallCount = 0;
});

describe("activate — gutterpress.markdownEditor registration (D9)", () => {
  test("registers exactly one custom editor provider, for viewType gutterpress.markdownEditor", () => {
    activate(fakeContext());
    expect(registerCalls).toHaveLength(1);
    expect(registerCalls[0]?.viewType).toBe("gutterpress.markdownEditor");
  });

  test("registers with retainContextWhenHidden:false and supportsMultipleEditorsPerDocument:false", () => {
    activate(fakeContext());
    expect(registerCalls[0]?.options).toEqual({
      webviewOptions: { retainContextWhenHidden: false },
      supportsMultipleEditorsPerDocument: false,
    });
  });

  test("passes a provider implementing resolveCustomTextEditor", () => {
    activate(fakeContext());
    const provider = registerCalls[0]?.provider as { resolveCustomTextEditor?: unknown };
    expect(typeof provider.resolveCustomTextEditor).toBe("function");
  });

  test("pushes exactly the registration disposable onto context.subscriptions", () => {
    const context = fakeContext();
    activate(context);
    expect(context.subscriptions).toHaveLength(1);
  });
});

describe("disposal (SFE-P1a behavior table: 'disposal does not throw')", () => {
  test("disposing the pushed registration does not throw, and reaches the underlying dispose", () => {
    const context = fakeContext();
    activate(context);
    expect(() => {
      for (const subscription of context.subscriptions) subscription.dispose();
    }).not.toThrow();
    expect(disposeCallCount).toBe(1);
  });

  test("deactivate() is a no-op that does not throw", () => {
    expect(() => deactivate()).not.toThrow();
  });
});

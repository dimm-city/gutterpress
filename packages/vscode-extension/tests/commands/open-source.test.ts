// Unit tests for src/commands/open-source.ts (SFE-P3c run spec deliverable 4).

import { beforeEach, describe, expect, mock, test } from "bun:test";
import type { VscodeDisposableLike } from "../support/vscode-mock.ts";
import { vscodeMock } from "../support/vscode-mock.ts";

interface Captured {
  errorMessages: string[];
  registeredCommands: Map<string, (...args: unknown[]) => unknown>;
  openedTextDocuments: unknown[];
  shownDocuments: unknown[];
}

let captured: Captured;
let mockActiveTab: { readonly input: unknown } | undefined;

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
    openTextDocument: async (uri: unknown) => {
      captured.openedTextDocuments.push(uri);
      return { uri };
    },
    showTextDocument: async (document: unknown) => {
      captured.shownDocuments.push(document);
      return { document };
    },
    get activeTab() {
      return mockActiveTab;
    },
  }),
);

const vscode = await import("vscode");
const { findActiveGutterpressEditorUri, registerOpenSourceCommand } = await import("../../src/commands/open-source.ts");

beforeEach(() => {
  captured = { errorMessages: [], registeredCommands: new Map(), openedTextDocuments: [], shownDocuments: [] };
  mockActiveTab = undefined;
});

describe("findActiveGutterpressEditorUri", () => {
  test("no active tab at all -> undefined", () => {
    mockActiveTab = undefined;
    expect(findActiveGutterpressEditorUri()).toBeUndefined();
  });

  test("an active tab whose input is NOT a TabInputCustom -> undefined (e.g. a plain text editor tab)", () => {
    mockActiveTab = { input: { uri: { toString: () => "file:///plain.md" } } }; // TabInputText-shaped, but not the class
    expect(findActiveGutterpressEditorUri()).toBeUndefined();
  });

  test("a TabInputCustom tab for a DIFFERENT viewType -> undefined", () => {
    const uri = { toString: () => "file:///other.md" };
    mockActiveTab = { input: new (vscode as unknown as { TabInputCustom: new (u: unknown, v: string) => unknown }).TabInputCustom(uri, "some.other.editor") };
    expect(findActiveGutterpressEditorUri()).toBeUndefined();
  });

  test("a TabInputCustom tab for gutterpress.markdownEditor -> its uri", () => {
    const uri = { toString: () => "file:///book.md" };
    mockActiveTab = {
      input: new (vscode as unknown as { TabInputCustom: new (u: unknown, v: string) => unknown }).TabInputCustom(
        uri,
        "gutterpress.markdownEditor",
      ),
    };
    expect(findActiveGutterpressEditorUri()).toBe(uri as unknown as never);
  });
});

describe("registerOpenSourceCommand — precondition refusal (D14)", () => {
  test("no active Gutterpress editor -> a specific error message, nothing opened", async () => {
    mockActiveTab = undefined;
    registerOpenSourceCommand();
    const handler = captured.registeredCommands.get("gutterpress.openSource");
    expect(handler).toBeDefined();

    await handler?.();

    expect(captured.errorMessages).toHaveLength(1);
    expect(captured.errorMessages[0]).toContain("Gutterpress");
    expect(captured.openedTextDocuments).toHaveLength(0);
    expect(captured.shownDocuments).toHaveLength(0);
  });
});

describe("registerOpenSourceCommand — success wiring", () => {
  test("the active Gutterpress editor's uri is opened via openTextDocument + showTextDocument", async () => {
    const uri = { toString: () => "file:///book.md" };
    mockActiveTab = {
      input: new (vscode as unknown as { TabInputCustom: new (u: unknown, v: string) => unknown }).TabInputCustom(
        uri,
        "gutterpress.markdownEditor",
      ),
    };
    registerOpenSourceCommand();
    const handler = captured.registeredCommands.get("gutterpress.openSource");

    await handler?.();

    expect(captured.openedTextDocuments).toEqual([uri]);
    expect(captured.shownDocuments).toHaveLength(1);
    expect(captured.errorMessages).toHaveLength(0);
  });
});

/**
 * Global Ctrl+F — source pins for the two find surfaces (2026-08-15).
 *
 * Routing rule (see +page.svelte's onGlobalKey): viewer showing → FindBar
 * (Electron's native window find, the ONLY way to search the cross-origin
 * preview iframe); only the editor open → CodeMirror's own search panel
 * (virtualization-safe — a DOM search would miss offscreen lines). Focus
 * inside the editor never reaches the global handler: CodeMirror's
 * searchKeymap consumes Ctrl+F first.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("editor find (CodeMirror search)", () => {
  const editor = read("src/lib/components/MarkdownEditor.svelte");
  test("the search extension + keymap are wired and openSearch is exported", () => {
    expect(editor).toContain('from "@codemirror/search"');
    expect(editor).toContain("search({ top: true })");
    expect(editor).toContain("...searchKeymap");
    expect(editor).toMatch(/export function openSearch\(\)/);
  });
});

describe("viewer find (native window find over the cross-origin frame)", () => {
  test("FindBar drives getPlatform().findInPage and clears highlights on close", () => {
    const bar = read("src/lib/components/FindBar.svelte");
    expect(bar).toContain("getPlatform().findInPage");
    expect(bar).toContain('stopFindInPage("clearSelection")');
    expect(bar).toContain("onFindResult");
  });

  test("main registers the IPC pair and forwards found-in-page results", () => {
    const main = read("electron/main.ts");
    expect(main).toContain('secureHandle(\n  "find:start"');
    expect(main).toContain('secureHandle(\n  "find:stop"');
    expect(main).toContain('"found-in-page"');
    expect(main).toContain('safeSend("find:result"');
  });
});

describe("global routing (+page.svelte)", () => {
  const page = read("src/routes/+page.svelte");
  test("find routes viewer-first, then the editor panel", () => {
    expect(page).toContain('command === "find"');
    expect(page).toContain("viewerVisibleForFind");
    expect(page).toContain("editorRef?.openSearch()");
  });
  test("a Ctrl+F CodeMirror already handled is left alone", () => {
    const findBlock = page.slice(page.indexOf('command === "find"'));
    expect(findBlock).toContain("e.defaultPrevented");
    expect(findBlock).toContain('.closest?.(".cm-editor")');
  });
});

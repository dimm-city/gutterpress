/**
 * Global Ctrl+F — source pins for the viewer find (owner ruling 2026-08-15:
 * find works in the VIEWER only; editing a found word goes through the
 * preview's "Go to source". No editor search surface, no @codemirror/search
 * dependency).
 *
 * The FindBar drives Electron's native window find (webContents.findInPage) —
 * the ONLY way to search the cross-origin preview iframe — with highlights,
 * scroll-to-match, and a match counter from the found-in-page push.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

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

describe("global routing (+page.svelte) — viewer only", () => {
  test("find opens the FindBar only when the viewer is visible", () => {
    const page = read("src/routes/+page.svelte");
    expect(page).toContain('command === "find"');
    expect(page).toContain("viewerVisibleForFind");
  });

  test("the editor has NO search surface (the dep stays removed)", () => {
    const editor = read("src/lib/components/MarkdownEditor.svelte");
    expect(editor).not.toContain("@codemirror/search");
    const page = read("src/routes/+page.svelte");
    expect(page).not.toContain("openSearch");
    const pkg = read("package.json");
    expect(pkg).not.toContain("@codemirror/search");
  });
});

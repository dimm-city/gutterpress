/**
 * Global Ctrl+F — source pins for the viewer find (owner rulings 2026-08-15:
 * find works in the VIEWER only, and it runs INSIDE the preview frame via
 * the previewAPI bridge — `window.find` scoped to book content, so it can
 * never highlight the app's toolbar chrome or the editor. Editing a found
 * word goes through the preview's "Go to source". No @codemirror/search
 * dependency, no Electron findInPage IPC).
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("viewer find (in-frame via the previewAPI bridge)", () => {
  test("the viewer exposes find/clearFind on previewAPI (in-frame window.find, wrap on)", () => {
    const viewer = read("../cli/src/assets/preview/scripts/preview-interface.js");
    expect(viewer).toContain("find: function (query, backwards)");
    expect(viewer).toContain("clearFind: function ()");
    expect(viewer).toContain("window.find(query, false, !!backwards, true");
  });

  test("FindBar drives client.call('find'/'clearFind') — no host code at all", () => {
    const bar = read("src/lib/components/FindBar.svelte");
    expect(bar).toContain('client.call<FindReply>("find", [query, backwards])');
    expect(bar).toContain('call("clearFind")');
    expect(bar).not.toContain("getPlatform");
  });

  test("the Electron findInPage seam stays deleted", () => {
    expect(read("electron/main.ts")).not.toContain("findInPage");
    expect(read("electron/preload.ts")).not.toContain("findInPage");
    expect(read("src/lib/platform/contract.ts")).not.toContain("findInPage");
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

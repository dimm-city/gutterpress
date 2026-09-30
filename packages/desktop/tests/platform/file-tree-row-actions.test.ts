/**
 * Source-level checks for issue #313 (Files tab row actions).
 *
 * No component-render harness exists for Svelte 5 SFCs in this repo (see
 * file-tree-cache.test.ts's note on the same limitation), so these read
 * FileTree.svelte's source. They pin the two things that are easy to break
 * without any test noticing:
 *
 *  1. Rename/delete/new-folder buttons on a RESTING row are hidden until the
 *     row is hovered or holds focus — but the delete confirm and the inline
 *     name inputs share the `.row-actions` wrapper and must never hide, or
 *     moving the pointer off an armed row would strand the confirm.
 *  2. A file can only be deleted through the armed confirm. Delete is
 *     permanent (api/fs/delete is an `rm`) and there is no per-file restore
 *     to offer as an Undo, so the client-side guard is this confirm.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const src = readFileSync(path.join(root, "src/lib/components/FileTree.svelte"), "utf8");
const script = src.slice(0, src.indexOf("{#snippet createRow"));
const markup = src.slice(src.indexOf("{#snippet createRow"), src.indexOf("<style>"));
// Comments stripped so prose in an explanatory comment can't satisfy (or
// trip) a selector match.
const style = src.slice(src.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");

/** Every `<div class="row-actions ...">` group in the markup, in source order. */
const groups = markup
  .split('<div class="row-actions')
  .slice(1)
  .map((chunk) => ({
    hoverOnly: chunk.startsWith(' hover-only">'),
    body: chunk.slice(0, chunk.indexOf("</div>")),
  }));

describe("FileTree — resting rows hide their action buttons until hover or focus", () => {
  test("the folder-row and file-row groups (the ones holding Delete) are hover-only", () => {
    const deleteGroups = groups.filter((g) => g.body.includes("requestDelete(entry)"));
    // One per row type: folder rows and file rows.
    expect(deleteGroups).toHaveLength(2);
    for (const g of deleteGroups) {
      expect(g.hoverOnly).toBe(true);
      expect(g.body).toContain("startRename(entry, parentDir)");
    }
  });

  test("the delete confirm and the inline create/rename inputs are never hover-only", () => {
    for (const commit of ["commitDelete(entry, parentDir)", "commitRename()", "commitCreate()"]) {
      const group = groups.find((g) => g.body.includes(commit));
      expect(group, `no .row-actions group holds ${commit}`).toBeDefined();
      expect(group!.hoverOnly).toBe(false);
    }
  });

  test("CSS reveals the group on :hover and :focus-within of the row", () => {
    expect(style).toMatch(/\.row-actions\.hover-only\s*\{\s*opacity:\s*0;\s*\}/);
    expect(style).toMatch(
      /\.tree-row:hover \.row-actions\.hover-only,\s*\.tree-row:focus-within \.row-actions\.hover-only\s*\{\s*opacity:\s*1;\s*\}/,
    );
  });

  test("hiding never removes the buttons from the tab order or the accessibility tree", () => {
    const rules = style.match(/[^{}]*\.hover-only[^{}]*\{[^}]*\}/g) ?? [];
    expect(rules.length).toBeGreaterThan(0);
    for (const rule of rules) {
      expect(rule).not.toMatch(/display:\s*none|visibility:\s*hidden/);
    }
  });

  test("devices that cannot hover keep the buttons visible", () => {
    expect(style).toMatch(
      /@media \(hover: none\)\s*\{\s*\.row-actions\.hover-only\s*\{\s*opacity:\s*1;\s*\}\s*\}/,
    );
  });
});

describe("FileTree — delete stays behind the inline armed confirm", () => {
  test("the row's trash button only arms; a single call site performs the delete", () => {
    expect(markup).toMatch(/onclick=\{\(\) => requestDelete\(entry\)\}/);
    // requestDelete arms; it must not reach the API.
    const request = script.slice(script.indexOf("function requestDelete"), script.indexOf("function cancelDelete"));
    expect(request).toContain("deleteArmedPath = entry.path");
    expect(request).not.toContain("deletePath");
    // Exactly one deletePath call, inside commitDelete...
    expect(src.match(/api\.fs\.deletePath\(/g)).toHaveLength(1);
    const commit = script.slice(script.indexOf("async function commitDelete"), script.indexOf("let anyBusy"));
    expect(commit).toContain("api.fs.deletePath(");
    // ...which the markup reaches only from the armed row's confirm button.
    expect(markup.match(/commitDelete\(/g)).toHaveLength(1);
    expect(markup).toMatch(/\{:else if deleteArmedPath === entry\.path\}[\s\S]*?commitDelete\(entry, parentDir\)/);
  });
});

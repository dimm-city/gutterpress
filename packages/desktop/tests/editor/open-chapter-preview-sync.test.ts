import { test, expect } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

// A user-initiated file switch (Focus Chapter select, Files tab) must carry the
// preview to the new chapter; go-to-source must not top-scroll before revealing.
const page = readFileSync(path.join(import.meta.dir, "../../src/routes/+page.svelte"), "utf8");

function body(name: string): string {
  const start = page.indexOf(`function ${name}(`);
  expect(start).toBeGreaterThan(-1);
  return page.slice(start, page.indexOf("\n  }\n", start));
}

test("openChapter selects the file then emits one top anchor", () => {
  const fn = body("openChapter");
  expect(fn).toContain("selectEditorFile(path)");
  expect(fn).toContain('editorSync.onEditorAnchorLine(1, "scroll", editorChapter)');
});

test("Focus Chapter select and Files tab route through openChapter", () => {
  expect(page).toMatch(/onSelectFile=\{\(name\) => [^}]*openChapter\(/);
  expect(page).toMatch(/onSelectEditorFile=\{\(path\) => \{\s*void openChapter\(path\);/);
});

test("selectEditorFile and go-to-source do not emit the top anchor", () => {
  expect(body("selectEditorFile")).not.toContain("onEditorAnchorLine");
  expect(body("revealInEditor")).not.toContain("onEditorAnchorLine");
  expect(body("revealInEditor")).not.toContain("openChapter");
  expect(page.match(/onEditorAnchorLine\(1,/g)?.length).toBe(1);
});

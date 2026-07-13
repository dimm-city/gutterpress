/**
 * Source-level tests for SnippetPicker.svelte (M25 / M1 fixes).
 *
 * See NewProjectWizard.test.ts for why this is source-level analysis rather
 * than a mounted-component test.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/SnippetPicker.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

describe("SnippetPicker — M1 shared shell CSS", () => {
  test("uses the shared dlg-* shell classes instead of a local backdrop/dialog/header block", () => {
    const src = readSource();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toContain('class="dlg-shell"');
    expect(src).toContain('@import "$lib/styles/dialog-shell.css"');
  });

  test("already used dialogBehavior before this change and still does", () => {
    const src = readSource();
    expect(src).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/);
  });
});

describe("SnippetPicker — M25 two-step delete confirm", () => {
  test("imports the shared inline-confirm helpers", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[\s\S]*requestInlineConfirm[\s\S]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/import\s*\{[\s\S]*cancelInlineConfirm[\s\S]*\}\s*from\s*["']\$lib\/dialog["']/);
  });

  test("the trash button routes through requestDelete (arm-then-confirm), not a direct api.snip.delete call", () => {
    const src = readSource();
    expect(src).toMatch(/onclick=\{\(\)\s*=>\s*requestDelete\(entry\)\}/);
    expect(src).toContain("function requestDelete(entry: SnippetEntry)");
    expect(src).toMatch(/requestInlineConfirm\(confirmDelete, entry\.fileName\)/);
    expect(src).toMatch(/if\s*\(confirmed\)\s*void remove\(entry\)/);
  });

  test("a Cancel button appears only while armed, and disarms via cancelInlineConfirm", () => {
    const src = readSource();
    expect(src).toMatch(/\{#if armed\}[\s\S]{0,200}cancelDelete/);
    expect(src).toMatch(/cancelInlineConfirm\(confirmDelete, entry\.fileName\)/);
  });

  test("the button swaps to a distinct 'Delete?' / danger treatment while armed, with a confirming aria-label", () => {
    const src = readSource();
    expect(src).toContain("Delete?");
    expect(src).toMatch(/class:dlg-danger-armed=\{armed\}/);
    expect(src).toMatch(/Really delete \$\{entry\.name\}\? This can't be undone\./);
  });

  test("remove() itself is unchanged — still a direct api.snip.delete call, only reachable via the confirm gate", () => {
    const src = readSource();
    const fn = src.slice(src.indexOf("async function remove("), src.indexOf("// ── Two-step delete confirm"));
    expect(fn).toContain("api.snip.delete(projectDir, entry.fileName)");
  });

  // FIX ROUND 1 regression guard: the base `.snippet-del` rule sets its own
  // background/border/color longhands, scoped by Svelte to 0,2,0 — which
  // outranks the imported `.dlg-danger-armed` (0,1,0), so arming the delete
  // confirm used to change only the label, with zero red anywhere. A local
  // `.snippet-del.dlg-danger-armed` override (0,3,0 once scoped) is required
  // so the armed state actually renders the error tokens.
  test("a local .snippet-del.dlg-danger-armed rule restates the error tokens so arming wins the cascade", () => {
    const src = readSource();
    const start = src.indexOf(".snippet-del.dlg-danger-armed {");
    expect(start).toBeGreaterThanOrEqual(0);
    const open = src.indexOf("{", start);
    const close = src.indexOf("}", open);
    const body = src.slice(open + 1, close);
    expect(body).toMatch(/background\s*:\s*var\(--app-error-bg\)/);
    expect(body).toMatch(/border-color\s*:\s*var\(--app-error-border\)/);
    expect(body).toMatch(/color\s*:\s*var\(--app-error-text\)/);
  });
});

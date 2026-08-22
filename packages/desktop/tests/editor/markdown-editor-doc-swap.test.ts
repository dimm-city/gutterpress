/**
 * MarkdownEditor — source-level checks for the M8 fix (UX critical review).
 *
 * MarkdownEditor.svelte has no component-render test harness in this repo
 * (Svelte 5 SFCs are compiled; these unit tests run under plain `bun test`),
 * so — following the established pattern for other component files
 * (RecoveryConfirmDialog.test.ts, RecoveryOverlay.test.ts) — these assertions
 * analyze the component's source text directly:
 *
 *  1. The parent (+page.svelte) no longer wraps <MarkdownEditor> in
 *     `{#key editorFilePath}` — that wrapper destroyed/rebuilt the whole
 *     EditorView (and its undo history/selection/scroll) on every file
 *     switch, contradicting the component's own header comment.
 *  2. MarkdownEditor uses one synchronous `view.setState(...)` swap instead
 *     of a deferred per-file scroll/cache restoration.
 *  3. The header comment describes the real (now-true) architecture and no
 *     longer contains the old, contradictory "doc-swap effect reconfigures
 *     the compartments" claim that nothing implemented.
 *  4. The file switch is driven by an EXPORTED `switchFile()` the parent
 *     calls explicitly (this repo's eslint config bans `$effect` outright —
 *     see eslint.config.js's `no-restricted-syntax` rule — so a reactive
 *     prop-watching effect was never an option here regardless of the M8
 *     fix); +page.svelte calls it after the buffer's file load/restore
 *     settles, guarded against a superseded concurrent load.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const EDITOR_PATH = path.resolve(__dirname, "../../src/lib/components/MarkdownEditor.svelte");
const PAGE_PATH = path.resolve(__dirname, "../../src/routes/+page.svelte");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("MarkdownEditor — one-file prerequisites exist", () => {
  test("component file exists", () => {
    expect(fs.existsSync(EDITOR_PATH)).toBe(true);
  });

});

describe("+page.svelte — no {#key editorFilePath} remount around MarkdownEditor", () => {
  test("the editorFilePath key wrapper is gone", () => {
    const src = read(PAGE_PATH);
    expect(src).not.toMatch(/\{#key\s+editorFilePath\}/);
  });

  test("MarkdownEditor is still mounted with a live filePath binding", () => {
    const src = read(PAGE_PATH);
    expect(src).toMatch(/<MarkdownEditor[\s\S]*?filePath=\{editorFilePath\}/);
  });

  test("the parent gives the editor exactly one file at a time", () => {
    const src = read(PAGE_PATH);
    expect(src).not.toContain("BookDocument");
    expect(src).not.toContain("editorRef.switchBook(");
    expect(src).not.toContain("onSectionChange=");
    expect(src).toContain("editorRef?.switchFile(");
  });

  test("same-path recovery/reload replaces content and delete clears editor ownership", () => {
    const src = read(PAGE_PATH);
    const show = src.slice(
      src.indexOf("function showEditorContent("),
      src.indexOf("function createEditorBuffer("),
    );
    expect(show).toContain("editorRef?.hasFile(path)");
    expect(show).toContain("editorRef.updateContent(content)");
    const reset = src.slice(
      src.indexOf("function resetEditorBuffer("),
      src.indexOf("async function flushEditorBuffer("),
    );
    expect(reset).toContain("editorFiles.reset()");
    expect(src).toContain('onClear: () => editorRef?.switchFile(null, "")');
  });
});

describe("MarkdownEditor.svelte — one persistent EditorView, synchronous swap", () => {
  test("swaps documents via view.setState(...), not by destroying the view", () => {
    const src = read(EDITOR_PATH);
    expect(src).toContain("view.setState(");
  });

  test("does not defer scroll restoration from a previous file", () => {
    const src = read(EDITOR_PATH);
    const swap = src.slice(
      src.indexOf("export function switchFile("),
      src.indexOf("export function updateContent("),
    );
    expect(src).not.toContain("EditorStateCache");
    expect(swap).not.toContain("requestAnimationFrame");
    expect(swap).not.toContain("scrollTop");
  });

  test("exports switchFile() as the file-switch entry point (no $effect anywhere in the file)", () => {
    const src = read(EDITOR_PATH);
    expect(src).toMatch(/export function switchFile\(\s*newPath:\s*string \| null,\s*newContent:\s*string\s*\)/);
    // The literal call form the banned-syntax eslint rule forbids.
    expect(src).not.toMatch(/[^.]\$effect\s*\(/);
  });

  test("does not compose chapter files into one editable document", () => {
    const src = read(EDITOR_PATH);
    expect(src).not.toContain("switchBook");
    expect(src).not.toContain("bookBoundaryField");
    expect(src).not.toContain("emitChangedSections");
    expect(src).not.toContain("repairCollapsed");
  });

  test("switchFile no-ops when called with the already-open path (avoids redundant cache churn)", () => {
    const src = read(EDITOR_PATH);
    const fnBody = src.slice(
      src.indexOf("export function switchFile("),
      src.indexOf("export function switchFile(") + 400,
    );
    expect(fnBody).toMatch(/newPath === appliedPath/);
  });

  test("onMount still only builds the EditorView once (mount, not per-switch)", () => {
    const src = read(EDITOR_PATH);
    const onMountBlock = src.slice(
      src.indexOf("onMount(() => {"),
      src.indexOf("export function switchFile("),
    );
    expect(onMountBlock).toContain("view = new EditorView(");
  });

  test("header comment no longer claims a doc-swap compartment-reconfigure effect that doesn't exist", () => {
    const src = read(EDITOR_PATH);
    expect(src).not.toMatch(/doc-swap effect reconfigures the compartments/);
  });

  test("header comment explains why $effect isn't used to drive the switch", () => {
    const src = read(EDITOR_PATH);
    const header = src.slice(0, src.indexOf("import {"));
    expect(header).toMatch(/bans `\$effect`/);
  });

  test("header comment documents the real architecture (one view, one file, setState)", () => {
    const src = read(EDITOR_PATH);
    const header = src.slice(0, src.indexOf("import {"));
    expect(header).toMatch(/ONE EditorView/);
    expect(header).toMatch(/ONE source file/);
    expect(header).toMatch(/setState/);
  });

  test("same-file replacement preserves the viewport without scrollIntoView", () => {
    const src = read(EDITOR_PATH);
    const update = src.slice(src.indexOf("export function updateContent("), src.indexOf("export function focus("));
    expect(update).toContain("suppressEmitUntil = Date.now() + 300");
    expect(update).toContain("const scrollTop = view.scrollDOM.scrollTop");
    expect(update).toContain("view.scrollDOM.scrollTop = scrollTop");
    expect(update).not.toContain("EditorView.scrollIntoView");
  });
});

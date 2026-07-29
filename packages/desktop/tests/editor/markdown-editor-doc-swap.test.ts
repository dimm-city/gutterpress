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
 *  2. MarkdownEditor uses the per-file EditorStateCache (LRU) and
 *     `view.setState(...)` to swap documents instead of remounting.
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
const CACHE_PATH = path.resolve(__dirname, "../../src/lib/editor/editor-state-cache.ts");

function read(p: string): string {
  return fs.readFileSync(p, "utf8");
}

describe("MarkdownEditor — M8 fix prerequisites exist", () => {
  test("component file exists", () => {
    expect(fs.existsSync(EDITOR_PATH)).toBe(true);
  });

  test("EditorStateCache module exists", () => {
    expect(fs.existsSync(CACHE_PATH)).toBe(true);
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

  test("the parent calls switchFile() explicitly wherever the buffer's open file changes", () => {
    const src = read(PAGE_PATH);
    const calls = src.match(/editorRef\?\.switchFile\(/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(2); // selectEditorFile + restoreRecovery
  });
});

describe("MarkdownEditor.svelte — one persistent EditorView, cache-backed swap", () => {
  test("imports EditorStateCache", () => {
    const src = read(EDITOR_PATH);
    expect(src).toContain('import { EditorStateCache } from "$lib/editor/editor-state-cache"');
  });

  test("instantiates a bounded (~20) per-file state cache", () => {
    const src = read(EDITOR_PATH);
    expect(src).toMatch(/new EditorStateCache</);
    expect(src).toMatch(/>\(\s*20\s*\)/);
  });

  test("swaps documents via view.setState(...), not by destroying the view", () => {
    const src = read(EDITOR_PATH);
    expect(src).toContain("view.setState(");
  });

  test("exports switchFile() as the file-switch entry point (no $effect anywhere in the file)", () => {
    const src = read(EDITOR_PATH);
    expect(src).toMatch(/export function switchFile\(\s*newPath:\s*string \| null,\s*newContent:\s*string\s*\)/);
    // The literal call form the banned-syntax eslint rule forbids.
    expect(src).not.toMatch(/[^.]\$effect\s*\(/);
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

  test("header comment documents the real architecture (one view, state cache, setState)", () => {
    const src = read(EDITOR_PATH);
    const header = src.slice(0, src.indexOf("import {"));
    expect(header).toMatch(/ONE EditorView/);
    expect(header).toMatch(/stateCache/);
    expect(header).toMatch(/setState/);
  });

  test("updateContent() (the #H1 same-file external-edit path) is preserved", () => {
    const src = read(EDITOR_PATH);
    expect(src).toContain("export function updateContent(nextDoc: string): void {");
  });
});

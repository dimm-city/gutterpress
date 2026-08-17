import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/lib/platform/shared-types";
import { pinEditorMode } from "../integration/_editor-mode.mjs";

/**
 * The wiring around the rich/source mode switch.
 *
 * `+page.svelte` has no component-render harness (it needs the whole host), so
 * the checks that CAN be behavioural are, and the rest assert on its source —
 * the repo's established pattern for that file. Each one here exists because
 * getting it wrong is silent: the app would still run, just in the wrong mode,
 * or writing to the wrong file, or leaving a dead button.
 */
const PAGE = readFileSync(
  resolve(import.meta.dir, "../../src/routes/+page.svelte"),
  "utf8",
);

describe("editor.mode setting", () => {
  test("defaults to rich", () => {
    expect(DEFAULT_SETTINGS.editor.mode).toBe("rich");
  });

  test("the integration pin writes what the settings store reads", async () => {
    // `pinEditorMode` seeds `app-settings.json` in a userData dir so the
    // Playwright suites that drive the CodeMirror surface get it. If the
    // filename or shape drifts from the store's, the seed is silently inert
    // and those suites fail on a selector instead — which is exactly how the
    // rich default broke them in the first place.
    const dir = await mkdtemp(join(tmpdir(), "gp-pin-"));
    try {
      pinEditorMode(dir, "source");
      // settings-store.ts: path.join(getUserDataDir(), "app-settings.json")
      const raw = JSON.parse(await readFile(join(dir, "app-settings.json"), "utf-8"));
      expect(raw.editor.mode).toBe("source");
      // It must be a PARTIAL patch — the store deep-merges over the defaults,
      // so a full snapshot here would freeze every other setting at today's
      // values and mask future regressions.
      expect(Object.keys(raw)).toEqual(["editor"]);
      expect(Object.keys(raw.editor)).toEqual(["mode"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("+page.svelte mode wiring", () => {
  test("the effective mode falls back to source when rich is impossible", () => {
    // A CSS file, a file the model cannot represent, or a failed chunk load
    // must never leave the author staring at an editor that cannot open it.
    //
    // Matched against the `effectiveEditorMode` DECLARATION, not the whole
    // file. Four loose `toContain`s over 6000 lines passed happily with
    // `&& !richBlockedReason` deleted from the expression: the substring
    // still occurred, in `disabled={!!richBlockedReason}` — a different
    // attribute entirely, since "!!x".includes("!x"). The test named the
    // fail-closed guard and gated nothing.
    const decl = /effectiveEditorMode\s*=\s*\$derived(?:<[^>]*>)?\(([\s\S]*?)\n  \);/.exec(PAGE);
    expect(decl).not.toBeNull();
    const expr = decl![1]!;
    expect(expr).toContain('editorModePref === "rich"');
    expect(expr).toContain("isMd(editorFilePath)");
    expect(expr).toContain("!richBlockedReason");
    expect(expr).toContain("!richModuleFailed");
    // All four are conjunctions: any one of them false means source mode.
    expect(expr.split("&&").length).toBeGreaterThanOrEqual(4);
  });

  test("a refusal is SHOWN, never silent", () => {
    expect(PAGE).toContain("richBlockedReason");
    expect(PAGE).toContain("Editing this file as markdown");
  });

  test("switching mode flushes before swapping the surface", () => {
    // The incoming editor parses what is on disk; an unflushed buffer would
    // hand it stale bytes, and source-offset edits key off exactly that.
    const fn = PAGE.slice(PAGE.indexOf("async function setEditorMode"));
    expect(fn.slice(0, 600)).toContain("handleForceSave");
    expect(fn.slice(0, 600)).toContain("settings.set({ editor: { mode } })");
  });

  test("switching mode re-seeds the newly mounted editor", () => {
    // A freshly mounted component starts empty; without this the author's
    // file appears to vanish on toggle.
    const fn = PAGE.slice(PAGE.indexOf("async function setEditorMode"));
    expect(fn.slice(0, 700)).toContain("reseedEditor()");
  });

  test("switching mode never touches the file session", () => {
    // The buffer is orthogonal to which component renders. Calling select()
    // or reset() here would re-read the file and could drop unsaved work.
    const fn = PAGE.slice(
      PAGE.indexOf("async function setEditorMode"),
      PAGE.indexOf("async function setEditorMode") + 700,
    );
    expect(fn).not.toContain("editorFiles.select");
    expect(fn).not.toContain("editorFiles.reset");
  });

  test("CommitEngine only claims a file when its offsets can be trusted", () => {
    // In rich mode the document is a tree; the caller's offsets index the file
    // on disk. When those differ the edit must take CommitEngine's own buffer
    // path rather than be written at a guessed position.
    expect(PAGE).toContain("canApplySourceOffsets");
    expect(PAGE).toContain("buffer?.content ?? \"\"");
  });

  test("the rich chunk is prepared wherever the editor opens", () => {
    // Rich is the default, so loading only on an explicit toggle would leave a
    // default-mode project with no editor at all.
    expect(PAGE).toContain("if (editorModePref === \"rich\") loadRichModule();");
  });

  test("the document model is lazily imported, never static", () => {
    // A static import would drag markdown-it + prosemirror-markdown + the
    // schema into the main bundle and undo the lazy loading both editors pay
    // for. Verified in the built output too (one chunk, absent from entry).
    expect(PAGE).toContain('import("$lib/editor/markdown-doc")');
    expect(PAGE).not.toMatch(/^\s*import\s+\{[^}]*canEditRichly/m);
  });
});

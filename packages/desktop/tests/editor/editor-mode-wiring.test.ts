import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { DEFAULT_SETTINGS } from "../../src/lib/platform/shared-types";
import { pinEditorMode } from "../integration/_editor-mode.mjs";

/**
 * The wiring around the rich editing surface — which mode is in effect, and
 * how many pages that surface shows.
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

const RICH = readFileSync(
  resolve(import.meta.dir, "../../src/lib/components/RichEditor.svelte"),
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

/**
 * Two-page spread in the rich editor.
 *
 * `columns` was a prop nothing passed, feeding a `column-count` that rendered
 * one column anyway (paginate.test.ts covers that half). Three links make it
 * live, and each can be cut without anything failing to compile: the app's
 * view mode has to be mapped, the mapping has to reach a surface that is
 * mounted lazily and reads its props exactly once, and the surface has to
 * render the count that FITS rather than the one it was handed.
 */
describe("spread view wiring", () => {
  test("the editor follows preview.viewMode rather than owning a second setting", () => {
    // Matched against the declaration, not the file: `columns` and `viewMode`
    // both occur dozens of times here (grid templates, the preview toolbar).
    const decl = /let editorColumns = \$derived<1 \| 2>\(([^;]*)\);/.exec(PAGE);
    expect(decl).not.toBeNull();
    expect(decl![1]).toBe('viewMode === "two-column" ? 2 : 1');
  });

  test("mounting seeds the surface with the current mode", () => {
    // The prop is the ONLY delivery for an editor that mounts after the mode
    // was last changed — the sink below fires on change, and a lazily imported
    // component routinely misses those.
    const el = PAGE.slice(PAGE.indexOf("<RichEditor"));
    expect(el.slice(0, el.indexOf("/>"))).toContain("columns={editorColumns}");
    const mount = RICH.slice(RICH.indexOf("onMount(() => {"));
    expect(mount.slice(0, 200)).toContain("requestedColumns = columns;");
  });

  test("a later change is pushed through the settings channel", () => {
    // RichEditor takes no reactive dependency on its props ($effect is banned,
    // and re-running on `content` would fight the author's typing), so a prop
    // alone would leave the toolbar's Two-page button doing nothing here.
    const sink = /const editorViewModeSink = settingsChangeGuard<[^>]*>\(([\s\S]*?)\n {2}\);/.exec(
      PAGE,
    );
    expect(sink).not.toBeNull();
    expect(sink![1]).toContain('setColumns?.(mode === "two-column" ? 2 : 1)');
    // A sink that is never called from the listener is the exact silent
    // failure ARCH #61's single channel exists to prevent.
    const listener = /onSettingsChange\(\(s\) => \{([\s\S]*?)\n {4}\}\)/.exec(PAGE);
    expect(listener).not.toBeNull();
    expect(listener![1]).toContain("editorViewModeSink(s.preview.viewMode);");
  });

  test("the surface renders the fitted column count, not the requested one", () => {
    // The editor is 1 CSS px per print px with no zoom, so a US-Letter spread
    // is a fixed 1656px against ~806px of editor pane at the default split.
    // Passing the request straight through would open a new project showing
    // half a spread behind a horizontal scrollbar.
    const applyCss = RICH.slice(RICH.indexOf("function applyCss(css: string)"));
    expect(applyCss.slice(0, 400)).toContain("requestedColumns === 2 && spreadFits(css) ? 2 : 1");
    expect(applyCss.slice(0, 400)).toContain("editorStylesheet(css, { columns: cols })");
    const fits = RICH.slice(RICH.indexOf("function spreadFits(css: string)"));
    expect(fits.slice(0, 400)).toContain("paginatedWidth(css, { columns: 2 })");
    expect(fits.slice(0, 400)).toContain("body?.clientWidth");
  });

  test("a refused spread is reconsidered when the pane changes size", () => {
    // The refusal is measured against the pane, so it has to be re-measured:
    // dragging the splitter wider or hiding the preview is how an author gets
    // the spread they asked for, and without this they would have to toggle
    // the setting off and on to be asked again.
    const fn = RICH.slice(
      RICH.indexOf("function onFrameGeometryChanged"),
      RICH.indexOf("function runSlash"),
    );
    expect(fn).toContain("if (requestedColumns === 2) applyCss(appliedCss);");
  });
});

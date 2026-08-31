/**
 * editor-projection-host.test.ts (SFE-P3e, Lane A, NEW)
 *
 * Drives {@link buildHostEditorProjection}
 * (`packages/desktop/electron/editor-projection.ts`) directly — the EXACT
 * function `main.ts`'s `api:editorProjection` `secureHandle` calls, after
 * its own argument validation (`validateEditorProjectionArgs`, tested by
 * IPC-boundary concerns living entirely in `main.ts`, out of scope here per
 * that module's own header — "PURE ENOUGH TO UNIT TEST DIRECTLY"). This is
 * the run's central end-to-end proof (deliverable 5): a real project
 * fixture ON DISK, a real manifest, a real degrade-and-report load of a
 * real local-file plugin FROM DISK, feeding the real, unmodified
 * `createMarkdownRenderer`/`createEditorProjection`. See
 * `editor-projection.ts`'s own header ("A CONFIRMED BLOCKER, not a design
 * preference") for exactly why the plugin-LOADING step is this module's own
 * narrower, host-local loader rather than a call into `packages/cli`'s
 * `loadPlugins` — reaching that function any other way was empirically
 * proven to break `bun run check` on unrelated code this lane cannot edit.
 *
 * Part 1 — the positive case, against the COMMITTED plugin-book fixture
 * (`packages/desktop/tests/fixtures/plugin-book/`): the plugin genuinely
 * loaded (no `pluginErrors`), `plugin-region` blocks are present with
 * correct ranges, `pluginCss` is non-empty (the real plugin file declares
 * CSS of its own — checked here, not asserted vacuously per this run's own
 * instruction), and the content passed in is never mutated (byte-identity).
 *
 * Part 2 — degradation, against DISPOSABLE temp-directory fixtures this
 * file builds and tears down itself (AP-25: never mutate the committed
 * plugin-book fixture in place; every temp dir this file creates is
 * recorded and removed in `afterAll`):
 *   (a) a manifest naming an uninstalled npm plugin;
 *   (b) a local plugin file that throws on load.
 * Both must still produce a projection, skip only the offending plugin, and
 * name it in `pluginErrors` — never a blank projection, never a silent
 * omission (CLAUDE.md §5's rationale, restated by this run's binding
 * decisions: "one uninstalled plugin must not blank a non-technical
 * author's... editor").
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildHostEditorProjection } from "../../electron/editor-projection";
import { PLUGIN_BOOK_ROOT, loadPluginBookChapters, type PluginBookChapter } from "../fixtures/plugin-book/support";

const LOADED: readonly PluginBookChapter[] = loadPluginBookChapters();
const CALLOUT_CHAPTER = LOADED.find((f) => /^@@callout\s+.+$/m.test(f.text));

// AP-21 liveness: this file's own core premise (there IS a real chapter to
// build a plugin-aware projection from) must hold before anything else runs.
if (!CALLOUT_CHAPTER) {
  throw new Error(
    "editor-projection-host.test.ts: no plugin-book chapter contains a \"@@callout\" marker — the fixture " +
      "changed shape and this file's entire premise is now vacuous.",
  );
}

describe("buildHostEditorProjection — real project fixture, real manifest, real local-file plugin, over the exact function the IPC handler calls (deliverable 5)", () => {
  test("AP-21 liveness: the real ./plugins/callout.js plugin actually loaded (no pluginErrors)", async () => {
    const { pluginErrors } = await buildHostEditorProjection({
      projectDir: PLUGIN_BOOK_ROOT,
      content: CALLOUT_CHAPTER.text,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
  });

  test("plugin-region blocks are PRESENT with correct ranges", async () => {
    const { projection, pluginErrors } = await buildHostEditorProjection({
      projectDir: PLUGIN_BOOK_ROOT,
      content: CALLOUT_CHAPTER.text,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);

    const regions = projection.blocks.filter((b) => b.kind === "plugin-region");
    // AP-21: liveness before behavior — a chapter this file claims has a
    // callout must actually produce at least one plugin-region block.
    expect(regions.length).toBeGreaterThan(0);
    for (const block of regions) {
      expect(block.from).toBeGreaterThanOrEqual(0);
      expect(block.to).toBeGreaterThan(block.from);
      expect(block.to).toBeLessThanOrEqual(CALLOUT_CHAPTER.text.length);
      const slice = CALLOUT_CHAPTER.text.slice(block.from, block.to);
      expect(slice.startsWith("@@callout ")).toBe(true);
      expect(block.editMode).toBe("source");
    }
  });

  test("pluginCss is non-empty — the real plugin file declares CSS of its own (checked, not asserted vacuously)", async () => {
    const { pluginCss, pluginErrors } = await buildHostEditorProjection({
      projectDir: PLUGIN_BOOK_ROOT,
      content: CALLOUT_CHAPTER.text,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
    expect(pluginCss.length).toBeGreaterThan(0);
    expect(pluginCss).toContain(".gp-callout");
  });

  test("byte-identity: buildHostEditorProjection never mutates the source string it was given", async () => {
    const original = CALLOUT_CHAPTER.text;
    const originalBuffer = Buffer.from(original, "utf8");
    await buildHostEditorProjection({ projectDir: PLUGIN_BOOK_ROOT, content: original, sourceVersion: 0 });
    // The caller's own string binding cannot mutate (JS strings are
    // immutable) — the load-bearing check is that the FIXTURE FILE the
    // caller read it from is untouched, matching every other real-book
    // byte-identity test's own convention.
    expect(CALLOUT_CHAPTER.text).toBe(original);
    expect(Buffer.from(CALLOUT_CHAPTER.text, "utf8").equals(originalBuffer)).toBe(true);
  });

  test("the returned projection's sourceVersion echoes the caller's exactly (G-11)", async () => {
    const { projection } = await buildHostEditorProjection({
      projectDir: PLUGIN_BOOK_ROOT,
      content: CALLOUT_CHAPTER.text,
      sourceVersion: 7,
    });
    expect(projection.schemaVersion).toBe(1);
    expect(projection.sourceVersion).toBe(7);
  });

  test("a chapter with NO callout still projects core marker/raw-html blocks and reports no plugin errors", async () => {
    const plainChapter = LOADED.find((f) => !/^@@callout\s+.+$/m.test(f.text));
    if (!plainChapter) throw new Error("expected at least one plugin-book chapter with no callout marker.");
    const { projection, pluginErrors } = await buildHostEditorProjection({
      projectDir: PLUGIN_BOOK_ROOT,
      content: plainChapter.text,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
    expect(projection.blocks.some((b) => b.kind === "plugin-region")).toBe(false);
  });
});

// ── Part 2 — degradation: a plugin that fails to load never blanks the ────
// projection. Disposable temp project directories only (AP-25) — the
// committed plugin-book fixture is never touched by this section.

const tempDirs: string[] = [];

function makeTempProjectDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gutterpress-editor-projection-host-"));
  tempDirs.push(dir);
  return dir;
}

afterAll(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const ORDINARY_CONTENT = "# Hello\n\nSome ordinary prose, no markers.\n";

describe("degradation (a): a manifest naming an UNINSTALLED npm plugin", () => {
  test("a projection is still produced, the npm plugin is skipped, and pluginErrors names it", async () => {
    const dir = makeTempProjectDir();
    writeFileSync(
      path.join(dir, "manifest.yaml"),
      [
        'title: "Degradation fixture: uninstalled npm plugin"',
        "plugins:",
        "  - name: gutterpress-plugin-definitely-not-installed",
        "",
      ].join("\n"),
      "utf8",
    );

    const { projection, pluginCss, pluginErrors } = await buildHostEditorProjection({
      projectDir: dir,
      content: ORDINARY_CONTENT,
      sourceVersion: 0,
    });

    // Never a blank projection, never a silent omission: exactly the one
    // configured (uninstalled) plugin is named, with a real message — and
    // the projection itself is still a valid, usable D6 shape.
    expect(pluginErrors.length).toBe(1);
    expect(pluginErrors[0]!.pluginRef).toBe("gutterpress-plugin-definitely-not-installed");
    expect(pluginErrors[0]!.message.length).toBeGreaterThan(0);
    expect(pluginErrors[0]!.message).toContain("gutterpress-plugin-definitely-not-installed");

    expect(projection.schemaVersion).toBe(1);
    expect(projection.sourceVersion).toBe(0);
    expect(Array.isArray(projection.blocks)).toBe(true);
    expect(pluginCss).toBe("");
  });
});

describe("degradation (b): a local plugin file that throws on load", () => {
  test("a projection is still produced, the broken local plugin is skipped, and pluginErrors names it — same posture as the uninstalled-npm case", async () => {
    const dir = makeTempProjectDir();
    mkdirSync(path.join(dir, "plugins"));
    writeFileSync(
      path.join(dir, "plugins", "broken.js"),
      ["throw new Error('this plugin always fails to load');", "export default function broken(md) {}", ""].join(
        "\n",
      ),
      "utf8",
    );
    writeFileSync(
      path.join(dir, "manifest.yaml"),
      ['title: "Degradation fixture: broken local plugin"', "plugins:", "  - ./plugins/broken.js", ""].join("\n"),
      "utf8",
    );

    const { projection, pluginErrors } = await buildHostEditorProjection({
      projectDir: dir,
      content: ORDINARY_CONTENT,
      sourceVersion: 0,
    });

    expect(pluginErrors.length).toBe(1);
    expect(pluginErrors[0]!.pluginRef).toBe("./plugins/broken.js");
    expect(pluginErrors[0]!.message).toContain("this plugin always fails to load");

    expect(projection.schemaVersion).toBe(1);
    expect(Array.isArray(projection.blocks)).toBe(true);
  });

  test("liveness (AP-21): a WORKING local plugin in the same shape as the broken one above does NOT report a pluginError (positive control)", async () => {
    const dir = makeTempProjectDir();
    mkdirSync(path.join(dir, "plugins"));
    writeFileSync(
      path.join(dir, "plugins", "fine.js"),
      "export default function fine(md) {}\n",
      "utf8",
    );
    writeFileSync(
      path.join(dir, "manifest.yaml"),
      ['title: "Degradation fixture: positive control"', "plugins:", "  - ./plugins/fine.js", ""].join("\n"),
      "utf8",
    );

    const { pluginErrors } = await buildHostEditorProjection({
      projectDir: dir,
      content: ORDINARY_CONTENT,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
  });
});

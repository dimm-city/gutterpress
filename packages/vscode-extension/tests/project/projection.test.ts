/**
 * Unit tests for src/project/projection.ts (SFE-P3c run spec deliverable 2:
 * "THE PROJECTION (the gap Lane A flagged)"). `vscode`-free (see that
 * file's own header) — driven directly with plain data and a real, local,
 * read-only fixture project (`fixtures/plugin-project/`, AP-25: never
 * mutated).
 *
 * Part 1 proves the REAL end-to-end pipeline: a real manifest, a real
 * degrade-and-report load of a real local-file plugin FROM DISK, feeding
 * the real, unmodified `createMarkdownRenderer`/`createEditorProjection` —
 * the SAME production functions the CLI build/preview path and the desktop
 * rich editor use (D11's `gutterpress/plugins` subpath).
 * Part 2 proves `resolveEditorProjectionMessage`'s own trust/project gate
 * (deliverable 2/3's core contract) via the observable DELTA between the
 * plugin-aware and base-pipeline projections of the SAME content — not by
 * asserting on internals, but on whether a `plugin-region` block for the
 * SAME "@@highlight" marker actually appears.
 * Part 3 proves degrade-and-report and the whole-build hard-failure
 * fallback, both against DISPOSABLE temp directories this file builds and
 * tears down itself (AP-25).
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBaseEditorProjection,
  buildProjectEditorProjection,
  resolveEditorProjectionMessage,
} from "../../src/project/projection.ts";

const FIXTURE_ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "plugin-project");
const HIGHLIGHT_CONTENT = "@@highlight Getting started\n\nSome ordinary paragraph text.\n";

// AP-21 liveness: this file's entire premise depends on this fixture
// existing exactly as expected.
if (!existsSync(path.join(FIXTURE_ROOT, "manifest.yaml"))) {
  throw new Error("projection.test.ts: fixtures/plugin-project/manifest.yaml is missing — fixture changed shape.");
}
if (!existsSync(path.join(FIXTURE_ROOT, "plugins", "highlight.js"))) {
  throw new Error("projection.test.ts: fixtures/plugin-project/plugins/highlight.js is missing.");
}

const disposableDirs: string[] = [];
afterAll(() => {
  for (const dir of disposableDirs) rmSync(dir, { recursive: true, force: true });
});

function makeDisposableProjectDir(manifestYaml: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "gp-vscode-projection-"));
  disposableDirs.push(dir);
  writeFileSync(path.join(dir, "manifest.yaml"), manifestYaml, "utf8");
  return dir;
}

describe("buildProjectEditorProjection — real project fixture, real manifest, real local-file plugin", () => {
  test("AP-21 liveness: the real ./plugins/highlight.js plugin actually loaded (no pluginErrors)", async () => {
    const { pluginErrors } = await buildProjectEditorProjection({
      projectDir: FIXTURE_ROOT,
      content: HIGHLIGHT_CONTENT,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
  });

  test("plugin-region blocks are PRESENT with correct ranges", async () => {
    const { projection, pluginErrors } = await buildProjectEditorProjection({
      projectDir: FIXTURE_ROOT,
      content: HIGHLIGHT_CONTENT,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
    const regions = projection.blocks.filter((b) => b.kind === "plugin-region");
    // AP-21: liveness before behavior.
    expect(regions.length).toBeGreaterThan(0);
    for (const block of regions) {
      expect(block.from).toBeGreaterThanOrEqual(0);
      expect(block.to).toBeGreaterThan(block.from);
      expect(block.to).toBeLessThanOrEqual(HIGHLIGHT_CONTENT.length);
      expect(HIGHLIGHT_CONTENT.slice(block.from, block.to).startsWith("@@highlight ")).toBe(true);
    }
  });

  test("pluginCss is non-empty and comes from the real plugin file — checked, not asserted vacuously", async () => {
    const { pluginCss, pluginErrors } = await buildProjectEditorProjection({
      projectDir: FIXTURE_ROOT,
      content: HIGHLIGHT_CONTENT,
      sourceVersion: 0,
    });
    expect(pluginErrors).toEqual([]);
    expect(pluginCss.length).toBeGreaterThan(0);
    expect(pluginCss).toContain(".gp-highlight");
  });

  test("byte-identity: never mutates the source string it was given", async () => {
    const original = HIGHLIGHT_CONTENT;
    await buildProjectEditorProjection({ projectDir: FIXTURE_ROOT, content: original, sourceVersion: 0 });
    expect(HIGHLIGHT_CONTENT).toBe(original);
  });

  test("the returned projection's sourceVersion echoes the caller's exactly (G-11)", async () => {
    const { projection } = await buildProjectEditorProjection({
      projectDir: FIXTURE_ROOT,
      content: HIGHLIGHT_CONTENT,
      sourceVersion: 7,
    });
    expect(projection.sourceVersion).toBe(7);
  });
});

describe("buildBaseEditorProjection — the non-plugin-aware pipeline", () => {
  test("the SAME '@@highlight' content produces NO plugin-region block without the plugin loaded", () => {
    const projection = buildBaseEditorProjection(HIGHLIGHT_CONTENT, 0);
    const regions = projection.blocks.filter((b) => b.kind === "plugin-region");
    expect(regions).toEqual([]);
  });
});

describe("resolveEditorProjectionMessage — the trust/project gate (deliverable 2/3's core contract)", () => {
  test("trusted + project present -> plugin-aware: a plugin-region block appears, pluginCss is populated, no diagnostic", async () => {
    const message = await resolveEditorProjectionMessage(
      { text: HIGHLIGHT_CONTENT, version: 0 },
      { projectDir: FIXTURE_ROOT },
      true,
    );
    const regions = message.projection.blocks.filter((b) => b.kind === "plugin-region");
    expect(regions.length).toBeGreaterThan(0);
    expect(message.pluginCss).toContain(".gp-highlight");
    expect(message.pluginErrors).toEqual([]);
    expect(message.diagnostic).toBeUndefined();
  });

  test("D9/D12: untrusted + project present -> base pipeline ONLY — no plugin-region block, empty pluginCss", async () => {
    const message = await resolveEditorProjectionMessage(
      { text: HIGHLIGHT_CONTENT, version: 0 },
      { projectDir: FIXTURE_ROOT },
      false,
    );
    const regions = message.projection.blocks.filter((b) => b.kind === "plugin-region");
    expect(regions).toEqual([]);
    expect(message.pluginCss).toBe("");
    expect(message.pluginErrors).toEqual([]);
  });

  test("D9: trusted + no project present -> base pipeline ONLY", async () => {
    const message = await resolveEditorProjectionMessage({ text: HIGHLIGHT_CONTENT, version: 0 }, undefined, true);
    const regions = message.projection.blocks.filter((b) => b.kind === "plugin-region");
    expect(regions).toEqual([]);
    expect(message.pluginCss).toBe("");
  });

  test("core layout markers still project in the base pipeline (D9: 'core markers still project')", async () => {
    const message = await resolveEditorProjectionMessage({ text: "@page\n\nHello.\n", version: 0 }, undefined, false);
    const pageBlocks = message.projection.blocks.filter((b) => b.kind === "page");
    expect(pageBlocks.length).toBeGreaterThan(0);
  });

  test("every returned message always carries the message envelope fields", async () => {
    const message = await resolveEditorProjectionMessage({ text: "hello", version: 3 }, undefined, false);
    expect(message.type).toBe("projection");
    expect(typeof message.protocolVersion).toBe("number");
    expect(message.projection.sourceVersion).toBe(3);
  });

  test("degrade-and-report: an uninstalled npm plugin is skipped and named, never blanking the document", async () => {
    const dir = makeDisposableProjectDir(
      'title: "temp"\nplugins:\n  - gutterpress-vscode-test-plugin-does-not-exist\n',
    );
    const message = await resolveEditorProjectionMessage({ text: "hello world", version: 0 }, { projectDir: dir }, true);
    expect(message.pluginErrors).toHaveLength(1);
    expect(message.pluginErrors[0]?.pluginRef).toBe("gutterpress-vscode-test-plugin-does-not-exist");
    expect(message.pluginErrors[0]?.message.length).toBeGreaterThan(0);
    // Still a real, usable projection — never blanked.
    expect(message.projection.sourceVersion).toBe(0);
    expect(message.diagnostic).toBeUndefined(); // per-plugin degrade, not a whole-build failure
  });

  test("degrade-and-report does not affect a DIFFERENT, loadable plugin in the same manifest", async () => {
    const dir = makeDisposableProjectDir(
      "title: \"temp\"\nplugins:\n" +
        "  - ./plugins/highlight.js\n" +
        "  - gutterpress-vscode-test-plugin-does-not-exist\n",
    );
    const pluginsDir = path.join(dir, "plugins");
    // Copy the real fixture plugin file (never write into the committed
    // fixture itself — a fresh disposable copy per AP-25).
    const { readFileSync, mkdirSync } = await import("node:fs");
    mkdirSync(pluginsDir, { recursive: true });
    writeFileSync(path.join(pluginsDir, "highlight.js"), readFileSync(path.join(FIXTURE_ROOT, "plugins", "highlight.js")));

    const message = await resolveEditorProjectionMessage(
      { text: HIGHLIGHT_CONTENT, version: 0 },
      { projectDir: dir },
      true,
    );
    expect(message.pluginErrors).toHaveLength(1);
    expect(message.pluginErrors[0]?.pluginRef).toBe("gutterpress-vscode-test-plugin-does-not-exist");
    const regions = message.projection.blocks.filter((b) => b.kind === "plugin-region");
    expect(regions.length).toBeGreaterThan(0); // the loadable plugin still worked
  });

  test("D9 UNTRUSTED GATE, SPY-VERIFIED: the plugin loader is NEVER invoked when untrusted — not absence of errors, an actual call-count spy", async () => {
    // A `mock()` spy passed as the injectable 5th parameter (`loadPlugins`)
    // — see projection.ts's `PluginLoaderFn` doc comment for why this is a
    // plain function parameter rather than `mock.module("gutterpress/plugins", ...)`
    // (measured to leak across test FILES in this Bun version — see that
    // comment for the full account). `project` genuinely HAS a declared,
    // loadable plugin (the same fixture Part 1 above proves loads for
    // real) — this is the point: even a real, loadable project's plugin
    // must not be touched when the workspace is untrusted.
    const loadPluginsSpy = mock(async () => ({ plugins: [], pluginCss: "" }) as never);
    await resolveEditorProjectionMessage(
      { text: HIGHLIGHT_CONTENT, version: 0 },
      { projectDir: FIXTURE_ROOT },
      false,
      undefined,
      loadPluginsSpy as never,
    );
    expect(loadPluginsSpy.mock.calls.length).toBe(0);
  });

  test("POSITIVE CONTROL for the spy above: trusted + project DOES invoke the loader (proves the spy is actually wired, not vacuously always-zero, G-12/AP-20)", async () => {
    const loadPluginsSpy = mock(async () => ({ plugins: [], pluginCss: "" }) as never);
    await resolveEditorProjectionMessage(
      { text: HIGHLIGHT_CONTENT, version: 0 },
      { projectDir: FIXTURE_ROOT },
      true,
      undefined,
      loadPluginsSpy as never,
    );
    expect(loadPluginsSpy.mock.calls.length).toBeGreaterThan(0);
  });

  test("D14: a whole-build hard failure (invalid manifest.yaml) falls back to the base pipeline WITH a diagnostic, never throws", async () => {
    const dir = makeDisposableProjectDir("title: [this is not valid yaml because it never closes\n");
    let capturedError: unknown;
    const message = await resolveEditorProjectionMessage(
      { text: "hello world", version: 0 },
      { projectDir: dir },
      true,
      (error) => {
        capturedError = error;
      },
    );
    expect(capturedError).toBeDefined();
    expect(message.diagnostic?.category).toBe("EDITOR_PLUGIN_LOAD_FAILED");
    expect(message.diagnostic?.message.length).toBeGreaterThan(0);
    // Still a usable, editable base projection — never blanked (D14).
    expect(message.projection.sourceVersion).toBe(0);
    expect(message.pluginCss).toBe("");
    expect(message.pluginErrors).toEqual([]);
  });
});

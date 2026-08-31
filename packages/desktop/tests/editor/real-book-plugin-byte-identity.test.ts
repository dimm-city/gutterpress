/**
 * real-book-plugin-byte-identity.test.ts (SFE-P3d-parity, Lane E)
 *
 * Parity-gate condition 3, PLUGIN-BOOK half of DELIVERABLE 1 — "Real
 * user-guide and PLUGIN-BOOK chapters can be edited without byte drift":
 * the NO-EDIT half, for the plugin-book corpus this lane supplies (Lane B's
 * `real-book-byte-identity.test.ts` already covers the user-guide half; see
 * that file's header for its own documented finding that no `examples/`
 * manifest configures a plugin).
 *
 * ## Why this exists — the gap this lane closes
 *
 * SFE-P3ab review round 1 found that `+page.svelte`'s own
 * `buildRichProjection` calls `createEditorProjection(content, {
 * sourceVersion })` with NEITHER `md` NOR `trusted` — that page's own
 * comment names this directly: "no project plugins are applied here (that
 * needs host/Node-side plugin loading, out of this repair's scope)". So the
 * desktop app's actual production wiring, TODAY, never produces a
 * `plugin-region` projected block at all. This lane's run spec permits
 * exactly this finding to be reported rather than faked — see
 * `packages/desktop/tests/fixtures/plugin-book/support.ts`'s header for the
 * full "why not `loadPlugins`" reasoning.
 *
 * What this file proves instead, with real, unmodified production code:
 * `createEditorProjection` (`gutterpress/render`) itself — the exact
 * function `buildRichProjection` calls, just called here with the `md`/
 * `trusted` parameters that function's own signature has always accepted —
 * IS plugin-aware and DOES produce genuine `plugin-region` blocks, when fed
 * a real configured `MarkdownIt` instance built by the same production
 * `createMarkdownRenderer` factory the CLI build/preview path uses. The gap
 * is in `+page.svelte`'s wiring (a known, already-documented finding from a
 * prior lane, out of THIS lane's write ownership — production source is
 * off limits here), not in `createEditorProjection`'s own capability.
 *
 * ## Corpus
 *
 * `packages/desktop/tests/fixtures/plugin-book/` (this lane's own
 * test-owned fixture, NOT `examples/`) — three chapters:
 *
 *   - `01-introduction.md` — `@chapter`, `@section`/`@end-section`,
 *     ordinary prose, one `@@callout` plugin region, one raw HTML block,
 *     `@page-break`.
 *   - `02-field-notes.md` — `@page`, `@section .gp-columns-2`,
 *     `@column-break`, ordinary prose, one `@@callout` plugin region
 *     immediately adjacent to a `@page-break`, `@end-section`.
 *   - `03-checklist.md` — plain prose only, no markers, no plugin usage — a
 *     deliberate "nothing to project" contrast chapter, mirroring Lane B's
 *     own `with-validation` contrast case.
 *
 * See `support.ts` for the plugin definition (`calloutMarkerPlugin`) and
 * why it is authored directly rather than routed through the vendored npm
 * plugin loader.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { loadManifest } from "gutterpress";
import { createEditorProjection, type GutterpressProjection, type ProjectedBlockKind } from "gutterpress/render";

// `rich-mode.svelte.ts` is a rune-bearing `.svelte.ts` module; Bun imports it
// without the Svelte compiler in these unit tests, so `$state` needs the
// same plain-passthrough shim `rich-mode.test.ts`/`real-book-byte-identity
// .test.ts` already establish for this exact file.
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

import { RichModeController } from "../../src/lib/editor/rich-mode.svelte";
import { DesktopDocumentHost } from "../../src/lib/editor-host/desktop-document-host";
import {
  PLUGIN_BOOK_CHAPTER_FILES,
  PLUGIN_BOOK_MANIFEST_PATH,
  loadPluginBookChapters,
  pluginBookRenderer,
  type PluginBookChapter,
} from "../fixtures/plugin-book/support";

const LOADED: readonly (PluginBookChapter & { readonly bytes: Buffer })[] = loadPluginBookChapters().map((c) => ({
  ...c,
  bytes: readFileSync(c.path),
}));

// Chapters that actually contain a `@@callout` marker — verified by grep
// against the committed source, independent of any plugin/parser code, so
// this expectation cannot silently drift with the fixture text.
const CHAPTERS_WITH_CALLOUTS = new Set(["01-introduction.md", "02-field-notes.md"]);

describe("plugin-book corpus liveness (AP-21) — real, nonempty, plugin-configuring fixture", () => {
  test(`${LOADED.length} plugin-book chapter files were read from disk`, () => {
    expect(LOADED.length).toBe(3);
    expect(LOADED.length).toBe(PLUGIN_BOOK_CHAPTER_FILES.length);
    for (const f of LOADED) {
      expect(f.text.length).toBeGreaterThan(0);
    }
  });

  test("the fixture's manifest.yaml genuinely configures a plugin, parsed by the REAL loadManifest (gutterpress)", async () => {
    const manifest = await loadManifest(PLUGIN_BOOK_MANIFEST_PATH);
    expect(Array.isArray(manifest.plugins)).toBe(true);
    expect(manifest.plugins!.length).toBeGreaterThan(0);
    const first = manifest.plugins![0]!;
    const name = typeof first === "string" ? first : first.name;
    expect(name).toBe("gutterpress-plugin-callout");
  });

  test("every chapter this lane claims contains a plugin marker really contains one (source grep, independent of any parser)", () => {
    for (const f of LOADED) {
      const hasCallout = /^@@callout\s+.+$/m.test(f.text);
      expect(hasCallout).toBe(CHAPTERS_WITH_CALLOUTS.has(f.id));
    }
  });

  test("the plugin's own core rule actually fires on every chapter claimed to contain a callout (direct md.parse(), independent of createEditorProjection)", () => {
    const md = pluginBookRenderer(true);
    for (const f of LOADED) {
      const tokenTypes = md.parse(f.text, {}).map((t) => t.type);
      if (CHAPTERS_WITH_CALLOUTS.has(f.id)) {
        expect(tokenTypes).toContain("plugin_callout_open");
        expect(tokenTypes).toContain("plugin_callout_close");
      } else {
        expect(tokenTypes).not.toContain("plugin_callout_open");
      }
    }
  });

  test("at least one chapter also contains a core Gutterpress marker and a raw HTML block (not plugin-only)", () => {
    const markerChapters = LOADED.filter((f) => /^@(chapter|page|section)\b/m.test(f.text));
    const htmlChapters = LOADED.filter((f) => /<div\b/.test(f.text));
    expect(markerChapters.length).toBeGreaterThan(0);
    expect(htmlChapters.length).toBeGreaterThan(0);
  });
});

describe("no-edit byte identity: plugin-book chapter -> DesktopDocumentHost -> rich-mount lifecycle (PLUGIN-AWARE, TRUSTED projection) -> unmount -> read back", () => {
  for (const file of LOADED) {
    test(`${file.id} — mount then unmount changes ZERO bytes, with a plugin-aware trusted projection actually built`, () => {
      const original = file.text;
      const originalBuffer = file.bytes;

      const host = new DesktopDocumentHost(original, { documentId: `plugin-book/${file.id}` });
      expect(host.getSnapshot().text).toBe(original);
      expect(host.getSnapshot().version).toBe(0);

      const notifications: string[] = [];
      const unsubscribe = host.subscribe((snapshot) => notifications.push(snapshot.text));

      const controller = new RichModeController({ initialSurface: "rich" });
      controller.registerMount("rich");
      expect(controller.mountedSurface).toBe("rich");

      // PLUGIN-AWARE, TRUSTED: the real production `createEditorProjection`,
      // fed a real configured MarkdownIt built by the same production
      // `createMarkdownRenderer` factory the CLI build/preview path uses,
      // with the callout plugin loaded and `trusted: true` — exactly the
      // parameters that function's own signature has always accepted (see
      // this file's header for why `+page.svelte` does not pass them
      // today).
      const md = pluginBookRenderer(true);
      let projection: GutterpressProjection;
      expect(() => {
        projection = createEditorProjection(host.getSnapshot().text, {
          sourceVersion: host.getSnapshot().version,
          md,
          trusted: true,
        });
      }).not.toThrow();
      projection = projection!;

      expect(projection.schemaVersion).toBe(1);
      expect(projection.sourceVersion).toBe(0);

      // AP-21 liveness FIRST, before any identity assertion: a projection
      // with zero plugin regions would make this whole test vacuous for the
      // callout chapters. Assert it BEFORE the byte-identity checks below.
      const pluginRegionCount = projection.blocks.filter((b) => b.kind === "plugin-region").length;
      if (CHAPTERS_WITH_CALLOUTS.has(file.id)) {
        expect(pluginRegionCount).toBeGreaterThan(0);
      }

      for (const block of projection.blocks) {
        expect(block.from).toBeGreaterThanOrEqual(0);
        expect(block.to).toBeGreaterThanOrEqual(block.from);
        expect(block.to).toBeLessThanOrEqual(original.length);
      }
      for (const generated of projection.generated) {
        expect(generated.anchor).toBeGreaterThanOrEqual(0);
        expect(generated.anchor).toBeLessThanOrEqual(original.length);
      }

      controller.registerUnmount("rich");
      expect(controller.mountedSurface).toBeNull();
      unsubscribe();

      const after = host.getSnapshot();
      expect(after.text).toBe(original);
      expect(after.version).toBe(0);
      expect(Buffer.from(after.text, "utf8").equals(originalBuffer)).toBe(true);

      // Mounting/projecting/unmounting a document nobody edited must never
      // notify a subscriber — same load-bearing assertion as the
      // user-guide/design-guide corpus's own byte-identity file.
      expect(notifications).toEqual([]);
    });
  }
});

describe("plugin-region blocks carry real evidence from the real pipeline (not a hand-built projection)", () => {
  for (const file of LOADED.filter((f) => CHAPTERS_WITH_CALLOUTS.has(f.id))) {
    test(`${file.id} — the plugin-region block's byte range reproduces the exact "@@callout ..." source line, and its inactiveHtml is the plugin's OWN rendered output`, () => {
      const md = pluginBookRenderer(true);
      const projection = createEditorProjection(file.text, { sourceVersion: 0, md, trusted: true });
      const block = projection.blocks.find((b) => b.kind === "plugin-region");
      expect(block).toBeDefined();
      const slice = file.text.slice(block!.from, block!.to);
      expect(slice.startsWith("@@callout ")).toBe(true);
      expect(block!.editMode).toBe("source");
      expect(block!.viewAttributes?.["data-callout-label"]).toBeTruthy();
      expect(block!.viewAttributes).not.toHaveProperty("data-source-range");
      // The plugin's own rendered HTML, not the raw authored marker text —
      // proves this is genuine pipeline output, mirroring
      // editor-projection-plugins.test.ts's own "repair round 1" assertion.
      expect(block!.inactiveHtml).toContain("gp-callout");
      expect(block!.inactiveHtml).not.toBe(slice);
    });
  }
});

describe("plugin-book byte-identity coverage report (deliverable 4)", () => {
  test("chapter count, total bytes, and the projection kinds this lane genuinely exercised", () => {
    const totalBytes = LOADED.reduce((sum, f) => sum + f.bytes.length, 0);
    const md = pluginBookRenderer(true);
    const kindsSeen = new Set<ProjectedBlockKind>();
    for (const f of LOADED) {
      const projection = createEditorProjection(f.text, { sourceVersion: 0, md, trusted: true });
      for (const b of projection.blocks) kindsSeen.add(b.kind);
    }
    // eslint-disable-next-line no-console -- this IS the coverage report; see this lane's report for the same numbers.
    console.log(
      `plugin-book corpus coverage: ${LOADED.length} files, ${totalBytes} bytes total, ` +
        `projected kinds: ${Array.from(kindsSeen).sort().join(", ")}`,
    );
    expect(LOADED.length).toBe(3);
    expect(totalBytes).toBeGreaterThan(0);
    expect(kindsSeen.has("plugin-region")).toBe(true);
    expect(kindsSeen.has("page-break")).toBe(true);
    expect(path.basename(PLUGIN_BOOK_MANIFEST_PATH)).toBe("manifest.yaml");
  });
});

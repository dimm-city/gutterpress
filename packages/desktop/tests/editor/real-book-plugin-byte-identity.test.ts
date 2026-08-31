/**
 * real-book-plugin-byte-identity.test.ts (SFE-P3d-parity, then SFE-P3e Lane A,
 * then Lane C's loader swap)
 *
 * Parity-gate condition 3, PLUGIN-BOOK half of DELIVERABLE 1 — "Real
 * user-guide and PLUGIN-BOOK chapters can be edited without byte drift":
 * the NO-EDIT half, for the plugin-book corpus this lane supplies (Lane B's
 * `real-book-byte-identity.test.ts` already covers the user-guide half; see
 * that file's header for its own documented finding that no `examples/`
 * manifest configures a plugin).
 *
 * ## SFE-P3e — this file now goes through the REAL desktop pipeline
 *
 * SFE-P3ab review round 1 found that `+page.svelte`'s own
 * `buildRichProjection` called `createEditorProjection(content, {
 * sourceVersion })` with NEITHER `md` NOR `trusted` — so the desktop app's
 * production wiring never produced a `plugin-region` projected block at
 * all. SFE-P3e closed that gap: `buildRichProjection` now calls
 * `packages/desktop/electron/editor-projection.ts`'s
 * `buildHostEditorProjection` (via typed IPC) whenever a desktop project is
 * open. This file's fixture-loading helper,
 * `support.ts`'s `buildRealPluginBookProjection`, calls that EXACT function
 * directly — real `loadManifestWithPath`/`resolveConfig` against this
 * fixture's own `manifest.yaml`, a real on-disk load of the REAL local-file
 * plugin it names (`./plugins/callout.js`), real `createMarkdownRenderer`,
 * real `createEditorProjection(..., { trusted: true })`. No hand-built `md`,
 * no injected plugin function. The plugin-loading step itself is
 * `gutterpress/plugins`'s `loadPluginsWithCss` (Lane C, SFE-P3e) — the SAME
 * degrade-and-report loader the live preview uses, not a desktop-local
 * duplicate; see `editor-projection.ts`'s own header ("Loader boundary").
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
 * See `support.ts` for `buildRealPluginBookProjection` and why the only
 * hand-written plugin logic left in that file is a deliberate NEGATIVE
 * (no-evidence) counter-example, not a second copy of the real rule.
 */
import { describe, expect, test } from "bun:test";
import path from "node:path";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadManifest } from "gutterpress";
import { createMarkdownRenderer, type GutterpressPlugin, type ProjectedBlockKind } from "gutterpress/render";

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
  PLUGIN_BOOK_PLUGIN_PATH,
  loadPluginBookChapters,
  buildRealPluginBookProjection,
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

  test("the fixture's manifest.yaml genuinely configures a REAL local-file plugin, parsed by the REAL loadManifest (gutterpress)", async () => {
    const manifest = await loadManifest(PLUGIN_BOOK_MANIFEST_PATH);
    expect(Array.isArray(manifest.plugins)).toBe(true);
    expect(manifest.plugins!.length).toBeGreaterThan(0);
    const first = manifest.plugins![0]!;
    const ref = typeof first === "string" ? first : (first.path ?? first.name);
    expect(ref).toBe("./plugins/callout.js");
  });

  test("every chapter this lane claims contains a plugin marker really contains one (source grep, independent of any parser)", () => {
    for (const f of LOADED) {
      const hasCallout = /^@@callout\s+.+$/m.test(f.text);
      expect(hasCallout).toBe(CHAPTERS_WITH_CALLOUTS.has(f.id));
    }
  });

  test("the REAL plugins/callout.js file's own core rule actually fires on every chapter claimed to contain a callout (direct md.parse() against the file the manifest names, independent of createEditorProjection AND of buildHostEditorProjection)", async () => {
    const mod = (await import(pathToFileURL(PLUGIN_BOOK_PLUGIN_PATH).href)) as { default: GutterpressPlugin };
    const md = createMarkdownRenderer([{ name: "gutterpress-plugin-callout", plugin: mod.default, options: {} }]);
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

// SFE-P3d-parity repair round 1 (CONFIRMED finding): same correction as
// `real-book-byte-identity.test.ts` — these titles used to say "rich-mount
// lifecycle" / "mount then unmount". No mount happens: `registerMount` is
// bookkeeping state and `createEditorProjection` is a pure function. A REAL
// browser mount of the actual fork is proven separately, against a
// SYNTHETIC corpus, by `packages/editor/tests/vscode-adapter/browser.cases
// .btest.ts`'s "mount + unmount with zero edits leaves host source
// byte-identical" cases — real chapters (this file's own plugin-book
// fixture included) have never been mounted in a real browser; a named,
// owner-attributed gap (Lane E, SFE-P3d-parity), not a claim this file makes.
describe("no-edit byte identity: plugin-book chapter -> DesktopDocumentHost -> buildHostEditorProjection (REAL manifest, REAL loaded plugin, TRUSTED) -> read back", () => {
  for (const file of LOADED) {
    test(`${file.id} — document session + REAL host projection build changes ZERO bytes, with a plugin-aware trusted projection actually built`, async () => {
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

      // REAL PIPELINE: buildHostEditorProjection — the exact function the
      // desktop's `api:editorProjection` IPC handler calls — resolving this
      // fixture's own manifest.yaml and loading its real local-file plugin.
      const { projection, pluginCss, pluginErrors } = await buildRealPluginBookProjection(
        host.getSnapshot().text,
        host.getSnapshot().version,
      );

      // AP-21 liveness FIRST: the plugin must have actually loaded — a
      // pluginError here would make every assertion below vacuous for the
      // wrong reason (a load failure, not a projection failure).
      expect(pluginErrors).toEqual([]);

      expect(projection.schemaVersion).toBe(1);
      expect(projection.sourceVersion).toBe(0);

      // AP-21 liveness, second: a projection with zero plugin regions would
      // make this whole test vacuous for the callout chapters. Assert it
      // BEFORE the byte-identity checks below.
      const pluginRegionCount = projection.blocks.filter((b) => b.kind === "plugin-region").length;
      if (CHAPTERS_WITH_CALLOUTS.has(file.id)) {
        expect(pluginRegionCount).toBeGreaterThan(0);
        // The real plugin file declares CSS (see its own header) — proves
        // pluginCss is genuinely populated by the real pipeline, not just
        // present-but-empty.
        expect(pluginCss.length).toBeGreaterThan(0);
        expect(pluginCss).toContain("gp-callout");
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
    test(`${file.id} — the plugin-region block's byte range reproduces the exact "@@callout ..." source line, and its inactiveHtml is the REAL plugin's OWN rendered output`, async () => {
      const { projection, pluginErrors } = await buildRealPluginBookProjection(file.text, 0);
      expect(pluginErrors).toEqual([]);
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
  test("chapter count, total bytes, and the projection kinds this lane genuinely exercised through the REAL pipeline", async () => {
    const totalBytes = LOADED.reduce((sum, f) => sum + f.bytes.length, 0);
    const kindsSeen = new Set<ProjectedBlockKind>();
    for (const f of LOADED) {
      const { projection, pluginErrors } = await buildRealPluginBookProjection(f.text, 0);
      expect(pluginErrors).toEqual([]);
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

/**
 * Source-level tests for FeaturesSection.svelte (#309 — the Features tab read
 * like a developer package browser).
 *
 * The contract: a non-technical writer sees the bundled "Formatting extras" in
 * plain language, with the package name only as a tooltip; everything
 * developer-shaped (the npm search and its raw package cards, install by name,
 * a plugin file or folder) sits behind ONE collapsed "Advanced" disclosure and
 * stays fully functional.
 *
 * Svelte templates have no mount/DOM harness in this repo's bun:test setup, so
 * — like ProjectsListBody.test.ts, ux-writer-friendly.test.ts — these assert
 * on the source text. The pure piece (splitting a description's `backtick`
 * spans into code segments) is unit-tested in config-helpers.test.ts.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const src = fs.readFileSync(
  path.resolve(__dirname, "../../src/lib/components/config/FeaturesSection.svelte"),
  "utf-8",
);
const markup = src.slice(src.indexOf("</script>"), src.indexOf("<style>"));
const style = src.slice(src.indexOf("<style>"));
const advancedAt = markup.indexOf('<details class="advanced"');
/** Everything a writer sees without opening anything. */
const above = markup.slice(0, advancedAt);
/** The Advanced disclosure, summary included. */
const advanced = markup.slice(advancedAt);

describe("FeaturesSection — Advanced disclosure (#309)", () => {
  test("the developer tools sit in ONE native <details>, collapsed by default", () => {
    expect(advancedAt).toBeGreaterThan(-1);
    expect(markup.split('<details class="advanced"').length - 1).toBe(1);
    const openingTag = advanced.slice(0, advanced.indexOf(">") + 1);
    expect(openingTag).not.toMatch(/\bopen\b/);
    // The writer-facing name of the disclosure is "Advanced".
    const summary = advanced.slice(0, advanced.indexOf("</summary>"));
    expect(summary).toContain("<summary>");
    expect(summary).toContain("Advanced");
  });

  test("npm search, its package cards, install by name and the local add are inside it — none above", () => {
    for (const piece of [
      "Find more on npm",
      "controller.searchQuery",
      "controller.availableSearch",
      "Install from npm",
      "controller.addNpm",
      "controller.addSearched",
      "Add a plugin file or folder",
      "controller.addLocal",
    ]) {
      expect(advanced).toContain(piece);
      expect(above).not.toContain(piece);
    }
  });

  test("the disclosure marker is an inline SVG chevron, never a content glyph", () => {
    const summary = advanced.slice(0, advanced.indexOf("</summary>"));
    expect(summary).toContain('<Icon name="chevron-right"');
    // No `content:` property (`justify-content:` etc. are fine).
    expect(style).not.toMatch(/(^|[\s;{])content:/);
    expect(style).toMatch(/\.advanced\[open\] > summary \.summary-marker \{ transform: rotate\(90deg\)/);
  });

  test("npm is searched the first time Advanced opens — not on mount, not while it stays closed", () => {
    expect(src).not.toContain("onMount");
    expect(advanced.slice(0, advanced.indexOf(">") + 1)).toContain("ontoggle={onAdvancedToggle}");
    expect(src).toMatch(/e\.currentTarget\.open && controller\.search\.status === "idle"/);
    expect(src).toContain('controller.runSearch("")');
  });
});

describe("FeaturesSection — plain-language lead (#309)", () => {
  test("leads with the curated built-in list under a writer-facing heading", () => {
    expect(above).toContain("Formatting extras");
    expect(above).not.toContain("Markdown features");
    expect(above).toContain("controller.availableRecommended");
    // The one-liner keeps its "what to type" spans, set in code type.
    expect(above).toContain("{@render oneLiner(rec.description)}");
    expect(markup).toContain("describeSegments(description)");
    expect(style).toMatch(/\.rec-desc code \{/);
  });

  test("a built-in feature's package name is a tooltip, never visible text", () => {
    const extras = above.slice(above.indexOf("controller.availableRecommended"));
    expect(extras).toContain("title={rec.use}");
    expect(extras).not.toContain("rec-pkg");
    expect(extras).not.toMatch(/>\s*\{rec\.use\}\s*</);
  });

  test("a turned-on built-in feature keeps its one-liner, not its package name; folders and packages keep a muted name", () => {
    expect(above).toContain("title={e.use}");
    const row = above.slice(above.indexOf('<span class="plugin-label"'), above.indexOf('<span class="plugin-meta">'));
    // Bundled: the plain-language line (what to type) instead of the package.
    expect(row).toMatch(/\{#if e\.kind === "bundled"\}\s*\{#if e\.description\}\{@render oneLiner\(e\.description\)\}\{\/if\}/);
    // Everything else: the muted `use` line, only when it adds something.
    expect(row).toMatch(/\{:else if e\.label !== e\.use\}\s*<span class="plugin-name">\{e\.use\}<\/span>/);
    // Muted and small, not primary text.
    expect(style).toMatch(/\.plugin-name, \.rec-pkg \{[^}]*color: var\(--app-text-muted\)/);
  });

  test("each Turn on button says which feature it turns on", () => {
    expect(above).toContain("aria-label={`Turn on ${rec.label}`}");
    expect(above).toContain("controller.addRecommended(rec)");
  });

  test("the empty state no longer points at controls that are now folded away", () => {
    expect(above).not.toContain("further down");
    expect(above).toContain("No features turned on yet. Pick one below.");
  });
});

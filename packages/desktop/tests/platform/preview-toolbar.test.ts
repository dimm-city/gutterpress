/**
 * Source-level tests for PreviewToolbar.svelte — the preview pane's own
 * control strip (page navigation + zoom), the mirror of EditorToolbar. These
 * controls used to sit in the main app toolbar; the contract they carried
 * there (the native page <select>, the perf-gate data seam, the DOM re-sync)
 * moves here unchanged.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const strip = () => read("src/lib/components/PreviewToolbar.svelte");

describe("PreviewToolbar — page select", () => {
  test("the page control is a native select labelled for navigation", () => {
    const src = strip();
    expect(src).toContain('class="page-select"');
    expect(src).toMatch(/<select[^>]*aria-label="Go to page"/);
    expect(src).not.toContain('type="number"');
  });

  test("carries the machine-readable page seam", () => {
    const src = strip();
    expect(src).toMatch(/data-current-page=\{pageNav\.currentPage\}/);
    expect(src).toMatch(/data-total-pages=\{pageNav\.totalPages\}/);
  });

  test("renders one option per page, selection driven by the select's VALUE (a property write)", () => {
    const src = strip();
    expect(src).toMatch(/\{#each\s+pageNav\.pageOptions\s+as\s+\w+/);
    expect(src).toMatch(/<select[\s\S]{0,400}?value=\{pageNav\.currentPage\}/);
    expect(src).not.toMatch(/<option[^>]*selected=\{/);
  });

  test("changing the select navigates via selectPage and re-syncs the DOM", () => {
    const src = strip();
    expect(src).toMatch(/pageNav\.selectPage\(/);
    expect(src).toMatch(/el\.value = String\(pageNav\.currentPage\)/);
  });

  test("the dropdown options are explicitly styled", () => {
    expect(strip()).toMatch(/\.page-select option\s*\{[^}]*background:[^}]*color:/s);
  });

  test("first/prev/next/last keep their labels and tooltips", () => {
    const src = strip();
    for (const label of ["First page", "Previous page", "Next page", "Last page"]) {
      expect(src).toContain(`aria-label="${label}"`);
    }
  });
});

describe("PreviewToolbar — zoom", () => {
  test("offers fit-to-width and the fixed levels, reports the current one, and routes through onApplyZoom", () => {
    const src = strip();
    expect(src).toContain('["fit-width", "Fit to width"]');
    expect(src).toContain('["1", "100%"]');
    expect(src).toMatch(/onApplyZoom\(val\); closeMenu\(e\);/);
    expect(src).toMatch(/aria-pressed=\{zoom === val\}/);
    expect(src).toContain('{zoomLabel}');
  });

  test("the strip is scoped to the preview pane's container, and the pane names it", () => {
    expect(strip()).toMatch(/@container preview-pane/);
    const page = read("src/routes/+page.svelte");
    expect(page).toMatch(/\.preview-pane\s*\{[^}]*container-name:\s*preview-pane/);
  });
});

describe("PreviewToolbar — PWA cleanliness (CLAUDE.md §8)", () => {
  test("no host/Node value imports", () => {
    const src = strip();
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toContain("window.electron");
    expect(src).toMatch(/import type \{ PageNavController \}/);
  });
});

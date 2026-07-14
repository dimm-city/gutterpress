import { test, expect } from "bun:test";
import {
  pluginLabel,
  pluginStatus,
  sampleSrcdoc,
  hoverPreviewSrcdoc,
} from "../../src/lib/components/config/config-helpers";
import type {
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
} from "../../src/lib/api";

const recommended: RecommendedPlugin[] = [
  { name: "markdown-it-mark", label: "Highlight", description: "==mark== -> <mark>", builtin: true },
  { name: "markdown-it-sub", label: "Subscript", description: "H~2~O", builtin: true },
];

function entry(overrides: Partial<ProjectPluginEntry> = {}): ProjectPluginEntry {
  return { ref: "markdown-it-mark", kind: "npm", enabled: true, ...overrides };
}

// ── #106: hover preview renders a fixed 2-page sample, never the document ──────

test("hoverPreviewSrcdoc inlines the theme CSS into a fixed two-page spread", () => {
  const css = ":root { --accent: #036; }";
  const doc = hoverPreviewSrcdoc(css);
  // The theme CSS is inlined inside a <style> block.
  expect(doc).toContain(css);
  // It is a FIXED sample spread — two sample pages, not the author's document.
  expect((doc.match(/pm-sample-page/g) ?? []).length).toBeGreaterThanOrEqual(2);
  expect(doc).toContain("Chapter One");
});

test("hoverPreviewSrcdoc is a superset sample of the thumbnail (both self-contained docs)", () => {
  const css = "h1 { color: red; }";
  expect(sampleSrcdoc(css).startsWith("<!DOCTYPE html>")).toBe(true);
  expect(hoverPreviewSrcdoc(css).startsWith("<!DOCTYPE html>")).toBe(true);
});

// ── M33: friendly label survives past "Turn on" ────────────────────────────

test("pluginLabel maps a configured entry's ref back to the recommended list's label", () => {
  expect(pluginLabel(entry({ ref: "markdown-it-mark" }), recommended)).toBe("Highlight");
  expect(pluginLabel(entry({ ref: "markdown-it-sub" }), recommended)).toBe("Subscript");
});

test("pluginLabel falls back to the raw ref when the plugin isn't in the recommended list", () => {
  expect(pluginLabel(entry({ ref: "markdown-it-footnote" }), recommended)).toBe(
    "markdown-it-footnote",
  );
});

test("pluginLabel falls back to the raw ref for local-file plugins (never recommended)", () => {
  expect(pluginLabel(entry({ ref: "./plugins/my-plugin.js", kind: "local" }), recommended)).toBe(
    "./plugins/my-plugin.js",
  );
});

test("pluginLabel falls back to the ref when a recommended entry has no label", () => {
  const noLabel: RecommendedPlugin[] = [
    { name: "markdown-it-mark", description: "no label here", builtin: true },
  ];
  expect(pluginLabel(entry({ ref: "markdown-it-mark" }), noLabel)).toBe("markdown-it-mark");
});

// ── M34: pluginStatus tri-state (checking vs never-resolved vs done) ───────

test("pluginStatus: disabled entry always reads Disabled, regardless of validation state", () => {
  const st = pluginStatus(entry({ enabled: false }), {}, true);
  expect(st).toEqual({ label: "Disabled", kind: "disabled" });
});

test("pluginStatus: in-flight validation with no result yet reads Checking…", () => {
  const st = pluginStatus(entry(), {}, /* pluginValidating */ true);
  expect(st.kind).toBe("checking");
  expect(st.label).toBe("Checking…");
});

test("pluginStatus: NOT validating and no result is a distinct 'check failed' state, not stuck Checking…", () => {
  const st = pluginStatus(entry(), {}, /* pluginValidating */ false);
  expect(st.kind).not.toBe("checking");
  expect(st.kind).toBe("stale");
  expect(st.label).toMatch(/check failed/i);
  expect(st.label).toMatch(/re-check/i);
});

test("pluginStatus: ok result reads Loads OK", () => {
  const validation: Record<string, PluginValidationResult> = {
    "markdown-it-mark": { ref: "markdown-it-mark", kind: "npm", enabled: true, ok: true },
  };
  const st = pluginStatus(entry(), validation, false);
  expect(st).toEqual({ label: "Loads OK", kind: "ok" });
});

test("pluginStatus: failed npm plugin gets a copyable install command and a guide link", () => {
  const validation: Record<string, PluginValidationResult> = {
    "markdown-it-footnote": {
      ref: "markdown-it-footnote",
      kind: "npm",
      enabled: true,
      ok: false,
      error: "Cannot find module 'markdown-it-footnote'",
    },
  };
  const st = pluginStatus(entry({ ref: "markdown-it-footnote" }), validation, false);
  expect(st.label).toBe("Not installed");
  expect(st.kind).toBe("error");
  expect(st.installCommand).toBe("npm install markdown-it-footnote");
  expect(st.guideHref).toMatch(/^https:\/\//);
  expect(st.guideHref).toContain("06-plugins.md");
  expect(st.raw).toBe("Cannot find module 'markdown-it-footnote'");
});

test("pluginStatus: failed local plugin gets no install command (it isn't an npm package)", () => {
  const validation: Record<string, PluginValidationResult> = {
    "./plugins/broken.js": {
      ref: "./plugins/broken.js",
      kind: "local",
      enabled: true,
      ok: false,
      error: "SyntaxError: unexpected token",
    },
  };
  const st = pluginStatus(
    entry({ ref: "./plugins/broken.js", kind: "local" }),
    validation,
    false,
  );
  expect(st.label).toBe("Error");
  expect(st.installCommand).toBeUndefined();
  expect(st.guideHref).toBeUndefined();
});

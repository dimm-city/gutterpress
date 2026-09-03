/**
 * gfm-alerts.ts (#237) — GFM-style `> [!NOTE]` alert blockquotes.
 *
 * Structured the same way as markers.test.ts: a bare MarkdownIt + the plugin
 * under test, asserting on rendered HTML and (where relevant) `env`. Two
 * concerns get their own describe block: the transform itself (bare
 * MarkdownIt + gfmAlerts), and the end-to-end wiring through the real
 * pipeline (createMarkdownRenderer / BUILTIN_OPTIONAL_PLUGINS / GP_CLASSES),
 * because it is the wiring — not just the transform — that #237 asks for.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import gfmAlerts from "./gfm-alerts.ts";
import { createMarkdownRenderer, BUILTIN_OPTIONAL_PLUGINS } from "./renderer.ts";
import { GP_CLASSES } from "./gutterpress-css.ts";
import { RECOMMENDED_PLUGINS } from "../plugin-manager.ts";

interface LayoutWarning {
  line: number;
  type: string;
  message: string;
}

interface AlertEnv {
  layoutWarnings?: LayoutWarning[];
  [key: string]: unknown;
}

/** Render markdown through a bare MarkdownIt + gfmAlerts plugin instance. */
function renderAlerts(src: string, env: AlertEnv = {}): { html: string; env: AlertEnv } {
  const md = new MarkdownIt({ html: true });
  md.use(gfmAlerts);
  const html = md.render(src, env);
  return { html, env };
}

/** Render through a bare MarkdownIt with NO plugins — today's default behavior. */
function renderPlain(src: string): string {
  return new MarkdownIt({ html: true }).render(src);
}

describe("gfm-alerts: backward compatibility (plugin not applied)", () => {
  test("a fresh project (no plugins) still prints > [!NOTE] as a literal blockquote", () => {
    const html = renderPlain("> [!NOTE]\n> Some text.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("[!NOTE]");
    expect(html).not.toContain("gp-alert");
  });

  test("createMarkdownRenderer with zero manifest plugins does not touch alert syntax", () => {
    // The full pipeline also runs markdown-it-source-map + source_range
    // (renderer.ts), so this asserts on tag/content shape, not an exact
    // literal string — those add attributes to the very same <blockquote>.
    const md = createMarkdownRenderer();
    const html = md.render("> [!NOTE]\n> Some text.");
    expect(html).toMatch(/<blockquote[ >]/);
    expect(html).toContain("[!NOTE]");
    expect(html).not.toContain("gp-alert");
  });
});

describe("gfm-alerts: the transform, enabled", () => {
  test("a marker alone on its line, blank line, then body — the common case", () => {
    const { html } = renderAlerts("> [!NOTE]\n>\n> Useful context.");
    expect(html).not.toContain("<blockquote>");
    expect(html).not.toContain("[!NOTE]");
    expect(html).toContain('<div class="gp-alert gp-alert-note">');
    expect(html).toContain('<p class="gp-alert-title">Note</p>');
    expect(html).toContain("<p>Useful context.</p>");
    expect(html.indexOf("</div>")).toBeGreaterThan(html.indexOf("Useful context."));
  });

  test("a marker sharing its paragraph with body text (no blank line)", () => {
    const { html } = renderAlerts("> [!TIP]\n> Body starts on the very next line.");
    expect(html).toContain('<div class="gp-alert gp-alert-tip">');
    expect(html).toContain('<p class="gp-alert-title">Tip</p>');
    expect(html).toContain("<p>Body starts on the very next line.</p>");
    expect(html).not.toContain("[!TIP]");
  });

  test.each([
    ["NOTE", "note", "Note"],
    ["TIP", "tip", "Tip"],
    ["IMPORTANT", "important", "Important"],
    ["WARNING", "warning", "Warning"],
    ["CAUTION", "caution", "Caution"],
  ])("recognizes the GitHub type [!%s]", (marker, cssType, label) => {
    const { html } = renderAlerts(`> [!${marker}]\n> Body.`);
    expect(html).toContain(`gp-alert gp-alert-${cssType}`);
    expect(html).toContain(`<p class="gp-alert-title">${label}</p>`);
  });

  test("case-insensitive marker matching", () => {
    const { html } = renderAlerts("> [!note]\n> Body.");
    expect(html).toContain("gp-alert gp-alert-note");
    expect(html).toContain('<p class="gp-alert-title">Note</p>');
  });

  test("multi-paragraph and list body content survives, in order", () => {
    const src = [
      "> [!WARNING]",
      ">",
      "> First paragraph.",
      ">",
      "> - one",
      "> - two",
    ].join("\n");
    const { html } = renderAlerts(src);
    expect(html).toContain('<div class="gp-alert gp-alert-warning">');
    const divIdx = html.indexOf('<div class="gp-alert');
    const pIdx = html.indexOf("First paragraph.");
    const liIdx = html.indexOf("<li>one</li>");
    const closeIdx = html.lastIndexOf("</div>");
    expect(divIdx).toBeLessThan(pIdx);
    expect(pIdx).toBeLessThan(liIdx);
    expect(liIdx).toBeLessThan(closeIdx);
  });

  test("inline markdown formatting inside the body still works", () => {
    const { html } = renderAlerts("> [!NOTE]\n> Some **bold** and *italic* text.");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>italic</em>");
  });

  test("a nested blockquote inside an alert body stays a literal nested blockquote", () => {
    const src = ["> [!NOTE]", ">", "> > A quoted aside.", ">", "> After the quote."].join("\n");
    const { html } = renderAlerts(src);
    expect(html).toContain('<div class="gp-alert gp-alert-note">');
    expect(html).toContain("<blockquote>");
    expect(html).toContain("A quoted aside.");
    expect(html).toContain("After the quote.");
  });
});

describe("gfm-alerts: deliberately NOT recognized (matches real GFM, protects backward compat)", () => {
  test("an unsupported type (not one of the GitHub five) is left as a literal blockquote", () => {
    const { html } = renderAlerts("> [!DANGER]\n> Not part of the GitHub set.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("[!DANGER]");
    expect(html).not.toContain("gp-alert");
  });

  test("a marker sharing its line with trailing text does not match (must be alone on the line)", () => {
    const { html } = renderAlerts("> [!NOTE] Custom Title\n> Body.");
    expect(html).toContain("<blockquote>");
    expect(html).toContain("[!NOTE] Custom Title");
    expect(html).not.toContain("gp-alert");
  });

  test("an ordinary blockquote with no marker is untouched", () => {
    const { html } = renderAlerts("> Just a regular quote.");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("gp-alert");
  });

  test("a blockquote that opens with a list, not a paragraph, is untouched", () => {
    const { html } = renderAlerts("> - [!NOTE]\n> - not a marker paragraph");
    expect(html).toContain("<blockquote>");
    expect(html).not.toContain("gp-alert");
  });
});

describe("gfm-alerts: wired into the real pipeline (#237's actual ask)", () => {
  test("registered as the built-in `gutterpress-gfm-alerts` feature", () => {
    expect(typeof BUILTIN_OPTIONAL_PLUGINS["gutterpress-gfm-alerts"]).toBe("function");
  });

  test("listed in RECOMMENDED_PLUGINS as \"Callouts\", bundled", () => {
    const entry = RECOMMENDED_PLUGINS.find((p) => p.name === "gutterpress-gfm-alerts");
    expect(entry).toBeDefined();
    expect(entry!.label).toBe("Callouts");
    expect(entry!.builtin).toBe(true);
  });

  test("createMarkdownRenderer renders alerts once the plugin is loaded, exactly like a manifest-enabled feature", () => {
    // Same caveat as above: the full pipeline also stamps data-source-range
    // onto this very div (see the dedicated test below), so match on the
    // class attribute rather than the exact tag string.
    const md = createMarkdownRenderer([
      {
        name: "gutterpress-gfm-alerts",
        plugin: BUILTIN_OPTIONAL_PLUGINS["gutterpress-gfm-alerts"]!,
        options: {},
      },
    ]);
    const html = md.render("> [!NOTE]\n>\n> Enabled via the manifest.");
    expect(html).toMatch(/<div class="gp-alert gp-alert-note"[ >]/);
    expect(html).toContain('<p class="gp-alert-title"');
    expect(html).toContain("Enabled via the manifest.");
  });

  test("every class the plugin emits is registered in GP_CLASSES (#226's unknown_gp_class contract)", () => {
    for (const cls of [
      "gp-alert",
      "gp-alert-title",
      "gp-alert-note",
      "gp-alert-tip",
      "gp-alert-important",
      "gp-alert-warning",
      "gp-alert-caution",
    ]) {
      expect(GP_CLASSES.has(cls)).toBe(true);
    }
  });

  test("the unknown_gp_class diagnostic does not fire on the plugin's own output", () => {
    const md = createMarkdownRenderer([
      {
        name: "gutterpress-gfm-alerts",
        plugin: BUILTIN_OPTIONAL_PLUGINS["gutterpress-gfm-alerts"]!,
        options: {},
      },
    ]);
    const env: AlertEnv = {};
    md.render("> [!CAUTION]\n>\n> Rendered through the full pipeline.", env);
    const unknownClassWarnings = (env.layoutWarnings ?? []).filter(
      (w) => w.type === "unknown_gp_class"
    );
    expect(unknownClassWarnings).toEqual([]);
  });

  test("the alert wrapper gets a data-source-range for editor click-to-source (ADR 0009)", () => {
    const md = createMarkdownRenderer([
      {
        name: "gutterpress-gfm-alerts",
        plugin: BUILTIN_OPTIONAL_PLUGINS["gutterpress-gfm-alerts"]!,
        options: {},
      },
    ]);
    const html = md.render("> [!NOTE]\n>\n> Body.");
    expect(html).toMatch(/<div class="gp-alert gp-alert-note" data-source-range="0:\d+">/);
  });
});

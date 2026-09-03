/**
 * `scaffoldExtension` (#245 / #233) — the plugin and theme starter packages.
 *
 * The load-bearing assertions here are the ones that go through REAL code
 * rather than inspecting strings: a scaffolded folder is fed to
 * `extension-manifest.ts`'s own reader/containment-check/resolver (the exact
 * path `loadPlugin`, `applyTheme` and the snippet merge all take) and to the
 * plugin loader itself. A scaffold that emits JSON those functions reject is
 * a scaffold that produces a folder nothing can consume, however plausible
 * the file looks by eye.
 */
import { test, expect, describe } from "bun:test";
import { mkdtemp, mkdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  scaffoldExtension,
  resolveExtensionPrefix,
  EXTENSION_KINDS,
  RESERVED_PREFIX,
} from "./extension-scaffold.ts";
import type { CreateProjectError } from "./project-scaffold.ts";
import {
  readExtensionMeta,
  resolveExtension,
  assertExtensionContained,
  extensionStyleList,
} from "./extension-manifest.ts";
import { loadPlugins } from "./markdown/plugins.ts";
import { createMarkdownRenderer } from "./markdown/renderer.ts";
import type { ResolvedPluginConfig } from "../schema/manifest.types.ts";

async function tmpParent(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "gutterpress-extension-scaffold-"));
}

/** CSS with `/* … *​/` comments removed, so a name assertion tests the RULES. */
function stripCssComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

/** A manifest `plugins:` entry with the defaults the loader expects. */
function pluginCfg(path: string): ResolvedPluginConfig {
  return { priority: 100, options: {}, path };
}

// ── Prefix — the convention the scaffolds exist to teach ────────────────────

describe("resolveExtensionPrefix", () => {
  test("defaults to the slug with a trailing hyphen", () => {
    expect(resolveExtensionPrefix("field-notes")).toBe("field-notes-");
  });

  test("adds the trailing hyphen a caller left off", () => {
    // The templates concatenate the prefix straight onto a name, so a missing
    // hyphen would produce `.fncallout` rather than `.fn-callout`.
    expect(resolveExtensionPrefix("field-notes", "fn")).toBe("fn-");
    expect(resolveExtensionPrefix("field-notes", "fn-")).toBe("fn-");
  });

  test("rejects core's reserved `gp-` prefix", () => {
    // CLAUDE.md §6: `gp-` is core's vocabulary. An extension taking it does
    // not collide with core, it silently overrides it.
    expect(() => resolveExtensionPrefix("x", RESERVED_PREFIX)).toThrow(/reserved/i);
  });

  test("rejects a prefix that is not a CSS identifier", () => {
    expect(() => resolveExtensionPrefix("x", "My Prefix")).toThrow(/not a usable prefix/i);
    expect(() => resolveExtensionPrefix("x", "9lives")).toThrow(/not a usable prefix/i);
  });
});

// ── Both kinds produce a folder #241's own resolver accepts ─────────────────

describe.each([...EXTENSION_KINDS])("scaffoldExtension --kind %s", (kind) => {
  test("writes a folder whose gutterpress.json resolves through extension-manifest.ts", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({
      name: "Field Notes",
      kind,
      parentDir: parent,
      author: "Jane Author",
      description: "A worked example.",
    });

    expect(result.slug).toBe("field-notes");
    expect(result.prefix).toBe("field-notes-");
    expect(result.extensionDir).toBe(path.join(parent, "field-notes"));
    expect(existsSync(result.manifestPath)).toBe(true);
    expect(existsSync(result.openFile)).toBe(true);
    for (const rel of result.files) {
      expect(existsSync(path.join(result.extensionDir, rel))).toBe(true);
    }

    // THE assertion: the real reader, the real containment guard, the real
    // resolver — not a hand-rolled JSON.parse.
    const meta = await readExtensionMeta(result.extensionDir);
    expect(meta.name).toBe("Field Notes");
    expect(meta.author).toBe("Jane Author");
    expect(() => assertExtensionContained(meta)).not.toThrow();

    const resolved = resolveExtension(result.extensionDir, meta, `Extension "${kind}"`);
    expect(resolved.styles?.length).toBeGreaterThan(0);
    expect(resolved.snippets).toBeTruthy();
  });

  test("leaves no unsubstituted placeholder in any file", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "Field Notes", kind, parentDir: parent });
    for (const rel of result.files) {
      const text = await readFile(path.join(result.extensionDir, rel), "utf8");
      expect(text).not.toMatch(/\{\{[A-Z_]+\}\}/);
    }
  });

  test("never overwrites an existing folder", async () => {
    const parent = await tmpParent();
    await mkdir(path.join(parent, "field-notes"), { recursive: true });
    const err = (await scaffoldExtension({
      name: "Field Notes",
      kind,
      parentDir: parent,
    }).catch((e: CreateProjectError) => e)) as CreateProjectError;
    expect(err.code).toBe("target-exists");
  });

  test("a name containing a quote still produces parseable JSON", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({
      name: 'Jane "JJ" Notes',
      kind,
      parentDir: parent,
      author: 'A "quoted" author',
    });
    const meta = JSON.parse(await readFile(result.manifestPath, "utf8"));
    expect(meta.name).toBe('Jane "JJ" Notes');
    expect(meta.author).toBe('A "quoted" author');
  });

  test("the chosen prefix is what the files actually carry", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({
      name: "Field Notes",
      kind,
      parentDir: parent,
      prefix: "fn",
    });
    expect(result.prefix).toBe("fn-");

    const meta = await readExtensionMeta(result.extensionDir);
    const sheets = extensionStyleList(meta);
    const css = (
      await Promise.all(
        sheets.map((rel) => readFile(path.join(result.extensionDir, rel), "utf8")),
      )
    ).join("\n");

    expect(css).toContain("--fn-");
    // The prefix rule the scaffolded README calls load-bearing, asserted on
    // the bytes the author actually gets. Comments are stripped first: the
    // rule is "emit no `gp-` name", not "never mention one" — the theme's
    // page-templates.css legitimately points authors at core's own
    // `.gp-columns-2` in prose.
    const rules = stripCssComments(css);
    expect(rules).not.toMatch(/\.gp-/);
    expect(rules).not.toMatch(/--gp-/);
  });
});

// ── Plugin-specific: it has to LOAD, and its markers have to arrive ─────────

describe("scaffoldExtension --kind plugin", () => {
  test("loads through the real plugin loader with its markers and styles", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "Field Notes", kind: "plugin", parentDir: parent });

    const [loaded] = await loadPlugins([pluginCfg(result.slug)], parent);
    expect(loaded?.name).toBe("Field Notes");
    expect(typeof loaded?.plugin).toBe("function");
    // #240's declarative table has to survive the FOLDER load path, not just
    // a direct `path: …/plugin.js` — see plugins.test.ts's own regression.
    expect(Object.keys(loaded?.markers ?? {})).toEqual(["term-box"]);
    expect(loaded?.styles?.[0]).toBe(path.join(result.extensionDir, "styles", "plugin.css"));
  });

  test("its declarative container and bespoke rule both render", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({
      name: "Field Notes",
      kind: "plugin",
      parentDir: parent,
      prefix: "fn",
    });
    const plugins = await loadPlugins([pluginCfg(result.slug)], parent);
    const md = createMarkdownRenderer(plugins);

    const html = md.render(
      ['@term-box warning label="Heads up"', "", "Defines [[a term]] inline.", "", "@end-term-box"].join("\n"),
    );

    // The declarative half: wrapper tag, base class, variant class, label.
    expect(html).toContain("<aside");
    expect(html).toContain("fn-term-box");
    expect(html).toContain("fn-term-box-warning");
    expect(html).toContain('class="fn-term-box-label"');
    expect(html).toContain("Heads up");
    // The bespoke half.
    expect(html).toContain('<span class="fn-term">a term</span>');
  });

  test("the scaffolded test suite's fixture matches its expected output", async () => {
    // The fixture/expected pair the author runs `bun test` on is generated
    // from the template, so a change to plugin.js that forgets expected.html
    // (or vice versa) fails HERE too, not only in a folder nobody re-runs.
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "Field Notes", kind: "plugin", parentDir: parent });

    const MarkdownIt = (await import("markdown-it")).default;
    const mod = await import(path.join(result.extensionDir, "plugin.js"));
    const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
    md.use(mod.default);

    const fixture = await readFile(path.join(result.extensionDir, "test", "fixture.md"), "utf8");
    const expected = await readFile(path.join(result.extensionDir, "test", "expected.html"), "utf8");
    expect(md.render(fixture)).toBe(expected);
  });
});

// ── Theme-specific: the #233 layered stack ─────────────────────────────────

describe("scaffoldExtension --kind theme", () => {
  test("declares the six layered sheets in cascade order, plus the token surface", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "House Style", kind: "theme", parentDir: parent });
    const meta = await readExtensionMeta(result.extensionDir);

    expect(extensionStyleList(meta)).toEqual([
      "styles/tokens.css",
      "styles/base.css",
      "styles/components.css",
      "styles/page-templates.css",
      "styles/page-rules.css",
      "styles/book.css",
    ]);
    // The Design panel's guided editor reads this.
    expect(meta.tokensFile).toBe("styles/tokens.css");
    expect(meta.components).toBe("components.yaml");
  });

  test("every sheet carries its OWNS / MUST NOT CONTAIN contract header", async () => {
    // #233's actual ask: the rules from contextual-cascade-principle.md moved
    // INTO the files so they travel with the code.
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "House Style", kind: "theme", parentDir: parent });
    const meta = await readExtensionMeta(result.extensionDir);

    for (const rel of extensionStyleList(meta)) {
      const text = await readFile(path.join(result.extensionDir, rel), "utf8");
      expect(text).toContain("OWNS");
      expect(text).toContain("MUST NOT CONTAIN");
    }
  });

  test("declares the layer order once and puts every sheet inside its layer", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "House Style", kind: "theme", parentDir: parent });
    const read = (rel: string) => readFile(path.join(result.extensionDir, rel), "utf8");

    // The order statement lives in the FIRST sheet, because a layer's position
    // is fixed by its first appearance.
    const tokens = await read("styles/tokens.css");
    expect(tokens).toContain("@layer tokens, base, components, templates, pages, book;");

    for (const [rel, layer] of [
      ["styles/tokens.css", "tokens"],
      ["styles/base.css", "base"],
      ["styles/components.css", "components"],
      ["styles/page-templates.css", "templates"],
      ["styles/page-rules.css", "pages"],
      ["styles/book.css", "book"],
    ] as const) {
      expect(await read(rel)).toContain(`@layer ${layer} {`);
    }

    // Only tokens.css declares the order — a second declaration in a later
    // sheet would be a no-op at best and a reordering at worst.
    for (const rel of ["styles/base.css", "styles/components.css", "styles/book.css"]) {
      expect(await read(rel)).not.toContain("@layer tokens, base,");
    }
  });

  test("declares an explicit @page size", async () => {
    // Measured, not assumed: with no `size:` anywhere in a book's CSS,
    // Chromium falls back to US Letter and prints the whole book at the wrong
    // trim with no error. The three built-in themes all declare it; so does
    // this one.
    const parent = await tmpParent();
    const result = await scaffoldExtension({ name: "House Style", kind: "theme", parentDir: parent });
    const pageRules = await readFile(
      path.join(result.extensionDir, "styles", "page-rules.css"),
      "utf8",
    );
    expect(pageRules).toMatch(/@page\s*\{[^}]*\bsize:\s*6in\s+9in\s*;/);
  });

  test("the worked component demonstrates the token pattern end to end", async () => {
    const parent = await tmpParent();
    const result = await scaffoldExtension({
      name: "House Style",
      kind: "theme",
      parentDir: parent,
      prefix: "hs",
    });
    const read = (rel: string) => readFile(path.join(result.extensionDir, rel), "utf8");

    const components = await read("styles/components.css");
    // 1. a :root default, 2. consumed BARE (an inline fallback would be a
    // second copy of the default, free to drift).
    expect(components).toMatch(/--hs-callout-accent:\s*var\(--hs-accent\)/);
    expect(components).toContain("var(--hs-callout-accent)");
    expect(components).not.toMatch(/var\(--hs-callout-accent\s*,/);
    // 3. a scope override, in the last layer.
    expect(await read("styles/book.css")).toMatch(
      /#ch-appendix\s*\{\s*--hs-callout-accent:/,
    );
  });
});

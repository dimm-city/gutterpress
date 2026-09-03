/**
 * {{NAME}} — the plugin's own test suite.
 *
 *   bun install     # once — pulls the single devDependency, markdown-it
 *   bun test
 *
 * Three things are checked, and it is worth knowing which is which.
 *
 * 1. RENDER (fixture.md → expected.html). The bespoke inline rule is an
 *    ordinary markdown-it rule, so a plain markdown-it instance with this
 *    plugin applied renders it exactly as a book would. This is the test that
 *    turns "did I break my plugin" into one command.
 *
 *    There is deliberately no snapshot auto-update here. After an intentional
 *    change, open `expected.html`, make the edit you meant to make, and commit
 *    it — a diff somebody had to read is the point of the file.
 *
 * 2. CONTRACT. The exact export shape Gutterpress's loader requires, and the
 *    existence of every file `gutterpress.json` declares. These catch the
 *    failures that otherwise surface as a blank page in someone else's book.
 *
 * 3. CONVENTIONS. The prefix rules — every class this package emits is its
 *    own, and none is `gp-`. Nothing in Gutterpress enforces this for you;
 *    a collision just silently restyles somebody's book. So it is enforced
 *    here.
 *
 * What this suite deliberately does NOT do: render the `@term-box` container.
 * That container is produced by Gutterpress CORE's marker parser from the
 * `markers` table below — plain markdown-it knows nothing about it, and this
 * package cannot import core (see README.md, "Why you cannot import
 * gutterpress"). So the table's CONTRACT is checked here, and the rendered
 * container is checked by running `gutterpress preview` on a real book.
 */
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import MarkdownIt from "markdown-it";

import plugin, { createTermRule, markers, metadata } from "../plugin.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");

const pkg = JSON.parse(read("gutterpress.json"));
const css = read("styles/plugin.css");
/** The stylesheet's RULES — comments stripped, so a name assertion below
 *  tests what the sheet emits rather than what it talks about. */
const cssRules = css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The prefix every class and custom property this package emits must carry.
 *  Written out here rather than imported from plugin.js on purpose: this is
 *  the independent statement of the convention, so changing the constant in
 *  plugin.js alone makes these tests fail instead of silently agreeing. */
const PREFIX = "{{PREFIX}}";

// ── 1. Render ───────────────────────────────────────────────────────────────

describe("render", () => {
  test("fixture.md renders to expected.html", () => {
    // The same options Gutterpress builds its own renderer with, so what
    // passes here behaves the same way in a real book.
    const md = new MarkdownIt({ html: true, linkify: true, typographer: true });
    md.use(plugin);

    const actual = md.render(read("test/fixture.md"));
    expect(actual).toBe(read("test/expected.html"));
  });

  test("plugin options can override the emitted class", () => {
    const md = new MarkdownIt();
    md.use(plugin, { termClass: "custom-term" });
    expect(md.render("[[x]]")).toContain('class="custom-term"');
  });

  test("the inline rule honours markdown-it's silent mode", () => {
    // A rule that emits tokens while `silent` is true corrupts markdown-it's
    // link/reference probing. Easy to get wrong, invisible until it breaks
    // somebody's footnote.
    const rule = createTermRule("x");
    const pushed = [];
    const state = {
      src: "[[term]]",
      pos: 0,
      posMax: 8,
      push: (...args) => {
        pushed.push(args);
        return { attrSet() {} };
      },
    };
    expect(rule(state, true)).toBe(true);
    expect(pushed).toHaveLength(0);
    expect(state.pos).toBe(8);
  });
});

// ── 2. Contract ─────────────────────────────────────────────────────────────

describe("loader contract", () => {
  test("the default export is a plain (md, options) function", () => {
    // CLAUDE.md §5: a Gutterpress plugin is a plain markdown-it plugin.
    // Nothing else is accepted, and nothing else should be.
    expect(typeof plugin).toBe("function");
    expect(plugin.length).toBeLessThanOrEqual(2);
  });

  test("`markers` is a plain object", () => {
    expect(typeof markers).toBe("object");
    expect(markers).not.toBeNull();
    expect(Array.isArray(markers)).toBe(false);
  });

  test("`metadata` carries a name", () => {
    expect(typeof metadata?.name).toBe("string");
    expect(metadata.name.length).toBeGreaterThan(0);
  });

  test("every path gutterpress.json declares exists", () => {
    const declared = [
      pkg.markdown,
      ...(pkg.styles ?? []),
      ...(pkg.engineStyles?.native ?? []),
      pkg.components,
      pkg.snippets,
      pkg.tokensFile,
    ].filter(Boolean);

    expect(declared.length).toBeGreaterThan(0);
    for (const rel of declared) {
      // Gutterpress refuses to load an extension that reaches outside its own
      // folder, so a `../` here would fail at install time, not here.
      expect(rel.startsWith("/")).toBe(false);
      expect(rel.split(/[\\/]/)).not.toContain("..");
      // `existsSync`, not a read: `snippets` names a DIRECTORY.
      expect(existsSync(path.join(root, rel))).toBe(true);
    }
  });
});

// ── 3. Conventions ──────────────────────────────────────────────────────────

/** Every class name this package declares, from wherever it declares it. */
function declaredClasses() {
  const out = new Set();
  for (const decl of Object.values(markers)) {
    if (typeof decl?.class === "string") {
      for (const c of decl.class.split(/\s+/).filter(Boolean)) out.add(c);
    }
    for (const variant of Object.values(decl?.variants ?? {})) {
      for (const c of String(variant).split(/\s+/).filter(Boolean)) out.add(c);
    }
    if (typeof decl?.label?.class === "string") out.add(decl.label.class);
  }
  return [...out];
}

describe("conventions", () => {
  test("every class the markers declare carries this package's prefix", () => {
    const classes = declaredClasses();
    expect(classes.length).toBeGreaterThan(0);
    for (const c of classes) expect(c.startsWith(PREFIX)).toBe(true);
  });

  test("nothing emits a `gp-` class — that prefix belongs to core", () => {
    for (const c of declaredClasses()) expect(c.startsWith("gp-")).toBe(false);
    // Also catch a `gp-` selector added straight to the stylesheet.
    expect(cssRules).not.toMatch(/\.gp-/);
    expect(cssRules).not.toMatch(/--gp-/);
  });

  test("every declared class has a rule in the stylesheet", () => {
    // A class the plugin emits but never styles is a silent no-op in every
    // book that installs it.
    for (const c of declaredClasses()) {
      expect(cssRules).toContain(`.${c}`);
    }
  });

  test("marker names are valid and do not shadow a core marker", () => {
    // Core's names are claimed during block parsing, before any plugin runs.
    // Declaring one of them is a hard load error — caught here first.
    const core = [
      "chapter", "spread", "page", "section", "continue",
      "page-break", "column-break", "end-section",
    ];
    for (const name of Object.keys(markers)) {
      expect(name).toMatch(/^[a-z][a-z0-9-]*$/);
      expect(name.startsWith("end-")).toBe(false);
      expect(core).not.toContain(name);
    }
  });

  test("marker declarations use only supported fields", () => {
    for (const [name, decl] of Object.entries(markers)) {
      if (decl.deprecated !== undefined || decl.alias !== undefined) continue;
      expect(typeof decl.tag === "undefined" || /^[a-z][a-z0-9-]*$/.test(decl.tag)).toBe(true);
      for (const [variant, cls] of Object.entries(decl.variants ?? {})) {
        expect(typeof cls).toBe("string");
        expect(variant).toMatch(/^\S+$/);
      }
      if (decl.label) {
        // "attr:<name>" is the only supported source today.
        expect(decl.label.from).toMatch(/^attr:[A-Za-z_][A-Za-z0-9_-]*$/);
        expect(typeof decl.label.class).toBe("string");
      }
      for (const at of decl.autoCloseAt ?? []) {
        expect(at).toBe("eof");
      }
      expect(name).toBeTruthy();
    }
  });

  test("every public custom property carries the prefix too", () => {
    // `--x` declared at :root is global. An unprefixed one would collide with
    // the book's own tokens exactly as an unprefixed class would.
    const declaredProps = [...cssRules.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gim)].map((m) => m[1]);
    expect(declaredProps.length).toBeGreaterThan(0);
    for (const prop of declaredProps) {
      expect(prop.startsWith(`--${PREFIX}`)).toBe(true);
    }
  });

  test("the stylesheet keeps all of its rules inside its own cascade layer", () => {
    // An unlayered rule beats every layered one, including this package's
    // own — see the header comment in styles/plugin.css.
    expect(css).toContain("@layer {{SLUG}} {");
    const outside = css.replace(/@layer\s+[\w-]+\s*\{[\s\S]*\}/m, "");
    expect(outside).not.toMatch(/^[^*\/\s][^{}]*\{/m);
  });
});

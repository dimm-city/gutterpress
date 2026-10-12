/**
 * class-catalog — the host's read of an extension's component catalog and the
 * book's stylesheets for the classes an author can write. The YAML fixtures are
 * trimmed copies of two real shapes: gp-dimm-city's catalog (`modifier:` naming
 * a class) and the scaffolded house-style one (variants with recipes).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  collectClassCatalog,
  extractCssClasses,
  parseCatalogClasses,
} from "../../src/routes/api/_lib/class-catalog";

const ext = { kind: "extension" as const, ref: "gp-dimm-city@1.6.2", name: "Dimm City" };

const DC = `
components:
  - name: avoid-split
    status: live
    origin: author
    modifier: dc-avoid-split
    recipe: "@section panel .dc-avoid-split  |  @skill .dc-avoid-split"
    emits: .dc-avoid-split (on the section or skill card it is written on)
    breaks: "break-inside: avoid — the section or card moves to the next page rather than splitting. Sections split by default."
    notes: "Replaces .dc-allow-split on sections."
  - name: snug
    status: live
    origin: author
    modifier: true
    recipe: "@section .dc-snug  /  @page .dc-snug"
    emits: .dc-snug (on the section or page it is written on)
    notes: "Paragraph margins drop so a section that overflows by a line fits. Type size is untouched."
  - name: allow-split
    status: retired
    origin: author
    modifier: dc-allow-split
    recipe: "@skill {.dc-allow-split}"
  - name: chevron
    status: live
    origin: author
    recipe: "# Title {.dc-chevron}  (the chapter-opener h1 gets the same treatment structurally)"
  - name: stat-block
    status: live
    origin: author
    recipe: "raw <div class=\\"dc-stat [dc-flush]\\"> with .dc-stat-head, .dc-stat-grid cells"
    breaks: none
  - name: skill
    status: live
    origin: plugin
    recipe: "@skill [id=…] [{.dc-highlight}] / #### Name | Tier / 1. **N AP** text (0 AP → .free, ranges → .variable)"
    notes: "Declared marker. Every heading is its own card."
  - name: unbuilt
    status: unimplemented
    recipe: "@section .dc-unbuilt"
page_templates:
  - name: opener
    status: stable
    recipe: "@page .dc-opener"
    notes: "Centred opener."
`;

describe("parseCatalogClasses", () => {
  const byClass = (text: string) => new Map(parseCatalogClasses(text, ext).map((e) => [e.class, e]));

  test("a modifier entry names its class, its recipe's markers, a label and a description", () => {
    const c = byClass(DC);
    expect(c.get("dc-avoid-split")).toEqual({
      class: "dc-avoid-split",
      modifier: true,
      appliesTo: ["section", "skill"],
      label: "Avoid split",
      description: "break-inside: avoid — the section or card moves to the next page rather than splitting.",
      source: ext,
    });
  });

  test("`modifier: true` takes the class the entry emits", () => {
    const snug = byClass(DC).get("dc-snug")!;
    expect(snug.modifier).toBe(true);
    expect(snug.appliesTo).toEqual(["section", "page"]);
    expect(snug.description).toBe("Paragraph margins drop so a section that overflows by a line fits.");
  });

  test("retired and unimplemented entries are skipped", () => {
    const c = byClass(DC);
    expect(c.has("dc-allow-split")).toBe(false);
    expect(c.has("dc-unbuilt")).toBe(false);
  });

  test("classes an author types are listed; ones that only describe output are not", () => {
    const c = byClass(DC);
    expect(c.get("dc-chevron")!.modifier).toBeUndefined();
    expect(c.has("dc-highlight")).toBe(true);
    expect(c.has("free")).toBe(false);
    expect(c.has("variable")).toBe(false);
  });

  test("a raw-HTML recipe only counts classes written in braces", () => {
    const c = byClass(DC);
    expect(c.has("dc-stat-head")).toBe(false);
    expect(c.has("dc-stat")).toBe(false);
  });

  test("page templates are read like components", () => {
    expect(byClass(DC).get("dc-opener")!.appliesTo).toEqual(["page"]);
  });

  test("a description that says nothing (none) is dropped", () => {
    expect(byClass(DC).get("dc-stat-head")).toBeUndefined();
    const text = `components:\n  - name: x\n    origin: author\n    recipe: "@section .x-class"\n    breaks: none\n`;
    expect(byClass(text).get("x-class")!.description).toBe("@section .x-class");
  });

  test("variants contribute their recipe's classes (the scaffolded catalog shape)", () => {
    const text = `
components:
  - name: callout
    recipe: "@section .house-style-callout"
    variants:
      - name: warning
        recipe: "@section .house-style-callout .house-style-callout-warning"
`;
    const c = byClass(text);
    expect(c.get("house-style-callout")!.label).toBe("Callout");
    expect(c.get("house-style-callout-warning")!.label).toBe("warning");
    expect([...c.keys()]).toEqual(["house-style-callout", "house-style-callout-warning"]);
  });

  test("a modifier replaces a looser mention of the same class", () => {
    const text = `
components:
  - name: skill
    origin: plugin
    recipe: "@skill .dc-avoid-split"
  - name: avoid-split
    modifier: dc-avoid-split
    recipe: "@skill .dc-avoid-split"
`;
    expect(byClass(text).get("dc-avoid-split")!.modifier).toBe(true);
  });

  test("malformed or empty catalogs list nothing, never throw", () => {
    for (const bad of ["", ":::", "- just\n- a list", "components: nope", "components:\n  - 5\n  - {}\n", "a: [unclosed"]) {
      expect(parseCatalogClasses(bad, ext)).toEqual([]);
    }
  });

  test("the first sentence is capped on one line", () => {
    const long = `components:\n  - name: x\n    origin: author\n    recipe: "@section .x"\n    notes: "${"word ".repeat(60)}end."\n`;
    const d = byClass(long).get("x")!.description!;
    expect(d.length).toBeLessThanOrEqual(140);
    expect(d.endsWith("…")).toBe(true);
  });
});

describe("extractCssClasses", () => {
  test("reads selector classes only: not values, urls, strings, comments or at-rule preludes", () => {
    const css = `
      /* .commented { } */
      .card, section.panel > .title:hover { background: url(art/logo.png); margin: 0.5em; content: ".fake"; }
      @media (min-width: .5in) { .in-media { color: red } }
      @page :first { margin: 1in }
      :is(.a, .b) .c[data-x=".nope"] { width: 1.5in }
      .a { .nested { color: blue } }
      .gp-pin { top: 0 }
    `;
    expect(extractCssClasses(css)).toEqual(["a", "b", "c", "card", "gp-pin", "in-media", "nested", "panel", "title"]);
  });

  test("a stylesheet with no rules, or garbage, gives nothing", () => {
    expect(extractCssClasses("")).toEqual([]);
    expect(extractCssClasses("}}} ;; {{{")).toEqual([]);
  });
});

describe("collectClassCatalog", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  function setup() {
    const root = mkdtempSync(path.join(tmpdir(), "gp-class-catalog-"));
    dirs.push(root);
    const pkg = path.join(root, "plugins", "dc");
    mkdirSync(pkg, { recursive: true });
    writeFileSync(path.join(pkg, "components.yaml"), DC);
    mkdirSync(path.join(root, "styles"), { recursive: true });
    writeFileSync(path.join(root, "styles", "book.css"), ".my-note { color: red } .dc-snug { margin: 0 } .also-off { }");
    writeFileSync(path.join(root, "styles", "off.css"), ".only-inactive { }");
    return { root, pkg };
  }

  function fakeLib(root: string, pkg: string, over: Partial<{ entries: unknown[]; components: string | undefined }> = {}) {
    return {
      listProjectExtensions: async () =>
        over.entries ?? [
          { use: "gp-dimm-city@1.6.2", enabled: true, dir: pkg, label: "Dimm City", carries: { components: true } },
          { use: "off@1.0.0", enabled: false, dir: pkg, label: "Off", carries: { components: true } },
          { use: "plain@1.0.0", enabled: true, dir: pkg, label: "Plain", carries: { components: false } },
          { use: "nodir@1.0.0", enabled: true, label: "Nodir", carries: { components: true } },
        ],
      readExtensionMeta: async () => ({ components: "components" in over ? over.components : "components.yaml" }),
      pathEscapesFolder: (rel: string) => rel.startsWith("..") || path.isAbsolute(rel),
      listProjectStyles: async () => [
        { path: path.join(root, "styles", "book.css"), displayName: "styles/book.css", active: true },
        { path: path.join(root, "styles", "off.css"), displayName: "styles/off.css", active: false },
      ],
    } as never;
  }

  test("extension classes from enabled catalogs, then the book's active stylesheet classes", async () => {
    const { root, pkg } = setup();
    const out = await collectClassCatalog(root, fakeLib(root, pkg));
    const ext = out.filter((e) => e.source.kind === "extension");
    const book = out.filter((e) => e.source.kind === "book");
    expect(ext.map((e) => e.class)).toContain("dc-avoid-split");
    expect(new Set(ext.map((e) => (e.source as { name: string }).name))).toEqual(new Set(["Dimm City"]));
    // the inactive stylesheet and the catalog-documented dc-snug are not repeated as book classes
    expect(book.map((e) => e.class)).toEqual(["also-off", "my-note"]);
    expect(book.every((e) => e.appliesTo.length === 0 && e.description === undefined)).toBe(true);
  });

  test("a catalog path that escapes the extension folder, or is missing, is ignored", async () => {
    const { root, pkg } = setup();
    expect((await collectClassCatalog(root, fakeLib(root, pkg, { components: "../../etc/passwd" }))).filter((e) => e.source.kind === "extension")).toEqual([]);
    expect((await collectClassCatalog(root, fakeLib(root, pkg, { components: "nope.yaml" }))).filter((e) => e.source.kind === "extension")).toEqual([]);
    expect((await collectClassCatalog(root, fakeLib(root, pkg, { components: undefined }))).filter((e) => e.source.kind === "extension")).toEqual([]);
  });

  test("an unreadable stylesheet list leaves the extension classes", async () => {
    const { root, pkg } = setup();
    const lib = { ...(fakeLib(root, pkg) as object), listProjectStyles: async () => { throw new Error("no manifest"); } } as never;
    const out = await collectClassCatalog(root, lib);
    expect(out.some((e) => e.class === "dc-snug")).toBe(true);
    expect(out.some((e) => e.source.kind === "book")).toBe(false);
  });
});

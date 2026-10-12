/**
 * `page` / `chapter` / `section` variants: a plugin's `markers` export may
 * declare the reserved kinds `page`, `chapter` and `section` in a
 * variants-only form, and the bare word after `@page` / `@chapter` /
 * `@section` then selects the variant's class. Core declares two page
 * variants of its own (`blank`, `full-bleed`) and no chapter or section ones.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import markerPlugin, { MARKER_CSS, buildDeclaredMarkerRegistry } from "./markers.js";
import { extract, resolvePage } from "../../engine/shared/gcpm-extract";
import { assembleBookHtml } from "./assemble";

type Env = { layoutWarnings?: Array<{ line: number; type: string; message: string }> };

function render(src: string, markers?: Record<string, unknown>, extra: Array<{ pluginName: string; markers: Record<string, unknown> }> = []) {
  const sources = [...(markers ? [{ pluginName: "dc", markers }] : []), ...extra];
  const md = new MarkdownIt({ html: true });
  md.use(markerPlugin, { declaredMarkers: buildDeclaredMarkerRegistry(sources) });
  const env: Env = {};
  return { html: md.render(src, env), env };
}

const DC = {
  page: { variants: { "chapter-start": "dc-page-chapter-start", intro: "dc-page-intro" } },
  chapter: { variants: { rules: "dc-chapter-rules" } },
  section: { variants: { card: "dc-section-card", npc: "dc-section-npc" } },
};

describe("declaration validation", () => {
  test("a variants-only page/chapter declaration is accepted", () => {
    const reg = buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: DC }]);
    expect(reg.locationVariants.page.get("intro")?.class).toBe("dc-page-intro");
    expect(reg.locationVariants.page.get("intro")?.owner).toBe("dc");
    expect(reg.locationVariants.chapter.get("rules")?.class).toBe("dc-chapter-rules");
    expect(reg.locationVariants.section.get("card")?.class).toBe("dc-section-card");
    // they are not markers: no map entry, no @end- closer
    expect(reg.has("page")).toBe(false);
    expect(reg.has("chapter")).toBe(false);
    expect(reg.has("section")).toBe(false);
  });

  test("label and snippet ride along", () => {
    const reg = buildDeclaredMarkerRegistry([
      { pluginName: "dc", markers: { page: { variants: { intro: "dc-page-intro" }, label: "Dimm City pages", snippet: "snippets/page.md" } } },
    ]);
    const v = reg.locationVariants.page.get("intro");
    expect(v?.label).toBe("Dimm City pages");
    expect(v?.snippet).toBe("snippets/page.md");
  });

  test("core's own page variants are always present", () => {
    const reg = buildDeclaredMarkerRegistry([]);
    expect(reg.locationVariants.page.get("blank")?.class).toBe("gp-page-blank");
    expect(reg.locationVariants.page.get("full-bleed")?.class).toBe("gp-page-full-bleed");
    expect(reg.locationVariants.page.get("blank")?.owner).toBe("Gutterpress");
    expect(reg.locationVariants.chapter.size).toBe(0);
    expect(reg.locationVariants.section.size).toBe(0);
  });

  describe.each(["page", "chapter", "section"])("%s", (kind) => {
    test.each(["section", "tag", "class", "alias", "preset", "validate", "deprecated", "selfClosing", "autoCloseAt"])(
      "any other key (%s) still throws the core-name error",
      (key) => {
        const bad = { [kind]: { variants: { a: "x" }, [key]: key === "validate" ? () => [] : key === "section" || key === "selfClosing" ? true : "x" } };
        expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: bad }])).toThrow(/core Gutterpress marker name/);
      },
    );
  });

  test("a page/chapter declaration without variants is still a core-name collision", () => {
    expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: { chapter: { class: "x" } } }])).toThrow(/core Gutterpress marker name/);
    expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: { page: {} } }])).toThrow(/core Gutterpress marker name/);
    expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: { section: { class: "x" } } }])).toThrow(/core Gutterpress marker name/);
  });

  test("other reserved names stay reserved, variants or not", () => {
    for (const name of ["spread", "continue", "page-break", "column-break", "columns"]) {
      expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: { [name]: { variants: { a: "x" } } } }])).toThrow(/core Gutterpress marker name/);
    }
  });

  test("a duplicate section word across plugins throws, naming both", () => {
    expect(() =>
      buildDeclaredMarkerRegistry([
        { pluginName: "alpha", markers: { section: { variants: { card: "a-card" } } } },
        { pluginName: "beta", markers: { section: { variants: { card: "b-card" } } } },
      ]),
    ).toThrow(/@section variant "card".*"alpha".*"beta"/);
  });

  test("a duplicate word across plugins throws, naming both", () => {
    expect(() =>
      buildDeclaredMarkerRegistry([
        { pluginName: "alpha", markers: { page: { variants: { intro: "a-intro" } } } },
        { pluginName: "beta", markers: { page: { variants: { intro: "b-intro" } } } },
      ]),
    ).toThrow(/"intro".*"alpha".*"beta"/);
  });

  test("a plugin cannot redefine a core page variant", () => {
    expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: { page: { variants: { blank: "dc-blank" } } } }])).toThrow(
      /"blank".*"Gutterpress".*"dc"/,
    );
  });

  test("the same word on page and chapter is two variants, not a duplicate", () => {
    const reg = buildDeclaredMarkerRegistry([
      { pluginName: "dc", markers: { page: { variants: { rules: "dc-page-rules" } }, chapter: { variants: { rules: "dc-chapter-rules" } } } },
    ]);
    expect(reg.locationVariants.page.get("rules")?.class).toBe("dc-page-rules");
    expect(reg.locationVariants.chapter.get("rules")?.class).toBe("dc-chapter-rules");
  });

  test("variants from several plugins merge", () => {
    const reg = buildDeclaredMarkerRegistry([
      { pluginName: "alpha", markers: { page: { variants: { one: "a-one" } } } },
      { pluginName: "beta", markers: { page: { variants: { two: "b-two" } } } },
    ]);
    expect([...reg.locationVariants.page.keys()].sort()).toEqual(["blank", "full-bleed", "one", "two"]);
  });

  test.each([
    [{ variants: ["a"] }, /not a plain object/],
    [{ variants: { "bad word": "x" } }, /invalid word/],
    [{ variants: { ok: "" } }, /non-empty class/],
    [{ variants: { ok: 3 } }, /non-empty class/],
    [{ variants: { ok: "x" }, label: 3 }, /label/],
    [{ variants: { ok: "x" }, snippet: 3 }, /snippet/],
  ])("malformed declaration %#", (decl, message) => {
    expect(() => buildDeclaredMarkerRegistry([{ pluginName: "dc", markers: { page: decl } }])).toThrow(message);
  });
});

describe("@page variant resolution", () => {
  test("a declared variant adds its class and keeps data-page", () => {
    const { html, env } = render("@page intro\n\nHello", DC);
    expect(html).toContain('<div class="page dc-page-intro" data-page="intro">');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("author classes are appended after the variant class", () => {
    const { html } = render("@page chapter-start .wide #p1\n\nHello", DC);
    expect(html).toContain('class="page dc-page-chapter-start wide"');
    expect(html).toContain('data-page="chapter-start"');
  });

  test("the chapter counter class still follows", () => {
    const { html } = render("@chapter ch=3\n\n@page intro\n\nHello", DC);
    expect(html).toContain('class="page dc-page-intro chapter-3"');
  });

  test("a raw class is never rewritten, and is the same as the variant", () => {
    const raw = render("@page .dc-page-chapter-start\n\nHello", DC).html;
    expect(raw).toContain('<div class="page dc-page-chapter-start">');
    expect(raw).not.toContain("data-page");
    const word = render("@page chapter-start\n\nHello", DC).html;
    expect(word).toContain('class="page dc-page-chapter-start"');
  });

  test("no variants declared: output is exactly today's", () => {
    const { html, env } = render("@page cover .hero\n\nHello");
    expect(html).toContain('<div class="page hero" data-page="cover">');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("a free page name is not warned about", () => {
    const { html, env } = render("@page cover\n\nA\n\n@page toc\n\nB\n\n@page gallery\n\nC", DC);
    expect(html).toContain('data-page="cover"');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("a near-miss of a declared variant warns on the unknown_variant channel", () => {
    const { html, env } = render("@page chapter-strat\n\nHello", DC);
    expect(html).toContain('<div class="page" data-page="chapter-strat">');
    const w = (env.layoutWarnings ?? []).filter((x) => x.type === "unknown_variant");
    expect(w).toHaveLength(1);
    expect(w[0]!.line).toBe(1);
    expect(w[0]!.message).toContain('Did you mean "chapter-start"?');
    expect(w[0]!.message).toContain("chapter-start");
  });

  test("a case-only difference warns too", () => {
    const { env } = render("@page Intro\n\nHello", DC);
    expect((env.layoutWarnings ?? []).some((x) => x.type === "unknown_variant" && x.message.includes('"intro"'))).toBe(true);
  });

  test("core variants resolve with no plugin at all", () => {
    const { html } = render("@page blank\n\n@page full-bleed\n\nx");
    expect(html).toContain('<div class="page gp-page-blank" data-page="blank">');
    expect(html).toContain('<div class="page gp-page-full-bleed" data-page="full-bleed">');
  });

  test("Object.prototype names are free page names", () => {
    const { html, env } = render("@page constructor\n\nHello", DC);
    expect(html).toContain('<div class="page" data-page="constructor">');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });
});

describe("@section variant resolution", () => {
  test("a declared variant adds its class and keeps data-section", () => {
    const { html, env } = render("@section card\n\nHello", DC);
    expect(html).toContain('<div class="section dc-section-card" data-section="card">');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("author classes are appended after the variant class", () => {
    const { html } = render("@section npc .wide #s1\n\nHello", DC);
    expect(html).toContain('class="section dc-section-npc wide"');
    expect(html).toContain('data-section="npc"');
  });

  test("the compact and brace spellings agree", () => {
    const a = render("@section card .x\n\nHi", DC).html;
    const b = render("@section card {.x}\n\nHi", DC).html;
    expect(a).toBe(b);
  });

  test("@continue reopens with the variant class again", () => {
    const { html } = render("@section card .x\n\nOne\n\n@continue\n\nTwo", DC);
    expect(html).toContain('class="section dc-section-card x"');
    expect(html).toContain('class="section dc-section-card x gp-continued"');
  });

  test("a raw class is never rewritten, and is the same as the variant", () => {
    const raw = render("@section .dc-section-card\n\nHello", DC).html;
    expect(raw).toContain('<div class="section dc-section-card">');
    expect(raw).not.toContain("data-section");
    expect(render("@section card\n\nHello", DC).html).toContain('class="section dc-section-card"');
  });

  test("no variants declared: output is exactly today's", () => {
    const { html, env } = render("@section sidebar .hero\n\nHello");
    expect(html).toContain('<div class="section hero" data-section="sidebar">');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("a free section name is not warned about", () => {
    const { html, env } = render("@section sidebar\n\nA\n\n@section aside\n\nB\n\n@section constructor\n\nC", DC);
    expect(html).toContain('data-section="constructor"');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("a near-miss of a declared variant warns on the unknown_variant channel", () => {
    const { html, env } = render("@section crad\n\nHello", DC);
    expect(html).toContain('<div class="section" data-section="crad">');
    const w = (env.layoutWarnings ?? []).filter((x) => x.type === "unknown_variant");
    expect(w).toHaveLength(1);
    expect(w[0]!.line).toBe(1);
    expect(w[0]!.message).toContain('Did you mean "card"?');
    expect(w[0]!.message).toContain("@section");
  });

  test("@continue does not warn a second time", () => {
    const { env } = render("@section crad\n\nOne\n\n@continue\n\nTwo", DC);
    expect((env.layoutWarnings ?? []).filter((x) => x.type === "unknown_variant")).toHaveLength(1);
  });

  test("a declared section: true component keeps its own variants", () => {
    const { html } = render("@npc-stat wirephreak\n\nHi", {
      ...DC,
      "npc-stat": { section: true, class: "dc-npc-stat", variants: { wirephreak: "dc-wirephreak" } },
    });
    expect(html).toContain('class="section dc-npc-stat dc-wirephreak"');
    expect(html).toContain('data-npc-stat="wirephreak"');
  });
});

describe("@chapter variant rule", () => {
  test("a declared chapter variant is the variant, not the label", () => {
    const { html } = render("@chapter rules\n\n@page\n\nBody", DC);
    expect(html).toContain('<div class="chapter dc-chapter-rules">');
    expect(html).not.toContain("data-chapter-label");
    expect(html).not.toContain("chapter-opener");
  });

  test("any other word is the label, exactly as before", () => {
    const { html } = render("@chapter C.01\n\n@page\n\nBody", DC);
    expect(html).toContain('<div class="chapter" data-chapter-label="C.01">');
    expect(html).toContain('<div class="chapter-opener" data-chapter-label="C.01">C.01</div>');
  });

  test("author classes follow the variant class; counter class still works", () => {
    const { html } = render("@chapter rules ch=2 .extra\n\n@page\n\nBody", DC);
    expect(html).toContain('class="chapter dc-chapter-rules extra"');
    expect(html).toContain('class="page chapter-2"');
  });

  test("a label with the variant as a raw class keeps both", () => {
    const { html } = render("@chapter C.02 .dc-chapter-rules\n\n@page\n\nBody", DC);
    expect(html).toContain('<div class="chapter dc-chapter-rules" data-chapter-label="C.02">');
  });

  test("without chapter variants a word is always the label", () => {
    const { html } = render("@chapter rules\n\n@page\n\nBody");
    expect(html).toContain('data-chapter-label="rules"');
  });
});

describe("core page variants' CSS", () => {
  // The model, built the way assemble.ts injects the CSS: marker cascade layer
  // first, the book's own stylesheet after it.
  const withBook = (book: string) => extract(`@layer gp.marker, gp.vocab;\n@layer gp.marker {\n${MARKER_CSS}\n}\n${book}`);
  const BOOK = `@page { size: 6in 9in; margin: 0.75in; @top-center { content: "Head"; } @bottom-center { content: counter(page); } }`;

  test("both named pages are in the model, assigned by the variant class", () => {
    const m = withBook("");
    expect(m.pageNames).toContain("gp-page-blank");
    expect(m.pageNames).toContain("gp-page-full-bleed");
    expect(MARKER_CSS).toContain(".page.gp-page-blank { page: gp-page-blank; }");
    expect(MARKER_CSS).toContain(".page.gp-page-full-bleed { page: gp-page-full-bleed; }");
    expect(m.pageAssignments.map((a) => a.page).sort()).toEqual(["gp-page-blank", "gp-page-full-bleed"]);
  });

  test("blank clears every margin box and keeps the geometry", () => {
    const m = withBook(BOOK);
    const base = resolvePage(m, {});
    const blank = resolvePage(m, { name: "gp-page-blank" });
    expect(base.marginBoxes["@top-center"]?.content).toBe('"Head"');
    for (const box of Object.keys(blank.marginBoxes)) expect(blank.marginBoxes[box]?.content).toBe("none");
    expect(Object.keys(blank.marginBoxes)).toHaveLength(16);
    expect(blank.geometry.margin).toEqual(base.geometry.margin);
  });

  test("full-bleed has zero margin, so its content box is the sheet", () => {
    const fb = resolvePage(withBook(BOOK), { name: "gp-page-full-bleed", pseudos: ["left"] });
    expect(fb.geometry.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
    expect(fb.marginBoxes["@top-center"]?.content).toBe("none");
  });

  test("a pseudo-page rule from the book does not re-inset or re-fill a variant page", () => {
    const m = withBook("@page { margin: 0.75in } @page :left { margin-left: 1in; @top-left { content: \"x\" } }");
    const fb = resolvePage(m, { name: "gp-page-full-bleed", pseudos: ["left"] });
    expect(fb.geometry.margin.left).toBe(0);
    expect(fb.marginBoxes["@top-left"]?.content).toBe("none");
    const blank = resolvePage(m, { name: "gp-page-blank", pseudos: ["left"] });
    expect(blank.marginBoxes["@top-left"]?.content).toBe("none");
  });

  test("assembled documents carry the rules and the class", async () => {
    const html = await assembleBookHtml({ files: ["a.md"], readText: async () => "@page blank\n\nx" });
    expect(html).toContain("@page gp-page-blank");
    expect(html).toContain('class="page gp-page-blank"');
  });
});

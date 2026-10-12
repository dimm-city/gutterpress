import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { nameFromSrc, nameSlug } from "./block-names";

/** A plugin that only declares markers: a container, a section marker, a variants-only page word. */
const declaring: LoadedPlugin = {
  name: "p",
  plugin: () => {},
  options: {},
  markers: {
    callout: { tag: "div", class: "dc-alert", variants: { note: "dc-note" }, label: { class: "dc-alert-label", from: "attr:label" } },
    "npc-stat": { section: true, class: "dc-npc-stat", variants: { wirephreak: "dc-wirephreak" } },
    page: { variants: { intro: "dc-page-intro" } },
  },
};

function render(src: string, plugins: LoadedPlugin[] = [declaring]): string {
  return createMarkdownRenderer(plugins).render(src, {});
}

/** The open tags of every element carrying the given class, in order. */
function tagsWith(html: string, cls: string): string[] {
  return (html.match(/<[a-z0-9]+ [^>]*>/g) ?? []).filter((t) => new RegExp(`class="[^"]*\\b${cls}\\b`).test(t));
}

const nameOf = (tag: string): string | null => /\bdata-name="([^"]*)"/.exec(tag)?.[1] ?? null;

describe("nameSlug / nameFromSrc", () => {
  test("lower-case, ASCII-folded, runs of other characters become one hyphen, trimmed", () => {
    expect(nameSlug("  The Café — Ærø & Straße!  ")).toBe("the-cafe-aero-strasse");
    expect(nameSlug("???")).toBe("");
  });

  test("an image name is the basename without extension, percent-decoded, query and folder dropped", () => {
    expect(nameFromSrc("images/chapter-00/founder-house.png")).toBe("founder-house");
    expect(nameFromSrc("./art/Staff%20of%20Many%20Hungry%20Maws.PNG?v=2#x")).toBe("staff-of-many-hungry-maws");
    expect(nameFromSrc("https://example.com/a/b/Hero.v2.jpg")).toBe("hero-v2");
    expect(nameFromSrc("100%.png")).toBe("100");
    expect(nameFromSrc("data:image/png;base64,AAAA")).toBe("");
  });
});

describe("data-name on marker-opened blocks", () => {
  test("a name comes from name=, else label=, else the block's own first heading", () => {
    const html = render(
      "@section name=custom label=\"Ignored Label\"\n## Ignored Heading\n" +
        "@section label=\"Big Box\"\n## Ignored Heading Too\n" +
        "@section\n## The Heading\nText\n"
    );
    expect(tagsWith(html, "section").map(nameOf)).toEqual(["custom", "big-box", "the-heading"]);
  });

  test("a block with no name, label or own heading stays unnamed, and no id is invented", () => {
    const html = render("@page\n@section\nJust text.\n");
    expect(html).not.toContain("data-name");
    expect(html).not.toContain(" id=");
  });

  test("the heading must be the block's OWN: a page does not borrow its section's title", () => {
    const html = render("@page\n@section\n## Sporos\nx\n");
    expect(tagsWith(html, "page").map(nameOf)).toEqual([null]);
    expect(tagsWith(html, "section").map(nameOf)).toEqual(["sporos"]);
    // A heading directly in the page names the page, and the section after it is its own block.
    const both = render("@page\n# Guide\n@section\n## Sporos\nx\n");
    expect(tagsWith(both, "page").map(nameOf)).toEqual(["guide"]);
    expect(tagsWith(both, "section").map(nameOf)).toEqual(["sporos"]);
  });

  test("every kind of block is named: chapter, spread, page (and its variant), section, columns, declared containers and section markers", () => {
    const html = render(
      "@chapter name=ch-a\n@spread name=sp-a\n@page intro\n# Intro Page\n" +
        "@columns 2\n### Two Up\n@end-columns\n" +
        "@callout note label=\"Heads Up\"\nBody\n@end-callout\n" +
        "@npc-stat wirephreak\n#### Hellhound\nStats\n"
    );
    expect(nameOf(tagsWith(html, "chapter")[0]!)).toBe("ch-a");
    expect(nameOf(tagsWith(html, "spread")[0]!)).toBe("sp-a");
    const page = tagsWith(html, "page")[0]!;
    expect(page).toContain("dc-page-intro");
    expect(nameOf(page)).toBe("intro-page");
    expect(nameOf(tagsWith(html, "gp-columns")[0]!)).toBe("two-up");
    expect(nameOf(tagsWith(html, "dc-alert")[0]!)).toBe("heads-up");
    const npc = tagsWith(html, "dc-npc-stat")[0]!;
    expect(npc).toContain('data-npc-stat="wirephreak"');
    expect(nameOf(npc)).toBe("hellhound");
  });

  test("duplicates get -2, -3 in document order; explicit names are reserved and never rewritten", () => {
    const html = render(
      "@section\n## Panel\n@section\n## Panel\n@section name=panel\nx\n@section\n## Panel\n@section\n## Panel\n"
    );
    expect(tagsWith(html, "section").map(nameOf)).toEqual(["panel-2", "panel-3", "panel", "panel-4", "panel-5"]);
  });

  test("a @continue piece keeps its block's data-name, carries gp-continued, and does not repeat the id", () => {
    const html = render("@section #sporos\n## Sporos\nA\n@continue\nB\n@continue\nC\n@end-section\n@section\n## Sporos\nD\n");
    const sections = tagsWith(html, "section");
    expect(sections.map(nameOf)).toEqual(["sporos", "sporos", "sporos", "sporos-2"]);
    expect(sections.map((t) => t.includes("gp-continued"))).toEqual([false, true, true, false]);
    expect(html.match(/id="sporos"/g)).toHaveLength(1);
  });

  test("a declared section marker's continuation also keeps the name", () => {
    const html = render("@npc-stat\n#### Hellhound\nA\n@continue\nB\n@end-npc-stat\n");
    expect(tagsWith(html, "dc-npc-stat").map(nameOf)).toEqual(["hellhound", "hellhound"]);
  });

  test("the editor attributes are still there", () => {
    const html = render("@page #p1\n# Title\nText\n");
    const page = tagsWith(html, "page")[0]!;
    expect(page).toMatch(/ data-source-range="0:1"/);
    expect(page).toContain('id="p1"');
    expect(page).toContain('data-name="title"');
  });
});

describe("data-name on headings", () => {
  test("a heading is named from its own text, with -2, -3 for repeats, and gets no id", () => {
    const html = render("# Hello *World*\n\n## Hello World\n\n### Hello World {name=custom}\n\n#### Hello World\n");
    expect(html).toContain('<h1 data-name="hello-world"');
    expect(html).toContain('<h2 data-name="hello-world-2"');
    expect(html).toContain('<h3 data-name="custom"');
    expect(html).toContain('<h4 data-name="hello-world-3"');
    expect(html).not.toContain(" id=");
    expect(html).not.toContain(' name="');
  });

  test("a heading's name and its section's name do not collide: they are separate namespaces", () => {
    const html = render("@section\n## Sporos\n");
    expect(nameOf(tagsWith(html, "section")[0]!)).toBe("sporos");
    expect(html).toContain('<h2 data-name="sporos"');
  });

  test("an explicit {#id} stays and is not turned into a name", () => {
    const html = render("## Sporos {#sporos-heading}\n");
    expect(html).toContain('id="sporos-heading"');
    expect(html).toContain('data-name="sporos"');
  });
});

describe("data-name on images", () => {
  test("from the file basename; an explicit {name=} wins; the same file shares a name", () => {
    const html = render(
      "![a](images/chapter-00/founder-house.png)\n\n![b](images/Hero%20Art.JPG){name=hero .gp-right}\n\n![c](other/founder-house.png)\n"
    );
    const imgs = html.match(/<img [^>]*>/g)!;
    expect(imgs.map(nameOf)).toEqual(["founder-house", "hero", "founder-house"]);
    expect(imgs[1]).toContain('class="gp-right"');
    expect(html).not.toContain(' name="');
  });
});

describe("core keeps the attributes an author writes", () => {
  test("attributes on a table survive (core replaces no table)", () => {
    const html = render("| a | b |\n|---|---|\n| 1 | 2 |\n\n{.stats #roll-table data-name=rolls}\n");
    expect(html).toMatch(/<table [^>]*class="stats"[^>]*id="roll-table"[^>]*data-name="rolls"/);
  });
});

/**
 * `collectPluginContainers` and `collectBlockAttributes` -  what a plugin
 * that WRAPS authored blocks (rather than rewriting them) leaves for the
 * editor to reproduce: the wrappers it opened, anchored to the authored
 * blocks they hold, and the attributes it put on blocks that survived.
 *
 * Renders through the REAL pipeline (`createMarkdownRenderer([plugin])`,
 * G-03) with fixtures shaped like the plugin this exists for: the Dimm City
 * design guide's, which emits hand-built `html_block` tokens carrying NO
 * `token.map`, so a wrapper has no evidence of its own and has to be placed
 * by the blocks around it.
 */
import { describe, test, expect } from "bun:test";
import type MarkdownIt from "markdown-it";
import { createEditorProjection } from "./editor-projection";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";

/** `html_block` the way a real plugin builds one: no map, no meta. */
function htmlToken(state: { Token: new (t: string, g: string, n: number) => { content: string } }, html: string) {
  const token = new state.Token("html_block", "", 0);
  token.content = html;
  return token;
}

/**
 * A wrap-not-rewrite plugin in the shape the design guide is moving to:
 * `@<kind>` marker paragraphs become the HTML `emit[kind]` gives, an `h4`
 * closes the card before it (if one is open) and opens a shell around
 * itself, and `@end-skill` closes the card. Every authored block is pushed
 * through by the same object; the h4 also gains a class and a data attr.
 */
function cardPlugin(emit: Readonly<Record<string, string>> = {}): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.core.ruler.after("layout_transform", "card_fixture", (state) => {
      const out: typeof state.tokens = [];
      let cardOpen = false;
      const closeCard = () => {
        if (!cardOpen) return;
        out.push(htmlToken(state as never, "</div></div>\n") as never);
        cardOpen = false;
      };
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
        const next = state.tokens[i + 1];
        const markerKind =
          tok.type === "paragraph_open" && next?.type === "inline" && /^@[a-z-]+\b/.test(next.content)
            ? next.content.trim().slice(1).split(/\s/)[0]!
            : "";
        if (markerKind === "end-skill") {
          closeCard();
          i += 2;
          continue;
        }
        if (markerKind && emit[markerKind] !== undefined) {
          out.push(htmlToken(state as never, emit[markerKind]!) as never);
          i += 2;
          continue;
        }
        if (tok.type === "heading_open" && tok.tag === "h4") {
          closeCard();
          out.push(htmlToken(state as never, '<div class="dc-skill-card">\n') as never);
          tok.attrJoin("class", "dc-card-tab");
          tok.attrSet("data-tier", "T1");
          out.push(tok, state.tokens[i + 1]!, state.tokens[i + 2]!);
          out.push(htmlToken(state as never, '<div class="dc-card-body">\n') as never);
          cardOpen = true;
          i += 2;
          continue;
        }
        out.push(tok);
      }
      closeCard();
      state.tokens = out;
    });
  };
  return { name: "card-fixture", plugin, options: {} };
}

const project = (source: string, emit?: Readonly<Record<string, string>>) =>
  createEditorProjection(source, {
    sourceVersion: 1,
    md: createMarkdownRenderer([cardPlugin(emit)]),
    trusted: true,
  });

const anchors = (source: string, emit?: Readonly<Record<string, string>>) =>
  project(source, emit).pluginContainers.map((c) => [c.attributes["class"], c.open.text, c.close?.text ?? null]);

/**
 * A `@box` ... `@end-box` macro of the @callout shape: the opening marker
 * paragraph becomes the wrapper's opening tag plus a label span, the closing
 * marker its closing tag, neither carrying a map -  the blocks between are
 * left as the author wrote them.
 */
const boxPlugin: GutterpressPlugin = (md) => {
  md.core.ruler.after("layout_transform", "box", (state) => {
    const out: typeof state.tokens = [];
    for (let i = 0; i < state.tokens.length; i++) {
      const tok = state.tokens[i]!;
      const next = state.tokens[i + 1];
      const text = tok.type === "paragraph_open" && next?.type === "inline" ? next.content.trim() : "";
      if (text === "@box" || text === "@end-box") {
        const html = new state.Token("html_block", "", 0);
        html.content = text === "@box" ? '<div class="box">\n<span class="label">Box</span>\n' : "</div>\n";
        out.push(html);
        i += 2;
        continue;
      }
      out.push(tok);
    }
    state.tokens = out;
  });
};

describe("collectPluginContainers", () => {
  test("liveness: the fixture really replaces the marker with a map-less html_block", () => {
    const md = createMarkdownRenderer([cardPlugin({ skill: '<div class="dc-skill-shell">\n' })]);
    const tokens = md.parse("@skill\n\nBody.\n", {});
    const html = tokens.find((t) => t.type === "html_block");
    expect(html?.content).toContain("dc-skill-shell");
    expect(html?.map).toBeNull();
  });

  test("a wrapper opened by HTML that is nothing but tags begins with the first authored block inside it", () => {
    // The marker line's block would otherwise stand in front of that block
    // and take its place as the wrapper's :first-child.
    expect(anchors("@panel\n\nBody.\n\nMore.\n", { panel: '<div class="dc-panel">\n' })).toEqual([
      ["dc-panel", "Body.", null],
    ]);
  });

  test("a wrapper opened at a heading holds the heading, and the one opened after it does not", () => {
    const source = "#### Gut Sense\n\n> Flavor.\n\n1. **0 AP** Text.\n\n@end-skill\n\nAfter.\n";
    // Both end at the `@end-skill` line's block: that line became the
    // closing tags, and it is the block after the wrappers in the editor.
    expect(anchors(source)).toEqual([
      ["dc-skill-card", "#### Gut Sense", "@end-skill"],
      ["dc-card-body", "> Flavor.", "@end-skill"],
    ]);
  });

  test("a card closed by the next card ends where that card's heading begins", () => {
    const source = "#### One\n\nA.\n\n#### Two\n\nB.\n";
    expect(anchors(source)).toEqual([
      ["dc-skill-card", "#### One", "#### Two"],
      ["dc-card-body", "A.", "#### Two"],
      ["dc-skill-card", "#### Two", null],
      ["dc-card-body", "B.", null],
    ]);
  });

  test("two identical anchors are told apart by offset", () => {
    const source = "#### Same\n\nA.\n\n#### Same\n\nB.\n";
    const containers = project(source).pluginContainers;
    const shells = containers.filter((c) => c.attributes["class"] === "dc-skill-card");
    expect(shells.map((c) => c.open.offset)).toEqual([0, source.indexOf("#### Same", 1)]);
  });

  test("a decorated shell yields its whole open chain and drops what it closed", () => {
    const emitted =
      '<div class="dc-shell" data-break-inside="avoid">\n' +
      '  <div class="dc-tab"><span>Title</span></div>\n' +
      '  <div class="dc-body">\n';
    // `<span>Title</span>` is content, so the shell begins with the marker
    // line's block, which renders it; the body, opened after it, holds only
    // authored blocks.
    expect(anchors("@panel\n\nBody.\n", { panel: emitted })).toEqual([
      ["dc-shell", "@panel", null],
      ["dc-body", "Body.", null],
    ]);
  });

  test("html that closes what it opens wraps nothing, and an empty wrapper is dropped", () => {
    expect(anchors("@toc\n\nBody.\n", { toc: '<nav class="dc-toc"><a href="#a">A</a></nav>\n' })).toEqual([]);
    // Two marker lines with nothing between them are one recovered run whose
    // HTML is the complete, empty box -  the region renders it; there is
    // nothing for a container to hold.
    expect(anchors("@panel\n\n@end-panel\n\nBody.\n", { panel: '<div class="dc-panel">\n', "end-panel": "</div>\n" })).toEqual([]);
  });

  test("an author's own raw HTML block is never a container", () => {
    // It keeps its own evidence, so it is an authored block, not a wrapper.
    expect(anchors('<div class="colophon-grid">\n\nBody.\n\n</div>\n')).toEqual([]);
  });
});

describe("collectBlockAttributes", () => {
  test("attributes a plugin adds to a surviving block travel with the block's own range", () => {
    const source = "Intro.\n\n#### Gut Sense\n\n> Flavor.\n";
    const projection = project(source);
    expect(projection.blockAttributes.map((b) => [source.slice(b.from, b.to).trimEnd(), b.attributes])).toEqual([
      ["#### Gut Sense", { class: "dc-card-tab", "data-tier": "T1" }],
    ]);
  });

  test("the evidence keys source-range adds are not attributes, and a block with none is not listed", () => {
    const projection = createEditorProjection("Plain paragraph.\n\n## Heading\n", { sourceVersion: 1, md: createMarkdownRenderer(), trusted: true });
    expect(projection.blockAttributes).toEqual([]);
  });

  test("an authored attrs trailer is carried too", () => {
    const source = "## Heading {.x #h}\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md: createMarkdownRenderer(), trusted: true });
    expect(projection.blockAttributes).toEqual([{ from: 0, to: source.length, path: "", attributes: { class: "x", id: "h" } }]);
  });

  test("an element inside a block is named by its tag-and-position path from the block, keyed by the block's range", () => {
    const source = "- one\n- two {.deep}\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md: createMarkdownRenderer(), trusted: true });
    expect(projection.blockAttributes).toEqual([{ from: 0, to: source.length, path: "li:nth-of-type(2)", attributes: { class: "deep" } }]);
  });

  test("a table row's attributes reach the editor by the same path markdown-it's HTML nests it under", () => {
    const rowPlugin: GutterpressPlugin = (md) => {
      md.core.ruler.push("tier_rows", (state) => {
        for (const token of state.tokens) {
          if (token.type === "tr_open" && token.level > 0) token.attrSet("data-tier", "hit");
        }
      });
    };
    const source = "| Roll | Outcome |\n| --- | --- |\n| 20 | Crit |\n| 11 | Hit |\n";
    const projection = createEditorProjection(source, {
      sourceVersion: 1,
      md: createMarkdownRenderer([{ name: "rows", plugin: rowPlugin, options: {} }]),
      trusted: true,
    });
    expect(projection.blockAttributes.map((b) => b.path)).toEqual([
      "thead:nth-of-type(1) > tr:nth-of-type(1)",
      "tbody:nth-of-type(1) > tr:nth-of-type(1)",
      "tbody:nth-of-type(1) > tr:nth-of-type(2)",
    ]);
    expect(projection.blockAttributes.every((b) => b.from === 0 && b.to === source.length)).toBe(true);
  });

  test("a tight list's hidden paragraph is no step in the path: the item's nested list is the item's own child", () => {
    const source = "- one\n  - inner {.deep}\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md: createMarkdownRenderer(), trusted: true });
    expect(projection.blockAttributes.map((b) => b.path)).toEqual(["li:nth-of-type(1) > ul:nth-of-type(1) > li:nth-of-type(1)"]);
  });

  test("a consumed run that ends with the plugin's own closing marker line is recovered as the plugin's region", () => {
    // The @outcome shape: the whole macro is one paragraph (no blank lines),
    // whose last line is the plugin's closing marker; the plugin replaces it
    // with generated HTML carrying no map. Only a line that is one of core's
    // own markers counts as a swallowed marker -  and the layout transform
    // lifts those out of a paragraph before any plugin registered after it
    // runs, so a run recovered across such a plugin cannot contain one.
    const ladderPlugin: GutterpressPlugin = (md) => {
      md.core.ruler.after("layout_transform", "ladder", (state) => {
        const out: typeof state.tokens = [];
        for (let i = 0; i < state.tokens.length; i++) {
          const tok = state.tokens[i]!;
          const next = state.tokens[i + 1];
          if (tok.type === "paragraph_open" && next?.type === "inline" && next.content.startsWith("@ladder")) {
            const html = new state.Token("html_block", "", 0);
            html.content = '<div class="ladder">' + next.content.split("\n").length + "</div>\n";
            out.push(html);
            i += 2;
            continue;
          }
          out.push(tok);
        }
        state.tokens = out;
      });
    };
    const md = createMarkdownRenderer([{ name: "ladder", plugin: ladderPlugin, options: {} }]);
    const own = "Intro.\n\n@ladder\n20 | Crit\n1 | Fail\n@end-ladder\n\nAfter.\n";
    const recovered = createEditorProjection(own, { sourceVersion: 1, md, trusted: true });
    expect(recovered.blocks.map((b) => [b.kind, own.slice(b.from, b.to)])).toEqual([["plugin-region", "@ladder\n20 | Crit\n1 | Fail\n@end-ladder\n"]]);
  });

  test("a wrapper opened by plugin HTML that stands in for a marker line begins with that line's block and ends at its closing line's block", () => {
    // The @callout shape: the marker line becomes the wrapper's opening tag
    // plus a label, the closing marker its closing tag; the blocks between
    // are the author's own. In the editor the marker lines are blocks that
    // render the plugin's HTML, so the label sits inside the wrapper.
    const md = createMarkdownRenderer([{ name: "box", plugin: boxPlugin, options: {} }]);
    const source = "@section\n\nIntro.\n\n@box\n\nInside.\n\n@end-box\n\nAfter.\n\n@end-section\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.pluginContainers).toEqual([
      { tag: "div", attributes: { class: "box" }, open: { text: "@box", offset: source.indexOf("@box") }, close: { text: "@end-box", offset: source.indexOf("@end-box") } },
    ]);
    // ...and the marker line itself projects as the region rendering that HTML.
    expect(projection.blocks.filter((b) => b.kind === "plugin-region").map((b) => source.slice(b.from, b.to).trimEnd())).toEqual(["@box", "@end-box"]);
  });

  test("two marker lines in a row are one recovered run and no block of the editor's: their wrappers anchor to the authored blocks around them", () => {
    // `@specialty` immediately followed by `@specialty-art`: each becomes a
    // wrapper's opening tag, both recovered as one run.
    const md = createMarkdownRenderer([{ name: "box", plugin: boxPlugin, options: {} }]);
    const source = "@box\n\n@box\n\nInside.\n\n@end-box\n\n@end-box\n\nAfter.\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.pluginContainers.map((c) => [c.open.text, c.close?.text])).toEqual([
      ["Inside.", "After."],
      ["Inside.", "After."],
    ]);
  });

  test("a wrapper still open at a layout scope's closer ends there, never across the scope's boundary", () => {
    const md = createMarkdownRenderer([{ name: "box", plugin: boxPlugin, options: {} }]);
    // The plugin leaves the wrapper open (no @end-box); the section closes first.
    const source = "@section\n\n@box\n\nInside.\n\n@end-section\n\nAfter.\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.pluginContainers.map((c) => [c.open.text, c.close?.text])).toEqual([["@box", "@end-section"]]);
  });

  test("a plugin's own element inside a block hides the path below it: nothing is guessed under an element the editor cannot name", () => {
    const wrapPlugin: GutterpressPlugin = (md) => {
      md.core.ruler.push("wrap_items", (state) => {
        const out: typeof state.tokens = [];
        for (const token of state.tokens) {
          if (token.type === "list_item_open") {
            out.push(token);
            const open = new state.Token("plugin_box_open", "div", 1);
            open.level = token.level + 1;
            out.push(open);
            continue;
          }
          if (token.type === "list_item_close") {
            const close = new state.Token("plugin_box_close", "div", -1);
            close.level = token.level + 1;
            out.push(close);
          }
          out.push(token);
        }
        state.tokens = out;
      });
    };
    const source = "- one\n\n  para {.deep}\n";
    const projection = createEditorProjection(source, {
      sourceVersion: 1,
      md: createMarkdownRenderer([{ name: "wrap", plugin: wrapPlugin, options: {} }]),
      trusted: true,
    });
    expect(projection.blockAttributes).toEqual([]);
  });
});

describe("collectInlineWrappers", () => {
  /** The roll-the-die shape: a text token split around a phrase, which a token of the plugin's own renders as a span. */
  const rollPlugin: GutterpressPlugin = (md) => {
    md.renderer.rules["roll"] = (tokens, idx) => '<span class="roll">' + md.utils.escapeHtml(tokens[idx]!.content) + "</span>";
    md.core.ruler.push("roll", (state) => {
      for (const token of state.tokens) {
        if (token.type !== "inline" || !token.children) continue;
        const children: typeof token.children = [];
        for (const child of token.children) {
          if (child.type !== "text" || !child.content.includes("ROLL!")) {
            children.push(child);
            continue;
          }
          const [before, after] = child.content.split("ROLL!", 2);
          if (before) children.push(Object.assign(new state.Token("text", "", 0), { content: before }));
          children.push(Object.assign(new state.Token("roll", "span", 0), { content: "ROLL!" }));
          if (after) children.push(Object.assign(new state.Token("text", "", 0), { content: after }));
        }
        token.children = children;
      }
    });
  };

  test("a plugin token that renders as one element around the author's text is named by block, text and element", () => {
    const md = createMarkdownRenderer([{ name: "roll", plugin: rollPlugin, options: {} }]);
    const source = "Plain.\n\nWhen told, ROLL! and **ROLL! again**.\n\n- Item: ROLL!\n";
    const projection = createEditorProjection(source, { sourceVersion: 1, md, trusted: true });
    expect(projection.inlineWrappers.map((w) => [source.slice(w.from, w.to).trimEnd(), w.text, w.tag, w.attributes])).toEqual([
      ["When told, ROLL! and **ROLL! again**.", "ROLL!", "span", { class: "roll" }],
      ["- Item: ROLL!", "ROLL!", "span", { class: "roll" }],
    ]);
  });

  test("markdown-it's own inline elements are not wrappers", () => {
    const projection = createEditorProjection("Some `code` and *em* here.\n", { sourceVersion: 1, md: createMarkdownRenderer(), trusted: true });
    expect(projection.inlineWrappers).toEqual([]);
  });
});

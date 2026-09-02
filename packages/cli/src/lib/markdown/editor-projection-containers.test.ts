/**
 * `collectPluginContainers` — the wrappers a project plugin opens around the
 * blocks that follow its own container marker, and how they are attributed
 * back to that marker.
 *
 * Renders through the REAL pipeline (`createMarkdownRenderer([plugin])`,
 * G-03) with a fixture shaped like the plugin this mechanism exists for: the
 * Dimm City design guide's, which replaces a marker paragraph with hand-built
 * `html_block` tokens carrying NO `token.map` — so the wrapper itself has no
 * source evidence and has to be placed by what surrounds it.
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
 * Replaces `@<kind>` marker paragraphs with the HTML a container plugin
 * emits, chosen per kind by `emit`. Mirrors the design guide's own core rule:
 * one pass over the block token array, survivors pushed through unchanged.
 */
function containerPlugin(emit: Readonly<Record<string, string>>): LoadedPlugin {
  const plugin = (md: MarkdownIt): void => {
    md.core.ruler.after("layout_transform", "container_fixture", (state) => {
      const out: typeof state.tokens = [];
      for (let i = 0; i < state.tokens.length; i++) {
        const tok = state.tokens[i]!;
        const next = state.tokens[i + 1];
        const kind =
          tok.type === "paragraph_open" && next?.type === "inline" && /^@[a-z-]+\b/.test(next.content)
            ? next.content.trim().slice(1).split(/\s/)[0]!
            : "";
        const html = kind ? emit[kind] : undefined;
        if (html === undefined) {
          out.push(tok);
          continue;
        }
        out.push(htmlToken(state as never, html) as never);
        i += 2; // paragraph_open + inline + paragraph_close
      }
      state.tokens = out;
    });
  };
  return { name: "container-fixture", plugin, options: {} };
}

const project = (source: string, emit: Readonly<Record<string, string>>) =>
  createEditorProjection(source, {
    sourceVersion: 1,
    md: createMarkdownRenderer([containerPlugin(emit)]),
    trusted: true,
  }).pluginContainers;

describe("collectPluginContainers", () => {
  test("liveness: the fixture really replaces the marker with a map-less html_block", () => {
    const md = createMarkdownRenderer([containerPlugin({ skill: '<div class="dc-skill-card">\n' })]);
    const tokens = md.parse("@skill\n\nBody.\n", {});
    const html = tokens.find((t) => t.type === "html_block");
    expect(html?.content).toContain("dc-skill-card");
    expect(html?.map).toBeNull();
  });

  test("a wrapper whose class does not name its marker is still attributed, by position", () => {
    // `@skill` emits `dc-skill-card`: nothing in the class says "skill", so
    // only the gap between the mapped tokens around it can place this.
    expect(project("@skill\n\nBody.\n", { skill: '<div class="dc-skill-card">\n' })).toEqual([
      { kind: "skill", wrappers: [{ tag: "div", attributes: { class: "dc-skill-card" } }] },
    ]);
  });

  test("a decorated container yields its whole open chain, outermost first, and drops what it closed", () => {
    const emitted =
      '<div class="dc-skill-card" data-break-inside="avoid">\n' +
      '  <div class="dc-card-tab"><span>Zeal Stitch</span></div>\n' +
      '  <div class="dc-card-body">\n' +
      '    <div class="dc-card-inner">\n';
    expect(project("@skill\n\nBody.\n", { skill: emitted })).toEqual([
      {
        kind: "skill",
        wrappers: [
          { tag: "div", attributes: { class: "dc-skill-card", "data-break-inside": "avoid" } },
          { tag: "div", attributes: { class: "dc-card-body" } },
          { tag: "div", attributes: { class: "dc-card-inner" } },
        ],
      },
    ]);
  });

  test("two markers with no content between them keep the order their plugin emitted them in", () => {
    const containers = project("@specialty\n\n@specialty-intro\n\nBody.\n", {
      specialty: '<div class="dc-specialty proxy">\n',
      "specialty-intro": '<div class="dc-specialty-intro">\n',
    });
    expect(containers.map((c) => [c.kind, c.wrappers[0]!.attributes["class"]])).toEqual([
      ["specialty", "dc-specialty proxy"],
      ["specialty-intro", "dc-specialty-intro"],
    ]);
  });

  test("a marker that wraps nothing does not take the next marker's wrapper", () => {
    // `@toc` emits a self-contained nav, so the only wrapper in this gap is
    // `@card`'s — and its class says so. Without that tie-break the wrapper
    // would be paired with the earlier marker just because it comes first.
    const containers = project("@toc\n\n@card\n\nBody.\n", {
      toc: '<nav class="dc-toc"><a href="#a">A</a></nav>\n',
      card: '<div class="dc-card">\n',
    });
    expect(containers).toEqual([{ kind: "card", wrappers: [{ tag: "div", attributes: { class: "dc-card" } }] }]);
  });

  test("html that closes what it opens wraps nothing, and opens no container", () => {
    expect(project("@toc\n\nBody.\n", { toc: '<nav class="dc-toc"><a href="#a">A</a></nav>\n' })).toEqual([]);
  });

  test("an author's own raw HTML block is never a container", () => {
    // It keeps its own token.map, so it is not in any marker's gap.
    expect(project('<div class="colophon-grid">\n\nBody.\n\n</div>\n', { skill: "<div>\n" })).toEqual([]);
  });

  test("a closing marker opens nothing", () => {
    expect(project("@skill\n\nBody.\n\n@end-skill\n", { skill: '<div class="dc-skill-card">\n' })).toEqual([
      { kind: "skill", wrappers: [{ tag: "div", attributes: { class: "dc-skill-card" } }] },
    ]);
  });
});

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  canEditRichly,
  createDocParser,
  createEditorRenderer,
  isFixpoint,
  normalize,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";
import { mdFilesIn, REPO } from "../support/corpus";
import { semanticHtml } from "../support/semantic-html";

/**
 * THE GO/NO-GO GATE for plugin-using books (the field-guide class).
 *
 * Plugins are central to the product (CLAUDE.md §5): a project plugin adds
 * branded component markers (`@sidebar`, `@callout`, `@stamp`) as plain
 * markdown-it block rules. The document model refused every such token,
 * which put whole chapters of any real book into source mode. This suite
 * proves the generic adoption (`parser.ts` `adoptPluginTokens`) round-trips
 * a REAL-SHAPED plugin — the committed fixture at
 * `docs/fixtures/advanced-book/book`, whose plugin deliberately exercises
 * every source-recovery path (map-carrying tokens, house-convention tokens
 * that carry NOTHING the editor reads and round-trip only via the ranges
 * `plugin-provenance.ts` stamps at registration) plus a token transform
 * that decorates standard tokens.
 *
 * Every property here is one the first-party corpus could never test,
 * because no example book loads a plugin.
 */
const BOOK = join(REPO, "docs", "fixtures", "advanced-book", "book");

/**
 * The editor pipeline WITH the fixture's own plugin — what the app must run.
 *
 * Applied through `createEditorRenderer(plugins)` — the SAME path the app
 * takes (project-renderer, the normalize route) — because that is where
 * `applyPlugins` wraps the plugin's block rules with the line-provenance
 * stamp. A bare `md.use(plugin)` would bypass the stamp and the fixture's
 * house-convention `@callout` tokens would be unrecoverable; that this
 * suite fails under a bypass is exactly the coverage we want.
 */
async function bookRenderer() {
  const mod = await import(join(BOOK, "plugins", "field-markers.js"));
  return createEditorRenderer([
    { name: "field-markers", plugin: mod.default, options: {}, css: mod.css },
  ]);
}

const chapters = mdFilesIn(BOOK).filter((p) => !p.endsWith("06-archive.md"));

describe("plugin round-trip (go/no-go)", () => {
  test("the fixture is present — this gate must not pass vacuously", () => {
    expect(chapters.length).toBeGreaterThanOrEqual(6);
  });

  test("every plugin-using chapter is rich-editable", async () => {
    const md = await bookRenderer();
    for (const file of chapters) {
      const verdict = canEditRichly(md, readFileSync(file, "utf8"));
      expect(`${file.split("/").pop()}: ${verdict.ok ? "ok" : verdict.reason}`).toBe(
        `${file.split("/").pop()}: ok`,
      );
    }
  });

  test("fixpoint holds across the whole book", async () => {
    const md = await bookRenderer();
    for (const file of chapters) {
      const r = isFixpoint(md, readFileSync(file, "utf8"));
      expect({ file: file.split("/").pop(), stable: r.ok }).toEqual({
        file: file.split("/").pop(),
        stable: true,
      });
    }
  });

  test("normalization preserves MEANING: identical rendered HTML", async () => {
    const md = await bookRenderer();
    for (const file of chapters) {
      const text = readFileSync(file, "utf8");
      const before = semanticHtml(md.render(text, {}));
      const after = semanticHtml(md.render(normalize(md, text), {}));
      expect({ file: file.split("/").pop(), same: after === before }).toEqual({
        file: file.split("/").pop(),
        same: true,
      });
    }
  });

  test("plugin marker lines round-trip VERBATIM", async () => {
    const md = await bookRenderer();
    const text = readFileSync(join(BOOK, "02-field-notes.md"), "utf8");
    const out = normalize(md, text);
    for (const line of [
      '@sidebar .gear "Kit check"',
      "@end-sidebar",
      '@callout note "Cross-reference"',
      '@callout warning "Do not"',
      "@end-callout",
      '@stamp "Checked"',
    ]) {
      expect(out).toContain(`\n${line}\n`);
    }
  });

  test("a token transform's decoration NEVER reaches the file", async () => {
    // The plugin adds `.fm-h2` to every h2 at render time. Saving must write
    // back only what the author typed — never `{.fm-h2}`.
    const md = await bookRenderer();
    for (const file of chapters) {
      const out = normalize(md, readFileSync(file, "utf8"));
      expect(out).not.toContain("fm-h2");
    }
    // …while AUTHORED braces on the same node types survive (in the
    // serializer's canonical order: classes first, then id):
    const appendix = normalize(md, readFileSync(join(BOOK, "05-appendix.md"), "utf8"));
    expect(appendix).toContain("{.procedure #radio}");
    expect(appendix).toContain("{.reference #glyphs}");
    expect(appendix).toContain("{.line-numbers}");
  });

  test("an edit INSIDE a plugin block lands in the file as markdown", async () => {
    const md = await bookRenderer();
    const doc = createDocParser(md).parse(
      '@sidebar .gear "Kit check"\n\nCarry a **pencil**.\n\n@end-sidebar\n',
    );
    // The sidebar's paragraph starts at doc(0)→sidebar(0)→paragraph. Append
    // text to it through an ordinary node rebuild, as an editing transaction
    // would produce.
    const sidebar = doc.child(0);
    expect(sidebar.type.name).toBe("gp_plugin_block");
    expect(sidebar.attrs.marker).toBe('@sidebar .gear "Kit check"');
    expect(sidebar.attrs.closeMarker).toBe("@end-sidebar");
    // The block renders with the plugin's own DOM so its shipped CSS applies.
    expect(sidebar.attrs.tag).toBe("aside");
    expect((sidebar.attrs.viewAttrs as Record<string, string>).class).toBe("fm-sidebar gear");
    expect((sidebar.attrs.viewAttrs as Record<string, string>)["data-label"]).toBe("Kit check");

    const out = serializeDoc(doc);
    expect(out).toBe('@sidebar .gear "Kit check"\n\nCarry a **pencil**.\n\n@end-sidebar\n');
  });

  test("NESTED plugin blocks round-trip", async () => {
    const md = await bookRenderer();
    const src =
      '@callout note "Outer"\n\n@sidebar\n\nInner content.\n\n@end-sidebar\n\nAfter.\n\n@end-callout\n';
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    expect(normalize(md, src)).toBe(src);
  });

  test("the @stamp atom keeps its authored line and shows its content", async () => {
    const md = await bookRenderer();
    const doc = createDocParser(md).parse('@stamp "Checked"\n');
    const atom = doc.child(0);
    expect(atom.type.name).toBe("gp_plugin_atom");
    expect(atom.attrs.marker).toBe('@stamp "Checked"');
    expect(atom.attrs.text).toBe("Checked");
    expect(serializeDoc(doc)).toBe('@stamp "Checked"\n');
  });

  test("a block rule's bare tokens (no map, no markup) are adopted via the stamped range", async () => {
    // This exact shape used to FAIL CLOSED — the editor demanded map or
    // markup, which made rich editing depend on how each plugin happened to
    // be written. The provenance stamp recovers the authored line from the
    // range the rule itself consumed, so the bare shape now round-trips.
    const opaque = (m: import("markdown-it")) => {
      m.block.ruler.before("paragraph", "opaque", (state, startLine, _end, silent) => {
        const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
        if (!state.src.slice(pos).startsWith("%%opaque")) return false;
        if (silent) return true;
        state.push("opaque_open", "div", 1);
        state.push("opaque_close", "div", -1);
        state.line = startLine + 1;
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "opaque", plugin: opaque, options: {} }]);
    expect(canEditRichly(md, "%%opaque data=7\n")).toEqual({ ok: true });
    expect(normalize(md, "%%opaque data=7\n")).toBe("%%opaque data=7\n");
    // A one-line open/close pair has ONE authored line; it must adopt as an
    // atom (written once), never as a block whose marker and closeMarker
    // would both claim — and duplicate — the same line.
    const doc = createDocParser(md).parse("%%opaque data=7\n");
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
  });

  test("an AUTO-CLOSED container (no terminator in the source) fails closed", async () => {
    // When a container-style rule hits EOF without its terminator, the close
    // token's consumed range ends on the last CONTENT line. Recovering that
    // as a close marker would write the content line twice. The adoption
    // detects the double attribution and refuses.
    const wrap = (m: import("markdown-it")) => {
      m.block.ruler.before("paragraph", "wrap2", (state, startLine, endLine, silent) => {
        const lineAt = (n: number) =>
          state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]!);
        if (lineAt(startLine).trim() !== "%%%wrap") return false;
        if (silent) return true;
        let next = startLine + 1;
        while (next < endLine && lineAt(next).trim() !== "%%%") next++;
        state.push("wrap2_open", "div", 1);
        state.md.block.tokenize(state, startLine + 1, next);
        state.line = Math.min(next + 1, endLine);
        state.push("wrap2_close", "div", -1);
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "wrap2", plugin: wrap, options: {} }]);
    const verdict = canEditRichly(md, "%%%wrap\n\nDangling content.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("wrap2");
  });

  test("a container-style close (pushed AFTER the rule advanced, carrying nothing) recovers its own line", async () => {
    // markdown-it-container's shape: ONE invocation consumes the whole
    // construct, advances state.line past the terminator, and only then
    // pushes the close token. A per-push line snapshot is off by one here;
    // the per-invocation range is not — its last line IS the terminator.
    const wrap = (m: import("markdown-it")) => {
      m.block.ruler.before("paragraph", "wrap", (state, startLine, endLine, silent) => {
        const lineAt = (n: number) =>
          state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]!);
        if (lineAt(startLine).trim() !== "%%%wrap") return false;
        if (silent) return true;
        let next = startLine + 1;
        while (next < endLine && lineAt(next).trim() !== "%%%") next++;
        state.push("wrap_open", "div", 1);
        state.md.block.tokenize(state, startLine + 1, next);
        state.line = Math.min(next + 1, endLine);
        state.push("wrap_close", "div", -1);
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "wrap", plugin: wrap, options: {} }]);
    const src = "%%%wrap\n\nInside.\n\n%%%\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    expect(normalize(md, src)).toBe(src);
  });

  test("a core-rule token injection (no consumed source) still fails closed", async () => {
    // The stamp is granted only to tokens a BLOCK RULE pushed while
    // consuming lines. A token synthesized in a core rule has no authored
    // source; absorbing it would materialize generated content into the
    // author's file (the chapter-opener bug, generalized). It must refuse.
    const injector = (m: import("markdown-it")) => {
      m.core.ruler.push("inject_opaque", (state) => {
        const t = new state.Token("opaque_thing", "div", 0);
        t.block = true;
        state.tokens.push(t);
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "injector", plugin: injector, options: {} }]);
    const verdict = canEditRichly(md, "Just a paragraph.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("opaque_thing");
  });

  test("the archive file (footnote + reference definition) is REFUSED with its reason", async () => {
    const md = await bookRenderer();
    const verdict = canEditRichly(md, readFileSync(join(BOOK, "06-archive.md"), "utf8"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0);
  });
});

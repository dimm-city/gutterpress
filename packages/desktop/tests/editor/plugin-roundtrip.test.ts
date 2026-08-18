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
 * both source-recovery paths (map-carrying tokens AND markup-only close
 * tokens) plus a token transform that decorates standard tokens.
 *
 * Every property here is one the first-party corpus could never test,
 * because no example book loads a plugin.
 */
const BOOK = join(REPO, "docs", "fixtures", "advanced-book", "book");

/** The editor pipeline WITH the fixture's own plugin — what the app must run. */
async function bookRenderer() {
  const mod = await import(join(BOOK, "plugins", "field-markers.js"));
  const md = createEditorRenderer();
  md.use(mod.default);
  return md;
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

  test("a plugin whose tokens carry NO recoverable source still fails closed", async () => {
    const md = createEditorRenderer();
    md.use((m: import("markdown-it")) => {
      m.block.ruler.before("paragraph", "opaque", (state, startLine, _end, silent) => {
        const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
        if (!state.src.slice(pos).startsWith("%%opaque")) return false;
        if (silent) return true;
        // Deliberately no map, no markup — the authored line is unrecoverable.
        state.push("opaque_open", "div", 1);
        state.push("opaque_close", "div", -1);
        state.line = startLine + 1;
        return true;
      });
    });
    const verdict = canEditRichly(md, "%%opaque\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("opaque_open");
  });

  test("the archive file (footnote + reference definition) is REFUSED with its reason", async () => {
    const md = await bookRenderer();
    const verdict = canEditRichly(md, readFileSync(join(BOOK, "06-archive.md"), "utf8"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0);
  });
});

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

// 06-archive and 08-refused are the book's two DELIBERATE refusals (a
// footnote/reference chapter, and the isolated consumed-to-nothing transform
// marker); each has its own refusal test below.
const chapters = mdFilesIn(BOOK).filter(
  (p) => !p.endsWith("06-archive.md") && !p.endsWith("08-refused.md"),
);

describe("plugin round-trip (go/no-go)", () => {
  test("the fixture is present — this gate must not pass vacuously", () => {
    expect(chapters.length).toBeGreaterThanOrEqual(7);
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

  test("core-rule transform marker lines round-trip VERBATIM", async () => {
    // The consuming transform (field_markers_transform) rewrites all of
    // these at render time; the file must keep the authored lines, once.
    const md = await bookRenderer();
    const text = readFileSync(join(BOOK, "07-transforms.md"), "utf8");
    const out = normalize(md, text);
    for (const line of [
      "@brief",
      "@end-brief",
      '@verdict "Cleared for reprint"',
      "> [!TIP] Weather eye",
      '@track "Ridge count"',
      "@end-track",
    ]) {
      expect(out).toContain(`\n${line}\n`);
      expect(out.split(`\n${line}\n`)).toHaveLength(2);
    }
  });

  test("the 07-transforms transform is LIVE: rendered chrome present, constructs adopted", async () => {
    // Liveness guard for the whole transform coverage: every "never reaches
    // the file" / "round-trips verbatim" assertion in this suite would pass
    // VACUOUSLY if the fixture's core-ruler transform stopped firing (the
    // markers would just be plain paragraphs). So first prove the transform
    // actually rewrites this chapter's render with its wrapper chrome…
    const md = await bookRenderer();
    const text = readFileSync(join(BOOK, "07-transforms.md"), "utf8");
    const html = md.render(text, {});
    for (const cls of ["fm-brief", "fm-verdict", "fm-alert fm-alert-tip", "fm-track"]) {
      expect(html).toContain(cls);
    }
    // …and that the doc model holds each transformed construct as adopted:
    // the @brief/@end-brief pair as ONE styled block (phase 2 — its
    // synthesized class reaches the view so the fixture CSS applies
    // in-editor), and @verdict, the [!TIP] alert, and @track as atoms.
    const doc = createDocParser(md).parse(text);
    let atoms = 0;
    const blocks: Array<Record<string, unknown>> = [];
    doc.descendants((node) => {
      if (node.type.name === "gp_plugin_atom") atoms += 1;
      if (node.type.name === "gp_plugin_block") blocks.push(node.attrs);
      return true;
    });
    expect(atoms).toBe(3);
    expect(blocks.length).toBe(1);
    expect(blocks[0]!.marker).toBe("@brief");
    expect(blocks[0]!.closeMarker).toBe("@end-brief");
    expect((blocks[0]!.viewAttrs as Record<string, string>).class).toBe("fm-brief");
  });

  test("a transform's SYNTHESIZED wrappers never reach the file", async () => {
    // The materialization trap: the html_block wrappers the transform
    // synthesizes must never be written back as authored source. The class
    // names cannot legitimately appear in any chapter; the tag scans are
    // restricted to the transform chapter because 05-appendix contains
    // AUTHORED raw HTML that rightly round-trips.
    const md = await bookRenderer();
    for (const file of chapters) {
      const out = normalize(md, readFileSync(file, "utf8"));
      for (const leak of ["fm-brief", "fm-verdict", "fm-alert", "fm-track"]) {
        expect(out).not.toContain(leak);
      }
    }
    const transforms = normalize(md, readFileSync(join(BOOK, "07-transforms.md"), "utf8"));
    for (const leak of ["<div", "</div>", "<ol"]) {
      expect(transforms).not.toContain(leak);
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

  test("the TRUE alerts shape adopts as ONE atom carrying the whole blockquote", async () => {
    // blockquote_open removed in one hunk, its map-less close removed in a
    // separate later hunk, the interior surviving by reference, the lead
    // inline replaced by a synthesized token — span pairing must merge it
    // all into a single region attributed to the open's construct-spanning
    // map, and the atom must serialize the authored blockquote once.
    const md = await bookRenderer();
    const src = "> [!TIP] Weather eye\n>\n> Watch the ridge.\n";
    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(1);
    const atom = doc.child(0);
    expect(atom.type.name).toBe("gp_plugin_atom");
    expect(atom.attrs.marker).toBe("> [!TIP] Weather eye\n>\n> Watch the ridge.");
    expect(serializeDoc(doc)).toBe(src);
  });

  test("a lazy-continuation TAIL marker adopts via the merged hunk (list map covers it)", async () => {
    // The terminator is absorbed into the last list item — no marker
    // paragraph of its own. The region's range comes from
    // `ordered_list_open.map`, which includes lazily-continued lines, so
    // the atom carries marker, list and tail verbatim.
    const md = await bookRenderer();
    const src = '@track "Ridge count"\n\n1. Pace the line.\n2. Log the posts.\n@end-track\n';
    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
    expect(doc.child(0).attrs.marker).toBe(
      '@track "Ridge count"\n\n1. Pace the line.\n2. Log the posts.\n@end-track',
    );
    expect(normalize(md, src)).toBe(src);
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
    // A token synthesized in a core rule has no authored source; absorbing
    // it would materialize generated content into the author's file (the
    // chapter-opener bug, generalized). The core-rule differ poisons the
    // non-html injection, so the refusal names the plugin RULE the author
    // must fix — not just the token type the library happens to choke on.
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
    if (!verdict.ok) expect(verdict.reason).toContain("inject_opaque");
  });

  test("a COPYING transform fails closed — degradation is refusal, never misattribution", async () => {
    // Rebuilds every survivor as a fresh object (maps preserved). Identity
    // runs out, so no attribution is possible; the file must refuse with
    // the rule named rather than guess which copy is the author's source.
    const copier = (m: import("markdown-it")) => {
      m.core.ruler.push("copy_all", (state) => {
        state.tokens = state.tokens.map((t) => {
          const copy = new state.Token(t.type, t.tag, t.nesting);
          copy.content = t.content;
          copy.map = t.map ? [t.map[0]!, t.map[1]!] : null;
          copy.children = t.children;
          copy.level = t.level;
          copy.block = t.block;
          copy.markup = t.markup;
          return copy;
        });
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "copier", plugin: copier, options: {} }]);
    const verdict = canEditRichly(md, "Plain prose.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("copy_all");
  });

  test("a non-html injection of a MODELED type fails closed — the second door", async () => {
    // An injected `hr` is a token type the schema models, so before the
    // differ it would have been silently absorbed as authored markdown —
    // a `---` line the author never typed, written into the file on save.
    const injector = (m: import("markdown-it")) => {
      m.core.ruler.push("inject_rule", (state) => {
        const t = new state.Token("hr", "hr", 0);
        t.block = true;
        t.markup = "---";
        state.tokens.push(t);
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "ruler", plugin: injector, options: {} }]);
    const verdict = canEditRichly(md, "Plain prose.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("inject_rule");
  });

  test("a MOVING transform (same mapped objects, new place) fails closed", async () => {
    const mover = (m: import("markdown-it")) => {
      m.core.ruler.push("move_last", (state) => {
        const toks = state.tokens;
        state.tokens = [...toks.slice(-3), ...toks.slice(0, -3)];
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "mover", plugin: mover, options: {} }]);
    const verdict = canEditRichly(md, "First.\n\nSecond.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("move_last");
  });

  test("stamped LONE-TAG wrappers are never adopted as HTML wrappers", async () => {
    // The materialization trap: `adoptHtmlWrappers` pairs authored lone-tag
    // html_blocks — if it paired a transform's synthesized `<div>`/`</div>`,
    // the SYNTHESIZED HTML would be written into the file as the marker.
    // The stamped tokens must adopt as verbatim atoms instead.
    const wrapizer = (m: import("markdown-it")) => {
      m.core.ruler.push("wrapize", (state) => {
        const toks = state.tokens;
        const out: (typeof toks)[number][] = [];
        const html = (content: string) => {
          const t = new state.Token("html_block", "", 0);
          t.content = content;
          t.block = true;
          return t;
        };
        const markerAt = (i: number, text: string) =>
          toks[i]?.type === "paragraph_open" &&
          toks[i + 1]?.type === "inline" &&
          toks[i + 1]!.content === text &&
          toks[i + 2]?.type === "paragraph_close";
        for (let i = 0; i < toks.length; i++) {
          if (markerAt(i, "%%note")) {
            out.push(html('<div class="trap-note">\n'));
            i += 2;
            continue;
          }
          if (markerAt(i, "%%end")) {
            out.push(html("</div>\n"));
            i += 2;
            continue;
          }
          out.push(toks[i]!);
        }
        state.tokens = out;
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "wrapizer", plugin: wrapizer, options: {} }]);
    const src = "%%note\n\nInside prose.\n\n%%end\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    const out = normalize(md, src);
    expect(out).toBe(src);
    expect(out).not.toContain("<div");
    expect(out).not.toContain("</div>");
    // Phase 2 pairs the regions into a block — through REGION pairing, whose
    // marker is the authored %%note line. A block minted by adoptHtmlWrappers
    // would carry the synthesized `<div class="trap-note">` as its marker
    // (and write it to the file); that is what stays forbidden.
    const doc = createDocParser(md).parse(src);
    const block = doc.child(0);
    expect(block.type.name).toBe("gp_plugin_block");
    expect(block.attrs.marker).toBe("%%note");
    expect(block.attrs.closeMarker).toBe("%%end");
    expect(String(block.attrs.marker)).not.toContain("<div");
  });

  test("a stamped html_block of MULTIPLE tag lines stays ONE atom — no per-tag copies", async () => {
    // adoptHtmlWrappers' expansion pass splits an authored multi-tag block
    // into one meta-dropping copy per tag. On a stamped block that would
    // shed the stamp and materialize each synthesized tag; the region must
    // collapse to a single verbatim atom instead.
    const panelizer = (m: import("markdown-it")) => {
      m.core.ruler.push("panelize", (state) => {
        const toks = state.tokens;
        const out: (typeof toks)[number][] = [];
        const html = (content: string) => {
          const t = new state.Token("html_block", "", 0);
          t.content = content;
          t.block = true;
          return t;
        };
        const markerAt = (i: number, text: string) =>
          toks[i]?.type === "paragraph_open" &&
          toks[i + 1]?.type === "inline" &&
          toks[i + 1]!.content === text &&
          toks[i + 2]?.type === "paragraph_close";
        for (let i = 0; i < toks.length; i++) {
          if (markerAt(i, "%%panel")) {
            out.push(html('<div class="trap-outer">\n<div class="trap-inner">\n'));
            i += 2;
            continue;
          }
          if (markerAt(i, "%%endpanel")) {
            out.push(html("</div>\n</div>\n"));
            i += 2;
            continue;
          }
          out.push(toks[i]!);
        }
        state.tokens = out;
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "panelizer", plugin: panelizer, options: {} }]);
    const src = "%%panel\n\nBody prose.\n\n%%endpanel\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    expect(normalize(md, src)).toBe(src);
    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(3);
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
    expect(doc.child(0).attrs.marker).toBe("%%panel");
    expect(doc.child(2).type.name).toBe("gp_plugin_atom");
    expect(doc.child(2).attrs.marker).toBe("%%endpanel");
    expect(normalize(md, src)).not.toContain("trap-outer");
  });

  test("the archive file (footnote + reference definition) is REFUSED with its reason", async () => {
    const md = await bookRenderer();
    const verdict = canEditRichly(md, readFileSync(join(BOOK, "06-archive.md"), "utf8"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0);
  });

  test("an ISOLATED consumed-to-nothing marker is REFUSED with the rule named", async () => {
    // 08-refused.md separates `@track` from its list with a surviving
    // paragraph, so the marker's hunk inserts nothing at its own site —
    // its authored line would silently vanish on save. The refusal names
    // the plugin rule the author has to hear about, not a token type.
    const md = await bookRenderer();
    const verdict = canEditRichly(md, readFileSync(join(BOOK, "08-refused.md"), "utf8"));
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("field_markers_transform");
  });
});

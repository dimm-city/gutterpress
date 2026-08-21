import { describe, expect, test } from "bun:test";
import type { Node as PMNode } from "prosemirror-model";
import {
  canEditRichly,
  createDocParser,
  createEditorRenderer,
  normalize,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";
import { planNormalize } from "../../src/lib/editor/normalize-project";

/**
 * Editor-side adoption of CORE-RULE transform provenance.
 *
 * A plugin core rule rewrites the finished token stream — it consumes
 * authored marker lines and synthesizes map-less replacements. The cli
 * differ (`plugin-provenance.ts`, `withCoreRuleProvenance`) stamps
 * recoverable regions `meta.gpCoreHunk` and poisons unattributable ones
 * `meta.gpCorePoison`; this suite proves the editor's side of that
 * contract: stamped regions collapse to ONE verbatim atom
 * (`adoptCoreRegions`), poison refuses rich mode with the rule named
 * (`raiseOnPoison`), `adoptHtmlWrappers` never adopts a synthesized
 * wrapper, and the pure-injection `gp_generated` path — the chapter-opener
 * badge — is byte-for-byte unchanged. Every toy rule below is a plain
 * markdown-it core rule (CLAUDE.md §5) mimicking the real dimm-city shapes:
 * the marker-consuming forward pass and the GFM-alert container split.
 */

type Md = import("markdown-it");
type MdPlugin = (m: Md) => void;

const mdWith = (name: string, plugin: MdPlugin) =>
  createEditorRenderer([{ name, plugin, options: {} }]);

function nodeTypes(doc: PMNode): string[] {
  const out: string[] = [];
  doc.descendants((node) => {
    out.push(node.type.name);
    return true;
  });
  return out;
}

/** The `@lede` shape: consume the 3-token marker paragraph (including its
 *  map-less `paragraph_close`), synthesize one map-less `html_block` whose
 *  content is a lone `<div>` / `</div>` tag line. */
const ledeTransform: MdPlugin = (m) => {
  m.core.ruler.push("t_lede", (state) => {
    const toks = state.tokens;
    const out: typeof toks = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i]!;
      if (tok.type === "paragraph_open" && toks[i + 1]?.type === "inline") {
        const text = toks[i + 1]!.content.trim();
        if (text === "@lede" || text === "@end-lede") {
          const html = new state.Token("html_block", "", 0);
          html.content = text === "@lede" ? '<div class="t-lede">\n' : "</div>\n";
          html.block = true;
          out.push(html);
          i += 2;
          continue;
        }
      }
      out.push(tok);
    }
    state.tokens = out;
    return true;
  });
};

/** The `dc_alerts` shape: `blockquote_open` removed in one place, its
 *  map-less close removed in a separate later place, the interior surviving
 *  by reference, the first `inline` replaced by a synthesized map-less
 *  `inline` with re-parsed children. */
const alertTransform: MdPlugin = (m) => {
  m.core.ruler.push("t_alerts", (state) => {
    const toks = state.tokens;
    const out: typeof toks = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i]!;
      if (
        tok.type === "blockquote_open" &&
        toks[i + 2]?.type === "inline" &&
        toks[i + 2]!.content.startsWith("[!NOTE]")
      ) {
        let depth = 1;
        let close = i;
        while (depth > 0) {
          close++;
          if (toks[close]!.type === "blockquote_open") depth++;
          else if (toks[close]!.type === "blockquote_close") depth--;
        }
        const openHtml = new state.Token("html_block", "", 0);
        openHtml.content = '<div class="t-note">\n';
        openHtml.block = true;
        out.push(openHtml);
        for (let k = i + 1; k < close; k++) {
          if (k === i + 2) {
            const lead = new state.Token("inline", "", 0);
            lead.content = toks[k]!.content.replace(/^\[!NOTE\]\s*/, "");
            const children: (typeof toks)[number][] = [];
            lead.children = children;
            state.md.inline.parse(lead.content, state.md, state.env, children);
            out.push(lead);
            continue;
          }
          out.push(toks[k]!);
        }
        const closeHtml = new state.Token("html_block", "", 0);
        closeHtml.content = "</div>\n";
        closeHtml.block = true;
        out.push(closeHtml);
        i = close;
        continue;
      }
      out.push(tok);
    }
    state.tokens = out;
    return true;
  });
};

describe("core-rule regions adopt as verbatim atoms", () => {
  test("a matched marker pair adopts as ONE styled block wrapping editable content (phase 2)", () => {
    const md = mdWith("lede", ledeTransform);
    const src = "@lede\n\nBody prose here.\n\n@end-lede\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });

    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(1);
    const block = doc.child(0);
    expect(block.type.name).toBe("gp_plugin_block");
    // The AUTHORED lines are the markers — never the synthesized HTML —
    // and the synthesized tag + class carry into the view so the book's
    // own stylesheet applies inside the editor.
    expect(block.attrs.marker).toBe("@lede");
    expect(block.attrs.closeMarker).toBe("@end-lede");
    expect(block.attrs.tag).toBe("div");
    expect(block.attrs.viewAttrs).toEqual({ class: "t-lede" });
    expect(block.childCount).toBe(1);
    expect(block.child(0).type.name).toBe("paragraph");

    // Pairing is view-only: bytes identical to the atom form.
    expect(serializeDoc(doc)).toBe(src);
    expect(normalize(md, normalize(md, src))).toBe(src);
  });

  test("an unmatched open marker fails SOFT to the atom form", () => {
    const md = mdWith("lede", ledeTransform);
    const src = "@lede\n\nBody prose here.\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    const doc = createDocParser(md).parse(src);
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
    expect(doc.child(0).attrs.marker).toBe("@lede");
    expect(serializeDoc(doc)).toBe(src);
  });

  test("an EMPTY marker pair merges into one hunk and stays one verbatim atom", () => {
    // Adjacent consumed paragraphs (no survivor between) are ONE hunk at
    // the differ, so both markers land in a single region — no pair to
    // form, nothing for `block+` to violate, bytes still exact. (The
    // pairing pass's own empty-pair guard is defense in depth for regions
    // that become adjacent some other way; it fails soft to atoms too.)
    const md = mdWith("lede", ledeTransform);
    const src = "@lede\n\n@end-lede\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
    expect(doc.child(0).attrs.marker).toBe("@lede\n\n@end-lede");
    expect(serializeDoc(doc)).toBe(src);
  });

  test("a multi-line region (the alerts shape) becomes ONE atom carrying the whole blockquote", () => {
    const md = mdWith("alerts", alertTransform);
    const src = "Intro.\n\n> [!NOTE] Keep dry\n> Ink runs in rain.\n\nAfter.\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });

    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(3);
    const atom = doc.child(1);
    expect(atom.type.name).toBe("gp_plugin_atom");
    // The whole authored blockquote, verbatim — the span-paired region
    // swallowed the surviving paragraph AND the synthesized inline, so
    // neither is adopted (or judged) on its own.
    expect(atom.attrs.marker).toBe("> [!NOTE] Keep dry\n> Ink runs in rain.");

    const out = normalize(md, src);
    expect(out).toBe(src);
    // Once — an atom that also left the survivors in place would write the
    // blockquote's lines twice.
    expect(out.split("> [!NOTE]").length - 1).toBe(1);
  });

  test("adoptHtmlWrappers never adopts a stamped lone-tag wrapper (no materialized HTML)", () => {
    // Without region adoption the lone `<div class="t-lede">` / `</div>`
    // lines are exactly what `adoptHtmlWrappers` pairs into a
    // `gp_plugin_block` — whose marker would be the SYNTHESIZED HTML, written
    // into the author's file on save. The atoms prove the wrapper pass never
    // touched them.
    const md = mdWith("lede", ledeTransform);
    const src = "@lede\n\nBody prose here.\n\n@end-lede\n";
    const doc = createDocParser(md).parse(src);
    // Phase 2 pairs the regions into a gp_plugin_block — but through region
    // pairing, whose marker is the AUTHORED line. A block built by
    // adoptHtmlWrappers would carry the synthesized `<div class="t-lede">`
    // as its marker, and that is the materialization this test forbids.
    const block = doc.child(0);
    expect(block.type.name).toBe("gp_plugin_block");
    expect(block.attrs.marker).toBe("@lede");
    expect(block.attrs.marker).not.toContain("<div");
    const out = normalize(md, src);
    expect(out).not.toContain("<div");
    expect(out).not.toContain("</div>");
    expect(out).toContain("@lede");
    expect(out).toContain("@end-lede");
  });

  test("a stamped html_block holding several tag lines is neither split nor duplicated", () => {
    // The wrapper pass's expansion step copies a multi-tag-line html_block
    // into one token per line — copies that drop meta, and with it the
    // stamp. The region must collapse to its atom before that step can run.
    const twinTransform: MdPlugin = (m) => {
      m.core.ruler.push("t_twin", (state) => {
        const toks = state.tokens;
        const out: typeof toks = [];
        for (let i = 0; i < toks.length; i++) {
          if (
            toks[i]!.type === "paragraph_open" &&
            toks[i + 1]?.type === "inline" &&
            toks[i + 1]!.content.trim() === "@twin"
          ) {
            const html = new state.Token("html_block", "", 0);
            html.content = '<div class="t-wrap">\n</div>\n';
            html.block = true;
            out.push(html);
            i += 2;
            continue;
          }
          out.push(toks[i]!);
        }
        state.tokens = out;
        return true;
      });
    };
    const md = mdWith("twin", twinTransform);
    const src = "@twin\n\nProse after.\n";
    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(2);
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
    expect(doc.child(0).attrs.marker).toBe("@twin");
    const out = normalize(md, src);
    expect(out).toBe(src);
    expect(out.split("@twin").length - 1).toBe(1);
  });
});

describe("poison refuses rich mode", () => {
  test("a consumed-to-nothing transform names its rule in the refusal", () => {
    const eatTransform: MdPlugin = (m) => {
      m.core.ruler.push("t_eater", (state) => {
        const toks = state.tokens;
        const out: typeof toks = [];
        for (let i = 0; i < toks.length; i++) {
          if (
            toks[i]!.type === "paragraph_open" &&
            toks[i + 1]?.type === "inline" &&
            toks[i + 1]!.content.trim() === "@eat"
          ) {
            i += 2;
            continue;
          }
          out.push(toks[i]!);
        }
        state.tokens = out;
        return true;
      });
    };
    const md = mdWith("eater", eatTransform);
    const verdict = canEditRichly(md, "Before.\n\n@eat\n\nAfter.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      // The poison lands on a surviving neighbor (nothing was inserted);
      // the refusal must still surface, and name the RULE, not a token type.
      expect(verdict.reason).toContain("t_eater");
      expect(verdict.reason).toContain("can't be edited richly");
    }
  });
});

describe("whole-document consumption refuses — an eaten file must not read as empty", () => {
  // A transform that consumes the ENTIRE token stream leaves no surviving
  // token for `gpCorePoison` to sit on; the differ's refusal rides the env
  // orphan channel (`gpCorePoisonOrphan`) instead. Without the facade
  // honoring it, the doc model parsed to an empty document and a save would
  // have wiped the author's bytes.
  const eatEverything: MdPlugin = (m) => {
    m.core.ruler.push("t_eat_everything", (state) => {
      if (state.inlineMode) return;
      state.tokens = [];
      return true;
    });
  };
  const SRC = "@eat-everything\n\nProse the transform swallows.\n";

  test("canEditRichly refuses with the rule named", () => {
    const md = mdWith("eat-everything", eatEverything);
    const verdict = canEditRichly(md, SRC);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.reason).toContain("t_eat_everything");
      expect(verdict.reason).toContain("can't be edited richly");
    }
  });

  test("planNormalize lands the file in refused — bytes untouched", () => {
    const md = mdWith("eat-everything", eatEverything);
    const report = planNormalize([{ path: "ch.md", text: SRC }], md);
    expect(report.changed).toEqual([]);
    expect(report.unchanged).toEqual([]);
    expect(report.refused).toHaveLength(1);
    expect(report.refused[0]!.path).toBe("ch.md");
    expect(report.refused[0]!.reason).toContain("t_eat_everything");
  });

  test("independent backstop: non-blank source with an EMPTY token stream refuses even without the orphan stamp", () => {
    // Registered directly on the instance — NOT through the plugin path —
    // so the cli differ never sees it and no orphan stamp is written. The
    // facade's own "non-blank source, zero tokens" check is the last door.
    const md = createEditorRenderer();
    md.core.ruler.push("raw_eater", (state) => {
      if (state.inlineMode) return;
      state.tokens = [];
      return true;
    });
    const verdict = canEditRichly(md, "Prose.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("consumed this file's entire content");
  });
});

describe("a too-narrow region stamp refuses instead of truncating", () => {
  // Hand-built stamps, registered directly on the instance so the cli
  // differ leaves them untouched: this exercises `adoptCoreRegions`'
  // contiguity check in isolation.
  test("a same-id survivor mapped OUTSIDE the stamped range converts to refusal", () => {
    // Every token of a two-paragraph document carries ONE hunk id whose
    // range covers only the first paragraph's line. Pre-fix, same-id
    // members skipped the map-within-range test entirely, so the region
    // adopted as an atom carrying lines.slice(0, 1) — and "Second." fell
    // out of the file on save.
    const md = createEditorRenderer();
    md.core.ruler.push("hand_stamp", (state) => {
      if (state.inlineMode) return;
      for (const tok of state.tokens) {
        tok.meta = {
          ...(tok.meta as Record<string, unknown> | null),
          gpCoreHunk: { id: 991, range: [0, 1], rule: "hand_stamp" },
        };
      }
      return true;
    });
    const verdict = canEditRichly(md, "First.\n\nSecond.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("hand_stamp");
  });

  test("control: a stamp whose range covers every survivor still adopts as ONE verbatim atom", () => {
    const md = createEditorRenderer();
    md.core.ruler.push("hand_stamp_ok", (state) => {
      if (state.inlineMode) return;
      for (const tok of state.tokens) {
        tok.meta = {
          ...(tok.meta as Record<string, unknown> | null),
          gpCoreHunk: { id: 992, range: [0, 3], rule: "hand_stamp_ok" },
        };
      }
      return true;
    });
    const src = "First.\n\nSecond.\n";
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    const doc = createDocParser(md).parse(src);
    expect(doc.childCount).toBe(1);
    expect(doc.child(0).type.name).toBe("gp_plugin_atom");
    expect(doc.child(0).attrs.marker).toBe("First.\n\nSecond.");
    expect(normalize(md, src)).toBe(src);
  });
});

describe("the gp_generated channel is unchanged", () => {
  test("editor_tag_generated never retags a stamped token", () => {
    const md = mdWith("lede", ledeTransform);
    const tokens = md.parse("@lede\n\nBody prose here.\n\n@end-lede\n", {});
    const stamped = tokens.filter(
      (t) => (t.meta as { gpCoreHunk?: unknown } | null)?.gpCoreHunk != null,
    );
    expect(stamped.length).toBe(2);
    for (const tok of stamped) expect(tok.type).toBe("html_block");
  });

  test("the chapter-opener badge still drops losslessly", () => {
    // An UNstamped map-less html_block — markers.js's injected badge — keeps
    // today's path: shown as gp_generated, serialized to nothing, regenerated
    // from the surviving `@chapter` line on the next render.
    const md = createEditorRenderer();
    const src = '@chapter "C.01" #ch\n\n@page\n\nBody text.\n';
    const doc = createDocParser(md).parse(src);
    expect(nodeTypes(doc)).toContain("gp_generated");
    const out = serializeDoc(doc);
    expect(out).toBe(src);
    expect(out).not.toContain("chapter-opener");
  });

  test("a plugin's pure map-less injection still drops losslessly", () => {
    // A pure injection passes through the differ with NEITHER meta key —
    // its generator source survives, so the gp_generated drop is lossless.
    const badgeInjector: MdPlugin = (m) => {
      m.core.ruler.push("t_badge", (state) => {
        const html = new state.Token("html_block", "", 0);
        html.content = '<span class="t-badge"></span>\n';
        html.block = true;
        state.tokens.push(html);
        return true;
      });
    };
    const md = mdWith("badge", badgeInjector);
    expect(canEditRichly(md, "Text.\n")).toEqual({ ok: true });
    const doc = createDocParser(md).parse("Text.\n");
    expect(nodeTypes(doc)).toContain("gp_generated");
    expect(normalize(md, "Text.\n")).toBe("Text.\n");
  });
});

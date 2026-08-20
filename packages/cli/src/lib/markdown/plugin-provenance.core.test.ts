import { describe, expect, test } from "bun:test";
import type Token from "markdown-it/lib/token.mjs";
import type StateCore from "markdown-it/lib/rules_core/state_core.mjs";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { GP_CORE_POISON_ORPHAN } from "./plugin-provenance";

/**
 * The core-rule transform stamps (`meta.gpCoreHunk` / `meta.gpCorePoison`)
 * — see plugin-provenance.ts. These tests pin the differ's POLICY TABLE:
 * which transform shapes stamp a recoverable region, which poison (fail
 * closed, rule named), and which pass untouched. Every toy rule below is a
 * plain markdown-it core rule (CLAUDE.md §5) mimicking a real published
 * pattern — the marker-consuming forward pass, the GFM-alert container
 * split, decorate-only attr joins.
 */

interface CoreHunkStamp {
  id: number;
  range: [number, number];
  rule: string;
}
interface CorePoisonStamp {
  rule: string;
  reason: string;
}

const hunkOf = (tok: Token): CoreHunkStamp | undefined =>
  (tok.meta as { gpCoreHunk?: CoreHunkStamp } | null)?.gpCoreHunk;
const poisonOf = (tok: Token): CorePoisonStamp | undefined =>
  (tok.meta as { gpCorePoison?: CorePoisonStamp } | null)?.gpCorePoison;

const corePlugin = (name: string, rule: (state: StateCore) => void): LoadedPlugin => ({
  name,
  options: {},
  plugin: (md) => {
    md.core.ruler.push(name, rule);
  },
});

/** The dimm-city `makeToken` shape: a plain object literal, `map: null`. */
const makeHtml = (content: string): Token =>
  ({
    type: "html_block",
    tag: "",
    attrs: null,
    map: null,
    nesting: 0,
    level: 0,
    children: null,
    content,
    markup: "",
    info: "",
    meta: null,
    block: true,
    hidden: false,
  }) as unknown as Token;

const isMarkerPara = (toks: Token[], i: number, marker: string): boolean =>
  toks[i]?.type === "paragraph_open" &&
  toks[i + 1]?.type === "inline" &&
  toks[i + 1]!.content === marker &&
  toks[i + 2]?.type === "paragraph_close";

/** The @lede shape: consume the 3-token marker paragraph, synthesize one wrapper. */
const ledePlugin = corePlugin("toy_lede", (state) => {
  const toks = state.tokens;
  const out: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (isMarkerPara(toks, i, "%lede%")) {
      out.push(makeHtml('<div class="toy-lede">\n'));
      i += 2;
      continue;
    }
    out.push(toks[i]!);
  }
  state.tokens = out;
});

describe("core-rule provenance: stamped regions", () => {
  test("consume-and-replace stamps the wrapper with the marker paragraph's range", () => {
    // The consumed run ends in a map-less paragraph_close; the close-token
    // clause (matching open removed in the same hunk) is what keeps this
    // attributable — the flagship shape the v1 policy could not reach.
    const md = createMarkdownRenderer([ledePlugin]);
    const tokens = md.parse("%lede%\n\nBody prose.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    const stamp = hunkOf(html)!;
    expect(stamp).toBeDefined();
    expect(stamp.range).toEqual([0, 1]);
    expect(stamp.rule).toBe("toy_lede");
    expect(typeof stamp.id).toBe("number");
    // Survivors keep their maps, unstamped; nothing poisons.
    const para = tokens.find((t) => t.type === "paragraph_open")!;
    expect(para.map).toEqual([2, 3]);
    expect(hunkOf(para)).toBeUndefined();
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("a consumed table attributes — nested map-less furniture is covered by the open's map", () => {
    // The field-guide ability-table shape: the plugin consumes a whole
    // markdown table and synthesizes one html_block. markdown-it maps
    // `table_open`/`thead_open`/`tbody_open`/`tr_open` but leaves `map` off
    // `th_open`/`td_open`/cell `inline` — those must be covered by the
    // enclosing matched pair's range, not poisoned as unattributable.
    const tableEater = corePlugin("toy_tableeater", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (let i = 0; i < toks.length; i++) {
        if (toks[i]!.type === "table_open") {
          let j = i;
          while (j < toks.length && toks[j]!.type !== "table_close") j++;
          out.push(makeHtml('<table class="toy-table"></table>\n'));
          i = j;
          continue;
        }
        out.push(toks[i]!);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([tableEater]);
    const tokens = md.parse("Intro.\n\n| A | B |\n| - | - |\n| 1 | 2 |\n\nOutro.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    const stamp = hunkOf(html)!;
    expect(stamp).toBeDefined();
    expect(stamp.range).toEqual([2, 5]);
    expect(stamp.rule).toBe("toy_tableeater");
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("span pairing merges a container split across hunks into ONE region", () => {
    // The dc_alerts shape: blockquote_open replaced in one hunk, the
    // map-less blockquote_close in a separate later hunk, the interior
    // surviving by reference, the first inline replaced by a synthesized
    // map-less inline. One region, attributed to the open's map — the
    // synthesized inline is swallowed, never judged at block position.
    const alertPlugin = corePlugin("toy_alert", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      let inAlert = false;
      let replacedLead = false;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i]!;
        if (
          !inAlert &&
          t.type === "blockquote_open" &&
          toks[i + 2]?.type === "inline" &&
          toks[i + 2]!.content.startsWith("[!TOY]")
        ) {
          out.push(makeHtml('<div class="toy-alert">\n'));
          inAlert = true;
          replacedLead = false;
          continue;
        }
        if (inAlert && !replacedLead && t.type === "inline") {
          const synthesized = new state.Token("inline", "", 0);
          synthesized.content = t.content.slice("[!TOY]".length).trim();
          synthesized.children = [];
          out.push(synthesized);
          replacedLead = true;
          continue;
        }
        if (inAlert && t.type === "blockquote_close") {
          out.push(makeHtml("</div>\n"));
          inAlert = false;
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([alertPlugin]);
    const tokens = md.parse("> [!TOY] Heads up.\n>\n> Second graf.\n", {});
    // Whole stream is the region: wrapper open .. wrapper close inclusive.
    expect(tokens[0]!.type).toBe("html_block");
    expect(tokens[tokens.length - 1]!.type).toBe("html_block");
    const stamps = tokens.map((t) => hunkOf(t));
    expect(stamps.every((s) => s !== undefined)).toBe(true);
    expect(new Set(stamps.map((s) => s!.id)).size).toBe(1);
    for (const s of stamps) {
      expect(s!.range).toEqual([0, 3]);
      expect(s!.rule).toBe("toy_alert");
    }
    // Swallowed survivors keep their real maps beside the stamp.
    const para = tokens.find((t) => t.type === "paragraph_open")!;
    expect(para.map).toEqual([0, 1]);
    // The synthesized inline sits inside the region, stamped, not poisoned.
    const synthesized = tokens.find((t) => t.type === "inline" && t.map === null)!;
    expect(hunkOf(synthesized)).toBeDefined();
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("a hunk inside surviving LAYOUT wrappers stamps — structural markers serialize delim-free", () => {
    // Real books put their transforms inside `@page`/`@section` as a matter
    // of course; the depth guard is for delim-bearing containers
    // (blockquote/list) and unknown plugin containers, not for markers.js's
    // structural family.
    const md = createMarkdownRenderer([ledePlugin]);
    const tokens = md.parse('@chapter "One" #c1\n\n@page\n\n%lede%\n\nBody prose.\n', {});
    const html = tokens.find((t) => t.type === "html_block" && t.content.includes("toy-lede"))!;
    const stamp = hunkOf(html)!;
    expect(stamp).toBeDefined();
    expect(stamp.range).toEqual([4, 5]);
    expect(stamp.rule).toBe("toy_lede");
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("chained rules attribute through the stamp (stamp ≡ map) and re-stamp", () => {
    const chainPlugin = corePlugin("toy_chain", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (const t of toks) {
        if (t.type === "html_block" && t.content.includes("toy-lede")) {
          out.push(makeHtml('<div class="toy-lede chained">\n'));
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([ledePlugin, chainPlugin]);
    const tokens = md.parse("%lede%\n\nBody prose.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    expect(html.content).toContain("chained");
    const stamp = hunkOf(html)!;
    expect(stamp.rule).toBe("toy_chain");
    expect(stamp.range).toEqual([0, 1]);
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("a frozen meta on a swallowed survivor degrades to a missing stamp, not a throw", () => {
    const freezer = corePlugin("toy_freezer", (state) => {
      const opens = state.tokens.filter((t) => t.type === "paragraph_open");
      if (opens[1]) opens[1].meta = Object.freeze({ theirs: true });
    });
    const alertish = corePlugin("toy_alertish", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (const t of toks) {
        if (t.type === "blockquote_open") {
          out.push(makeHtml("<div>\n"));
          continue;
        }
        if (t.type === "blockquote_close") {
          out.push(makeHtml("</div>\n"));
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([freezer, alertish]);
    const tokens = md.parse("> First graf.\n>\n> Second graf.\n", {});
    const frozen = tokens.filter((t) => t.type === "paragraph_open")[1]!;
    expect((frozen.meta as { theirs: boolean }).theirs).toBe(true);
    expect(hunkOf(frozen)).toBeUndefined();
    // The rest of the region still stamped — the gap fails closed downstream.
    expect(hunkOf(tokens[0]!)).toBeDefined();
  });
});

describe("core-rule provenance: poison (fail closed, rule named)", () => {
  test("overlap guard: a range covering surviving content poisons, never double-writes", () => {
    // Only the open is replaced; interior and close survive. The open's map
    // spans the survivors' lines, so a stamp would serialize them twice.
    const openOnly = corePlugin("toy_openonly", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (const t of toks) {
        if (t.type === "blockquote_open") {
          out.push(makeHtml("<div>\n"));
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([openOnly]);
    const tokens = md.parse("> Quoted line.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    const poison = poisonOf(html)!;
    expect(poison.rule).toBe("toy_openonly");
    expect(poison.reason).toMatch(/overlap/i);
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("depth guard: a hunk inside a surviving container poisons", () => {
    // The surviving container is MAP-LESS (a marker-style block rule), so
    // the overlap guard cannot see it — the depth guard is what refuses.
    const boxPlugin: LoadedPlugin = {
      name: "box",
      options: {},
      plugin: (md) => {
        md.block.ruler.before("paragraph", "box", (state, startLine, _end, silent) => {
          const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
          const line = state.src.slice(pos, state.eMarks[startLine]!);
          if (!line.startsWith("%box")) return false;
          if (silent) return true;
          const close = line.startsWith("%box-end");
          state.push(close ? "box_close" : "box_open", "div", close ? -1 : 1);
          state.line = startLine + 1;
          return true;
        });
      },
    };
    const insidePlugin = corePlugin("toy_inside", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      let depth = 0;
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i]!;
        if (t.type === "box_open") depth++;
        if (t.type === "box_close") depth--;
        if (depth > 0 && t.type === "paragraph_open" && toks[i + 2]?.type === "paragraph_close") {
          out.push(makeHtml("<p>rewritten</p>\n"));
          i += 2;
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([boxPlugin, insidePlugin]);
    const tokens = md.parse("%box\n\nInner para.\n\n%box-end\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    const poison = poisonOf(html)!;
    expect(poison.rule).toBe("toy_inside");
    expect(poison.reason).toMatch(/container/i);
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("isolated consumed-to-nothing poisons the nearest survivor", () => {
    // Registered via the `after` anchor form — interception covers all four
    // registration methods, not just push.
    const eraser: LoadedPlugin = {
      name: "eraser",
      options: {},
      plugin: (md) => {
        md.core.ruler.after("block", "toy_eraser", (state) => {
          const toks = state.tokens;
          const out: Token[] = [];
          for (let i = 0; i < toks.length; i++) {
            if (isMarkerPara(toks, i, "%gone%")) {
              i += 2;
              continue;
            }
            out.push(toks[i]!);
          }
          state.tokens = out;
        });
      },
    };
    const md = createMarkdownRenderer([eraser]);
    const tokens = md.parse("Alpha.\n\n%gone%\n\nOmega.\n", {});
    expect(tokens.some((t) => t.type === "inline" && t.content === "%gone%")).toBe(false);
    const omegaOpen = tokens.filter((t) => t.type === "paragraph_open")[1]!;
    const poison = poisonOf(omegaOpen)!;
    expect(poison.rule).toBe("toy_eraser");
    expect(poison.reason).toMatch(/no replacement/i);
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("a non-html injection poisons — it would be absorbed as authored markdown", () => {
    const badInjector = corePlugin("toy_badinject", (state) => {
      const t = new state.Token("hr", "hr", 0);
      t.block = true;
      state.tokens.push(t);
    });
    const md = createMarkdownRenderer([badInjector]);
    const tokens = md.parse("Prose.\n", {});
    const hr = tokens.find((t) => t.type === "hr")!;
    const poison = poisonOf(hr)!;
    expect(poison.rule).toBe("toy_badinject");
    expect(poison.reason).toMatch(/absorbed/i);
  });

  test("a mapped insertion poisons — authored source that moved or was copied", () => {
    const mapCopier = corePlugin("toy_mapcopy", (state) => {
      const t = new state.Token("html_block", "", 0);
      t.content = "<aside></aside>\n";
      t.block = true;
      t.map = [0, 1];
      state.tokens.push(t);
    });
    const md = createMarkdownRenderer([mapCopier]);
    const tokens = md.parse("Prose.\n", {});
    const aside = tokens.find((t) => t.type === "html_block")!;
    const poison = poisonOf(aside)!;
    expect(poison.rule).toBe("toy_mapcopy");
    expect(poison.reason).toMatch(/authored source/i);
  });

  test("a moving transform poisons the invocation", () => {
    const mover = corePlugin("toy_mover", (state) => {
      const toks = state.tokens;
      state.tokens = [...toks.slice(-3), ...toks.slice(0, -3)];
    });
    const md = createMarkdownRenderer([mover]);
    const tokens = md.parse("First.\n\nSecond.\n", {});
    const poisoned = tokens.filter((t) => poisonOf(t));
    expect(poisoned.length).toBeGreaterThan(0);
    for (const t of poisoned) {
      expect(poisonOf(t)!.rule).toBe("toy_mover");
      expect(poisonOf(t)!.reason).toMatch(/reordered/i);
    }
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("a copying transform poisons — degradation is fail-closed, never misattribution", () => {
    // Rebuilds every survivor as a fresh object (maps preserved): identity
    // runs out, the whole document becomes one hunk, and its inline copies
    // trip the type guard. Nothing may be stamped.
    const copier = corePlugin("toy_copier", (state) => {
      state.tokens = state.tokens.map((t) => {
        const copy = new state.Token(t.type, t.tag, t.nesting);
        copy.content = t.content;
        copy.map = t.map ? [t.map[0], t.map[1]] : null;
        copy.children = t.children;
        copy.level = t.level;
        copy.block = t.block;
        copy.markup = t.markup;
        return copy;
      });
    });
    const md = createMarkdownRenderer([copier]);
    const tokens = md.parse("Copied prose.\n", {});
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
    const poisoned = tokens.filter((t) => poisonOf(t));
    expect(poisoned.length).toBeGreaterThan(0);
    expect(poisonOf(poisoned[0]!)!.rule).toBe("toy_copier");
  });
});

describe("core-rule provenance: morphs and non-events", () => {
  test("a children-reference-only mutation is a morph and is judged, not ignored", () => {
    const childSwapper = corePlugin("toy_childswap", (state) => {
      const t = state.tokens.find((x) => x.type === "inline");
      if (t?.children) t.children = t.children.slice();
    });
    const md = createMarkdownRenderer([childSwapper]);
    const tokens = md.parse("Some prose.\n", {});
    // The morphed inline sits inside its surviving paragraph — fail closed.
    const inline = tokens.find((t) => t.type === "inline")!;
    const poison = poisonOf(inline)!;
    expect(poison.rule).toBe("toy_childswap");
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("an attrs-only mutation is NOT a morph — decorate rules stay invisible", () => {
    const decorator = corePlugin("toy_attrs", (state) => {
      for (const t of state.tokens) {
        if (t.type === "heading_open") t.attrJoin("class", "toy-decorated");
      }
    });
    const md = createMarkdownRenderer([decorator]);
    const tokens = md.parse("# Title\n\nProse.\n", {});
    expect(tokens.every((t) => !hunkOf(t) && !poisonOf(t))).toBe(true);
  });

  test("a pure map-less html_block injection stays unstamped — the gp_generated path", () => {
    const injector = corePlugin("toy_inject", (state) => {
      state.tokens.push(makeHtml('<hr class="toy">\n'));
    });
    const md = createMarkdownRenderer([injector]);
    const tokens = md.parse("Prose.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    expect(hunkOf(html)).toBeUndefined();
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("an in-place child.content mutation is a morph and is judged, not ignored", () => {
    // The markdown-it `replacements` pattern: mutate child token content IN
    // PLACE, never replacing the children array or touching the parent
    // inline token. The array REFERENCE alone cannot see this — the deep
    // child signature is what turns it into a morph hunk, which the policy
    // then poisons (the morphed inline sits inside its surviving paragraph).
    const arrows = corePlugin("toy_arrows", (state) => {
      for (const tok of state.tokens) {
        if (tok.type !== "inline" || !tok.children) continue;
        for (const child of tok.children) {
          if (child.type === "text") child.content = child.content.replace(/->/g, "→");
        }
      }
    });
    const md = createMarkdownRenderer([arrows]);
    const tokens = md.parse("A -> B\n", {});
    const inline = tokens.find((t) => t.type === "inline")!;
    const poison = poisonOf(inline)!;
    expect(poison).toBeDefined();
    expect(poison.rule).toBe("toy_arrows");
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("a NESTED in-place child mutation (image alt text) is caught by the recursive signature", () => {
    // Image alt tokens live in `image.children`, one level below the
    // inline's own children — only the recursion sees this edit.
    const deepMutator = corePlugin("toy_deepmutate", (state) => {
      const walk = (children: Token[]): void => {
        for (const child of children) {
          if (child.type === "text") child.content = child.content.toUpperCase();
          if (child.children) walk(child.children);
        }
      };
      for (const tok of state.tokens) {
        if (tok.type !== "inline" || !tok.children) continue;
        for (const child of tok.children) {
          // Deliberately skip the top level: mutate only nested children.
          if (child.children) walk(child.children);
        }
      }
    });
    const md = createMarkdownRenderer([deepMutator]);
    const tokens = md.parse("![alt text](img.png)\n", {});
    const inline = tokens.find((t) => t.type === "inline")!;
    const poison = poisonOf(inline)!;
    expect(poison).toBeDefined();
    expect(poison.rule).toBe("toy_deepmutate");
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("base and host core rules are never wrapped — the badge path is unchanged", () => {
    // markers.js's layout_transform injects the chapter-opener badge as a
    // map-less html_block BEFORE plugin rules run; it must gain no stamp and
    // no poison from a plugin rule passing it through by reference.
    const md = createMarkdownRenderer([ledePlugin]);
    const tokens = md.parse("@chapter One\n\nProse.\n", {});
    expect(tokens.length).toBeGreaterThan(0);
    expect(tokens.every((t) => !hunkOf(t) && !poisonOf(t))).toBe(true);
  });
});

/**
 * Replaces the FIRST blockquote_open and the LAST blockquote_close it sees.
 * On one blockquote that is the legal alerts shape (same construct, split
 * hunks); on two it pairs quote 1's open with quote 2's close — a
 * cross-construct pairing whose region would swallow (and delete on save)
 * everything between the two constructs.
 */
const crossPairPlugin = corePlugin("toy_crosspair", (state) => {
  const toks = state.tokens;
  const firstOpen = toks.findIndex((t) => t.type === "blockquote_open");
  let lastClose = -1;
  for (let i = 0; i < toks.length; i++) {
    if (toks[i]!.type === "blockquote_close") lastClose = i;
  }
  if (firstOpen < 0 || lastClose <= firstOpen) return;
  const out: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (i === firstOpen) {
      out.push(makeHtml('<div class="toy-cross">\n'));
      continue;
    }
    if (i === lastClose) {
      out.push(makeHtml("</div>\n"));
      continue;
    }
    out.push(toks[i]!);
  }
  state.tokens = out;
});

describe("core-rule provenance: cross-construct pairing (region containment guard)", () => {
  test("an open paired with a DIFFERENT construct's close poisons — never swallows the between", () => {
    // Two blockquotes with an authored paragraph between them. Stack
    // pairing matches quote 1's removed open to quote 2's removed close;
    // the region's range comes from quote 1's map only, so the middle
    // paragraph and all of quote 2 (maps outside that range) would be
    // deleted on save if the region stamped. The containment guard must
    // poison instead.
    const md = createMarkdownRenderer([crossPairPlugin]);
    const tokens = md.parse(
      "> Alpha quote.\n\nMiddle paragraph.\n\n> Omega quote.\n\nTail.\n",
      {},
    );
    const poisoned = tokens.filter((t) => poisonOf(t));
    expect(poisoned.length).toBeGreaterThan(0);
    for (const t of poisoned) {
      expect(poisonOf(t)!.rule).toBe("toy_crosspair");
      expect(poisonOf(t)!.reason).toMatch(/outside/i);
    }
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });

  test("control: the SAME rule on one blockquote is the legal alerts shape and still stamps", () => {
    const md = createMarkdownRenderer([crossPairPlugin]);
    const tokens = md.parse("> Solo quote.\n>\n> More of it.\n", {});
    // Whole stream is the region: wrapper open .. wrapper close inclusive.
    const stamps = tokens.map((t) => hunkOf(t));
    expect(stamps.every((s) => s !== undefined)).toBe(true);
    expect(new Set(stamps.map((s) => s!.id)).size).toBe(1);
    for (const s of stamps) expect(s!.range).toEqual([0, 3]);
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });
});

describe("core-rule provenance: poison is sticky (no laundering)", () => {
  test("a later rule consuming a poison-carrying token re-poisons naming the FIRST rule", () => {
    // Rule 1 consumes `%gone%` to nothing — poison parks on the nearest
    // surviving neighbor, `%wrapme%`'s paragraph_open. Rule 2 then replaces
    // that very paragraph with a synthesized wrapper (the blessed @lede
    // shape). Without the laundering guard the poisoned token leaves the
    // stream, the wrapper gets stamped, and the refusal — plus the
    // `%gone%` lines — silently evaporates.
    const gone = corePlugin("toy_gone", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (let i = 0; i < toks.length; i++) {
        if (isMarkerPara(toks, i, "%gone%")) {
          i += 2;
          continue;
        }
        out.push(toks[i]!);
      }
      state.tokens = out;
    });
    const wrap = corePlugin("toy_wrap", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (let i = 0; i < toks.length; i++) {
        if (isMarkerPara(toks, i, "%wrapme%")) {
          out.push(makeHtml('<div class="toy-wrap">\n'));
          i += 2;
          continue;
        }
        out.push(toks[i]!);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([gone, wrap]);
    const tokens = md.parse("Alpha.\n\n%gone%\n\n%wrapme%\n\nOmega.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    expect(html).toBeDefined();
    // The wrapper carries the ORIGINAL refusal, not a fresh stamp.
    const poison = poisonOf(html)!;
    expect(poison).toBeDefined();
    expect(poison.rule).toBe("toy_gone");
    expect(poison.reason).toMatch(/no replacement/i);
    expect(hunkOf(html)).toBeUndefined();
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });
});

/** Splits one `%pair%` marker paragraph into TWO stamped sibling wrappers. */
const splitPlugin = corePlugin("toy_split", (state) => {
  const toks = state.tokens;
  const out: Token[] = [];
  for (let i = 0; i < toks.length; i++) {
    if (isMarkerPara(toks, i, "%pair%")) {
      out.push(makeHtml('<div class="pair-a">\n'));
      out.push(makeHtml('<div class="pair-b">\n'));
      i += 2;
      continue;
    }
    out.push(toks[i]!);
  }
  state.tokens = out;
});

describe("core-rule provenance: overlap guard sees stamped map-less survivors", () => {
  test("a chained rule consuming a strict SUBSET of a stamped region poisons", () => {
    // Rule 1 stamps two siblings with one region (range [0,1)). Rule 2
    // consumes only the first — its replacement's range comes from the
    // stamp, and the SURVIVING stamped sibling still serializes those same
    // lines. Two regions over one line range would duplicate the authored
    // content on save; the guard must read tokenRange (map OR stamp), not
    // token.map alone.
    const subsetEater = corePlugin("toy_subset", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (const t of toks) {
        if (t.type === "html_block" && t.content.includes("pair-a")) {
          out.push(makeHtml('<div class="eaten">\n'));
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([splitPlugin, subsetEater]);
    const tokens = md.parse("%pair%\n\nBody prose.\n", {});
    const eaten = tokens.find((t) => t.type === "html_block" && t.content.includes("eaten"))!;
    const poison = poisonOf(eaten)!;
    expect(poison).toBeDefined();
    expect(poison.rule).toBe("toy_subset");
    expect(poison.reason).toMatch(/overlap/i);
    expect(hunkOf(eaten)).toBeUndefined();
    // The survivor keeps rule 1's stamp — it was never part of rule 2's hunk.
    const survivor = tokens.find((t) => t.type === "html_block" && t.content.includes("pair-b"))!;
    expect(hunkOf(survivor)!.rule).toBe("toy_split");
  });

  test("whole-region consumption still stamps — chaining stays legal", () => {
    const wholeEater = corePlugin("toy_whole", (state) => {
      const toks = state.tokens;
      const out: Token[] = [];
      for (let i = 0; i < toks.length; i++) {
        const t = toks[i]!;
        if (t.type === "html_block" && t.content.includes("pair-a")) {
          out.push(makeHtml('<div class="merged">\n'));
          // Skip the adjacent pair-b too: the whole region is consumed.
          if (toks[i + 1]?.type === "html_block" && toks[i + 1]!.content.includes("pair-b")) i++;
          continue;
        }
        out.push(t);
      }
      state.tokens = out;
    });
    const md = createMarkdownRenderer([splitPlugin, wholeEater]);
    const tokens = md.parse("%pair%\n\nBody prose.\n", {});
    const merged = tokens.find((t) => t.type === "html_block" && t.content.includes("merged"))!;
    const stamp = hunkOf(merged)!;
    expect(stamp).toBeDefined();
    expect(stamp.rule).toBe("toy_whole");
    expect(stamp.range).toEqual([0, 1]);
    expect(tokens.every((t) => !poisonOf(t))).toBe(true);
  });

  test("a gpEditorLines-stamped block sibling is visible to the guard too", () => {
    // The block-rule variant: one block rule emits TWO map-less siblings
    // stamped with the same gpEditorLines range; a core rule replaces only
    // the first. The stamped survivor must trip the overlap guard.
    const twinPlugin: LoadedPlugin = {
      name: "twin",
      options: {},
      plugin: (md) => {
        md.block.ruler.before("paragraph", "twin", (state, startLine, _end, silent) => {
          const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
          const line = state.src.slice(pos, state.eMarks[startLine]!);
          if (!line.startsWith("%twin")) return false;
          if (silent) return true;
          const head = state.push("twin_head", "div", 0);
          head.block = true;
          const body = state.push("twin_body", "div", 0);
          body.block = true;
          state.line = startLine + 2;
          return true;
        });
        md.core.ruler.push("toy_twinhead", (state) => {
          const out: Token[] = [];
          for (const t of state.tokens) {
            if (t.type === "twin_head") {
              out.push(makeHtml('<div class="twin">\n'));
              continue;
            }
            out.push(t);
          }
          state.tokens = out;
        });
      },
    };
    const md = createMarkdownRenderer([twinPlugin]);
    const tokens = md.parse("%twin\nsecond line\n\nAfter.\n", {});
    const html = tokens.find((t) => t.type === "html_block")!;
    const poison = poisonOf(html)!;
    expect(poison).toBeDefined();
    expect(poison.rule).toBe("toy_twinhead");
    expect(poison.reason).toMatch(/overlap/i);
    expect(tokens.every((t) => !hunkOf(t))).toBe(true);
  });
});

describe("core-rule provenance: whole-document consumption (env orphan channel)", () => {
  interface PoisonEnv {
    [GP_CORE_POISON_ORPHAN]?: CorePoisonStamp;
  }

  test("consuming the ENTIRE document records the refusal on env — no carrier token exists", () => {
    const nuke = corePlugin("toy_nuke", (state) => {
      state.tokens = [];
    });
    const md = createMarkdownRenderer([nuke]);
    const env: PoisonEnv = {};
    const tokens = md.parse("Alpha.\n\nOmega.\n", env);
    expect(tokens.length).toBe(0);
    const orphan = env[GP_CORE_POISON_ORPHAN]!;
    expect(orphan).toBeDefined();
    expect(orphan.rule).toBe("toy_nuke");
    expect(orphan.reason).toMatch(/no replacement/i);
  });

  test("the orphan channel is first-wins — a later refusal never overwrites the root cause", () => {
    // Rule 1 nukes the document (orphan recorded). Rule 2 injects a bare
    // `hr` (poisoned in place as a non-html injection). Rule 3 removes that
    // hr — the laundering guard carries rule 2's stamp toward the orphan
    // channel, but rule 1's earlier refusal must keep the slot.
    const nuke = corePlugin("toy_nuke1", (state) => {
      state.tokens = [];
    });
    const inject = corePlugin("toy_hr", (state) => {
      const t = new state.Token("hr", "hr", 0);
      t.block = true;
      state.tokens.push(t);
    });
    const remove = corePlugin("toy_remover", (state) => {
      state.tokens = state.tokens.filter((t) => t.type !== "hr");
    });
    const md = createMarkdownRenderer([nuke, inject, remove]);
    const env: PoisonEnv = {};
    const tokens = md.parse("Alpha.\n", env);
    expect(tokens.length).toBe(0);
    const orphan = env[GP_CORE_POISON_ORPHAN]!;
    expect(orphan).toBeDefined();
    expect(orphan.rule).toBe("toy_nuke1");
  });
});

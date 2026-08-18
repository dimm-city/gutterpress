import { describe, expect, test } from "bun:test";
import type Token from "markdown-it/lib/token.mjs";
import { createMarkdownRenderer, applyPlugins, type LoadedPlugin } from "./renderer";

/**
 * The line-provenance stamp (`meta.gpEditorLines`) — see plugin-provenance.ts.
 * These tests pin the CONTRACT the desktop editor's adoption pass relies on:
 * which tokens are stamped, with which range, and which deliberately are not.
 */

const stamp = (tok: Token): [number, number] | undefined =>
  (tok.meta as { gpEditorLines?: [number, number] } | null)?.gpEditorLines;

/** A single-line marker rule in the HOUSE style: meta.line only, map null. */
const markerStyle: LoadedPlugin = {
  name: "marker-style",
  options: {},
  plugin: (md) => {
    md.block.ruler.before("paragraph", "ms", (state, startLine, _end, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      const line = state.src.slice(pos, state.eMarks[startLine]!);
      if (!line.startsWith("%ms")) return false;
      if (silent) return true;
      const t = state.push(line.startsWith("%ms-end") ? "ms_close" : "ms_open", "div", line.startsWith("%ms-end") ? -1 : 1);
      t.meta = { line: startLine + 1 };
      state.line = startLine + 1;
      return true;
    });
  },
};

/** A container-style rule: ONE invocation consumes the whole construct. */
const containerStyle: LoadedPlugin = {
  name: "container-style",
  options: {},
  plugin: (md) => {
    md.block.ruler.before("paragraph", "cs", (state, startLine, endLine, silent) => {
      const lineAt = (n: number) =>
        state.src.slice(state.bMarks[n]! + state.tShift[n]!, state.eMarks[n]!);
      if (lineAt(startLine).trim() !== "%%%cs") return false;
      if (silent) return true;
      let next = startLine + 1;
      while (next < endLine && lineAt(next).trim() !== "%%%") next++;
      state.push("cs_open", "div", 1);
      state.md.block.tokenize(state, startLine + 1, next);
      state.line = Math.min(next + 1, endLine);
      state.push("cs_close", "div", -1);
      return true;
    });
  },
};

describe("block-rule line provenance", () => {
  test("a plugin rule's map-less tokens are stamped with the consumed range", () => {
    const md = createMarkdownRenderer([markerStyle]);
    const tokens = md.parse("%ms box\n\nBody.\n\n%ms-end\n", {});
    const open = tokens.find((t) => t.type === "ms_open")!;
    const close = tokens.find((t) => t.type === "ms_close")!;
    expect(open.map).toBeNull();
    expect(stamp(open)).toEqual([0, 1]);
    expect(stamp(close)).toEqual([4, 5]);
    // The plugin's own meta survives beside the stamp.
    expect((open.meta as { line: number }).line).toBe(1);
  });

  test("a container-style invocation stamps open AND close with its full range", () => {
    // The last line of the range IS the terminator — the property that makes
    // close-marker recovery exact for advance-then-push rules, where any
    // per-push line snapshot is off by one.
    const md = createMarkdownRenderer([containerStyle]);
    const tokens = md.parse("%%%cs\n\nInside.\n\n%%%\n", {});
    const open = tokens.find((t) => t.type === "cs_open")!;
    const close = tokens.find((t) => t.type === "cs_close")!;
    expect(stamp(open)).toEqual([0, 5]);
    expect(stamp(close)).toEqual([0, 5]);
    // Inner base tokens keep their own maps, unstamped.
    const para = tokens.find((t) => t.type === "paragraph_open")!;
    expect(para.map).toEqual([2, 3]);
    expect(stamp(para)).toBeUndefined();
  });

  test("BASE pipeline tokens are never stamped — unmodelled base constructs stay refused", () => {
    // Footnote/deflist rules register before applyPlugins runs; stamping them
    // would let the editor absorb constructs the schema deliberately refuses
    // (CLAUDE.md §5: modelling one is a schema change, not a fallback).
    const md = createMarkdownRenderer([markerStyle]);
    const tokens = md.parse("Term\n: definition\n", {});
    for (const t of tokens) {
      if (t.type.startsWith("d")) expect(stamp(t)).toBeUndefined();
    }
  });

  test("instrumentation is scoped to applyPlugins — later registrations are untouched", () => {
    const md = createMarkdownRenderer();
    applyPlugins(md, [markerStyle]);
    md.block.ruler.before("paragraph", "late", (state, startLine, _end, silent) => {
      const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
      if (!state.src.slice(pos).startsWith("%late")) return false;
      if (silent) return true;
      state.push("late_atom", "div", 0).block = true;
      state.line = startLine + 1;
      return true;
    });
    const tokens = md.parse("%late\n", {});
    const atom = tokens.find((t) => t.type === "late_atom")!;
    expect(stamp(atom)).toBeUndefined();
  });

  test("a frozen plugin meta is skipped, not a crash in the middle of a render", () => {
    const frozen: LoadedPlugin = {
      name: "frozen-meta",
      options: {},
      plugin: (md) => {
        md.block.ruler.before("paragraph", "fz", (state, startLine, _end, silent) => {
          const pos = state.bMarks[startLine]! + state.tShift[startLine]!;
          if (!state.src.slice(pos).startsWith("%fz")) return false;
          if (silent) return true;
          const t = state.push("fz_atom", "div", 0);
          t.block = true;
          t.meta = Object.freeze({ theirs: true });
          state.line = startLine + 1;
          return true;
        });
      },
    };
    const md = createMarkdownRenderer([frozen]);
    const tokens = md.parse("%fz\n", {});
    const atom = tokens.find((t) => t.type === "fz_atom")!;
    expect(stamp(atom)).toBeUndefined();
    expect((atom.meta as { theirs: boolean }).theirs).toBe(true);
  });
});

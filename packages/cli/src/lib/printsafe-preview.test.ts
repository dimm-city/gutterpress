import { describe, expect, test } from "bun:test";
import { checkCss, rulePreviewCannotFollow } from "./printsafe";
import { extract } from "../engine/shared/gcpm-extract";

const rule = (css: string) => checkCss(css).filter((w) => w.rule === rulePreviewCannotFollow);

describe("printsafe/preview-cannot-follow", () => {
  test("plain, flat, literal breaks and page assignments are silent", () => {
    expect(
      rule(`
        .chapter { break-before: page; }
        .cover { page: cover; }
        .x { break-after: avoid; break-inside: avoid; page: auto; }
        @media print { .opener { break-before: right; } }
        @layer book { .toc { break-before: left; } }
        @supports (display: grid) { .a { page: wide; } }
        @page { margin: 1in; }
      `)
    ).toEqual([]);
  });

  test("a forced break or page: written with var() is reported, with its line", () => {
    const w = rule(`:root { --b: page; }\n.chapter { break-before: var(--b); }\n.wide { page: var(--p, wide); }\n.x { break-before: var(--c); }`);
    expect(w.map((x) => x.line)).toEqual([2, 3, 4]);
    expect(w[0]!.severity).toBe("warning");
    expect(w[0]!.message).toContain("var()");
    expect(w[1]!.message).toContain("page assignment");
  });

  test("a forced break or page: inside a nested rule is reported", () => {
    const w = rule(
      `.book { & .chapter { break-before: page; } .cover { page: cover; } @media print { break-after: page; } }`
    );
    expect(w).toHaveLength(3);
    expect(w.every((x) => x.message.includes('nested rule in ".book"'))).toBe(true);
  });

  test("the first declaration after a nested rule is reported, the one before is not", () => {
    const w = rule(`.a { break-before: page; & b { color: red; } break-after: page; page: x; }`);
    expect(w).toHaveLength(1);
    expect(w[0]!.message).toContain("break-after: page");
    expect(w[0]!.message).toContain("right after a nested rule");
  });

  test("the legacy page-break-before/after: always|left|right is reported with the modern spelling", () => {
    const w = rule(`.a { page-break-before: always; } .b { page-break-after: avoid; } .c { page-break-after: left; }`);
    expect(w).toHaveLength(2);
    expect(w[0]!.message).toContain('Write "break-before: page"');
    expect(w[1]!.message).toContain('Write "break-after: left"');
  });

  test("declarations the reader skips whole (@page, @keyframes, @font-face) are not its business", () => {
    expect(rule(`@keyframes k { from { break-before: var(--x); } } @page { page-break-before: always; }`)).toEqual([]);
  });

  test("it can be switched off or silenced for one site like any printsafe rule", () => {
    const css = `/* gutterpress-disable-next-line printsafe/preview-cannot-follow -- print only */\n.a { break-before: var(--b); }\n.b { break-before: var(--b); }`;
    expect(rule(css).map((x) => x.line)).toEqual([3]);
    expect(checkCss(css, undefined, { rules: { [rulePreviewCannotFollow]: "off" } })).toEqual([]);
    expect(checkCss(css, undefined, { rules: { [rulePreviewCannotFollow]: "error" } })[0]!.severity).toBe("error");
  });

  test("it reports exactly what the preview's own CSS reader misses", () => {
    // Everything in `read` reaches the engine's model; everything in `missed` does not.
    const read = `.a { break-before: page; } @media print { .b { break-after: right; page: p; } } @layer l { .c { break-before: left; } }`;
    const missed = `.d { break-before: var(--b); } .e { & .f { break-before: page; } } .g { & h { x: y } break-after: page; } .h { page-break-before: always; }`;
    const readModel = extract(read);
    expect(readModel.breaks.map((b) => b.selector)).toEqual([".a", ".b", ".c"]);
    expect(readModel.pageAssignments.map((p) => p.selector)).toEqual([".b"]);
    expect(rule(read)).toEqual([]);

    const model = extract(missed);
    expect(model.breaks.filter((b) => /^(page|left|right|recto|verso)$/.test(b.value))).toEqual([]);
    expect(rule(missed)).toHaveLength(4);
  });
});

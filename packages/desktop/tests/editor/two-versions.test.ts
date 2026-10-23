/**
 * two-versions.ts — the SPA-side reader of the passages a sync left with two
 * versions, and the edits that settle them. The first test is the lockstep
 * guard: it feeds the REAL converge merge's output (the lib's
 * `mergeWithMarkers`, not a hand-typed copy) through `findTwoVersions`, so
 * the sentinel lines spelled in the SPA module cannot drift from the ones
 * the merge writes without this failing.
 */
import { describe, expect, test } from "bun:test";
import {
  differOnlyInSpacing,
  findTwoVersions,
  markDifferences,
  resolveTwoVersions,
} from "../../src/lib/editor/two-versions";

const BASE = "# One\n\nThe vault door opened.\n\nMika stepped through.\n";
const OURS = "# One\n\nThe vault door groaned open after Mika picked the lock.\n\nMika stepped through.\n";
const THEIRS = "# One\n\nThe vault door swung open at Mika's touch.\n\nMika stepped through.\n";

async function realMerge(base = BASE, ours = OURS, theirs = THEIRS): Promise<string> {
  const { mergeWithMarkers } = await import("../../../cli/src/lib/remote-auth/converge-merge");
  return mergeWithMarkers(base, ours, theirs);
}

describe("findTwoVersions", () => {
  test("finds the block the REAL converge merge writes, with both sides' text", async () => {
    const combined = await realMerge();
    expect(combined).toContain("<<<<<<< your version");

    const blocks = findTwoVersions(combined);
    expect(blocks).toHaveLength(1);
    const [b] = blocks;
    expect(b!.yours).toBe("The vault door groaned open after Mika picked the lock.\n");
    expect(b!.online).toBe("The vault door swung open at Mika's touch.\n");
    // The same 1-based line the merge-markers check reports for this block.
    expect(b!.line).toBe(combined.split("\n").indexOf("<<<<<<< your version") + 1);
    // The range covers exactly the marker family: opener line through the
    // closer's line break, and nothing of the clean text around it.
    expect(combined.slice(b!.from, b!.to)).toBe(
      "<<<<<<< your version\n" +
        "The vault door groaned open after Mika picked the lock.\n" +
        "=======\n" +
        "The vault door swung open at Mika's touch.\n" +
        ">>>>>>> online version\n",
    );
    expect(combined.slice(0, b!.from)).toBe("# One\n\n");
    expect(combined.slice(b!.to)).toBe("\nMika stepped through.\n");
  });

  test("a bare ======= line is setext markdown and never opens or splits a block", () => {
    expect(findTwoVersions("A Heading\n=======\n\nBody.\n\n=======\n")).toEqual([]);
  });

  test("a half-deleted family is not offered as a block", () => {
    // Closer alone — the check's own "leftover marker" finding covers it.
    expect(findTwoVersions("Kept this.\n>>>>>>> online version\n")).toEqual([]);
    // Opener with no closer.
    expect(findTwoVersions("<<<<<<< your version\nmine\n=======\ntheirs\n")).toEqual([]);
    // Opener and closer with no separator between them.
    expect(findTwoVersions("<<<<<<< your version\nmine\n>>>>>>> online version\n")).toEqual([]);
  });

  test("several blocks come back in document order, each with its own text", () => {
    const text =
      "intro\n" +
      "<<<<<<< your version\na1\n=======\nb1\n>>>>>>> online version\n" +
      "middle\n" +
      "<<<<<<< your version\na2\na2b\n=======\nb2\n>>>>>>> online version\n" +
      "end\n";
    const blocks = findTwoVersions(text);
    expect(blocks.map((b) => [b.line, b.yours, b.online])).toEqual([
      [2, "a1\n", "b1\n"],
      [8, "a2\na2b\n", "b2\n"],
    ]);
  });

  test("text that still carries CRLF line breaks (not the editor's) offers nothing rather than wrong offsets", () => {
    const text = "top\r\n<<<<<<< your version\r\nmine\r\n=======\r\ntheirs\r\n>>>>>>> online version\r\nend\r\n";
    expect(findTwoVersions(text)).toEqual([]);
    expect(findTwoVersions(text.replace(/\r\n/g, "\n"))).toHaveLength(1);
  });

  test("an empty side (the passage removed on one side) is an empty string, not a missing block", () => {
    const text = "<<<<<<< your version\n=======\ntheirs\n>>>>>>> online version\n";
    const [b] = findTwoVersions(text);
    expect(b!.yours).toBe("");
    expect(b!.online).toBe("theirs\n");
  });

  test("a closer on the last line without a trailing line break still closes the block", () => {
    const text = "<<<<<<< your version\nmine\n=======\ntheirs\n>>>>>>> online version";
    const [b] = findTwoVersions(text);
    expect(b).toBeDefined();
    expect(b!.to).toBe(text.length);
  });

  test("a file with no markers finds nothing", () => {
    expect(findTwoVersions("# One\n\nClean prose.\n")).toEqual([]);
    expect(findTwoVersions("")).toEqual([]);
  });
});

describe("resolveTwoVersions", () => {
  const apply = (text: string, e: { from: number; to: number; insert: string }) =>
    text.slice(0, e.from) + e.insert + text.slice(e.to);

  test("keep yours / keep online / keep both leave one passage and no markers", async () => {
    const combined = await realMerge();
    const [b] = findTwoVersions(combined);

    expect(apply(combined, resolveTwoVersions(b!, "yours"))).toBe(OURS);
    expect(apply(combined, resolveTwoVersions(b!, "online"))).toBe(THEIRS);
    // "Both" keeps two paragraphs two paragraphs: a blank line between them.
    expect(apply(combined, resolveTwoVersions(b!, "both"))).toBe(
      "# One\n\n" +
        "The vault door groaned open after Mika picked the lock.\n" +
        "\n" +
        "The vault door swung open at Mika's touch.\n" +
        "\nMika stepped through.\n",
    );
    for (const choice of ["yours", "online", "both"] as const) {
      const settled = apply(combined, resolveTwoVersions(b!, choice));
      expect(settled).not.toMatch(/<<<<<<<|=======|>>>>>>>/);
      expect(findTwoVersions(settled)).toEqual([]);
    }
  });

  test("a stylesheet block settles the same way", () => {
    const css =
      "h1 { color: black; }\n<<<<<<< your version\nh2 { color: red; }\n=======\nh2 { color: blue; }\n>>>>>>> online version\n";
    const [b] = findTwoVersions(css);
    expect(apply(css, resolveTwoVersions(b!, "online"))).toBe("h1 { color: black; }\nh2 { color: blue; }\n");
  });
});

describe("resolveTwoVersions — both", () => {
  const block = (yours: string, online: string) => ({ line: 1, from: 0, to: 0, yours, online });
  test("adds no blank line when one side is empty, when yours already ends with one, or when online starts with one", () => {
    expect(resolveTwoVersions(block("", "b\n"), "both").insert).toBe("b\n");
    expect(resolveTwoVersions(block("a\n", ""), "both").insert).toBe("a\n");
    expect(resolveTwoVersions(block("a\n\n", "b\n"), "both").insert).toBe("a\n\nb\n");
    expect(resolveTwoVersions(block("a\n", "\nb\n"), "both").insert).toBe("a\n\nb\n");
  });
});

describe("markDifferences", () => {
  test("marks only the words one side has; whitespace never", () => {
    const r = markDifferences("The lantern was out tonight.", "The torch was out tonight.");
    expect(r.yours).toEqual([
      { text: "The ", changed: false },
      { text: "lantern", changed: true },
      { text: " was out tonight.", changed: false },
    ]);
    expect(r.online).toEqual([
      { text: "The ", changed: false },
      { text: "torch", changed: true },
      { text: " was out tonight.", changed: false },
    ]);
  });

  test("identical texts have no marks; texts that share little are shown plain, not marked all over", () => {
    expect(markDifferences("same here", "same here").yours).toEqual([{ text: "same here", changed: false }]);
    const r = markDifferences("alpha beta gamma delta", "one two three four");
    expect(r.yours).toEqual([{ text: "alpha beta gamma delta", changed: false }]);
    expect(r.online).toEqual([{ text: "one two three four", changed: false }]);
  });

  test("very long sides come back unmarked rather than building a huge table", () => {
    const long = Array.from({ length: 500 }, (_, i) => `w${i}`).join(" ");
    const r = markDifferences(long, long + " extra");
    expect(r.yours).toEqual([{ text: long, changed: false }]);
    expect(r.online).toHaveLength(1);
  });
});

describe("differOnlyInSpacing", () => {
  test("true for spacing and line-break differences only", () => {
    expect(differOnlyInSpacing("a  b\n", "a b\n")).toBe(true);
    expect(differOnlyInSpacing("a\nb\n", "a b\n")).toBe(true);
    expect(differOnlyInSpacing("a b\n", "a b\n")).toBe(false);
    expect(differOnlyInSpacing("a b\n", "a c\n")).toBe(false);
  });
});

/**
 * The merge-marker check is the ONLY path by which an unfinished combine
 * (converge-merge's marker blocks and `name.online.ext` kept-both siblings)
 * reaches the desktop Problems panel and the pre-export list: before it, the
 * markers rendered silently as setext headings/blockquotes and printed.
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { getCheckById } from "../registry";
import { makeCtx } from "../../test-helpers/testkit";
import { mergeWithMarkers } from "../../lib/remote-auth/converge-merge";

import "./merge-markers";

/** Write `files` into a fresh project dir and run the check over it. */
async function runOn(files: Record<string, string>) {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-merge-check-"));
  try {
    const markdownFiles: string[] = [];
    const cssFiles: string[] = [];
    for (const [rel, content] of Object.entries(files)) {
      const abs = join(dir, rel);
      await mkdir(dirname(abs), { recursive: true });
      await writeFile(abs, content);
      if (rel.endsWith(".md")) markdownFiles.push(abs);
      if (rel.endsWith(".css")) cssFiles.push(abs);
    }
    const check = getCheckById("source.sync.merge-markers")!;
    return await check.run(makeCtx({ inputDir: dir, markdownFiles, cssFiles }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("source.sync.merge-markers", () => {
  test("flags the exact three-line family converge-merge writes — pinned to the REAL merge output", async () => {
    // Lockstep guard: generate the conflicted content with the actual merge
    // function, not a hand-typed copy, so a label change in converge-merge.ts
    // cannot silently strand this check matching stale sentinels.
    const combined = mergeWithMarkers(
      "# One\n\nThe vault door opened.\n",
      "# One\n\nThe vault door groaned open after Mika picked the lock.\n",
      "# One\n\nThe vault door swung open at Mika's touch.\n",
    );
    expect(combined).toContain("<<<<<<< your version");

    const results = await runOn({ "chapter-01.md": combined });
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.checkId).toBe("source.sync.merge-markers");
    // ERROR: these lines are setext syntax and PRINT — a chapter-sized
    // heading plus nested blockquotes in the PDF. The build must not finish
    // with them in a chapter (runner.ts keys ok off `error`).
    expect(r.severity).toBe("error");
    expect(r.code).toBe("two-versions-passage");
    expect(r.file).toContain("chapter-01.md");
    expect(r.line).toBe(combined.split("\n").indexOf("<<<<<<< your version") + 1);
    // Writer-voice: no git jargon anywhere in the message.
    expect(r.message).not.toMatch(/conflict|merge|git/i);
  });

  test("a bare ======= line is legitimate setext markdown and is NEVER flagged", async () => {
    const results = await runOn({
      "chapter-01.md":
        "A Heading Underlined With Equals\n=======\n\nBody text.\n\n=======\n",
    });
    expect(results).toEqual([]);
  });

  test("an orphaned closing sentinel (half-deleted family) is still flagged", async () => {
    const results = await runOn({
      "chapter-01.md": "Kept this text.\n>>>>>>> online version\n\nMore prose.\n",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.code).toBe("leftover-version-marker");
    expect(results[0]!.line).toBe(2);
  });

  test("stylesheets are scanned too — a marker-broken CSS file is as invisible as prose", async () => {
    const results = await runOn({
      "styles/main.css":
        "h1 { color: black; }\n<<<<<<< your version\nh2 { color: red; }\n=======\nh2 { color: blue; }\n>>>>>>> online version\n",
    });
    expect(results).toHaveLength(1);
    expect(results[0]!.file).toContain("main.css");
    expect(results[0]!.line).toBe(2);
  });

  test("reports name.online.ext kept-both siblings and self-clears when the sibling is gone", async () => {
    const files = {
      "chapter-01.md": "# One\n\nClean prose.\n",
      "art/cover.png": "ours",
      "art/cover.online.png": "theirs",
      "notes.online": "extensionless sibling",
    };
    const results = await runOn(files);
    expect(results.map((r) => r.code)).toEqual([
      "kept-both-versions",
      "kept-both-versions",
    ]);
    const covers = results.find((r) => r.file!.endsWith("cover.online.png"))!;
    expect(covers.message).toBe(
      "Two versions of art/cover.png are in your project — keep the one you want, then delete the other.",
    );
    const notes = results.find((r) => r.file!.endsWith("notes.online"))!;
    expect(notes.message).toContain("Two versions of notes are in your project");

    // Self-clears: the same project without the siblings reports nothing.
    const { "art/cover.online.png": _a, "notes.online": _b, ...resolved } = files;
    expect(await runOn(resolved)).toEqual([]);
  });

  test("clean project: no findings, no crash", async () => {
    expect(
      await runOn({ "chapter-01.md": "# One\n\ntext\n", "styles/main.css": "h1{}\n" }),
    ).toEqual([]);
  });
});

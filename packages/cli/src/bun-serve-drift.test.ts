/**
 * "Bun.serve" doc-drift guard (ARCH finding #13).
 *
 * CLAUDE.md §1 used to instruct `Bun.serve` for the preview dev server,
 * directly contradicting both the actual implementation
 * (`packages/cli/src/preview/http-server.ts` uses `node:http` + `ws` so it
 * can run under Electron's bundled Node in the packaged viewer) and
 * CLAUDE.md's own Node-compatibility requirement (Monorepo layout section:
 * "no `Bun.serve`/`Bun.file`/runtime Bun APIs"). CONTRIBUTING.md and
 * docs/ARCHITECTURE.md repeated the same dead story. All three now describe
 * `node:http` + `ws` instead; any remaining "Bun.serve" mention in them is a
 * CONTRASTIVE/historical one (explaining what it was replaced with and why),
 * never an instruction to use it.
 *
 * This test does not fully parse prose. It requires every line mentioning
 * "Bun.serve" in the three docs to also carry a recognizable negation/
 * contrast cue (not/no/instead of/unlike/earlier/replaced/chosen over/
 * crash/...) on the SAME line, so a future edit that reintroduces an
 * affirmative "use Bun.serve" instruction fails loudly instead of silently
 * regressing this finding. It also asserts the actual preview server module
 * still doesn't call `Bun.serve(...)`, so the docs and the code can't drift
 * apart again without one of these tests catching it.
 */
import { describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// __dirname === packages/cli/src — three levels up is the repo root.
const REPO_ROOT = path.join(__dirname, "..", "..", "..");

const DOCS = [
  path.join(REPO_ROOT, "CLAUDE.md"),
  path.join(REPO_ROOT, "CONTRIBUTING.md"),
  path.join(REPO_ROOT, "docs", "ARCHITECTURE.md"),
];

/**
 * Case-insensitive contrast/negation cues that make a "Bun.serve" mention
 * clearly historical/contrastive rather than an affirmative instruction.
 * Keep this list narrow and additive: a new legitimately-historical mention
 * should read naturally with one of these words, not force a workaround.
 */
const CONTRAST_CUE =
  /\b(not|no|n't|unlike|earlier|previous|prior|replaced|old|historical|crash)\b|instead of|chosen over|is not available/i;

interface Hit {
  file: string;
  line: number;
  text: string;
}

function findUncontrastedBunServeMentions(filePath: string): Hit[] {
  const text = fs.readFileSync(filePath, "utf8");
  const lines = text.split("\n");
  const hits: Hit[] = [];
  lines.forEach((line, i) => {
    if (!/Bun\.serve/.test(line)) return;
    if (CONTRAST_CUE.test(line)) return;
    hits.push({ file: path.relative(REPO_ROOT, filePath), line: i + 1, text: line.trim() });
  });
  return hits;
}

describe("docs don't instruct Bun.serve for the preview/dev server (ARCH #13)", () => {
  test("packages/cli/src/preview/http-server.ts still uses node:http, not Bun.serve", () => {
    const httpServerPath = path.join(REPO_ROOT, "packages", "cli", "src", "preview", "http-server.ts");
    const src = fs.readFileSync(httpServerPath, "utf8");
    expect(/Bun\.serve\s*\(/.test(src)).toBe(false);
    expect(/from ['"]node:http['"]/.test(src)).toBe(true);
  });

  for (const doc of DOCS) {
    const relPath = path.relative(REPO_ROOT, doc);
    test(`${relPath} has no un-contrasted "Bun.serve" instruction`, () => {
      expect(fs.existsSync(doc)).toBe(true);
      const hits = findUncontrastedBunServeMentions(doc);
      expect(hits).toEqual([]);
    });
  }
});

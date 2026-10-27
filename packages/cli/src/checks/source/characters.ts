/**
 * Character check (#382) — finds the characters in `character-table.ts`
 * (invisible and control characters, odd spaces, and the typography a chat
 * model or word processor pastes in) in the book's markdown, one finding per
 * occurrence, each saying what to type instead.
 *
 * Like merge-markers.ts it needs no new IPC and no new UI: the desktop's
 * `/api/lint/project` route already maps every `CheckResult` into the
 * Problems panel. `column` is a 1-based UTF-16 offset, the unit the editor
 * positions in, so a click lands on the character even after an emoji.
 *
 * Code blocks are scanned too: a curly quote pasted into a code sample is a
 * bug in the sample. `<!-- gutterpress-disable-next-line source.characters -->`
 * silences the line below it; `checks:` in the manifest sets the level for the whole book.
 */
import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import { parseDisableDirective } from "../../lib/lint-rules";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { CHARACTER_PATTERN, codePointLabel, describeCharacter } from "./character-table";

/** The same pattern without `g`, for a stateless whole-file probe. */
const PROBE = new RegExp(CHARACTER_PATTERN.source, "u");

const check: Check = {
  id: "source.characters",
  name: "Unusual Characters",
  description:
    "Finds invisible and control characters, odd spaces, and pasted typography (em dashes, curly quotes, emoji) in markdown",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];
    for (const file of (ctx.markdownFiles ?? []).slice().sort()) {
      let content: string;
      try {
        content = await readFile(file, "utf8");
      } catch {
        results.push(inspectionFailed(check.id, `Could not read source file: ${file}`, { file }));
        continue;
      }
      // Runs on every preview rebuild: skip the split for a clean file.
      if (!PROBE.test(content)) continue;
      const lines = content.split("\n");
      let silencedLine = -1;
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i]!;
        const comment = /^\s*<!--(.*)-->\s*$/.exec(line);
        if (comment && parseDisableDirective(comment[1]!)?.includes(check.id)) {
          silencedLine = i + 1;
          continue;
        }
        if (i === silencedLine) continue;
        for (const match of line.matchAll(CHARACTER_PATTERN)) {
          const char = match[0];
          const { name, code, fix } = describeCharacter(char);
          results.push(
            finding(check.id, {
              // Typography the typographer would print anyway (dashes, curly
              // quotes, the ellipsis) is info: common in pasted prose, and it
              // prints correctly. Everything else can change what prints.
              severity: code === "typographer" ? "info" : "warning",
              code,
              message: `${name} (${codePointLabel(char)}). ${fix}`,
              file,
              line: i + 1,
              column: match.index + 1,
              data: { codePoint: char.codePointAt(0) },
            }),
          );
        }
      }
    }
    return results;
  },
};

registerCheck(check);

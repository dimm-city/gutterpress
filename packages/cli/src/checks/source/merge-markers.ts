/**
 * Merge-marker check — makes an unfinished combine VISIBLE before it prints.
 *
 * When a sync finds a passage edited both here and online, the converge merge
 * (lib/remote-auth/converge-merge.ts) keeps BOTH versions in the file inside
 * standard git conflict markers, and keeps both copies of an uncombinable file
 * as a `name.online.ext` sibling. That is deliberate — sync never blocks — but
 * until this check the only signal was a transient toast: the marker lines are
 * valid markdown (`=======` is setext-heading syntax), so the preview quietly
 * renders the writer's paragraph as a chapter-sized heading, the Problems
 * panel says nothing, and a build/export completes and PRINTS the garbage.
 *
 * Running the detection AS A CHECK is what closes that gap, exactly like
 * layout-markers.ts: no new IPC, no new UI — the desktop's `/api/lint/project`
 * route already maps every `CheckResult` into the Problems panel and the
 * pre-export list, and the finding self-clears when the writer resolves it.
 *
 * Matching is deliberately EXACT: only the three-line family Gutterpress
 * itself writes (`<<<<<<< your version` / `=======` / `>>>>>>> online
 * version`). A bare `=======` line is legitimate setext markdown and is never
 * flagged on its own — only the fixed sentinel labels identify a combine, so
 * false positives are near-zero. The labels must stay byte-identical to
 * converge-merge.ts's OUR_LABEL/THEIR_LABEL output (the lockstep is pinned by
 * merge-markers.test.ts, which runs this check over `mergeWithMarkers`'s real
 * output rather than a hand-typed copy).
 *
 * Severity is always `warning` — the document still renders, so this must not
 * abort a build (only `error` results set ok=false).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { ASSET_SCAN_IGNORE_GLOBS } from "../asset/extensions";

/** The exact sentinel lines converge-merge writes. Byte-match — never loosen. */
const OPEN_SENTINEL = "<<<<<<< your version";
const CLOSE_SENTINEL = ">>>>>>> online version";

/** `art/cover.online.png` → `art/cover.png`; `notes.online` → `notes`. */
function withoutOnlineTag(relPath: string): string {
  return relPath.replace(/\.online(?=\.[^./]*$|$)/, "");
}

const check: Check = {
  id: "source.sync.merge-markers",
  name: "Combined Versions",
  description:
    "Finds passages and files still holding two versions (yours and the online copy) after a sync",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const results: CheckResult[] = [];

    // Text scan: every file the build will actually render/ship — chapters
    // AND stylesheets (the converge merge writes markers into any text file,
    // and a marker-broken stylesheet is exactly as invisible until print).
    const textFiles = [...(ctx.markdownFiles ?? []), ...(ctx.cssFiles ?? [])]
      .slice()
      .sort();
    for (const file of textFiles) {
      let content: string;
      try {
        content = await readFile(file, "utf8");
      } catch {
        results.push(
          inspectionFailed(check.id, `Could not read source file: ${file}`, { file }),
        );
        continue;
      }
      let inBlock = false;
      const lines = content.split("\n");
      for (let i = 0; i < lines.length; i++) {
        // Tolerate CRLF files — converge preserves the file's own endings.
        const line = lines[i]!.endsWith("\r") ? lines[i]!.slice(0, -1) : lines[i]!;
        if (line === OPEN_SENTINEL) {
          inBlock = true;
          results.push(
            finding(check.id, {
              severity: "warning",
              code: "two-versions-passage",
              message:
                "This passage has two versions (yours and the online copy) — keep what you want, then delete the marker lines.",
              file,
              line: i + 1,
            }),
          );
        } else if (line === CLOSE_SENTINEL) {
          if (!inBlock) {
            // Half-deleted family: the closing line alone still prints as a
            // wall of nested quotes, so it gets its own finding.
            results.push(
              finding(check.id, {
                severity: "warning",
                code: "leftover-version-marker",
                message:
                  "This marker line is left over from combining two versions — delete it.",
                file,
                line: i + 1,
              }),
            );
          }
          inBlock = false;
        }
      }
    }

    // Sibling scan: uncombinable files (images, SVG, both-added) are kept as
    // a `name.online.ext` pair — report the pair until the writer settles it.
    // Same lazy glob + ignore list every asset scan uses.
    try {
      const { glob } = await import("glob");
      const siblings = await glob(["**/*.online", "**/*.online.*"], {
        cwd: ctx.inputDir,
        absolute: true,
        ignore: [...ASSET_SCAN_IGNORE_GLOBS],
      });
      for (const sibling of [...new Set(siblings)].sort()) {
        const rel = path.relative(ctx.inputDir, sibling).split(path.sep).join("/");
        results.push(
          finding(check.id, {
            severity: "warning",
            code: "kept-both-versions",
            message: `Two versions of ${withoutOnlineTag(rel)} are in your project — keep the one you want, then delete the other.`,
            file: sibling,
          }),
        );
      }
    } catch (error) {
      results.push(
        inspectionFailed(
          check.id,
          `Could not scan for kept-both files: ${
            error instanceof Error ? error.message : String(error)
          }`,
        ),
      );
    }

    return results;
  },
};

registerCheck(check);

export default check;

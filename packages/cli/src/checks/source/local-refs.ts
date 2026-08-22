import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import {
  decodeRef,
  isNonFilesystemRef,
  proseImageRefError,
} from "../../lib/asset-inline";
import { loadPlugins } from "../../lib/markdown/plugins";
import { createRenderedLocalRefCollector, type RenderedRefKind } from "./local-ref-parser";

const check: Check = {
  id: "source.links.local-refs",
  name: "Local Markdown References",
  description: "Checks local markdown links and image refs resolve on disk",
  category: "source",
  phase: "pre-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    const files = (ctx.markdownFiles ?? []).slice().sort();
    if (files.length === 0) return [];

    const results: CheckResult[] = [];
    // Match the authored book grammar. The loader's path-module cache avoids
    // repeating module-level plugin side effects when another source check or
    // the build already loaded the same unchanged plugin; application happens
    // once to this check's parser and that parser is reused for every chapter.
    const plugins = await loadPlugins(ctx.config.plugins, ctx.inputDir, (ref, error) => {
      results.push(
        inspectionFailed(
          check.id,
          `Plugin "${ref}" could not be loaded, so local references it defines were not checked: ${error.message}`,
        ),
      );
    });
    const collectRenderedLocalRefs = createRenderedLocalRefCollector(plugins);

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        for (const { ref, kind, line } of collectRenderedLocalRefs(content)) {
          // The parser deliberately returns every rendered link/image. Only
          // filesystem-backed destinations belong to this check: page-local
          // fragments and URLs are resolved by the reader, not on disk.
          if (isNonFilesystemRef(ref)) continue;

          // R5: a prose IMAGE must live inside the book. `proseImageRefError`
          // is the SAME predicate the build's `planImageCopies` rejects with,
          // so this pre-build check can't drift from what the build enforces
          // — it used to green-light an escaping ref that happened to exist and
          // let the build fail later instead.
          const escape = kind === "image" ? proseImageRefError(ref, ctx.inputDir) : null;
          if (escape) {
            results.push(
              finding(check.id, {
                severity: "error",
                message: escape,
                file,
                line,
              })
            );
            continue;
          }
          if (localRefExists(ref, kind, file, ctx.inputDir)) continue;
          results.push(
            finding(check.id, {
              // Missing prose images are recoverable: the build's asset
              // planner writes a loud magenta PNG and rewrites the rendered
              // URL. Missing links have no such fallback and remain errors.
              // Keep source file/line so the finding is directly fixable.
              severity: kind === "image" ? "warning" : "error",
              code: kind === "image" ? "missing-image-placeholder" : undefined,
              message:
                kind === "image"
                  ? `Local image not found; build will substitute a magenta placeholder: ${ref}`
                  : `Local reference not found: ${ref}`,
              file,
              line,
            })
          );
        }
      } catch {
        results.push(
          inspectionFailed(check.id, `Could not read source file: ${file}`, {
            file,
          })
        );
      }
    }

    return results;
  },
};

/**
 * Which frame a ref must be resolved in, mirroring the two frames the actual
 * BUILD uses (see `localRefExists`'s doc comment for the full rationale):
 *   - `image`  — an inline `![alt](dest)` — the renderer records it verbatim
 *     and `planImageCopies` (lib/asset-inline.ts) resolves it against the
 *     PROJECT ROOT.
 *   - `link`   — an inline `[text](dest)` with no `!` — never touched by the
 *     renderer; it ships as a plain relative href a reader resolves relative
 *     to the LINKING file (e.g. a chapter linking to another chapter file).
 * Reference definitions need no ambiguous third frame: the parser-aligned
 * collector sees their actual consumers as either rendered links or images.
 */

/** Match the build's URL-to-filesystem normalization. */
function filesystemRef(ref: string): string {
  return decodeRef(ref).replace(/[?#].*$/, "");
}

/**
 * Does `ref` resolve to a real file on disk?
 *
 * TWO fixes over the previous version:
 *
 * 1. **Percent-decode before probing.** `![](images/my%20photo.png)` is the
 *    only bracket-less spelling CommonMark actually renders for a filename
 *    containing a space, and `caf%C3%A9.png` is the standard escape for a
 *    non-ASCII name — both are correct references to real files, but
 *    `existsSync` was previously called on the still-encoded string, which
 *    never matches a real path. `static-serve.ts` already decodes on the
 *    serving side, so the check was failing builds over references the
 *    preview happily served. `decodeRef` (lib/asset-inline.ts) is reused
 *    rather than re-implemented — same bundle-safe pure string work the CSS
 *    `url()` resolver already relies on.
 *
 * 2. **Resolve in the frame the BUILD actually uses**, which differs by ref
 *    kind:
 *      - An IMAGE ref is emitted verbatim by the renderer and resolved
 *        against the PROJECT ROOT by `planImageCopies` (book.html itself sits
 *        at the output root — see lib/asset-inline.ts). A chapter in a
 *        subfolder that writes `![cover](art/cover.png)` meaning
 *        "`<projectRoot>/art/cover.png`" was previously checked against
 *        `<chapterDir>/art/cover.png` instead, and a correct reference was
 *        reported as a build-failing error.
 *      - A non-image LINK (e.g. one chapter linking to another markdown file)
 *        is never touched by the renderer — it ships as an ordinary relative
 *        href that a reader's browser/PDF desktop resolves relative to the
 *        LINKING file, so that stays the frame this check uses too.
 *      - A reference-style consumer already has a concrete rendered kind, so
 *        it follows the same link/image frame without guessing from the
 *        definition in isolation.
 */

function localRefExists(
  ref: string,
  kind: RenderedRefKind,
  sourceFile: string,
  projectRoot: string
): boolean {
  const cleaned = filesystemRef(ref);
  const fileRelative = resolve(dirname(sourceFile), cleaned);
  const rootRelative = resolve(projectRoot, cleaned);

  switch (kind) {
    case "image":
      return existsSync(rootRelative);
    case "link":
      return existsSync(fileRelative);
  }
}

registerCheck(check);
export default check;

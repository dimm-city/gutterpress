import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { decodeRef } from "../../lib/asset-inline";

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

    for (const file of files) {
      try {
        const content = await readFile(file, "utf8");
        const lines = content.split("\n");
        let inFence = false;

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i] ?? "";
          if (/^\s*(```|~~~)/.test(line)) {
            inFence = !inFence;
            continue;
          }
          if (inFence) continue;

          for (const { ref, kind } of extractLocalRefs(line)) {
            // R5: a prose IMAGE must live inside the book. The build enforces
            // this (planImageCopies), so reporting it HERE is the whole point of
            // a pre-build check — it used to green-light an escaping ref that
            // happened to exist and let the build fail later instead.
            const escape = kind === "image" ? imageRefEscape(ref, ctx.inputDir) : null;
            if (escape) {
              results.push(
                finding(check.id, {
                  severity: "error",
                  message: escape,
                  file,
                  line: i + 1,
                })
              );
              continue;
            }
            if (localRefExists(ref, kind, file, ctx.inputDir)) continue;
            results.push(
              finding(check.id, {
                severity: "error",
                message: `Local reference not found: ${ref}`,
                file,
                line: i + 1,
              })
            );
          }
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

function stripInlineCode(line: string): string {
  return line.replace(/`[^`]*`/g, (match) => " ".repeat(match.length));
}

/**
 * Which frame a ref must be resolved in, mirroring the two frames the actual
 * BUILD uses (see `localRefExists`'s doc comment for the full rationale):
 *   - `image`  — an inline `![alt](dest)` — the renderer records it verbatim
 *     and `planImageCopies` (lib/asset-inline.ts) resolves it against the
 *     PROJECT ROOT.
 *   - `link`   — an inline `[text](dest)` with no `!` — never touched by the
 *     renderer; it ships as a plain relative href a reader resolves relative
 *     to the LINKING file (e.g. a chapter linking to another chapter file).
 *   - `ambiguous` — a reference-style definition (`[label]: dest`). Its
 *     consumer (`[text][label]` vs `![alt][label]`) lives on a different line
 *     this check never correlates back to the definition, so which frame
 *     applies is unknowable here.
 */
type RefKind = "image" | "link" | "ambiguous";

interface LocalRef {
  ref: string;
  kind: RefKind;
}

function extractLocalRefs(line: string): LocalRef[] {
  const refs: LocalRef[] = [];
  const stripped = stripInlineCode(line);
  const inlinePattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const defPattern = /^\s*\[[^\]]+\]:\s*(\S+)/;

  for (const match of stripped.matchAll(inlinePattern)) {
    const raw = match[1];
    if (!raw) continue;
    const ref = normalizeDestination(raw);
    if (!ref || !isLocalRef(ref)) continue;
    // match[0] keeps the leading "!" (if any) from the `!?` in the pattern,
    // so this is exactly CommonMark's own image-vs-link distinction.
    refs.push({ ref, kind: match[0].startsWith("!") ? "image" : "link" });
  }

  const defMatch = stripped.match(defPattern);
  if (defMatch?.[1]) {
    const ref = normalizeDestination(defMatch[1]);
    if (ref && isLocalRef(ref)) refs.push({ ref, kind: "ambiguous" });
  }

  return refs;
}

function normalizeDestination(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";

  let dest = trimmed;
  if (trimmed.startsWith("<") && trimmed.includes(">")) {
    dest = trimmed.slice(1, trimmed.indexOf(">"));
  } else {
    const spaceIndex = trimmed.search(/\s/);
    if (spaceIndex > 0) {
      dest = trimmed.slice(0, spaceIndex);
    }
  }

  const withoutFragments = dest.split(/[?#]/)[0] ?? "";
  return withoutFragments.trim();
}

function isLocalRef(ref: string): boolean {
  const lower = ref.toLowerCase();
  if (!ref || ref.startsWith("#")) return false;
  if (lower.startsWith("http://") || lower.startsWith("https://")) return false;
  if (lower.startsWith("mailto:") || lower.startsWith("tel:")) return false;
  if (lower.startsWith("data:") || lower.startsWith("javascript:")) return false;
  if (ref.startsWith("//")) return false;
  return true;
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
 *      - A reference-style definition (`kind: "ambiguous"`) is accepted in
 *        EITHER frame: this check has no way to see whether the label it
 *        defines is later consumed by `[text][label]` or `![alt][label]`, so
 *        picking one frame would risk flagging a legitimate reference as
 *        broken. Accepting either trades a small amount of missed-detection
 *        risk (a truly-broken ambiguous ref that happens to coincide with a
 *        real file in the OTHER frame) for never false-positiving on a
 *        correct one — the same fail-open bias `isNonFileUrl` already uses
 *        for anything this check can't confidently classify.
 */
/**
 * The build-failing reason a prose IMAGE ref is unusable, or null when it is
 * fine. Mirrors `planImageCopies` (lib/asset-inline.ts) — the code that
 * actually rejects these at build time — so validation and build agree:
 * an image referenced from Markdown prose must live inside the book folder, and
 * an absolute or `../`-escaping ref is an error telling the author to copy the
 * file in. (Shared art referenced from shared CSS is a different rule and is
 * handled by the CSS inliner, not here.)
 */
function imageRefEscape(ref: string, projectRoot: string): string | null {
  const cleaned = decodeRef(ref);
  if (isAbsolute(cleaned)) {
    return `Image reference must be relative to the project: ${ref} — copy the file into your project folder and reference it from there.`;
  }
  const abs = resolve(projectRoot, cleaned);
  const rel = relative(resolve(projectRoot), abs);
  if (rel === ".." || rel.startsWith(`..${sep}`)) {
    return `Image reference points outside the project: ${ref} — copy the file into your project folder and reference it from there.`;
  }
  return null;
}

function localRefExists(
  ref: string,
  kind: RefKind,
  sourceFile: string,
  projectRoot: string
): boolean {
  const decoded = decodeRef(ref);
  const fileRelative = resolve(dirname(sourceFile), decoded);
  const rootRelative = resolve(projectRoot, decoded);

  switch (kind) {
    case "image":
      return existsSync(rootRelative);
    case "link":
      return existsSync(fileRelative);
    case "ambiguous":
      return existsSync(fileRelative) || existsSync(rootRelative);
  }
}

registerCheck(check);
export default check;

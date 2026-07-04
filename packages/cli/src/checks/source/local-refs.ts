import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";

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

          for (const ref of extractLocalRefs(line)) {
            if (localRefExists(ref, file)) continue;
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

function extractLocalRefs(line: string): string[] {
  const refs: string[] = [];
  const stripped = stripInlineCode(line);
  const inlinePattern = /!?\[[^\]]*\]\(([^)]+)\)/g;
  const defPattern = /^\s*\[[^\]]+\]:\s*(\S+)/;

  for (const match of stripped.matchAll(inlinePattern)) {
    const raw = match[1];
    if (!raw) continue;
    const ref = normalizeDestination(raw);
    if (!ref || !isLocalRef(ref)) continue;
    refs.push(ref);
  }

  const defMatch = stripped.match(defPattern);
  if (defMatch?.[1]) {
    const ref = normalizeDestination(defMatch[1]);
    if (ref && isLocalRef(ref)) refs.push(ref);
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

function localRefExists(ref: string, sourceFile: string): boolean {
  const candidate = resolve(dirname(sourceFile), ref);
  return existsSync(candidate);
}

registerCheck(check);
export default check;

/**
 * `gutterpress validate --fix` (#275) — markdownlint's auto-fixes applied in
 * place, driven through the real `executeValidation` + the real
 * `source.markdownlint` check (`--only`, so no other check and no external
 * tool is involved).
 *
 * The guarantees under test are the ones that make writing files from a
 * read-only command safe: `--fix` rewrites ONLY the mechanically fixable
 * violations and still reports the rest, a plain run writes nothing at all,
 * and the "no config found" path (which the check itself skips silently) says
 * so instead of looking like a success.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { writeFile, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { executeValidation } from "./validation-exec";
import { makeTempDir, initRepo, commitFile } from "../test-helpers/testkit";

// Self-registering check modules — the same side-effect import the sibling
// validation-exec tests use.
import "../checks/source/index";

/** MD009 (trailing spaces) + MD012 (multiple blanks), both fixable, plus
 * MD024 (duplicate heading), which markdownlint cannot fix. */
const UNFIXED =
  "# Title\n\ntrailing   \n\n\n\n## Dup\n\ntext\n\n## Dup\n\nend\n";
const FIXED = "# Title\n\ntrailing\n\n## Dup\n\ntext\n\n## Dup\n\nend\n";

let warnSpy: ReturnType<typeof spyOn> | undefined;

function captureWarnings(): string[] {
  const lines: string[] = [];
  warnSpy = spyOn(console, "warn").mockImplementation((...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  });
  return lines;
}

afterEach(() => {
  warnSpy?.mockRestore();
  warnSpy = undefined;
});

async function makeProject(opts: { config?: boolean } = {}): Promise<string> {
  const dir = await makeTempDir("gutterpress-mdfix-");
  await writeFile(path.join(dir, "manifest.yaml"), "title: Fix Fixture\n", "utf-8");
  if (opts.config !== false) {
    await writeFile(
      path.join(dir, ".markdownlint.json"),
      '{ "default": true, "MD013": false }\n',
      "utf-8"
    );
  }
  await writeFile(path.join(dir, "chapter-01.md"), UNFIXED, "utf-8");
  return dir;
}

/** The `source.markdownlint` rule ids the run reported. */
function reportedRules(results: Array<{ checkId: string; code?: string }>): string[] {
  return results
    .filter((r) => r.checkId === "source.markdownlint")
    .map((r) => r.code ?? "");
}

describe("validate --fix applies markdownlint's auto-fixes", () => {
  test("rewrites the fixable violations and still reports the unfixable one", async () => {
    const dir = await makeProject();
    captureWarnings();
    try {
      const execution = await executeValidation({
        input: dir,
        only: "source.markdownlint",
        fix: true,
      });

      expect(await readFile(path.join(dir, "chapter-01.md"), "utf-8")).toBe(FIXED);

      const rules = reportedRules(execution.report.results);
      expect(rules).toContain("MD024"); // no fix exists — still reported
      expect(rules).not.toContain("MD009");
      expect(rules).not.toContain("MD012");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes nothing when --skip excludes the check", async () => {
    const dir = await makeProject();
    const warnings = captureWarnings();
    try {
      await executeValidation({ input: dir, skip: "source.markdownlint", fix: true });

      // The whole point of the gate: --fix must not rewrite files belonging to
      // a check this run excluded, or the write happens with nothing in the
      // report to explain it.
      expect(await readFile(path.join(dir, "chapter-01.md"), "utf-8")).toBe(UNFIXED);
      expect(warnings.join("\n")).toContain("is not part of this run");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("writes nothing when --phase excludes the source checks", async () => {
    const dir = await makeProject();
    captureWarnings();
    try {
      await executeValidation({ input: dir, phase: "post-build", fix: true });

      expect(await readFile(path.join(dir, "chapter-01.md"), "utf-8")).toBe(UNFIXED);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("prints every file it rewrote", async () => {
    const dir = await makeProject();
    const warnings = captureWarnings();
    try {
      await executeValidation({ input: dir, only: "source.markdownlint", fix: true });

      expect(warnings.join("\n")).toContain(path.join(dir, "chapter-01.md"));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a run without --fix writes nothing", async () => {
    const dir = await makeProject();
    captureWarnings();
    try {
      const execution = await executeValidation({
        input: dir,
        only: "source.markdownlint",
      });

      expect(await readFile(path.join(dir, "chapter-01.md"), "utf-8")).toBe(UNFIXED);

      const rules = reportedRules(execution.report.results);
      expect(rules).toContain("MD009");
      expect(rules).toContain("MD012");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("no markdownlint config found: says so instead of reporting a silent success", async () => {
    const dir = await makeProject({ config: false });
    const warnings = captureWarnings();
    try {
      await executeValidation({ input: dir, only: "source.markdownlint", fix: true });

      expect(warnings.join("\n")).toContain("no markdownlint config found");
      expect(await readFile(path.join(dir, "chapter-01.md"), "utf-8")).toBe(UNFIXED);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("notices — and does not refuse — when a rewritten file had uncommitted changes", async () => {
    const dir = await makeTempDir("gutterpress-mdfix-git-");
    const warnings = captureWarnings();
    try {
      await initRepo(dir, { content: "# Title\n\nclean\n" });
      await commitFile(dir, "manifest.yaml", "title: Fix Fixture\n");
      await commitFile(dir, ".markdownlint.json", '{ "default": true, "MD013": false }\n');
      // Uncommitted edit to the very file --fix is about to rewrite.
      await writeFile(path.join(dir, "chapter-01.md"), UNFIXED, "utf-8");

      await executeValidation({ input: dir, only: "source.markdownlint", fix: true });

      expect(warnings.join("\n")).toContain("already had uncommitted changes");
      expect(await readFile(path.join(dir, "chapter-01.md"), "utf-8")).toBe(FIXED);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

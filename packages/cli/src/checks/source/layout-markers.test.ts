/**
 * The layout-marker check is the ONLY path by which `env.layoutWarnings`
 * reaches the desktop Problems panel: the panel is filled by
 * `executeValidation({ category: "source", phase: "pre-build" })` via
 * `/api/lint/project`, and before this check every marker warning died in a
 * build-log line the desktop user never saw.
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCheckById } from "../registry";
import { makeCtx } from "../../test-helpers/testkit";

import "./layout-markers";

async function runOn(markdown: string) {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-markers-check-"));
  try {
    const mdFile = join(dir, "ch1.md");
    await writeFile(mdFile, markdown);
    const check = getCheckById("source.markdown.layout-markers")!;
    return await check.run(makeCtx({ inputDir: dir, markdownFiles: [mdFile] }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("source.markdown.layout-markers", () => {
  test("reports marker mistakes as line-numbered warnings the panel can render", async () => {
    const results = await runOn(
      "@page\n\ntext\n\n@page My Cover Page\n\ntext\n\n@secton .two-column\n\ntext\n"
    );

    expect(results.map((r) => r.code).sort()).toEqual([
      "extra_bare_marker_token",
      "unknown_marker",
    ]);
    for (const r of results) {
      expect(r.checkId).toBe("source.markdown.layout-markers");
      // Warnings only — a marker mistake renders SOMETHING, so it must never
      // set ok=false and abort a build (runner.ts keys ok off `error`).
      expect(r.severity).toBe("warning");
      expect(r.file).toContain("ch1.md");
      expect(r.line).toBeGreaterThan(0);
    }
    expect(results.find((r) => r.code === "extra_bare_marker_token")!.line).toBe(5);
    expect(results.find((r) => r.code === "unknown_marker")!.line).toBe(9);
  });

  test("a document with well-formed markers produces no findings", async () => {
    expect(await runOn("@page cover .a #id\n\ntext\n\n@section {.two-column}\n\ntext\n")).toEqual([]);
  });

  test("no markdown files: no findings, no crash", async () => {
    const check = getCheckById("source.markdown.layout-markers")!;
    expect(await check.run(makeCtx({ inputDir: tmpdir(), markdownFiles: [] }))).toEqual([]);
  });
});

/**
 * UX finding M32 (CLI half): markdownlint messages used to lead with
 * rule-code jargon ("MD013/line-length Line length exceeds 80 characters"),
 * which reads as gibberish to a non-technical writer. The human-readable
 * description must come first; the rule code is demoted to a suffix (and
 * also surfaced structurally via `CheckResult.code` for consumers — e.g. the
 * viewer's Problems panel — that want to key off it without parsing prose).
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCheckById } from "../registry";
import { makeCtx } from "../../test-helpers/testkit";

// self-register the markdownlint check
import "./markdownlint";

describe("markdownlint message format (writer-first, M32)", () => {
  test("message leads with the human description, not the rule code", async () => {
    const dir = await mkdtemp(join(tmpdir(), "print-md-mdlint-msg-"));
    try {
      await writeFile(join(dir, ".markdownlint.yaml"), "default: true\n");
      const mdFile = join(dir, "doc.md");
      // MD018: no space after the ATX heading hash.
      await writeFile(mdFile, "#Heading\n\nsome text\n");

      const check = getCheckById("source.markdownlint")!;
      const ctx = makeCtx({ inputDir: dir, markdownFiles: [mdFile] });
      const results = await check.run(ctx);

      const md018 = results.find((r) => r.message.includes("no-missing-space-atx"));
      expect(md018).toBeDefined();

      // Writer-first: the description leads the message.
      expect(md018!.message.startsWith("No space after hash on atx style heading")).toBe(true);

      // The rule code is demoted to a suffix, not the headline.
      expect(md018!.message.indexOf("MD018")).toBeGreaterThan(0);
      expect(md018!.message.startsWith("MD018")).toBe(false);

      // And it's ALSO available structurally, not just parsed from prose.
      expect(md018!.code).toBe("MD018");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

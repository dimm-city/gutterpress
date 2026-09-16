import { describe, expect, test } from "bun:test";
import { MemoryDocumentHost } from "../../src/core/memory-host.ts";
import { CORPUS_COMMAND_CASES, EXPECTED_COMMAND_KINDS } from "./support/command-harness.ts";
import { FIXTURES, FIXTURE_NAMES } from "./fixtures.ts";

/**
 * SFE-P2a Lane C — fixture liveness and the trivial no-edit byte-identity
 * check.
 *
 * DETAILS (2): "for each fixture, MemoryDocumentHost round-trip (construct,
 * getSnapshot, no edits) is trivially identical" — proven here directly,
 * with NO dependency on Lane B's command layer, so this file (unlike
 * byte-identity.test.ts / locality.test.ts / randomized.test.ts) always
 * runs regardless of Lane B's landing status.
 *
 * AP-21 ("empty result sets count as success") liveness assertions live
 * here: fixtures non-empty, and the command-kind list's size is pinned so a
 * future addition to the run-spec's command union cannot silently drop out
 * of corpus coverage without a visible test change.
 */

describe("corpus liveness (AP-21)", () => {
  test("the fixture corpus is non-empty and extends the P1b six", () => {
    expect(FIXTURE_NAMES.length).toBeGreaterThanOrEqual(19);
    for (const name of [
      "mixed bullet characters",
      "trailing spaces before newlines",
      "no final newline",
      "reference-style links",
      "HTML comments",
      "combined non-normalized markdown",
    ]) {
      expect(FIXTURE_NAMES).toContain(name);
    }
  });

  test("every fixture value is a string (never undefined/null)", () => {
    for (const name of FIXTURE_NAMES) {
      expect(typeof FIXTURES[name]).toBe("string");
    }
  });

  test(
    "EXPECTED_COMMAND_KINDS matches SFE-P2a.md's authorized command-list size exactly " +
      "(update this test, EXPECTED_COMMAND_KINDS, and CORPUS_COMMAND_CASES together if the run's command union changes)",
    () => {
      expect(EXPECTED_COMMAND_KINDS.length).toBe(12);
      const coveredKinds = new Set(CORPUS_COMMAND_CASES.map((c) => c.command.kind));
      for (const kind of EXPECTED_COMMAND_KINDS) {
        expect(coveredKinds.has(kind)).toBe(true);
      }
    },
  );
});

describe("no-edit byte identity — MemoryDocumentHost round-trip (DETAILS (1), trivial layer)", () => {
  for (const name of FIXTURE_NAMES) {
    test(`construct + getSnapshot with zero edits is byte-identical (${name})`, () => {
      const text = FIXTURES[name]!;
      const host = new MemoryDocumentHost({ text, version: 0 });
      const snapshot = host.getSnapshot();
      expect(snapshot.text).toBe(text);
      expect(snapshot.version).toBe(0);
      // Re-reading does not mutate or normalize anything.
      expect(host.getSnapshot().text).toBe(text);
    });
  }
});

describe("CRLF preservation — recorded finding (DETAILS (1): \"test and record\")", () => {
  test("CRLF bytes survive host construction/read untouched (no host-level EOL normalization)", () => {
    const text = FIXTURES["CRLF line endings"]!;
    expect(text).toContain("\r\n");
    const host = new MemoryDocumentHost({ text, version: 0 });
    // RECORDED FINDING: at the MemoryDocumentHost layer (and therefore for
    // any pure command function operating on `snapshot.text` via plain
    // string splicing — see apply-edit.ts), CRLF is preserved byte-for-byte.
    // Nothing in this contract layer normalizes line endings. This does NOT
    // by itself prove the same holds through Lane B's real
    // `@dimm-city/vscode-markdown-editor` fork mount/rendering pipeline in a
    // browser — that is Lane A's `tests/web`/`tests/vscode-adapter` surface,
    // outside this unit-level corpus's scope.
    expect(host.getSnapshot().text).toBe(text);
    expect(host.getSnapshot().text).toContain("\r\n");
  });
});

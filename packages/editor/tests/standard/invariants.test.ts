import { describe, expect, test } from "bun:test";
import type { EditorCommand } from "../../src/core/commands.ts";
import { applyCommand, type ApplyCommandResult } from "../../src/web/standard/apply-command.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";

/**
 * Cross-command invariants that apply to every member of the run spec's
 * "Command list" uniformly: out-of-range selection refusal, and a seeded
 * randomized-range sweep proving "apply succeeds or rejects cleanly, no
 * drift outside range" (run spec "Randomized ranges" row) for every
 * command against a small representative corpus.
 */

const ALL_COMMANDS: readonly EditorCommand[] = [
  { kind: "toggle-bold" },
  { kind: "toggle-italic" },
  { kind: "toggle-strike" },
  { kind: "toggle-inline-code" },
  { kind: "set-heading", level: 2 },
  { kind: "set-heading", level: "none" },
  { kind: "toggle-blockquote" },
  { kind: "toggle-list", variant: "bullet" },
  { kind: "toggle-list", variant: "ordered" },
  { kind: "toggle-list", variant: "task" },
  { kind: "insert-link", href: "url" },
  { kind: "insert-image", src: "img.png" },
  { kind: "toggle-code-block" },
  { kind: "insert-horizontal-rule" },
  { kind: "insert-table", rows: 1, cols: 2 },
];

describe("selection validation — every command", () => {
  for (const command of ALL_COMMANDS) {
    test(`${command.kind}${"variant" in command ? `/${command.variant}` : ""}: endExclusive past document length is refused, source unchanged`, () => {
      const snapshot = { text: "short", version: 0 };
      const result = applyCommand(snapshot, { start: 0, endExclusive: 999 }, command);
      expect("refused" in result).toBe(true);
      if ("refused" in result) {
        expect(result.refused.category).toBe("EDITOR_INVALID_RANGE");
      }
    });

    test(`${command.kind}${"variant" in command ? `/${command.variant}` : ""}: start > endExclusive is refused`, () => {
      const snapshot = { text: "short text", version: 0 };
      const result = applyCommand(snapshot, { start: 5, endExclusive: 2 }, command);
      expect("refused" in result).toBe(true);
    });
  }
});

// A small xorshift PRNG — deterministic across runs (no external
// dependency, matches this package's zero-runtime-dependency contract) so
// a failure is exactly reproducible from the fixed SEED below.
function xorshift(seed: number): () => number {
  let state = seed || 1;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
}

const SEED = 0x5fe_2a01;
const CORPUS = [
  "",
  "plain paragraph text",
  "# Heading\n\nBody paragraph.",
  "- item one\n- item two\n- item three",
  "1. first\n2. second",
  "> quoted line\n> second quoted line",
  "```js\nconst x = 1;\n```",
  "**bold** and _emph_ and `code` and ~~strike~~",
  "line one\nline two\nline three\nline four",
];

describe("randomized ranges — apply succeeds or refuses cleanly, never throws, never drifts", () => {
  const random = xorshift(SEED);

  for (const command of ALL_COMMANDS) {
    test(`${command.kind}${"variant" in command ? `/${command.variant}` : ""}: 25 random selections across the corpus`, () => {
      for (let i = 0; i < 25; i++) {
        const text = CORPUS[Math.floor(random() * CORPUS.length)]!;
        const a = Math.floor(random() * (text.length + 1));
        const b = Math.floor(random() * (text.length + 1));
        const start = Math.min(a, b);
        const endExclusive = Math.max(a, b);
        const snapshot = { text, version: 0 };

        let result: ApplyCommandResult | undefined;
        expect(() => {
          result = applyCommand(snapshot, { start, endExclusive }, command);
        }).not.toThrow();

        if (result && "edit" in result) {
          // No drift outside the declared range.
          assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
          expect(typeof result.edit.insert).toBe("string");
          expect(result.edit.expectedVersion).toBe(0);
        } else if (result) {
          expect("refused" in result).toBe(true);
        }
      }
    });
  }
});

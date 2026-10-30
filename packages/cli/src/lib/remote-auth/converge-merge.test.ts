/**
 * Tests for converge-merge.ts's isomorphic-git error guards — the two type
 * guards the merge path uses to tell a real merge conflict (which produces
 * marked-up text for the writer to blend) from a checkout refusal (which is
 * atomic: nothing on disk was touched) — and for the words it writes into a
 * book's history.
 *
 * TEST RUNNER: bun:test only.
 */
import { describe, expect, test } from "bun:test";

import {
  CONVERGE_MERGE_MESSAGE,
  CONVERGE_PREPARE_MESSAGE,
  CONVERGE_RESTORE_MESSAGE,
  isCheckoutConflict,
  isMergeConflictError,
} from "./converge-merge.ts";

describe("isMergeConflictError", () => {
  test("true only for code === 'MergeConflictError' and narrows the payload", () => {
    const err = Object.assign(new Error("merge conflict"), {
      code: "MergeConflictError",
      data: {
        filepaths: ["a.md"],
        bothModified: ["a.md"],
        deleteByUs: [],
        deleteByTheirs: [],
      },
    });
    expect(isMergeConflictError(err)).toBe(true);
    if (isMergeConflictError(err)) {
      expect(err.data.filepaths).toEqual(["a.md"]);
    }
  });

  test("false for any other error code or shape", () => {
    expect(isMergeConflictError(new Error("x"))).toBe(false);
    expect(isMergeConflictError({ code: "PushRejectedError" })).toBe(false);
    expect(isMergeConflictError(null)).toBe(false);
  });
});

describe("isCheckoutConflict", () => {
  test("true only for code === 'CheckoutConflictError'", () => {
    expect(isCheckoutConflict({ code: "CheckoutConflictError" })).toBe(true);
    expect(isCheckoutConflict({ code: "MergeConflictError" })).toBe(false);
    expect(isCheckoutConflict(new Error("x"))).toBe(false);
    expect(isCheckoutConflict(null)).toBe(false);
  });
});

describe("the history messages are writer copy", () => {
  // Shown raw on github.com. "Version" means a saved version (one side of a
  // combined passage is a "take"), and no Git word reaches a writer
  // (docs/ux-design-contract.md, Vocabulary).
  test("no Git word, and no \"version\" for one side of a combined change", () => {
    for (const message of [CONVERGE_PREPARE_MESSAGE, CONVERGE_RESTORE_MESSAGE, CONVERGE_MERGE_MESSAGE]) {
      expect(message).not.toMatch(/\bversions?\b|\bsync|snapshot|commit|\bgit\b|merge|repositor|\bbranch|\bpush|\bpull/i);
    }
  });
});

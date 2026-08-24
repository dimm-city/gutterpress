/**
 * Tests for converge-merge.ts's isomorphic-git error guards — the two type
 * guards the merge path uses to tell a real merge conflict (which produces
 * marked-up text for the writer to blend) from a checkout refusal (which is
 * atomic: nothing on disk was touched).
 *
 * TEST RUNNER: bun:test only.
 */
import { describe, expect, test } from "bun:test";

import { isCheckoutConflict, isMergeConflictError } from "./converge-merge.ts";

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

// Tests for compareSemver / comparePrerelease numeric-identifier ordering.
//
// Regression: comparePrerelease compared numeric identifiers via
// Number(x) - Number(y). For identifiers above 2^53 the IEEE-754 conversion
// loses precision (Number('9007199254740992') === Number('9007199254740993')),
// so two distinct prerelease tags compared equal. See defect
// compare-prerelease-float-precision.
import { describe, expect, test } from "bun:test";

// Electron mock so the module under test can import cleanly.
import { mock } from "bun:test";
mock.module("electron", () => ({
  app: { getPath: () => "/tmp", getVersion: () => "0.0.0" },
}));

const { compareSemver } = await import("../../electron/updater/index.js");

describe("compareSemver prerelease numeric ordering", () => {
  test("orders ordinary numeric prerelease identifiers numerically", () => {
    expect(compareSemver("1.0.0-beta.2", "1.0.0-beta.10")).toBe(-1);
    expect(compareSemver("1.0.0-beta.10", "1.0.0-beta.2")).toBe(1);
  });

  test("orders large numeric identifiers above 2^53 strictly", () => {
    // 2^53 = 9007199254740992; the next integer is not representable as a
    // distinct IEEE-754 double, which is what the naive Number() subtraction hit.
    expect(
      compareSemver("1.0.0-9007199254740992", "1.0.0-9007199254740993")
    ).toBe(-1);
    expect(
      compareSemver("1.0.0-9007199254740993", "1.0.0-9007199254740992")
    ).toBe(1);
    expect(
      compareSemver("1.0.0-9007199254740992", "1.0.0-9007199254740992")
    ).toBe(0);
  });
});

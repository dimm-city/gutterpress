import { describe, expect, test } from "bun:test";
import { findBrokenXrefRefs } from "./build.ts";

describe("findBrokenXrefRefs", () => {
  test("no sites, no broken refs", () => {
    expect(findBrokenXrefRefs([], {})).toEqual([]);
  });

  test("resolved bare-fragment href is not flagged", () => {
    expect(findBrokenXrefRefs([{ href: "#ch1" }], { ch1: "Chapter One" })).toEqual([]);
  });

  test("unresolved bare-fragment href is named", () => {
    expect(findBrokenXrefRefs([{ href: "#ch99" }], { ch1: "Chapter One" })).toEqual(["#ch99"]);
  });

  test("non-bare hrefs (other file, absolute URL) are skipped even if unresolved", () => {
    expect(
      findBrokenXrefRefs(
        [{ href: "other.html#ch1" }, { href: "https://example.com/#ch1" }],
        {},
      ),
    ).toEqual([]);
  });

  test("mixed sites report only the broken ones, in document order", () => {
    expect(
      findBrokenXrefRefs(
        [{ href: "#ok" }, { href: "#typo" }, { href: "other.html#x" }, { href: "#missing" }],
        { ok: "Fine" },
      ),
    ).toEqual(["#typo", "#missing"]);
  });

  test("a broken href repeated across many sites is reported once, first-seen order", () => {
    expect(
      findBrokenXrefRefs(
        [{ href: "#missing" }, { href: "#ok" }, { href: "#missing" }, { href: "#missing" }],
        { ok: "Fine" },
      ),
    ).toEqual(["#missing"]);
  });
});

import { describe, expect, test } from "bun:test";
import { fixtureLabels } from "./native-parity-gate.ts";

/**
 * A fixture's label names its staging directory (`join(WORK, label)`) and is
 * what `KNOWN_DIVERGENCES.fixture` matches on. Two of the default fixtures are
 * both called `book` — `docs/fixtures/css-authoring-spike/book` and
 * `docs/fixtures/gp-image-positioning/book`. Under the old bare-basename
 * scheme they shared one staging directory AND one allowlist identity, so a
 * single `KNOWN_DIVERGENCES` entry would have silently excused divergences in
 * a book nobody meant to excuse. These tests pin the disambiguation.
 */
describe("fixtureLabels", () => {
  test("leaves unique basenames alone", () => {
    expect(
      fixtureLabels([
        "/repo/examples/with-design-guide/book-01",
        "/repo/examples/gutterpress-user-guide",
      ]),
    ).toEqual(["book-01", "gutterpress-user-guide"]);
  });

  test("THE COLLISION REPRO: two fixtures named `book` get distinct labels", () => {
    const labels = fixtureLabels([
      "/repo/docs/fixtures/css-authoring-spike/book",
      "/repo/docs/fixtures/gp-image-positioning/book",
    ]);
    expect(labels).toEqual(["css-authoring-spike/book", "gp-image-positioning/book"]);
    expect(new Set(labels).size).toBe(2);
  });

  test("disambiguates only the duplicates, not the whole set", () => {
    const labels = fixtureLabels([
      "/repo/examples/with-design-guide/design-guide",
      "/repo/docs/fixtures/css-authoring-spike/book",
      "/repo/docs/fixtures/gp-image-positioning/book",
    ]);
    expect(labels).toEqual([
      "design-guide",
      "css-authoring-spike/book",
      "gp-image-positioning/book",
    ]);
  });

  test("walks up further when one parent segment is not enough", () => {
    const labels = fixtureLabels(["/repo/a/shared/book", "/repo/b/shared/book"]);
    expect(new Set(labels).size).toBe(2);
    expect(labels[0]).toBe("a/shared/book");
    expect(labels[1]).toBe("b/shared/book");
  });

  test("tolerates trailing slashes", () => {
    expect(fixtureLabels(["/repo/examples/book-01/"])).toEqual(["book-01"]);
  });

  test("terminates on genuinely identical paths instead of looping", () => {
    // Nothing can disambiguate the same path from itself, so it walks up until
    // it runs out of segments and returns. The contract under test is
    // TERMINATION — a duplicate that cannot be resolved must not spin.
    const labels = fixtureLabels(["/repo/x/book", "/repo/x/book"]);
    expect(labels).toEqual(["repo/x/book", "repo/x/book"]);
  });

  test("empty input", () => {
    expect(fixtureLabels([])).toEqual([]);
  });
});

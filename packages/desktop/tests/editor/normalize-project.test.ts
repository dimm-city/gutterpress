import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { planNormalize } from "../../src/lib/editor/normalize-project";
import { mdFilesIn, REPO } from "../support/corpus";

describe("planNormalize", () => {
  test("reports a file that is already canonical as unchanged", () => {
    const r = planNormalize([{ path: "a.md", text: "# Title\n\nBody.\n" }]);
    expect(r.unchanged).toEqual(["a.md"]);
    expect(r.changed).toEqual([]);
    expect(r.refused).toEqual([]);
  });

  test("reports the canonical text for a file that needs reformatting", () => {
    // `+` bullets and `__bold__` are valid markdown that the serializer
    // spells differently (verified: the canonical bullet is `*`). That IS the
    // churn this command exists to land in one commit.
    const r = planNormalize([{ path: "a.md", text: "+ one\n+ two\n" }]);
    expect(r.changed).toHaveLength(1);
    expect(r.changed[0]!.path).toBe("a.md");
    expect(r.changed[0]!.text).toBe("* one\n* two\n");
  });

  test("REFUSES a file the document model cannot represent, with a reason", () => {
    // A footnote is the corpus's one real refusal. Rewriting it would drop
    // content from somebody's book.
    const r = planNormalize([{ path: "notes.md", text: "Text[^1]\n\n[^1]: A note.\n" }]);
    expect(r.changed).toEqual([]);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0]!.path).toBe("notes.md");
    expect(r.refused[0]!.reason.length).toBeGreaterThan(0);
  });

  test("one refused file does not stop the rest of the project", () => {
    const r = planNormalize([
      { path: "ok.md", text: "+ one\n" },
      { path: "bad.md", text: "Text[^1]\n\n[^1]: A note.\n" },
      { path: "fine.md", text: "# Done\n" },
    ]);
    expect(r.changed.map((c) => c.path)).toEqual(["ok.md"]);
    expect(r.refused.map((c) => c.path)).toEqual(["bad.md"]);
    expect(r.unchanged).toEqual(["fine.md"]);
  });

  test("never returns a file in more than one bucket", () => {
    const r = planNormalize([
      { path: "a.md", text: "+ one\n" },
      { path: "b.md", text: "# B\n" },
      { path: "c.md", text: "Text[^1]\n\n[^1]: n.\n" },
    ]);
    const all = [...r.changed.map((c) => c.path), ...r.unchanged, ...r.refused.map((c) => c.path)];
    expect(new Set(all).size).toBe(all.length);
  });

  test("planning writes nothing — it only reports", () => {
    // The author consents to the commit; the plan is what they consent to.
    const input = { path: "a.md", text: "+ one\n" };
    planNormalize([input]);
    expect(input.text).toBe("+ one\n");
  });
});

describe("on the real corpus", () => {
  const BOOKS = [
    "examples/gutterpress-user-guide",
    "examples/with-design-guide/design-guide",
    "docs/fixtures/css-authoring-spike/book",
  ];
  const files = BOOKS.flatMap((b) => mdFilesIn(join(REPO, b))).map((p) => ({
    path: p.slice(REPO.length + 1),
    text: readFileSync(p, "utf8"),
  }));

  test("the corpus is present — this must not pass vacuously", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  test("normalizing a real project is idempotent: re-running changes nothing", () => {
    // The property that makes this safe to run on somebody's book. If a second
    // run produced more diffs, "one deliberate commit" would be a lie.
    const first = planNormalize(files);
    const second = planNormalize(
      first.changed.map((c) => ({ path: c.path, text: c.text })),
    );
    expect(second.changed).toEqual([]);
    expect(second.refused).toEqual([]);
  });

  test("every refusal on the real corpus names its cause", () => {
    for (const r of planNormalize(files).refused) {
      expect(r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("representability preflight", () => {
  /**
   * This is the WRITING path, so it must refuse everything the editor refuses.
   * Going straight to `isFixpoint` was not equivalent: a `[ref]: url`
   * definition is consumed by markdown-it without emitting a token, so nothing
   * raises and losing it is stable on the second pass — the plan called the
   * lossy output safe and the route wrote it.
   */
  test("a file defining link references is refused, not rewritten", () => {
    const src = 'Read the [docs][d].\n\n[d]: https://example.com "Docs"\n';
    const r = planNormalize([{ path: "a.md", text: src }]);
    expect(r.changed).toEqual([]);
    expect(r.refused).toHaveLength(1);
    expect(r.refused[0]!.reason).toContain("link reference");
  });

  test("an unused definition is refused too — it renders nothing, so no gate sees it", () => {
    const r = planNormalize([{ path: "a.md", text: "Text.\n\n[unused]: https://x.com\n" }]);
    expect(r.changed).toEqual([]);
    expect(r.refused).toHaveLength(1);
  });

  test("a file the schema cannot model is still refused", () => {
    const r = planNormalize([{ path: "a.md", text: "Text[^1]\n\n[^1]: note\n" }]);
    expect(r.changed).toEqual([]);
    expect(r.refused).toHaveLength(1);
  });

  test("an ordinary file is still normalized", () => {
    const r = planNormalize([{ path: "a.md", text: "# Title\n\n- one\n- two\n" }]);
    expect(r.refused).toEqual([]);
    expect(r.changed.length + r.unchanged.length).toBe(1);
  });
});

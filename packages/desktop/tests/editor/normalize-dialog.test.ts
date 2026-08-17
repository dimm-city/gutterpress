import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { renderComponent, textOf } from "../support/render-svelte";

/**
 * The consent dialog for the one-time reformat, RENDERED.
 *
 * This dialog is the only thing standing between an author and a rewrite of
 * their whole book, so what it shows them is the safety property — a count
 * they cannot inspect is not consent.
 */
const noop = () => {};

const dialog = (plan: unknown, applying = false) =>
  renderComponent("lib/components/NormalizeDialog.svelte", {
    plan,
    applying,
    onApply: noop,
    onDismiss: noop,
  });

const PLAN = {
  applied: false,
  changed: [
    { path: "01-intro.md", before: "+ one\n+ two\n", after: "* one\n* two\n" },
    { path: "02-body.md", before: "__b__\n", after: "**b**\n" },
  ],
  unchanged: ["03-end.md"],
  refused: [{ path: "notes.md", reason: "Token type `footnote_ref` not supported" }],
};

describe("NormalizeDialog", () => {
  test("renders nothing without a plan", async () => {
    expect(await dialog(null)).not.toContain("nz-dialog");
  });

  test("names every file that would change", async () => {
    const html = await dialog(PLAN);
    expect(html).toContain("01-intro.md");
    expect(html).toContain("02-body.md");
    expect(textOf(html)).toContain("2 files would be reformatted");
  });

  test("names the files it will NOT touch, and why", async () => {
    // Fail-closed has to be visible. A file silently skipped is how an author
    // ends up believing a book was fully converted when it was not.
    const html = await dialog(PLAN);
    expect(html).toContain("notes.md");
    expect(html).toContain("footnote_ref");
    expect(textOf(html)).toContain("left untouched and will open as markdown");
  });

  test("offers a per-file way to see the actual change", async () => {
    // Measured: 27 of 32 corpus files change, dominated by paragraph
    // rewrapping. A count alone is not something an author can consent to.
    const html = await dialog(PLAN);
    expect((html.match(/Show changes/g) ?? []).length).toBe(PLAN.changed.length);
  });

  test("always offers a way out", async () => {
    expect(await dialog(PLAN)).toContain("Decide later");
  });

  test("uses the shared modal contract — it IS a dialog", async () => {
    // Unlike the inline chrome, this one is modal and must trap focus. Checked
    // at SOURCE level, not in the render: `dialogBehavior` is a `use:` action
    // and actions do not run during SSR, so the role/aria-modal it applies are
    // legitimately absent from the rendered markup.
    const src = readFileSync(
      resolve(import.meta.dir, "../../src/lib/components/NormalizeDialog.svelte"),
      "utf8",
    );
    expect(src).toContain("use:dialogBehavior");
    expect(src).toContain("labelledBy: \"nz-title\"");
    // and the id that names it IS in the render
    expect(await dialog(PLAN)).toContain('id="nz-title"');
  });

  test("a book already canonical says so and cannot be applied", async () => {
    const html = await dialog({ applied: false, changed: [], unchanged: ["a.md"], refused: [] });
    expect(textOf(html)).toContain("already in that style");
    expect(html).toContain("disabled");
  });

  test("the apply button is disabled while the write is in flight", async () => {
    // Double-firing would re-run the rewrite over a half-written project.
    const html = await dialog(PLAN, true);
    expect(html).toContain("Tidying…");
    expect(html).toContain("disabled");
  });

  test("says plainly that words are not changed", async () => {
    // The author's fear on being asked this is "will it edit my writing?".
    expect(await dialog(PLAN)).toContain("Your words are not changed");
  });
});

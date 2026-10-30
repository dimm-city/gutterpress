import { describe, expect, test } from "bun:test";
import { applyTokenUpdates, rootTokens } from "./root-tokens";

/** One sheet, one batch: the new text. */
const update = (css: string, name: string, value: string | null): string =>
  applyTokenUpdates([css], 0, [{ name, value }])[0]!;

/** A value with `;` inside a quoted `url("data:…")`, which a `[^;]+` scan cut short. */
const DATA_URI = `url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg'><path d='M0 0;L4 4'/></svg>")`;

describe("rootTokens: what a stylesheet declares at root level", () => {
  test("reads :root custom properties in source order, and nothing from other rules", () => {
    const css = `:root {\n  --a: #111111;\n  --b: 2rem;\n  color: red;\n}\nh1 { --c: 1; color: var(--a); }`;
    expect(rootTokens(css).map((t) => [t.name, t.value])).toEqual([
      ["--a", "#111111"],
      ["--b", "2rem"],
    ]);
  });

  test("a value that wraps across lines is read in full", () => {
    const css = ':root {\n  --font-body: "Georgia",\n    "Times New Roman",\n    serif;\n  --leading: 1.55;\n}';
    expect(rootTokens(css).map((t) => [t.name, t.value])).toEqual([
      ["--font-body", '"Georgia",\n    "Times New Roman",\n    serif'],
      ["--leading", "1.55"],
    ]);
  });

  test("a `;` inside url(\"data:…\") is part of the value", () => {
    const css = `:root {\n  --paper: ${DATA_URI};\n  --after: 1;\n}\n`;
    expect(rootTokens(css)).toEqual([
      { name: "--paper", value: DATA_URI },
      { name: "--after", value: "1" },
    ]);
  });

  test("a :root in a comment, @media or @supports is not root level; one in a cascade layer is, with its layer", () => {
    const css = [
      "/* :root { --commented: 1; } */",
      "@media print { :root { --print-only: 1; } }",
      "@supports (color: oklch(0 0 0)) { :root { --modern: 1; } }",
      "@layer ext.look { :root { --look: 1; } @layer theme { :root { --theme: 1; } } }",
      ":root, ::backdrop { --both: 1; }",
      ":root { --plain: 1; }",
    ].join("\n");
    expect(rootTokens(css).map((t) => [t.name, t.layer ?? null])).toEqual([
      ["--look", "ext.look"],
      ["--theme", "ext.look.theme"],
      ["--both", null],
      ["--plain", null],
    ]);
  });
});

// ── Token annotations (issue #244, block defaults #435) ─────────────────────

describe("rootTokens: @group / @label / @internal", () => {
  test("a stylesheet with no annotation comments has no groups or labels, and drops nothing", () => {
    const tokens = rootTokens(`:root {\n  --heading-color: #cc0000;\n  --body-size: 1rem;\n}\n`);
    expect(tokens.map((t) => t.name)).toEqual(["--heading-color", "--body-size"]);
    expect(tokens.every((t) => t.group === undefined && t.label === undefined)).toBe(true);
  });

  test("@label and @group apply to the next declaration only", () => {
    const css = `:root {\n  /* @label Accent color */\n  /* @group Colors */\n  --color-accent: #2b4c7e;\n  --untouched: 1rem;\n}\n`;
    expect(rootTokens(css)).toEqual([
      { name: "--color-accent", value: "#2b4c7e", label: "Accent color", group: "Colors" },
      { name: "--untouched", value: "1rem" },
    ]);
  });

  test("directives combined in one comment do not bleed into each other", () => {
    const [t] = rootTokens(`:root {\n  /* @label Accent color @group Colors */\n  --color-accent: #2b4c7e;\n}\n`);
    expect([t!.label, t!.group]).toEqual(["Accent color", "Colors"]);
  });

  test("@internal leaves the token out; a plain comment changes nothing", () => {
    const css = [
      ":root {",
      "  /* just a note about spacing */",
      "  --gap: 1rem;",
      "  /* @internal */",
      "  --dc-skill-tab-shape: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);",
      "}",
    ].join("\n");
    expect(rootTokens(css)).toEqual([{ name: "--gap", value: "1rem" }]);
  });

  test("a plain declaration between an annotation and its custom property does not consume it", () => {
    const [t] = rootTokens(`:root {\n  /* @label Paper */\n  color: red;\n  --paper: #fff;\n}\n`);
    expect(t!.label).toBe("Paper");
  });

  test("@internal directly before :root hides the block, except declarations annotated themselves", () => {
    const css = [
      "/* Component defaults: override them on a context selector, not here. */",
      "/* @internal */",
      ":root {",
      "  --dc-tab-shape: 2pt;",
      "  /* @label Section accent */",
      "  --dc-section-accent: var(--rust);",
      "  /* @group Paper */",
      "  --dc-paper: #fffdf7;",
      "  /* @internal */",
      "  --dc-paper-edge: 1px;",
      "}",
      ":root {",
      "  --other: 1;",
      "}",
    ].join("\n");
    expect(rootTokens(css).map((t) => [t.name, t.group ?? null, t.label ?? null])).toEqual([
      ["--dc-section-accent", null, "Section accent"],
      ["--dc-paper", "Paper", null],
      ["--other", null, null],
    ]);
  });

  test("@group directly before :root groups the block; a declaration's own @group or @internal still wins", () => {
    const css = [
      "/* @group Paper */",
      ":root {",
      "  --paper: #fff;",
      "  /* @group Ink */",
      "  --ink: #000;",
      "  --ink-faint: #666;",
      "  /* @internal */",
      "  --ink-cache: 0;",
      "}",
    ].join("\n");
    expect(rootTokens(css).map((t) => [t.name, t.group])).toEqual([
      ["--paper", "Paper"],
      ["--ink", "Ink"],
      ["--ink-faint", "Paper"],
    ]);
  });

  test("a comment before :root counts only when nothing but comments separates them; @label there is ignored", () => {
    expect(rootTokens("/* @internal */\nh1 { color: red }\n:root {\n  --a: 1;\n}").map((t) => t.name)).toEqual(["--a"]);
    const label = "/* @label Nope @group Colors */\n\n/* prose */\n:root {\n  --paper: #fff;\n}";
    expect(rootTokens(label)).toEqual([{ name: "--paper", value: "#fff", group: "Colors" }]);
  });

  test("a } inside a comment neither ends the block nor yields a token (#433)", () => {
    const css = [
      ":root {",
      "  /* Override per chapter: `#chapter-03 { --dc-section-accent: var(--rust); }` */",
      "  --dc-section-accent: var(--brand-magenta);",
      "  --dc-tab-shape: 2pt;",
      "}",
      "/* :root { --not-a-token: 1; } */",
      "h1 { --scoped: 2; }",
    ].join("\n");
    expect(rootTokens(css).map((t) => [t.name, t.value])).toEqual([
      ["--dc-section-accent", "var(--brand-magenta)"],
      ["--dc-tab-shape", "2pt"],
    ]);
    const edited = update(css, "--dc-section-accent", "var(--teal)");
    expect(edited).toBe(css.replace("var(--brand-magenta)", "var(--teal)"));
    expect(update(css, "--dc-tab-shape", null)).toBe(css.replace("\n  --dc-tab-shape: 2pt;", ""));
  });
});

// ── The writer ──────────────────────────────────────────────────────────────

describe("applyTokenUpdates: a postcss edit that changes only what it names", () => {
  test("replaces a declaration in place and inserts a missing one at the top of :root", () => {
    const css = `:root {\n  --a: #111111;\n}`;
    expect(update(css, "--a", "#222222")).toBe(`:root {\n  --a: #222222;\n}`);
    expect(update(css, "--b", "3rem")).toBe(`:root {\n  --b: 3rem;\n  --a: #111111;\n}`);
  });

  test("a batch folds every update onto one result; an empty batch returns the sheet as given", () => {
    const base = `:root {\n  --a: #111111;\n  --b: #222222;\n}`;
    expect(applyTokenUpdates([base], 0, [
      { name: "--a", value: "#aaaaaa" },
      { name: "--b", value: "#bbbbbb" },
    ])).toEqual([`:root {\n  --a: #aaaaaa;\n  --b: #bbbbbb;\n}`]);
    expect(applyTokenUpdates([base], 0, [])).toEqual([base]);
  });

  test("a sheet with no :root gets one at the end", () => {
    expect(update("body { color: red; }", "--a", "#abcdef")).toBe("body { color: red; }\n:root {\n  --a: #abcdef;\n}\n");
    expect(update("/* mine */\n", "--a", "#abcdef")).toBe("/* mine */\n:root {\n  --a: #abcdef;\n}\n");
  });

  test("a scoped rule, a commented-out declaration and a longer name are left exactly as written", () => {
    expect(update(":root {\n  --leading: 1.5;\n}\n.cover { --color-paper: black; }\n", "--color-paper", "#fafafa")).toBe(
      ":root {\n  --color-paper: #fafafa;\n  --leading: 1.5;\n}\n.cover { --color-paper: black; }\n",
    );
    expect(update("/* --color-accent: #c00; */\n:root {\n  /* --color-accent: #c00; */\n}\n", "--color-accent", "#00f")).toBe(
      "/* --color-accent: #c00; */\n:root {\n  --color-accent: #00f;\n  /* --color-accent: #c00; */\n}\n",
    );
    expect(update(":root {\n  --my--color-accent: red;\n  --color-accent-2: blue;\n}\n", "--color-accent", "#00f")).toBe(
      ":root {\n  --color-accent: #00f;\n  --my--color-accent: red;\n  --color-accent-2: blue;\n}\n",
    );
  });

  test("a :root { inside a comment before the real block does not receive an insert", () => {
    const css = "/* Example: :root { --color-accent: red; } */\n:root {\n  --b: 2;\n}\n";
    expect(update(css, "--color-accent", "#00f")).toBe(
      "/* Example: :root { --color-accent: red; } */\n:root {\n  --color-accent: #00f;\n  --b: 2;\n}\n",
    );
  });

  test("an insert never lands in @media; a declaration there is not the book's setting and is left alone", () => {
    const css = "@media print {\n  :root { --a: 2; }\n}\n";
    expect(update(css, "--a", "3")).toBe(`${css}:root {\n  --a: 3;\n}\n`);
    const both = ":root {\n  --a:1;\n}\n@media print {\n  :root { --a: 2; }\n}\n";
    expect(update(both, "--a", "3")).toBe(":root {\n  --a:3;\n}\n@media print {\n  :root { --a: 2; }\n}\n");
    expect(update(both, "--a", null)).toBe("@media print {\n  :root { --a: 2; }\n}\n");
  });

  test("a url(\"data:…\") value with ; inside round-trips byte for byte", () => {
    const css = `:root {\n  --paper: ${DATA_URI};\n  --b: 2;\n}\n`;
    // Read, then write the same value back: nothing changes.
    const [paper] = rootTokens(css);
    expect(update(css, "--paper", paper!.value)).toBe(css);
    // Another token's edit leaves it untouched.
    expect(update(css, "--b", "3")).toBe(css.replace("--b: 2;", "--b: 3;"));
    // Written as a new value, it is stored whole and reads back whole.
    const added = update(":root {\n}\n", "--paper", DATA_URI);
    expect(added).toBe(`:root {\n  --paper: ${DATA_URI};\n}\n`);
    expect(rootTokens(added)[0]!.value).toBe(DATA_URI);
  });

  test("writing back the value as read restores a declaration with comments and spacing byte for byte", () => {
    const css = ":root {\n  --a:   foo /* note */  ;\n  --b: 1\n}\n";
    const [a, b] = rootTokens(css);
    const changed = update(update(css, "--a", "bar"), "--b", "2");
    expect(update(update(changed, "--a", a!.value), "--b", b!.value)).toBe(css);
  });

  test("null removes the root-level declaration with its line, and an emptied :root with it", () => {
    const css = "/* --a: 0; */\n:root {\n  --b: 2;\n  --a: 1;\n}\n.x { --a: 9; }\n";
    expect(update(css, "--a", null)).toBe("/* --a: 0; */\n:root {\n  --b: 2;\n}\n.x { --a: 9; }\n");
    // Nothing to remove: the sheet comes back unchanged, and no :root is added.
    expect(update(".x { --a: 9; }\n", "--a", null)).toBe(".x { --a: 9; }\n");
  });

  test("adding a token and removing it again gives back the sheet byte for byte", () => {
    for (const css of ["/* mine */\n", "", ":root {\n  --b: 2;\n}\n", ":root { --b: 2; }\n", "a {}\n:root {\n  --b: 2;\n}\n.c {}\n"]) {
      const added = update(css, "--a", "#abcdef");
      expect(added).not.toBe(css);
      expect(update(added, "--a", null)).toBe(css);
    }
  });

  test("a var(--name) reference is written as the value, like a color (#482)", () => {
    const css = `:root {\n  --color-ink: #222222;\n  --color-accent: #2b6cb0;\n}`;
    expect(update(css, "--color-accent", "var(--color-ink)")).toBe(
      `:root {\n  --color-ink: #222222;\n  --color-accent: var(--color-ink);\n}`,
    );
  });

  test("a value that would not stay one declaration's value is refused, and nothing is written", () => {
    const css = `:root {\n  --a: #111111;\n}`;
    for (const value of ["red; --b: blue", "red } body { display: none", "var(--x", "red; } :root {"]) {
      expect(() => applyTokenUpdates([css], 0, [{ name: "--a", value }])).toThrow(/can't be saved as --a: it is not one CSS value/);
    }
    // The whole batch is refused, so a good update beside a bad one does not land either.
    expect(() =>
      applyTokenUpdates([css], 0, [
        { name: "--b", value: "3rem" },
        { name: "--a", value: "x; }" },
      ]),
    ).toThrow(/it is not one CSS value/);
    // A semicolon inside a string or url() is part of one value.
    expect(update(css, "--a", 'url("data:image/svg+xml;utf8,x")')).toBe(`:root {\n  --a: url("data:image/svg+xml;utf8,x");\n}`);
  });

  test("an empty :root {} (a new book.css) gets the declaration with its semicolon", () => {
    expect(update(":root {\n}\n", "--a", "1")).toBe(":root {\n  --a: 1;\n}\n");
  });

  test("across sheets: a value goes where the book declares it — the last sheet that does — else into the target", () => {
    const first = ":root {\n  --a: 1;\n  --both: 1;\n}\n";
    const second = "h1 { color: red; }\n:root {\n  --b: 2;\n  --both: 2;\n}\n";
    expect(applyTokenUpdates([first, second], 0, [{ name: "--b", value: "20" }])).toEqual([
      first,
      second.replace("--b: 2;", "--b: 20;"),
    ]);
    expect(applyTokenUpdates([first, second], 0, [{ name: "--both", value: "3" }])).toEqual([
      first,
      second.replace("--both: 2;", "--both: 3;"),
    ]);
    expect(applyTokenUpdates([first, second], 0, [{ name: "--new", value: "4" }])).toEqual([
      ":root {\n  --new: 4;\n  --a: 1;\n  --both: 1;\n}\n",
      second,
    ]);
    // A removal takes it out of every sheet, so what a look sets shows through.
    expect(applyTokenUpdates([first, second], 0, [{ name: "--both", value: null }])).toEqual([
      ":root {\n  --a: 1;\n}\n",
      "h1 { color: red; }\n:root {\n  --b: 2;\n}\n",
    ]);
  });
});

import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  makeStyleToken,
  parseStyleTokens,
  updateRootToken,
  applyTokenUpdates,
  derivedTokenLabel,
  firstFontFamily,
  SHARED_TOKEN_LABELS,
} from "../../src/lib/style-tokens";

test("makeStyleToken classifies color / length / font / text", () => {
  expect(makeStyleToken("--heading-color", "#cc0000").kind).toBe("color");
  const len = makeStyleToken("--gap", "1.5rem");
  expect(len.kind).toBe("length");
  expect(len.number).toBe(1.5);
  expect(len.unit).toBe("rem");
  // A font stack is now its own guided kind, not raw "Other" text (M36).
  expect(makeStyleToken("--font-body", "Georgia, serif").kind).toBe("font");
  expect(makeStyleToken("--accent-note", "italic").kind).toBe("text");
  expect(makeStyleToken("--heading-color", "#cc0000").label).toBe("Heading color");
});

test("makeStyleToken routes named CSS colors through the color control (M36)", () => {
  // Previously `white`/`black`/etc fell to a bare text input because only
  // hex/rgb/hsl/oklch were recognized as colors.
  expect(makeStyleToken("--color-paper", "white").kind).toBe("color");
  expect(makeStyleToken("--color-ink", "black").kind).toBe("color");
  expect(makeStyleToken("--accent", "rebeccapurple").kind).toBe("color");
  expect(makeStyleToken("--overlay", "Transparent").kind).toBe("color");
  // Case-insensitive.
  expect(makeStyleToken("--color-paper", "WHITE").kind).toBe("color");
  // A non-color word must not be misclassified as a color.
  expect(makeStyleToken("--font-body", "Georgia").kind).not.toBe("color");
});

test("makeStyleToken detects font-family tokens by property name (M36)", () => {
  // Every built-in theme names its font tokens this way — the first thing a
  // writer changes must not land in "Other" as raw text.
  expect(makeStyleToken("--font-body", `"Georgia", "Times New Roman", serif`).kind).toBe("font");
  expect(makeStyleToken("--font-display", `"Impact", "Arial Black", sans-serif`).kind).toBe("font");
  expect(makeStyleToken("--font-mono", `"Menlo", "Consolas", monospace`).kind).toBe("font");
  // Font-size/weight/scale/style must NOT be misclassified as font-family.
  expect(makeStyleToken("--font-size", "12pt").kind).toBe("length");
  expect(makeStyleToken("--font-weight", "600").kind).toBe("number");
});

test("makeStyleToken detects font-family tokens by value shape even without 'font' in the name (M36)", () => {
  const t = makeStyleToken("--heading-typeface", `"Iowan Old Style", Georgia, serif`);
  expect(t.kind).toBe("font");
  // A single generic keyword with no name hint still counts.
  expect(makeStyleToken("--body-typeface", "serif").kind).toBe("font");
  // A comma list with no generic-family fallback is NOT assumed to be a font.
  expect(makeStyleToken("--misc-list", "foo, bar").kind).not.toBe("font");
});

test("makeStyleToken classifies unitless numbers as the numeric kind (M36)", () => {
  const t = makeStyleToken("--leading", "1.55");
  expect(t.kind).toBe("number");
  expect(t.number).toBe(1.55);
  expect(t.unit).toBeUndefined();
  expect(makeStyleToken("--z-index", "2").kind).toBe("number");
  expect(makeStyleToken("--offset", "-1.5").kind).toBe("number");
});

test("parseStyleTokens reads :root custom properties in source order", () => {
  const css = `:root {\n  --a: #111111;\n  --b: 2rem;\n}\nh1 { color: var(--a); }`;
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => t.name)).toEqual(["--a", "--b"]);
});

test("parseStyleTokens reads a value that wraps across multiple physical lines (M36)", () => {
  // Previously one-declaration-per-line parsing required the terminating `;`
  // on the SAME line as the property name, so a wrapped value like this font
  // stack was silently hidden from the panel entirely.
  const css = [
    ":root {",
    '  --font-body: "Georgia",',
    '    "Times New Roman",',
    "    serif;",
    "  --leading: 1.55;",
    "}",
  ].join("\n");
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => t.name)).toEqual(["--font-body", "--leading"]);
  const font = tokens.find((t) => t.name === "--font-body")!;
  expect(font.kind).toBe("font");
  expect(font.value).toContain("Times New Roman");
  expect(font.value).toContain("serif");
  const leading = tokens.find((t) => t.name === "--leading")!;
  expect(leading.kind).toBe("number");
  expect(leading.number).toBe(1.55);
});

test("updateRootToken replaces an existing declaration and inserts a missing one", () => {
  const css = `:root {\n  --a: #111111;\n}`;
  expect(updateRootToken(css, "--a", "#222222")).toContain("--a: #222222;");
  const inserted = updateRootToken(css, "--b", "3rem");
  expect(inserted).toContain("--a: #111111;");
  expect(inserted).toContain("--b: 3rem;");
});

// The core regression: two DIFFERENT token edits committed against the SAME base
// CSS. A naive last-write-wins (apply each independently to the original string,
// keep the last result) drops the first edit. applyTokenUpdates must fold BOTH
// onto one accumulated string so neither is clobbered.
test("applyTokenUpdates folds multiple edits onto one base — both survive", () => {
  const base = `:root {\n  --a: #111111;\n  --b: #222222;\n}`;

  // Demonstrate the bug the fold fixes: independent last-write-wins loses --a.
  const naiveLastWriteWins = [
    { name: "--a", value: "#aaaaaa" },
    { name: "--b", value: "#bbbbbb" },
  ].map((u) => updateRootToken(base, u.name, u.value)).at(-1)!;
  expect(naiveLastWriteWins).not.toContain("--a: #aaaaaa;");

  // The fold applies every mutation to one threaded result.
  const folded = applyTokenUpdates(base, [
    { name: "--a", value: "#aaaaaa" },
    { name: "--b", value: "#bbbbbb" },
  ]);
  expect(folded).toContain("--a: #aaaaaa;");
  expect(folded).toContain("--b: #bbbbbb;");
});

test("applyTokenUpdates with no updates returns the input unchanged", () => {
  const base = `:root {\n  --a: #111111;\n}`;
  expect(applyTokenUpdates(base, [])).toBe(base);
});

test("updateRootToken appends a :root block when the stylesheet has none", () => {
  // Previously this returned the CSS unchanged, silently dropping the edit.
  const out = updateRootToken("body { color: red; }", "--a", "#abcdef");
  expect(out).toContain(":root {");
  expect(out).toContain("--a: #abcdef;");
  // The new token must be discoverable by the parser round-trip.
  expect(parseStyleTokens(out).some((t) => t.name === "--a" && t.value === "#abcdef")).toBe(true);
});

// The target is an author's own stylesheet, so only `:root` declarations are
// tokens: a scoped rule, a comment, or a longer name that ends in the same
// letters is the author's and is left exactly as written.
test("updateRootToken leaves a scoped declaration alone and sets the token in :root", () => {
  const css = ":root {\n  --leading: 1.5;\n}\n.cover { --color-paper: black; }\n";
  expect(updateRootToken(css, "--color-paper", "#fafafa")).toBe(
    ":root {\n  --color-paper: #fafafa;\n  --leading: 1.5;\n}\n.cover { --color-paper: black; }\n",
  );
});

test("updateRootToken leaves a commented-out declaration alone and adds the token to :root", () => {
  const css = "/* --color-accent: #c00; */\n:root {\n  /* --color-accent: #c00; */\n}\n";
  expect(updateRootToken(css, "--color-accent", "#00f")).toBe(
    "/* --color-accent: #c00; */\n:root {\n  --color-accent: #00f;\n  /* --color-accent: #c00; */\n}\n",
  );
});

test("updateRootToken matches the name whole: --my--color-accent is not --color-accent", () => {
  const css = ":root {\n  --my--color-accent: red;\n  --color-accent-2: blue;\n}\n";
  expect(updateRootToken(css, "--color-accent", "#00f")).toBe(
    ":root {\n  --color-accent: #00f;\n  --my--color-accent: red;\n  --color-accent-2: blue;\n}\n",
  );
});

test("updateRootToken replaces every :root declaration of the token, keeping its spacing", () => {
  const css = ":root {\n  --a:1;\n}\n@media print {\n  :root { --a: 2; }\n}\n";
  expect(updateRootToken(css, "--a", "3")).toBe(":root {\n  --a:3;\n}\n@media print {\n  :root { --a: 3; }\n}\n");
});

test("updateRootToken with null removes the :root declaration and its line, and nothing else", () => {
  const css = "/* --a: 0; */\n:root {\n  --b: 2;\n  --a: 1;\n}\n.x { --a: 9; }\n";
  expect(updateRootToken(css, "--a", null)).toBe("/* --a: 0; */\n:root {\n  --b: 2;\n}\n.x { --a: 9; }\n");
  // Nothing to remove: the sheet comes back unchanged, and no :root is added.
  expect(updateRootToken(".x { --a: 9; }\n", "--a", null)).toBe(".x { --a: 9; }\n");
});

test("adding a token and removing it again gives back the sheet byte for byte", () => {
  for (const css of [
    "/* mine */\n",
    "",
    ":root {\n  --b: 2;\n}\n",
    ":root { --b: 2; }\n",
  ]) {
    const added = updateRootToken(css, "--a", "#abcdef");
    expect(added).not.toBe(css);
    expect(updateRootToken(added, "--a", null)).toBe(css);
  }
});

// ── Token annotations (issue #244) ──────────────────────────────────────────
//
// Theme authors curate what the guided Design panel shows with `@group` /
// `@label` / `@internal` comments scanned out of the same `:root` block.

test("a stylesheet with no annotation comments parses exactly as before (no regression)", () => {
  // The literal backward-compat requirement from issue #244: an unannotated
  // theme's tokens must carry no `group`, and none are dropped.
  const css = `:root {\n  --heading-color: #cc0000;\n  --body-size: 1rem;\n}\n`;
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => t.name)).toEqual(["--heading-color", "--body-size"]);
  expect(tokens.every((t) => t.group === undefined)).toBe(true);
});

test("@label overrides the name-derived label for the declaration right after it", () => {
  const css = `:root {\n  /* @label Accent color */\n  --color-accent: #2b4c7e;\n  --untouched: 1rem;\n}\n`;
  const tokens = parseStyleTokens(css);
  expect(tokens.find((t) => t.name === "--color-accent")!.label).toBe("Accent color");
  // One-shot: the annotation must not leak onto the next declaration.
  expect(tokens.find((t) => t.name === "--untouched")!.label).toBe("Untouched");
});

test("@group assigns the token's display group; tokens without it are ungrouped", () => {
  const css = `:root {\n  /* @group Colors */\n  --color-accent: #2b4c7e;\n  --plain: 1rem;\n}\n`;
  const tokens = parseStyleTokens(css);
  expect(tokens.find((t) => t.name === "--color-accent")!.group).toBe("Colors");
  expect(tokens.find((t) => t.name === "--plain")!.group).toBeUndefined();
});

test("@internal omits the token from the parsed list entirely", () => {
  const css = [
    ":root {",
    "  --color-accent: #2b4c7e;",
    "  /* @internal */",
    "  --dc-skill-tab-shape: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);",
    "}",
  ].join("\n");
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => t.name)).toEqual(["--color-accent"]);
});

test("stacked annotation comments (the issue's illustrative form) both apply to the same declaration", () => {
  const css = [
    ":root {",
    "  /* @group Colors */",
    "  /* @label Accent color */",
    "  --color-accent: #2b4c7e;",
    "}",
  ].join("\n");
  const t = parseStyleTokens(css)[0]!;
  expect(t.group).toBe("Colors");
  expect(t.label).toBe("Accent color");
});

test("directives combined in one comment do not bleed into each other's value", () => {
  // Without excluding "@" from the value capture, @label would greedily eat
  // " Accent color @group Colors" whole.
  const css = `:root {\n  /* @label Accent color @group Colors */\n  --color-accent: #2b4c7e;\n}\n`;
  const t = parseStyleTokens(css)[0]!;
  expect(t.label).toBe("Accent color");
  expect(t.group).toBe("Colors");
});

test("a plain, non-directive comment is inert — no crash, no leaked label", () => {
  const css = [
    ":root {",
    "  /* just a note about spacing, nothing special */",
    "  --gap: 1rem;",
    "}",
  ].join("\n");
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => t.name)).toEqual(["--gap"]);
  expect(tokens[0]!.label).toBe("Gap");
  expect(tokens[0]!.group).toBeUndefined();
});

test("annotations only affect the declaration immediately following them, not the whole file", () => {
  const css = [
    ":root {",
    "  /* @group Colors */",
    "  --color-accent: #2b4c7e;",
    "  --color-secondary: #112233;", // no annotation of its own
    "}",
  ].join("\n");
  const tokens = parseStyleTokens(css);
  expect(tokens.find((t) => t.name === "--color-accent")!.group).toBe("Colors");
  expect(tokens.find((t) => t.name === "--color-secondary")!.group).toBeUndefined();
});

// ── Block-level defaults (#435) ───────────────────────────────────────────────

test("@internal directly before the :root selector hides the whole block, except declarations annotated themselves", () => {
  const css = [
    "/* Component defaults: override them on a context selector, not here. */",
    "/* @internal */",
    ":root {",
    "  --dc-tab-shape: 2pt;",
    "  --dc-tab-ink: #333;",
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
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => [t.name, t.group ?? null, t.label])).toEqual([
    ["--dc-section-accent", null, "Section accent"],
    ["--dc-paper", "Paper", "Dc paper"],
    ["--other", null, "Other"],
  ]);
});

test("@group directly before the :root selector groups the block; a declaration's own @group or @internal still wins", () => {
  const css = [
    "/* @group Paper */",
    ":root {",
    "  --paper: #fff;",
    "  --paper-edge: #eee;",
    "  /* @group Ink */",
    "  --ink: #000;",
    "  --ink-faint: #666;",
    "  /* @internal */",
    "  --ink-cache: 0;",
    "}",
  ].join("\n");
  expect(parseStyleTokens(css).map((t) => [t.name, t.group])).toEqual([
    ["--paper", "Paper"],
    ["--paper-edge", "Paper"],
    ["--ink", "Ink"],
    ["--ink-faint", "Paper"],
  ]);
});

test("a comment before :root counts only when nothing but whitespace or comments separates them; @label there is ignored", () => {
  const apart = "/* @internal */\nh1 { color: red }\n:root {\n  --a: 1;\n}";
  expect(parseStyleTokens(apart).map((t) => t.name)).toEqual(["--a"]);
  const label = "/* @label Nope @group Colors */\n\n/* prose */\n:root {\n  --paper: #fff;\n}";
  expect(parseStyleTokens(label).map((t) => [t.name, t.label, t.group])).toEqual([["--paper", "Paper", "Colors"]]);
});

// ── Braces inside comments (#433) ─────────────────────────────────────────────

test("a } inside a :root block's comment neither ends the block nor yields a token", () => {
  const css = [
    ":root {",
    "  /* Override per chapter: `#chapter-03 { --dc-section-accent: var(--rust); }` */",
    "  --dc-section-accent: var(--brand-magenta);",
    "  --dc-tab-shape: 2pt;",
    "}",
    "/* :root { --not-a-token: 1; } */",
    "h1 { --scoped: 2; }",
  ].join("\n");
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => [t.name, t.value])).toEqual([
    ["--dc-section-accent", "var(--brand-magenta)"],
    ["--dc-tab-shape", "2pt"],
  ]);
  // The writer finds the same block: the real declaration changes, the comment's does not.
  const edited = updateRootToken(css, "--dc-section-accent", "var(--teal)");
  expect(edited).toContain("`#chapter-03 { --dc-section-accent: var(--rust); }`");
  expect(edited).toContain("--dc-section-accent: var(--teal);");
  expect(edited).not.toContain("var(--brand-magenta)");
  expect(updateRootToken(css, "--dc-tab-shape", null)).toBe(css.replace("\n  --dc-tab-shape: 2pt;", ""));
});

// ── Plain-language labels for the shared vocabulary (issue #308) ─────────────
//
// The name-derived default ("Color ink muted", "Fs h1") is designer jargon. The
// tokens every built-in look defines are labelled in plain language instead;
// the token NAMES (the CSS authors write) are untouched and stay visible in the
// panel beside the label.

const PLAIN_LABELS: Record<string, string> = {
  "--font-body": "Body text font",
  "--font-display": "Heading font",
  "--font-mono": "Code font",
  "--color-ink": "Text color",
  "--color-ink-muted": "Secondary text color",
  "--color-ink-faint": "Faint text color",
  "--color-accent": "Accent color",
  "--color-paper": "Page color",
  "--color-rule": "Line color",
  "--fs-body": "Body text size",
  "--fs-h1": "Heading 1 size",
  "--fs-h2": "Heading 2 size",
  "--fs-h3": "Heading 3 size",
  "--leading": "Line spacing",
};

test("the shared token vocabulary gets plain-language labels (#308)", () => {
  for (const [name, label] of Object.entries(PLAIN_LABELS)) {
    const t = makeStyleToken(name, "1");
    expect(t.label).toBe(label);
    // Display only: the token keeps its real CSS name.
    expect(t.name).toBe(name);
  }
});

test("a token outside the shared vocabulary gets a label in plain words", () => {
  expect(makeStyleToken("--fs-display", "30pt").label).toBe("Display size");
  expect(makeStyleToken("--fs-h4", "10pt").label).toBe("Heading 4 size");
  expect(makeStyleToken("--fs-micro", "7pt").label).toBe("Micro size");
  expect(makeStyleToken("--space-xs", "0.35em").label).toBe("Spacing extra small");
  expect(makeStyleToken("--radius-sm", "2pt").label).toBe("Corner radius small");
  expect(makeStyleToken("--color-tint-warn", "#fffbeb").label).toBe("Color tint warn");
  expect(makeStyleToken("--dc-skill-tab-shape", "1px").label).toBe("Dc skill tab shape");
  expect(derivedTokenLabel("--fs-display")).toBe("Display size");
});

test("a compound value is never offered as a bare number (the text control takes it)", () => {
  const border = makeStyleToken("--border-thin", "1pt solid var(--color-rule)");
  expect(border.kind).toBe("text");
  expect(border.number).toBeUndefined();
  // A shadow that starts with a length (#434): writing its first length back
  // as the whole value would drop the shadow from the book.
  expect(makeStyleToken("--shadow-lift", "3pt 7pt 12pt -5pt var(--shadow-soft)").kind).toBe("text");
  expect(makeStyleToken("--shadow-poster", "2pt 3pt 0 var(--shadow-ink), var(--shadow-lift)").kind).toBe("text");
  // A plain length still gets the numeric control, with and without spacing.
  expect(makeStyleToken("--fs-body", "11pt").kind).toBe("length");
  expect(makeStyleToken("--gap", " 2 rem ").kind).toBe("length");
});

test("firstFontFamily names the first family of a stack, unquoted", () => {
  expect(firstFontFamily('"Helvetica Neue", "Segoe UI", Arial, sans-serif')).toBe("Helvetica Neue");
  expect(firstFontFamily("serif")).toBe("serif");
  expect(firstFontFamily("'Latin Modern Roman', serif")).toBe("Latin Modern Roman");
});

test("a bundled look labels its own extra token with @label (technical-doc's --color-tint)", () => {
  const css = readFileSync(
    path.resolve(import.meta.dir, "../../../cli/src/assets/themes/technical-doc/theme.css"),
    "utf8",
  );
  const tint = parseStyleTokens(css).find((t) => t.name === "--color-tint");
  expect(tint?.label).toBe("Note and code background");
});

test("a stylesheet's own @label wins over the plain-language default", () => {
  const css = `:root {\n  /* @label Ink */\n  --color-ink: #1a1a1a;\n  --color-ink-muted: #555555;\n}\n`;
  const tokens = parseStyleTokens(css);
  expect(tokens.find((t) => t.name === "--color-ink")!.label).toBe("Ink");
  // One-shot, as ever: the neighbour still gets its plain-language default.
  expect(tokens.find((t) => t.name === "--color-ink-muted")!.label).toBe("Secondary text color");
});

test("every token all the built-in looks share is labelled in plain language", () => {
  // Guards drift the other way: a token added to every built-in look must get a
  // label here, or the Design panel goes back to showing "Color ink muted".
  const themesDir = path.resolve(import.meta.dir, "../../../cli/src/assets/themes");
  const perTheme = readdirSync(themesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => parseStyleTokens(readFileSync(path.join(themesDir, e.name, "theme.css"), "utf8")));
  expect(perTheme.length).toBeGreaterThan(1);
  const shared = perTheme[0]!.filter((t) => perTheme.every((tokens) => tokens.some((o) => o.name === t.name)));
  expect(shared.length).toBeGreaterThanOrEqual(13);
  for (const t of shared) {
    expect(t.name in SHARED_TOKEN_LABELS, `${t.name} has no plain-language label`).toBe(true);
    expect(t.label).toBe(SHARED_TOKEN_LABELS[t.name]!);
  }
});

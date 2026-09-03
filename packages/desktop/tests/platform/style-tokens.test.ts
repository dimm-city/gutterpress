import { test, expect } from "bun:test";
import {
  makeStyleToken,
  parseStyleTokens,
  updateRootToken,
  applyTokenUpdates,
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

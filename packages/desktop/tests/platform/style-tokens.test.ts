import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import {
  makeStyleToken,
  derivedTokenLabel,
  firstFontFamily,
  SHARED_TOKEN_LABELS,
} from "../../src/lib/style-tokens";
// Which custom properties a stylesheet declares, and their `@label`s, are read
// host-side (the lib's root-tokens.ts; its own tests cover the grammar).
import { rootTokens } from "../../../cli/src/lib/root-tokens";

/** A stylesheet's tokens as the panel labels them: an `@label` wins over the default. */
const labelled = (css: string) =>
  rootTokens(css).map((t) => ({ ...makeStyleToken(t.name, t.value.trim()), ...(t.label ? { label: t.label } : {}) }));

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
  const tint = labelled(css).find((t) => t.name === "--color-tint");
  expect(tint?.label).toBe("Note and code background");
});

test("a stylesheet's own @label wins over the plain-language default", () => {
  const css = `:root {\n  /* @label Ink */\n  --color-ink: #1a1a1a;\n  --color-ink-muted: #555555;\n}\n`;
  const tokens = labelled(css);
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
    .map((e) => labelled(readFileSync(path.join(themesDir, e.name, "theme.css"), "utf8")));
  expect(perTheme.length).toBeGreaterThan(1);
  const shared = perTheme[0]!.filter((t) => perTheme.every((tokens) => tokens.some((o) => o.name === t.name)));
  expect(shared.length).toBeGreaterThanOrEqual(13);
  for (const t of shared) {
    expect(t.name in SHARED_TOKEN_LABELS, `${t.name} has no plain-language label`).toBe(true);
    expect(t.label).toBe(SHARED_TOKEN_LABELS[t.name]!);
  }
});

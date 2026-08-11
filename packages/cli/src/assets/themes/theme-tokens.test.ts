import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * "Style your project by setting CSS custom properties" is a stated product
 * goal, and the user guide teaches a specific token vocabulary. Those two
 * drifted apart once already: the guide documented `--fs-h1`…`--fs-micro`,
 * `--color-tint` and `--color-accent-alt` while every built-in theme actually
 * defined `--scale-h1..h3` and hard-coded `body { font-size }` — so an author
 * who followed the chapter verbatim changed nothing, silently, on the single
 * most-used surface there is.
 *
 * This locks the contract from both ends: every theme must define the shared
 * vocabulary, and the guide must not teach a token no theme provides.
 */
const THEMES_DIR = import.meta.dir;
const GUIDE = join(
  THEMES_DIR,
  "../../../../../examples/gutterpress-user-guide/04-styling-theming.md",
);

/** Tokens every built-in theme must define — the set the guide documents. */
const REQUIRED = [
  "--color-ink",
  "--color-ink-muted",
  "--color-accent",
  "--color-paper",
  "--color-rule",
  "--font-body",
  "--font-display",
  "--font-mono",
  "--fs-body",
  "--fs-h1",
  "--fs-h2",
  "--fs-h3",
  "--leading",
];

const themeNames = readdirSync(THEMES_DIR, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

describe("built-in theme tokens", () => {
  test("there are themes to check", () => {
    expect(themeNames.length).toBeGreaterThan(0);
  });

  test.each(themeNames)("%s defines every shared token", (name) => {
    const css = readFileSync(join(THEMES_DIR, name, "theme.css"), "utf8");
    for (const token of REQUIRED) {
      expect(css).toContain(`${token}:`);
    }
  });

  // A token that exists but is wired to nothing is the same failure from the
  // author's side: they set it and nothing moves. Body size is the one that
  // was literally hard-coded, so it gets an explicit check.
  test.each(themeNames)("%s drives body text from --fs-body", (name) => {
    const css = readFileSync(join(THEMES_DIR, name, "theme.css"), "utf8");
    expect(css).toMatch(/font-size:\s*var\(--fs-body\)/);
  });

  test("the user guide teaches only tokens the themes provide", () => {
    const guide = readFileSync(GUIDE, "utf8");
    const defined = new Set<string>();
    for (const name of themeNames) {
      const css = readFileSync(join(THEMES_DIR, name, "theme.css"), "utf8");
      for (const m of css.matchAll(/(--[a-z0-9-]+)\s*:/g)) defined.add(m[1]!);
    }
    // Only `var(--x)` reads and `--x:` overrides inside the guide's CSS
    // samples count — prose mentioning a token by name is fine.
    const taught = new Set<string>();
    for (const m of guide.matchAll(/var\((--[a-z0-9-]+)\)/g)) taught.add(m[1]!);
    for (const m of guide.matchAll(/^\s*(--[a-z0-9-]+)\s*:/gm)) taught.add(m[1]!);
    const phantom = [...taught].filter((t) => !defined.has(t));
    expect(phantom).toEqual([]);
  });
});

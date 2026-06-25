import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readStyleTokens, writeStyleToken } from "./style-tokens";

let dir: string;
const cssPath = () => join(dir, "theme.css");

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "style-tokens-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("readStyleTokens", () => {
  test("parses :root custom properties and classifies them", async () => {
    await writeFile(
      cssPath(),
      `:root {\n  --heading-color: #cc0000;\n  --base-size: 1.125rem;\n  --body-font: Georgia, serif;\n  --accent: rgb(10 20 30);\n  --paper: red;\n  --leading: 1.45;\n}\nh1 { color: var(--heading-color); }`,
    );
    const tokens = await readStyleTokens(cssPath());
    const byName = Object.fromEntries(tokens.map((t) => [t.name, t]));

    expect(byName["--heading-color"]!.kind).toBe("color");
    expect(byName["--heading-color"]!.value).toBe("#cc0000");
    expect(byName["--heading-color"]!.label).toBe("Heading color");

    expect(byName["--base-size"]!.kind).toBe("length");
    expect(byName["--base-size"]!.number).toBe(1.125);
    expect(byName["--base-size"]!.unit).toBe("rem");

    expect(byName["--body-font"]!.kind).toBe("text");
    expect(byName["--accent"]!.kind).toBe("color"); // rgb() → color swatch
    expect(byName["--paper"]!.kind).toBe("color"); // named color (D-3)
    // unit-less numeric → length stepper with empty unit (D-4)
    expect(byName["--leading"]!.kind).toBe("length");
    expect(byName["--leading"]!.number).toBe(1.45);
    expect(byName["--leading"]!.unit).toBe("");
  });

  test("last declaration wins (cascade) and non-:root vars are ignored", async () => {
    await writeFile(
      cssPath(),
      `:root { --x: #111; }\n.card { --ignored: 5px; }\n:root { --x: #222; }`,
    );
    const tokens = await readStyleTokens(cssPath());
    expect(tokens).toHaveLength(1);
    expect(tokens[0]!.name).toBe("--x");
    expect(tokens[0]!.value).toBe("#222");
  });

  test("returns [] for a missing file or a file with no :root vars", async () => {
    expect(await readStyleTokens(join(dir, "nope.css"))).toEqual([]);
    await writeFile(cssPath(), `h1 { color: red; }`);
    expect(await readStyleTokens(cssPath())).toEqual([]);
  });
});

describe("writeStyleToken", () => {
  test("updates an existing :root property, preserving the rest", async () => {
    await writeFile(
      cssPath(),
      `:root {\n  --heading-color: #cc0000;\n  --base-size: 1rem;\n}\nh1 { color: var(--heading-color); }`,
    );
    await writeStyleToken(cssPath(), "--heading-color", "#0066ff");
    const out = await readFile(cssPath(), "utf-8");
    expect(out).toContain("--heading-color: #0066ff");
    expect(out).toContain("--base-size: 1rem"); // untouched
    expect(out).toContain("h1 { color: var(--heading-color); }"); // untouched

    const tokens = await readStyleTokens(cssPath());
    expect(tokens.find((t) => t.name === "--heading-color")!.value).toBe("#0066ff");
  });

  test("appends to the existing :root when the property is new", async () => {
    await writeFile(cssPath(), `:root {\n  --a: 1px;\n}`);
    await writeStyleToken(cssPath(), "--b", "2px");
    const tokens = await readStyleTokens(cssPath());
    expect(tokens.map((t) => t.name).sort()).toEqual(["--a", "--b"]);
  });

  test("creates a :root rule when the file has none", async () => {
    await writeFile(cssPath(), `h1 { color: red; }`);
    await writeStyleToken(cssPath(), "--accent", "#fff");
    const out = await readFile(cssPath(), "utf-8");
    expect(out).toContain(":root");
    expect(out).toContain("--accent: #fff");
    expect(out).toContain("h1 { color: red; }");
  });

  test("rejects a non-custom-property name", async () => {
    await writeFile(cssPath(), `:root { --a: 1px; }`);
    await expect(writeStyleToken(cssPath(), "color", "red")).rejects.toThrow(/custom property/);
  });
});

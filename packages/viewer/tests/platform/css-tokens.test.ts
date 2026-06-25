import { test, expect } from "bun:test";
import { parseRootTokens, setRootToken } from "../../src/lib/css-tokens";

test("parseRootTokens reads :root custom properties with number/unit", () => {
  const css = `:root {\n  --color-ink: #241a12;\n  --scale-h1: 2.4rem;\n  --leading: 1.45;\n  --font-body: Georgia, serif;\n}\nh1 { color: var(--color-ink); }`;
  const byName = Object.fromEntries(parseRootTokens(css).map((t) => [t.name, t]));
  expect(byName["--color-ink"]!.value).toBe("#241a12");
  expect(byName["--color-ink"]!.label).toBe("Color ink");
  expect(byName["--scale-h1"]!.number).toBe(2.4);
  expect(byName["--scale-h1"]!.unit).toBe("rem");
  expect(byName["--leading"]!.unit).toBe(""); // unit-less numeric
  expect(byName["--font-body"]!.number).toBeUndefined(); // text
});

test("parseRootTokens: last :root declaration wins, non-:root vars ignored", () => {
  const css = `:root { --x: #111; }\n.card { --ignored: 5px; }\n:root { --x: #222; }`;
  const tokens = parseRootTokens(css);
  expect(tokens).toHaveLength(1);
  expect(tokens[0]!.value).toBe("#222");
});

test("parseRootTokens handles :root in a selector list", () => {
  const css = `:root, .preview { --accent: red; }`;
  expect(parseRootTokens(css).map((t) => t.name)).toEqual(["--accent"]);
});

test("setRootToken updates the value, preserving everything else", () => {
  const css = `:root {\n  --a: #111;\n  --b: 1rem;\n}\nh1 { color: var(--a); }`;
  const out = setRootToken(css, "--a", "#0099ff");
  expect(out).toContain("--a: #0099ff");
  expect(out).toContain("--b: 1rem"); // untouched
  expect(out).toContain("h1 { color: var(--a); }"); // untouched
  expect(parseRootTokens(out).find((t) => t.name === "--a")!.value).toBe("#0099ff");
});

test("setRootToken is a no-op for an unknown property and a non-custom name", () => {
  const css = `:root { --a: 1px; }`;
  expect(setRootToken(css, "--missing", "x")).toBe(css);
  expect(setRootToken(css, "color", "red")).toBe(css);
});

test("setRootToken does not touch a non-:root rule's same-named property", () => {
  const css = `:root { --x: a; }\n.dark { --x: b; }`;
  const out = setRootToken(css, "--x", "c");
  expect(out).toContain(":root { --x: c; }");
  expect(out).toContain(".dark { --x: b; }");
});

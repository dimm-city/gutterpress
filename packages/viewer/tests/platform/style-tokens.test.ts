import { test, expect } from "bun:test";
import {
  makeStyleToken,
  parseStyleTokens,
  updateRootToken,
  applyTokenUpdates,
} from "../../src/lib/style-tokens";

test("makeStyleToken classifies color / length / text", () => {
  expect(makeStyleToken("--heading-color", "#cc0000").kind).toBe("color");
  const len = makeStyleToken("--gap", "1.5rem");
  expect(len.kind).toBe("length");
  expect(len.number).toBe(1.5);
  expect(len.unit).toBe("rem");
  expect(makeStyleToken("--font-body", "Georgia, serif").kind).toBe("text");
  expect(makeStyleToken("--heading-color", "#cc0000").label).toBe("Heading color");
});

test("parseStyleTokens reads :root custom properties in source order", () => {
  const css = `:root {\n  --a: #111111;\n  --b: 2rem;\n}\nh1 { color: var(--a); }`;
  const tokens = parseStyleTokens(css);
  expect(tokens.map((t) => t.name)).toEqual(["--a", "--b"]);
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

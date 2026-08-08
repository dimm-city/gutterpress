import { describe, expect, test } from "bun:test";
import { extract } from "../shared/gcpm-extract.ts";
import { synthesize } from "./tier2.ts";

describe("tier 2 — --gp-margin-* emission (#10)", () => {
  test("emits :root vars for the default page and a selector block for a named page that overrides margins", () => {
    const model = extract(`
      @page { margin: 0.75in 0.5in 0.75in 0.625in; }
      h1 { page: chapter; }
      @page chapter { margin: 0.5in; }
    `);
    const { css } = synthesize({ model });
    expect(css).toMatch(/:root\s*\{[^}]*--gp-margin-top: 54pt;/);
    expect(css).toMatch(/:root\s*\{[^}]*--gp-margin-left: 45pt;/);
    expect(css).toMatch(/:where\(h1\)\s*\{[^}]*--gp-margin-top: 36pt;/);
  });

  test("a named page with no element assigned to it emits nothing (no DOM ever gets that name)", () => {
    const model = extract(`
      @page { margin: 1in; }
      @page cover { margin: 0; }
    `);
    const { css } = synthesize({ model });
    expect(css).not.toContain("cover");
  });

  test("a named page that does NOT override margins gets no selector block", () => {
    const model = extract(`
      @page { margin: 1in; }
      h1 { page: chapter; }
      @page chapter { @top-center { content: "x"; } }
    `);
    const { css } = synthesize({ model });
    expect(css).not.toMatch(/h1\s*\{/);
  });
});

describe("tier 2 — margin-band background synthesis (#8)", () => {
  test("no --gp-margin-box-background -> no synthesis", () => {
    const model = extract(`@page { margin: 1in; }`);
    const { css, notes } = synthesize({ model });
    expect(css).not.toContain("background:");
    expect(notes.join("\n")).not.toContain("margin-band");
  });

  test("declared -> expands to every undeclared margin box, skipping the author's own", () => {
    const model = extract(`
      @page {
        margin: 1in;
        --gp-margin-box-background: url(texture.png);
        @top-center { content: "Chapter"; }
      }
    `);
    const { css, notes } = synthesize({ model });
    expect(css).toContain('@top-left { content: ""; background: url(texture.png); }');
    expect(css).toContain('@bottom-right-corner { content: ""; background: url(texture.png); }');
    // the box the author declared themselves is left alone
    expect(css).not.toMatch(/@top-center\s*\{\s*content:\s*"";/);
    expect(notes.join("\n")).toContain("margin-band background synthesized for 15");
  });
});

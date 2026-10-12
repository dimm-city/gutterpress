import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkCss, ruleEngineHyphenation } from "./printsafe";
import { executeValidation } from "./validation-exec";

const rule = (css: string) => checkCss(css).filter((w) => w.rule === ruleEngineHyphenation);

describe("printsafe/engine-hyphenation", () => {
  test("hyphens: auto in book CSS is a warning with its line and the manual-hyphens advice", () => {
    const w = rule(`body { color: black; }\np { text-align: justify; hyphens: auto; }`);
    expect(w).toHaveLength(1);
    expect(w[0]!.severity).toBe("warning");
    expect(w[0]!.line).toBe(2);
    expect(w[0]!.message).toContain("dictionaries");
    expect(w[0]!.message).toContain("desktop app and the CLI");
    expect(w[0]!.message).toContain("hyphens: manual");
    expect(w[0]!.message).toContain("&shy;");
  });

  test("the -webkit- spelling, !important, odd casing and nested/at-rule contexts are all reported", () => {
    const w = rule(
      [
        `.a { -webkit-hyphens: auto; }`,
        `.b { hyphens: auto !important; }`,
        `.c { HYPHENS: AUTO; }`,
        `@media print { .d { hyphens: auto; } }`,
        `@layer book { .e { hyphens:auto } }`,
        `.f { & p { hyphens: auto; } }`,
      ].join("\n"),
    );
    expect(w.map((x) => x.line)).toEqual([1, 2, 3, 4, 5, 6]);
  });

  test("manual, none and the CSS-wide keywords are silent", () => {
    expect(
      rule(`
        p { hyphens: manual; }
        .a { hyphens: none; }
        .b { -webkit-hyphens: manual; }
        .c { hyphens: inherit; }
        .d { hyphens: initial; }
        .e { hyphenate-character: "-"; }
      `),
    ).toEqual([]);
  });

  test("it can be switched off, raised, or silenced for one site like any printsafe rule", () => {
    const css = `/* gutterpress-disable-next-line printsafe/engine-hyphenation -- tested on both */\np { hyphens: auto; }\n.b { hyphens: auto; }`;
    expect(rule(css).map((x) => x.line)).toEqual([3]);
    expect(checkCss(css, undefined, { rules: { [ruleEngineHyphenation]: "off" } })).toEqual([]);
    expect(checkCss(css, undefined, { rules: { [ruleEngineHyphenation]: "error" } })[0]!.severity).toBe("error");
  });
});

// The rule has to see the same stylesheets the rest of the print-safety check
// does: the book's own `styles:` AND a loaded plugin's declared `styles`.
describe("printsafe/engine-hyphenation through validate", () => {
  const dirs: string[] = [];
  afterEach(async () => {
    for (const d of dirs.splice(0)) await rm(d, { recursive: true, force: true });
  });

  async function book(opts: { bookCss: string; pluginCss: string; manifestExtra?: string }): Promise<string> {
    const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-hyphenation-"));
    dirs.push(dir);
    await writeFile(path.join(dir, "chapter-01.md"), "# Hi\n\nText.\n", "utf8");
    await mkdir(path.join(dir, "styles"), { recursive: true });
    await writeFile(path.join(dir, "styles", "book.css"), opts.bookCss, "utf8");
    await mkdir(path.join(dir, "plugin"), { recursive: true });
    await writeFile(
      path.join(dir, "plugin", "plugin.mjs"),
      "export default function () {}\nexport const styles = ['./plugin.css'];\n",
      "utf8",
    );
    await writeFile(path.join(dir, "plugin", "plugin.css"), opts.pluginCss, "utf8");
    await writeFile(
      path.join(dir, "manifest.yaml"),
      `title: Hyphenation\nstyles:\n  - styles/book.css\nextensions:\n  - ./plugin/plugin.mjs\n${opts.manifestExtra ?? ""}`,
      "utf8",
    );
    return dir;
  }

  async function findings(dir: string) {
    const execution = await executeValidation({ input: dir, category: "source", phase: "pre-build" });
    return execution.report.results.filter((r) => r.message.includes(ruleEngineHyphenation));
  }

  test("fires on the book's stylesheet and on a loaded plugin's stylesheet", async () => {
    const dir = await book({
      bookCss: "body { color: black; }\np { hyphens: auto; }\n",
      pluginCss: ".card { color: red; }\n.card p { -webkit-hyphens: auto; }\n",
    });
    const found = await findings(dir);
    expect(found.map((r) => [path.basename(r.file!), r.line, r.severity])).toEqual([
      ["book.css", 2, "warning"],
      ["plugin.css", 2, "warning"],
    ]);
  });

  test("is silent when book and plugin both use manual or none", async () => {
    const dir = await book({
      bookCss: "p { hyphens: manual; }\n",
      pluginCss: ".card p { hyphens: none; }\n",
    });
    expect(await findings(dir)).toEqual([]);
  });

  test("the manifest's lint.rules switches it off", async () => {
    const dir = await book({
      bookCss: "p { hyphens: auto; }\n",
      pluginCss: "p { hyphens: auto; }\n",
      manifestExtra: `lint:\n  rules:\n    ${ruleEngineHyphenation}: off\n`,
    });
    expect(await findings(dir)).toEqual([]);
  });
});

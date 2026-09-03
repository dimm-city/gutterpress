/**
 * Tests for the CSS ownership contract check (#232) — the postcss-based lint
 * that replaces the dc-design-guide's prose "AGENT RULE" stylesheet-header
 * contracts with a machine-checked pass. See css-ownership.ts's header for
 * the full rationale and the scope this deliberately does NOT cover.
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveConfig } from "../../lib/manifest";
import { getCheckById } from "../registry";
import { makeCtx } from "../../test-helpers/testkit";
import type { ResolvedConfig } from "../../schema/manifest.types";

// self-register the check
import "./css-ownership";

async function makeProject(): Promise<string> {
  return mkdtemp(join(tmpdir(), "gutterpress-css-contract-"));
}

function configWith(cssOwnership?: string | false): ResolvedConfig {
  const manifest =
    cssOwnership === undefined ? {} : { validate: { source: { cssOwnership } } };
  return resolveConfig({}, manifest as never);
}

describe("source.css-ownership: opt-in discovery", () => {
  test("no .gutterpress/css-contract.yaml and no explicit path: reports nothing (silent no-op)", async () => {
    const dir = await makeProject();
    try {
      const cssFile = join(dir, "styles.css");
      await writeFile(cssFile, ".foo { columns: 2; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [cssFile], config: configWith() });
      const results = await check.run(ctx);

      expect(results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("validate.source.cssOwnership: false disables the check even with a contract present", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        "files:\n  a.css:\n    owns-properties: [columns]\n"
      );
      const aCss = join(dir, "a.css");
      const bCss = join(dir, "b.css");
      await writeFile(aCss, ".x { columns: 2; }\n");
      await writeFile(bCss, ".y { columns: 3; }\n"); // would violate a.css's ownership

      const check = getCheckById("source.css-ownership")!;
      expect(check.enabledWhen!(configWith(false))).toBe(false);

      const ctx = makeCtx({
        inputDir: dir,
        cssFiles: [aCss, bCss],
        config: configWith(false),
      });
      expect(await check.run(ctx)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an explicit validate.source.cssOwnership path is used instead of the conventional location", async () => {
    const dir = await makeProject();
    try {
      const customPath = join(dir, "contracts/my-contract.yaml");
      await mkdir(join(dir, "contracts"), { recursive: true });
      await writeFile(customPath, "files:\n  a.css:\n    owns-properties: [columns]\n");
      const aCss = join(dir, "a.css");
      const bCss = join(dir, "b.css");
      await writeFile(aCss, ".x { columns: 2; }\n");
      await writeFile(bCss, ".y { columns: 3; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({
        inputDir: dir,
        cssFiles: [aCss, bCss],
        config: configWith("contracts/my-contract.yaml"),
      });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.file).toBe(bCss);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("malformed contract YAML produces one error-severity result, not a thrown exception", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(join(dir, ".gutterpress/css-contract.yaml"), "files: [this is not: valid: yaml\n");
      const cssFile = join(dir, "a.css");
      await writeFile(cssFile, ".x { color: red; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [cssFile], config: configWith() });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.severity).toBe("error");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("source.css-ownership: owns-properties (the real column-ownership rule, #232)", () => {
  // Grounded directly in the issue's own quoted contract: page-templates.css's
  // header says "COLUMN OWNERSHIP RULE: If a THEME rule sets columns:N
  // anywhere in this project, it belongs here and ONLY here. Any columns:N
  // found in another file is a bug." This is exactly the collision an honor
  // system misses and this check catches.
  test("a property declared in a NON-owning file is flagged, naming the owner", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        "files:\n  css/page-templates.css:\n    owns-properties: [columns, column-count]\n"
      );
      await mkdir(join(dir, "css"), { recursive: true });
      const owner = join(dir, "css/page-templates.css");
      const offender = join(dir, "css/dc-components.css"); // NOT named in the contract at all
      await writeFile(owner, ".section.two-column { columns: 2; }\n");
      await writeFile(offender, ".section.two-column { columns: 2; column-rule: 1px solid; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({
        inputDir: dir,
        cssFiles: [owner, offender],
        config: configWith(),
      });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.file).toBe(offender);
      expect(results[0]!.severity).toBe("warning");
      expect(results[0]!.message).toContain("columns");
      expect(results[0]!.message).toContain("css/page-templates.css");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the owning file itself declaring the property is not a violation", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        "files:\n  page-templates.css:\n    owns-properties: [columns]\n"
      );
      const owner = join(dir, "page-templates.css");
      await writeFile(owner, ".a { columns: 2; }\n.b { columns: 3; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [owner], config: configWith() });
      expect(await check.run(ctx)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("source.css-ownership: owns-at-rules", () => {
  test("an at-rule declared outside its owning file is flagged", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        "files:\n  page-rules.css:\n    owns-at-rules: [page]\n"
      );
      const owner = join(dir, "page-rules.css");
      const offender = join(dir, "native-furniture.css");
      await writeFile(owner, "@page { size: letter; }\n");
      await writeFile(offender, "@page :first { margin-top: 2in; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({
        inputDir: dir,
        cssFiles: [owner, offender],
        config: configWith(),
      });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.file).toBe(offender);
      expect(results[0]!.message).toContain("@page");
      expect(results[0]!.message).toContain("page-rules.css");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("source.css-ownership: allow (closed top-level allow-list)", () => {
  // Grounded in dc-tokens.css's header: "MUST NOT CONTAIN: Any style rule at
  // all" — operationalized as a closed allow-list of top-level constructs.
  test("a top-level rule outside the allow-list is flagged", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        'files:\n  dc-tokens.css:\n    allow: [":root", "@font-face"]\n'
      );
      const file = join(dir, "dc-tokens.css");
      await writeFile(
        file,
        ':root { --dc-ink: #111; }\n@font-face { font-family: "Body"; src: local("Body"); }\n.dc-callout { color: red; }\n'
      );

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.message).toContain(".dc-callout");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(":root and @font-face themselves pass — allow-list entries are not self-violations", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        'files:\n  dc-tokens.css:\n    allow: [":root", "@font-face"]\n'
      );
      const file = join(dir, "dc-tokens.css");
      await writeFile(
        file,
        ':root { --dc-ink: #111; }\n@font-face { font-family: "Body"; src: local("Body"); }\n'
      );

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      expect(await check.run(ctx)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("allow is not recursive into @media — only true top-level constructs are checked", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        'files:\n  dc-tokens.css:\n    allow: [":root"]\n'
      );
      const file = join(dir, "dc-tokens.css");
      // `@media` is itself a top-level at-rule not in the allow-list, so it
      // IS flagged — but nothing INSIDE it is separately walked.
      await writeFile(file, ":root { --x: 1; }\n@media print { .y { color: red; } }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.message).toContain("@media");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("source.css-ownership: forbid-properties", () => {
  test("a forbidden property declared anywhere in the file is flagged", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        "files:\n  book-overrides.css:\n    forbid-properties: [z-index]\n"
      );
      const file = join(dir, "book-overrides.css");
      await writeFile(file, "#ch-01 .cover { z-index: 5; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.message).toContain("z-index");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("source.css-ownership: forbid-unscoped-selectors", () => {
  // Grounded in fg-overrides.css's header: "MUST NOT CONTAIN — CORE
  // CONSTRAINT: Any bare .dc-*/.pmd-* rule without a page/chapter context
  // qualifier."
  test("a bare forbidden-pattern selector with no ancestor is flagged", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        'files:\n  fg-overrides.css:\n    forbid-unscoped-selectors: ["\\\\.dc-", "\\\\.pmd-"]\n'
      );
      const file = join(dir, "fg-overrides.css");
      await writeFile(file, ".dc-callout { border: none; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.message).toContain(".dc-callout");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the same pattern qualified by a page/chapter ancestor is NOT flagged", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        'files:\n  fg-overrides.css:\n    forbid-unscoped-selectors: ["\\\\.dc-"]\n'
      );
      const file = join(dir, "fg-overrides.css");
      await writeFile(file, "#ch-bestiary .dc-callout { border: none; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      expect(await check.run(ctx)).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("one of several comma-separated branches can be unscoped while another is scoped", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        'files:\n  fg-overrides.css:\n    forbid-unscoped-selectors: ["\\\\.dc-"]\n'
      );
      const file = join(dir, "fg-overrides.css");
      await writeFile(file, ".page .dc-callout, .dc-alert { border: none; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({ inputDir: dir, cssFiles: [file], config: configWith() });
      const results = await check.run(ctx);

      expect(results.length).toBe(1);
      expect(results[0]!.message).toContain(".dc-alert");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("source.css-ownership: files not named in the contract get ownership checks only", () => {
  test("a file with no entry in `files:` is still checked against other files' ownership claims", async () => {
    const dir = await makeProject();
    try {
      await mkdir(join(dir, ".gutterpress"), { recursive: true });
      await writeFile(
        join(dir, ".gutterpress/css-contract.yaml"),
        "files:\n  owner.css:\n    owns-properties: [columns]\n"
      );
      const owner = join(dir, "owner.css");
      const unlisted = join(dir, "unlisted.css");
      await writeFile(owner, ".a { columns: 2; }\n");
      await writeFile(unlisted, ".dc-anything-goes-here { color: blue; columns: 4; }\n");

      const check = getCheckById("source.css-ownership")!;
      const ctx = makeCtx({
        inputDir: dir,
        cssFiles: [owner, unlisted],
        config: configWith(),
      });
      const results = await check.run(ctx);

      // Only the ownership violation fires — `unlisted.css` has no `allow`/
      // `forbid-*` entry of its own, so nothing else about it is checked.
      expect(results.length).toBe(1);
      expect(results[0]!.file).toBe(unlisted);
      expect(results[0]!.message).toContain("columns");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

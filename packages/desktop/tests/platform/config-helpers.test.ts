import { test, expect } from "bun:test";
import {
  addedBuiltInIds,
  describeSegments,
  extensionSourceLabel,
  extensionProblem,
  orderAfterMove,
  carriedKinds,
  sampleSrcdoc,
} from "../../src/lib/components/config/config-helpers";
import type { ProjectExtensionEntry, ExtensionValidationResult } from "../../src/lib/api";

const NONE = { markdown: false, styles: false, snippets: false, components: false };

function entry(overrides: Partial<ProjectExtensionEntry> = {}): ProjectExtensionEntry {
  return {
    use: "markdown-it-mark",
    kind: "bundled",
    name: "markdown-it-mark",
    enabled: true,
    label: "Highlight",
    carries: { ...NONE, markdown: true },
    ...overrides,
  };
}

// ── The sample thumbnail: a fixed sample, never the document ──────────────────

test("sampleSrcdoc inlines the look's CSS into a self-contained sample document that never scrolls", () => {
  const css = ":root { --accent: #036; }";
  const doc = sampleSrcdoc(css);
  expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
  expect(doc).toContain(css);
  expect(doc).toContain("<h1>Chapter One</h1>");
  expect(doc).toContain("html,body{margin:0;padding:0;overflow:hidden;}");
});

// ── extensionSourceLabel: where a row comes from, in one caption ───────────

test("extensionSourceLabel names the three sources in words", () => {
  expect(extensionSourceLabel(entry())).toBe("built in");
  expect(extensionSourceLabel(entry({ kind: "npm", use: "markdown-it-emoji@3.0.0", name: "markdown-it-emoji", version: "3.0.0" }))).toBe("npm 3.0.0");
  expect(extensionSourceLabel(entry({ kind: "npm", use: "markdown-it-emoji", name: "markdown-it-emoji" }))).toBe("npm");
  expect(extensionSourceLabel(entry({ kind: "path", use: "./extensions/clean-book", name: "./extensions/clean-book" }))).toBe("folder extensions/clean-book");
  expect(extensionSourceLabel(entry({ kind: "path", use: "../shared/house", name: "../shared/house" }))).toBe("folder ../shared/house");
  expect(extensionSourceLabel(entry({ kind: "path", use: "./plugins/x.js", name: "./plugins/x.js" }))).toBe("file plugins/x.js");
});

// ── describeSegments (#309): "what to type" spans set in code type ─────────

test("describeSegments marks the backtick spans of a feature description as code", () => {
  expect(describeSegments("Lower text below the line, like the 2 in `H~2~O`.")).toEqual([
    { text: "Lower text below the line, like the 2 in ", code: false },
    { text: "H~2~O", code: true },
    { text: ".", code: false },
  ]);
  // Two spans in one line, as the Callouts feature writes it.
  expect(describeSegments("Start a quote with `> [!NOTE]` (or `TIP`).")).toEqual([
    { text: "Start a quote with ", code: false },
    { text: "> [!NOTE]", code: true },
    { text: " (or ", code: false },
    { text: "TIP", code: true },
    { text: ").", code: false },
  ]);
});

test("describeSegments leaves plain text alone, drops empty pieces, and never returns the backticks", () => {
  expect(describeSegments("Nothing to type here.")).toEqual([{ text: "Nothing to type here.", code: false }]);
  expect(describeSegments("`only code`")).toEqual([{ text: "only code", code: true }]);
  expect(describeSegments("")).toEqual([]);
  // An unbalanced trailing backtick still shows no stray backtick.
  expect(describeSegments("Type `oops").map((s) => s.text).join("")).toBe("Type oops");
});

// ── orderAfterMove: a move in the one list, expressed as the full order ────

const LOOK_A = entry({ use: "./extensions/a", kind: "path", carries: { ...NONE, styles: true } });
const FEAT = entry({ use: "markdown-it-mark" });
const LOOK_B = entry({ use: "./extensions/b", kind: "path", carries: { ...NONE, styles: true } });
const ALL = [LOOK_A, FEAT, LOOK_B];

test("orderAfterMove swaps an entry with its neighbour, keeping the rest in place", () => {
  expect(orderAfterMove(ALL, LOOK_B, -1)).toEqual(["./extensions/a", "./extensions/b", "markdown-it-mark"]);
  expect(orderAfterMove(ALL, LOOK_A, 1)).toEqual(["markdown-it-mark", "./extensions/a", "./extensions/b"]);
});

test("orderAfterMove lists every configured entry exactly once (what reorderExtensions insists on)", () => {
  const order = orderAfterMove(ALL, LOOK_B, -1)!;
  expect([...order].sort()).toEqual(ALL.map((e) => e.use).sort());
});

test("orderAfterMove returns null at the list's edge or for an entry not in it", () => {
  expect(orderAfterMove(ALL, LOOK_A, -1)).toBeNull();
  expect(orderAfterMove(ALL, LOOK_B, 1)).toBeNull();
  expect(orderAfterMove([LOOK_A, LOOK_B], FEAT, 1)).toBeNull();
});

// ── carriedKinds: a row's kinds, in words ──────────────────────────────────

test("carriedKinds names each kind an entry carries, in author words and a fixed order", () => {
  expect(carriedKinds(FEAT)).toEqual(["Extra"]);
  expect(carriedKinds(LOOK_A)).toEqual(["Look"]);
  // Styles beside markdown are a component library's own, not a look: "Styles".
  expect(
    carriedKinds(entry({ carries: { markdown: true, styles: true, snippets: true, components: true, publish: true } })),
  ).toEqual(["Extra", "Styles", "Snippets", "Components", "Publish destination"]);
  expect(carriedKinds(entry({ carries: NONE }))).toEqual([]);
});

// ── extensionProblem: silence is success; a problem names its fix ──────────

const OK_MARK: Record<string, ExtensionValidationResult> = {
  "markdown-it-mark": { use: "markdown-it-mark", kind: "bundled", enabled: true, ok: true },
};

test("extensionProblem: a working, switched-off or still-checking entry has nothing to say", () => {
  expect(extensionProblem(entry(), OK_MARK, false)).toBeNull();
  expect(extensionProblem(entry({ enabled: false, warnings: ["Not installed — run x"] }), {}, false)).toBeNull();
  expect(extensionProblem(entry(), {}, /* validating */ true)).toBeNull();
});

test("extensionProblem: a check that never finished is not success — it offers Check again", () => {
  expect(extensionProblem(entry(), {}, /* validating */ false)).toEqual({ label: "Couldn't check it.", fix: "check" });
});

test("extensionProblem: an npm entry the lib flagged as not installed / not pinned offers Install, ahead of any load-test result", () => {
  for (const warning of [
    "Not installed — run `gutterpress ext add markdown-it-footnote@4.0.0`.",
    "Not pinned — run `gutterpress ext add markdown-it-footnote` to install it and pin an exact version.",
  ]) {
    const e = entry({ use: "markdown-it-footnote@4.0.0", kind: "npm", name: "markdown-it-footnote", version: "4.0.0", warnings: [warning] });
    const validation: Record<string, ExtensionValidationResult> = {
      [e.use]: { use: e.use, kind: "npm", enabled: true, ok: false, error: "Plugin not found" },
    };
    // The lib's text (the CLI's `gutterpress ext add …`) is never shown.
    expect(extensionProblem(e, validation, false)).toEqual({ label: "Not downloaded yet.", fix: "install" });
  }
});

test("extensionProblem: a failed load says Couldn't load, keeps the loader's message, and offers Check again", () => {
  const e = entry({ use: "./plugins/broken.js", kind: "path", name: "./plugins/broken.js" });
  const validation: Record<string, ExtensionValidationResult> = {
    "./plugins/broken.js": { use: "./plugins/broken.js", kind: "path", enabled: true, ok: false, error: "SyntaxError: unexpected token" },
  };
  expect(extensionProblem(e, validation, false)).toEqual({ label: "Couldn't load.", raw: "SyntaxError: unexpected token", fix: "check" });
});

test("extensionProblem: an installed npm entry that fails to load offers Reinstall", () => {
  const e = entry({ use: "markdown-it-x@1.0.0", kind: "npm", name: "markdown-it-x", version: "1.0.0" });
  const validation: Record<string, ExtensionValidationResult> = {
    "markdown-it-x@1.0.0": { use: "markdown-it-x@1.0.0", kind: "npm", enabled: true, ok: false },
  };
  expect(extensionProblem(e, validation, false)).toEqual({ label: "Couldn't load.", raw: "Unknown load error", fix: "reinstall" });
});

// ── addedBuiltInIds: an older version's ./extensions/<id> copy of a look ──────

/** A path entry, the way a copied look (or anything else on disk) is listed. */
const onDisk = (use: string, kind: ProjectExtensionEntry["kind"] = "path") =>
  entry({ use, kind, name: use, label: use, carries: { ...NONE, styles: true } });

test("addedBuiltInIds is empty when nothing is configured", () => {
  expect(addedBuiltInIds([])).toEqual(new Set());
});

test("addedBuiltInIds recognizes a built-in copied to ./extensions/<id> (#265)", () => {
  const ids = addedBuiltInIds([onDisk("./extensions/clean-book"), entry()]);
  expect(ids).toEqual(new Set(["clean-book"]));
});

test("addedBuiltInIds tolerates a trailing slash and backslashes as written by hand", () => {
  expect(addedBuiltInIds([onDisk("./extensions/zine/")])).toEqual(new Set(["zine"]));
  expect(addedBuiltInIds([onDisk(".\\extensions\\zine")])).toEqual(new Set(["zine"]));
});

test("addedBuiltInIds ignores looks that live anywhere else, nested folders, and npm entries", () => {
  const ids = addedBuiltInIds([
    onDisk("./themes/clean-book"),
    onDisk("./extensions/vendor/clean-book"),
    onDisk("../shared/extensions/zine"),
    onDisk("clean-book@1.0.0", "npm"),
  ]);
  expect(ids).toEqual(new Set());
});

test("addedBuiltInIds reports a disabled copy too — the folder exists, so Use would only re-reference it", () => {
  const off = { ...onDisk("./extensions/technical-doc"), enabled: false };
  expect(addedBuiltInIds([off])).toEqual(new Set(["technical-doc"]));
});

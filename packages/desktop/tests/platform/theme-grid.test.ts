import { expect, test } from "bun:test";
import { addedBuiltInIds } from "../../src/lib/components/config/theme-grid";
import type { ProjectExtensionEntry } from "../../src/lib/api";

const CARRIES_STYLES = { markdown: false, styles: true, snippets: false, components: false };

function entry(use: string, kind: ProjectExtensionEntry["kind"] = "path"): ProjectExtensionEntry {
  return { use, kind, name: use, enabled: true, label: use, carries: CARRIES_STYLES };
}

test("addedBuiltInIds is empty when nothing is configured", () => {
  expect(addedBuiltInIds([])).toEqual(new Set());
});

test("addedBuiltInIds recognizes a built-in copied to ./extensions/<id> (#265)", () => {
  const ids = addedBuiltInIds([entry("./extensions/clean-book"), entry("markdown-it-mark", "bundled")]);
  expect(ids).toEqual(new Set(["clean-book"]));
});

test("addedBuiltInIds tolerates a trailing slash and backslashes as written by hand", () => {
  expect(addedBuiltInIds([entry("./extensions/zine/")])).toEqual(new Set(["zine"]));
  expect(addedBuiltInIds([entry(".\\extensions\\zine")])).toEqual(new Set(["zine"]));
});

test("addedBuiltInIds ignores looks that live anywhere else, nested folders, and npm entries", () => {
  const ids = addedBuiltInIds([
    entry("./themes/clean-book"),
    entry("./extensions/vendor/clean-book"),
    entry("../shared/extensions/zine"),
    entry("clean-book@1.0.0", "npm"),
  ]);
  expect(ids).toEqual(new Set());
});

test("addedBuiltInIds reports a disabled copy too — the folder exists, so Use would only re-reference it", () => {
  const off = { ...entry("./extensions/technical-doc"), enabled: false };
  expect(addedBuiltInIds([off])).toEqual(new Set(["technical-doc"]));
});

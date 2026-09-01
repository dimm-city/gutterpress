import { expect, test } from "bun:test";
import { visibleBuiltInThemes } from "../../src/lib/components/config/theme-grid";
import type { ThemeInfo } from "../../src/lib/platform/dtos";

function theme(kind: ThemeInfo["kind"], id: string, name = id): ThemeInfo {
  return { id, name, description: "", kind };
}

test("visibleBuiltInThemes returns all built-ins when no project copy exists", () => {
  const builtIns = [theme("builtin", "clean-book"), theme("builtin", "zine")];
  expect(visibleBuiltInThemes(builtIns, [])).toEqual(builtIns);
});

test("visibleBuiltInThemes hides a built-in once a same-id project copy exists (M6 dedupe)", () => {
  const builtIns = [theme("builtin", "clean-book"), theme("builtin", "zine")];
  const projectThemes = [theme("project", "clean-book")];
  const visible = visibleBuiltInThemes(builtIns, projectThemes);
  expect(visible.map((t) => t.id)).toEqual(["zine"]);
});

test("visibleBuiltInThemes hides the built-in twin even when the project copy is not the active theme", () => {
  // Dedupe is unconditional on "active" — an inactive project copy still
  // means the built-in twin's Apply button would re-run the destructive
  // copy, so it must stay hidden regardless of which theme is applied.
  const builtIns = [theme("builtin", "clean-book")];
  const projectThemes = [theme("project", "clean-book"), theme("project", "zine")];
  expect(visibleBuiltInThemes(builtIns, projectThemes)).toEqual([]);
});

test("visibleBuiltInThemes is unaffected by unrelated project themes (different ids)", () => {
  const builtIns = [theme("builtin", "clean-book")];
  const projectThemes = [theme("project", "my-imported-theme")];
  expect(visibleBuiltInThemes(builtIns, projectThemes)).toEqual(builtIns);
});

test("visibleBuiltInThemes reappears the built-in card after the project copy is removed", () => {
  const builtIns = [theme("builtin", "clean-book")];
  // Simulates the grid state right after AppearanceSection's `removeTheme`
  // callback resolves and `projectThemes` no longer contains the id.
  expect(visibleBuiltInThemes(builtIns, [])).toEqual(builtIns);
});

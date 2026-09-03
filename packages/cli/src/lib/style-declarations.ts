/**
 * Shared "declared stylesheet list" resolution (#239) — the ONE function a
 * plugin's `styles` export (#238) and a theme's `theme.json` `styles`/
 * `engineStyles.native` both resolve through. This is the concrete code-level
 * answer to the 0.10.7 milestone's acceptance criterion for this pair — "a
 * theme and a styles-carrying plugin are the same object": both declare an
 * ORDERED LIST of stylesheet paths relative to their OWN folder/module, and
 * both turn that declaration into absolute, existence-checked paths through
 * this same code, not through two parallel re-implementations that could
 * drift apart.
 *
 * Consumers:
 *   - `lib/markdown/plugins.ts`'s `loadPlugin` — a plugin's `styles` export,
 *     relative to the plugin's own module/package directory.
 *   - `lib/theme-manager.ts`'s `applyTheme` and `importThemeFromFolder` — a
 *     theme's `styles`/`engineStyles.native`, relative to the theme folder.
 *   - `lib/theme-import.ts`'s zip/css-text import — the same declared-sheet
 *     list, ahead of its own additional print-safety pass (a theme-import-
 *     specific richness plugin loading doesn't need, so it stays layered on
 *     top of this rather than folded into it).
 *
 * Pure Node fs/path — no subprocess, no bundler, no runtime package.json
 * reads, no computed dynamic imports (CLAUDE.md §1/§3): bundles cleanly under
 * `bun build --compile` and runs in the packaged desktop alike.
 */
import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Resolve a declared stylesheet list to absolute, existence-checked paths, in
 * declared order. `undefined`/`[]` returns `undefined` — a plugin/theme that
 * declares no `styles` pays zero cost here, the exact contract #238
 * established and #239 now shares. Any entry that doesn't resolve to a real
 * file THROWS immediately: a final artifact must never silently drop an
 * author-declared stylesheet from the cascade (CLAUDE.md §5's fail-fast
 * doctrine) — this is the load-time check, matching a plugin's own
 * missing-file error, not a render-time warning.
 *
 * `baseDir` is never resolved by this function — whether a plugin/theme even
 * HAS a usable base directory (e.g. a plugin loaded via a bare npm specifier
 * with no on-disk path) is a caller-specific question the caller answers
 * before calling this; by the time `baseDir` reaches here it names a real
 * directory to resolve `rawStyles` against.
 *
 * @param subject Names the declaring thing for the error message, e.g.
 *   `Plugin "my-plugin"` or `Theme "dc-design"`.
 */
export function resolveDeclaredStyles(
  rawStyles: string[] | undefined,
  baseDir: string,
  subject: string,
): string[] | undefined {
  if (!rawStyles || rawStyles.length === 0) return undefined;
  return rawStyles.map((rel) => {
    const abs = resolve(baseDir, rel);
    if (!existsSync(abs)) {
      throw new Error(`${subject} declares stylesheet "${rel}" but no file exists at ${abs}.`);
    }
    return abs;
  });
}

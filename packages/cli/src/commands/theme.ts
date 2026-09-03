import { defineCommand } from "citty";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import {
  applyTheme,
  getActiveTheme,
  getPreviousTheme,
  importThemeFromFile,
  importThemeFromFolder,
  importThemeFromUrl,
  listBuiltInThemes,
  listProjectThemes,
  readThemeCss,
  removeProjectTheme,
  revertTheme,
  BUILT_IN_THEME_IDS,
} from "../index.ts";
import type { ApplyThemeTarget, ThemeInfo } from "../index.ts";
import {
  EXIT_CODES,
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";

/**
 * `gutterpress theme` (#235) — list / apply / import / revert / remove themes
 * from the terminal. A thin front-end over `theme-manager.ts`/`theme-import.ts`
 * (the same shared-lib functions the desktop's Theme panel calls through the
 * platform seam) — no new behavior is invented here, only a CLI shape over the
 * existing, already-tested `applyTheme`/`importThemeFrom*`/`revertTheme`/
 * `removeProjectTheme` functions.
 *
 *   gutterpress theme list [dir]
 *   gutterpress theme apply <id> [dir]
 *   gutterpress theme import <source> [dir]   (folder | .zip | .css | http(s) URL)
 *   gutterpress theme revert [dir]
 *   gutterpress theme remove <id> [dir]
 */

const dirArg = {
  type: "positional",
  description: "Project directory (defaults to the current directory)",
  required: false,
} as const;

export const themeListArgs = { dir: dirArg } as const;

export const themeApplyArgs = {
  id: {
    type: "positional",
    description:
      "Theme id to apply — a built-in id (clean-book, zine, technical-doc) or an already-imported project theme id",
    required: true,
  },
  dir: dirArg,
} as const;

export const themeImportArgs = {
  source: {
    type: "positional",
    description: "Theme source: a folder, a .zip package, a .css file, or an http(s) URL",
    required: true,
  },
  dir: dirArg,
} as const;

export const themeRevertArgs = { dir: dirArg } as const;

export const themeRemoveArgs = {
  id: {
    type: "positional",
    description: "Project theme id to remove",
    required: true,
  },
  dir: dirArg,
} as const;

const parentArgs = {} as const;

const THEME_SUBCOMMANDS = ["list", "apply", "import", "revert", "remove"] as const;

function exitForUsage(error: unknown): never {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  throw error;
}

function rejectParentFlags(rawArgs: string[]): void {
  const first = rawArgs[0];
  if (first === undefined || (THEME_SUBCOMMANDS as readonly string[]).includes(first)) return;
  if (!first.startsWith("-")) return;
  try {
    rejectUnknownFlags(rawArgs, parentArgs, "theme");
  } catch (error) {
    exitForUsage(error);
  }
}

function resolveProjectDir(dir: unknown): string {
  return path.resolve(typeof dir === "string" && dir ? dir : process.cwd());
}

function themeLine(id: string, rest: string): string {
  return `  ${id.padEnd(16)} ${rest}`;
}

/**
 * A theme id can name either a project theme already vendored under
 * `themes/<id>/` or a built-in that has never been applied yet. A project
 * match wins when both exist — it is the author's actual (possibly
 * customized) copy, and re-resolving to "builtin" would fork a SECOND fresh
 * copy instead of the idempotent "make my existing theme active again" a
 * repeated `apply` should be (mirrors applyTheme's own non-destructive
 * re-apply guard, theme-manager.ts UX review M6).
 */
async function resolveApplyTarget(projectDir: string, id: string): Promise<ApplyThemeTarget> {
  const projectThemes = await listProjectThemes(projectDir);
  if (projectThemes.some((t) => t.id === id)) return { kind: "project", id };
  if ((BUILT_IN_THEME_IDS as readonly string[]).includes(id)) return { kind: "builtin", id };

  const known = [
    `built-in: ${BUILT_IN_THEME_IDS.join(", ")}`,
    ...(projectThemes.length > 0 ? [`project: ${projectThemes.map((t) => t.id).join(", ")}`] : []),
  ].join("; ");
  throw new UsageError(
    `gutterpress theme apply: unknown theme "${id}" (${known}). Run "gutterpress theme list" to see them.`,
  );
}

/**
 * #236 follow-through: detect a project whose `styles/book.css` is
 * byte-identical to a built-in theme's `theme.css` while NO theme is tracked
 * as active. That shape is exactly what a pre-0.10.7 `gutterpress new` (or
 * "set up as a book") produced — a real, working stylesheet that is simply
 * invisible to this command and to the desktop's Theme panel, and which will
 * keep loading AFTER (so silently override) whatever theme is applied next.
 * Read-only: this never modifies the project — it only surfaces a note so the
 * author can decide whether to run `theme apply` themselves.
 */
async function detectLegacyForkedTheme(
  projectDir: string,
  active: ThemeInfo | null,
): Promise<{ id: string; name: string } | null> {
  if (active) return null;
  let bookCss: string;
  try {
    bookCss = await readFile(path.join(projectDir, "styles", "book.css"), "utf8");
  } catch {
    return null;
  }
  if (!bookCss.trim()) return null;
  for (const candidate of await listBuiltInThemes()) {
    let builtinCss: string;
    try {
      builtinCss = await readThemeCss(null, { kind: "builtin", id: candidate.id });
    } catch {
      continue;
    }
    if (builtinCss === bookCss) return { id: candidate.id, name: candidate.name };
  }
  return null;
}

async function printThemeList(projectDir: string): Promise<void> {
  const [builtins, projectThemes, active, previous] = await Promise.all([
    listBuiltInThemes(),
    listProjectThemes(projectDir),
    getActiveTheme(projectDir),
    getPreviousTheme(projectDir),
  ]);

  console.log(`Project: ${projectDir}`);
  console.log(`Active theme: ${active ? `${active.name} (${active.id})` : "none"}`);

  console.log("");
  console.log("Built-in themes (gutterpress theme apply <id>):");
  for (const t of builtins) {
    const marker = active?.id === t.id ? "  [active]" : "";
    console.log(themeLine(t.id, `${t.name}${marker}`));
    if (t.description) console.log(themeLine("", t.description));
  }

  console.log("");
  if (projectThemes.length === 0) {
    console.log("Project themes: none yet — apply a built-in or import one to get started.");
  } else {
    console.log("Project themes (already vendored under this project's themes/ folder):");
    for (const t of projectThemes) {
      const marker = active?.id === t.id ? "  [active]" : "";
      const author = t.author ? ` — by ${t.author}` : "";
      console.log(themeLine(t.id, `${t.name}${author}${marker}`));
    }
  }

  if (previous) {
    console.log("");
    console.log(
      `Previous theme: ${previous.name} (${previous.id}) — restore it with "gutterpress theme revert".`,
    );
  }

  const legacyFork = await detectLegacyForkedTheme(projectDir, active);
  if (legacyFork) {
    console.log("");
    console.log(
      `Note: styles/book.css is byte-identical to the built-in theme "${legacyFork.name}" (${legacyFork.id}).`,
    );
    console.log(
      "      This looks like a project scaffolded before Gutterpress 0.10.7, which copied a theme's",
    );
    console.log(
      "      CSS into styles/book.css instead of tracking it. It still renders correctly, but it",
    );
    console.log(
      "      won't show up as an active theme, and it will keep loading AFTER any theme you apply —",
    );
    console.log(
      `      silently overriding it. To adopt the tracked layout, run: gutterpress theme apply ${legacyFork.id}`,
    );
    console.log(
      "      (then fold any customizations from styles/book.css in as overrides, or clear the file).",
    );
  }
}

function printImported(theme: ThemeInfo, projectDir: string): void {
  console.log(`Imported theme: ${theme.name} (${theme.id})`);
  console.log(`  project: ${projectDir}`);
  console.log(`  vendored under: themes/${theme.id}`);
  console.log(`Not yet active — apply it with: gutterpress theme apply ${theme.id}`);
}

const list = defineCommand({
  meta: { name: "list", description: "List built-in and project themes, and the active one" },
  args: themeListArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, themeListArgs, "theme list");
      rejectExtraPositionals(args._, 1, "theme list");
    } catch (error) {
      exitForUsage(error);
    }
    await printThemeList(resolveProjectDir(args.dir));
  },
});

const apply = defineCommand({
  meta: { name: "apply", description: "Apply a built-in or project theme, wiring it into the manifest" },
  args: themeApplyArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, themeApplyArgs, "theme apply");
      rejectExtraPositionals(args._, 2, "theme apply");
    } catch (error) {
      exitForUsage(error);
    }

    const projectDir = resolveProjectDir(args.dir);
    const id = String(args.id);

    let target: ApplyThemeTarget;
    try {
      target = await resolveApplyTarget(projectDir, id);
    } catch (error) {
      exitForUsage(error);
    }

    try {
      const applied = await applyTheme(projectDir, target);
      console.log(`Applied theme: ${applied.name} (${applied.id})`);
      console.log(`  project: ${projectDir}`);
      // #239: a theme may declare more than one stylesheet — list every one
      // that actually landed in the manifest's styles: block, in cascade
      // order, instead of assuming the single theme.css every theme used to
      // be capped at.
      const label = applied.styles.length > 1 ? "stylesheets" : "stylesheet";
      console.log(
        `  ${label}: ${applied.styles.map((rel) => `themes/${applied.id}/${rel}`).join(", ")}`,
      );
      if (applied.id !== id) {
        console.log(
          `  note: an existing "${id}" theme was already customized, so this copy was applied as "${applied.id}" instead of overwriting it.`,
        );
      }
    } catch (error) {
      console.error(
        `Could not apply theme: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(EXIT_CODES.PIPELINE);
    }
  },
});

const themeImport = defineCommand({
  meta: { name: "import", description: "Import a theme from a folder, .zip, .css file, or URL" },
  args: themeImportArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, themeImportArgs, "theme import");
      rejectExtraPositionals(args._, 2, "theme import");
    } catch (error) {
      exitForUsage(error);
    }

    const projectDir = resolveProjectDir(args.dir);
    const source = String(args.source);

    let url: URL | undefined;
    try {
      url = new URL(source);
    } catch {
      url = undefined;
    }

    if (url && (url.protocol === "http:" || url.protocol === "https:")) {
      try {
        printImported(await importThemeFromUrl(projectDir, source), projectDir);
      } catch (error) {
        console.error(
          `Could not import theme: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(EXIT_CODES.PIPELINE);
      }
      return;
    }

    const resolvedSource = path.resolve(source);
    let sourceStat: Awaited<ReturnType<typeof stat>>;
    try {
      sourceStat = await stat(resolvedSource);
    } catch {
      exitForUsage(new UsageError(`gutterpress theme import: source not found: ${resolvedSource}`));
    }

    if (sourceStat.isDirectory()) {
      try {
        printImported(await importThemeFromFolder(projectDir, resolvedSource), projectDir);
      } catch (error) {
        console.error(
          `Could not import theme: ${error instanceof Error ? error.message : String(error)}`,
        );
        process.exit(EXIT_CODES.PIPELINE);
      }
      return;
    }

    const ext = path.extname(resolvedSource).toLowerCase();
    if (ext !== ".zip" && ext !== ".css") {
      exitForUsage(
        new UsageError(
          `gutterpress theme import: unsupported file type "${ext || path.basename(resolvedSource)}". ` +
            "Expected a theme folder, a .zip package, a .css file, or an http(s) URL.",
        ),
      );
    }

    try {
      const result = await importThemeFromFile(projectDir, resolvedSource);
      printImported(result.theme, projectDir);
      for (const warning of result.warnings) console.warn(`Warning: ${warning.message}`);
    } catch (error) {
      console.error(
        `Could not import theme: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(EXIT_CODES.PIPELINE);
    }
  },
});

const revert = defineCommand({
  meta: { name: "revert", description: "Revert to the theme that was active before the current one" },
  args: themeRevertArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, themeRevertArgs, "theme revert");
      rejectExtraPositionals(args._, 1, "theme revert");
    } catch (error) {
      exitForUsage(error);
    }

    const projectDir = resolveProjectDir(args.dir);
    const previous = await getPreviousTheme(projectDir);
    if (!previous) {
      exitForUsage(
        new UsageError(`gutterpress theme revert: there is no previous theme to revert to in ${projectDir}.`),
      );
    }

    try {
      const reverted = await revertTheme(projectDir);
      console.log(`Reverted to theme: ${reverted.name} (${reverted.id})`);
      console.log(`  project: ${projectDir}`);
    } catch (error) {
      console.error(
        `Could not revert theme: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(EXIT_CODES.PIPELINE);
    }
  },
});

const remove = defineCommand({
  meta: { name: "remove", description: "Remove a project theme (never touches a built-in)" },
  args: themeRemoveArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, themeRemoveArgs, "theme remove");
      rejectExtraPositionals(args._, 2, "theme remove");
    } catch (error) {
      exitForUsage(error);
    }

    const projectDir = resolveProjectDir(args.dir);
    const id = String(args.id);

    const projectThemes = await listProjectThemes(projectDir);
    const target = projectThemes.find((t) => t.id === id);
    if (!target) {
      exitForUsage(
        new UsageError(
          `gutterpress theme remove: "${id}" is not a theme in this project.` +
            (projectThemes.length > 0
              ? ` Project themes: ${projectThemes.map((t) => t.id).join(", ")}.`
              : ""),
        ),
      );
    }

    const activeBefore = await getActiveTheme(projectDir);
    try {
      await removeProjectTheme(projectDir, id);
      console.log(`Removed theme: ${target.name} (${id})`);
      if (activeBefore?.id === id) {
        console.log("  it was the active theme — no theme is applied now.");
        console.log('  run "gutterpress theme apply <id>" to pick one.');
      }
    } catch (error) {
      console.error(
        `Could not remove theme: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(EXIT_CODES.PIPELINE);
    }
  },
});

export default defineCommand({
  meta: {
    name: "theme",
    description: "List, apply, import, revert, or remove project themes",
  },
  args: parentArgs,
  setup({ rawArgs }) {
    rejectParentFlags(rawArgs);
  },
  subCommands: { list, apply, import: themeImport, revert, remove },
});

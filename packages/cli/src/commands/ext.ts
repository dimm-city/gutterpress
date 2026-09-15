import { defineCommand } from "citty";
import { stat } from "node:fs/promises";
import path from "node:path";

import {
  addBuiltInStyleSet,
  addExtension,
  BUILT_IN_STYLE_SET_IDS,
  importExtensionFromFile,
  importExtensionFromUrl,
  isPathSpecifier,
  listProjectExtensions,
  parseExtensionSpecifier,
  removeExtension,
  setExtensionEnabled,
} from "../index.ts";
import type { ProjectExtensionEntry } from "../index.ts";
import {
  EXIT_CODES,
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
  exitForUsage,
  resolveProjectDir,
} from "../lib/cli-args.ts";

/**
 * `gutterpress ext` (#265) — the one verb set for extensions, whatever they
 * carry (markdown, styles, snippets, a component catalog):
 *
 *   gutterpress ext list [dir]
 *   gutterpress ext add <source> [dir] [--export name]
 *   gutterpress ext remove <specifier> [dir]
 *   gutterpress ext enable <specifier> [dir]
 *   gutterpress ext disable <specifier> [dir]
 *
 * `add` takes an npm package (`name`, `name@version`), a bundled feature
 * name, a folder or plugin-file path, a `.zip`/`.css` file, or an http(s)
 * URL. A thin front-end over `extension-manager.ts`/`extension-import.ts` —
 * the same shared-lib functions the desktop's Extensions panel calls.
 */

const dirArg = {
  type: "positional",
  description: "Project directory (defaults to the current directory)",
  required: false,
} as const;

const specifierArg = {
  type: "positional",
  description: "The extension's specifier as written in the manifest (an npm name, a bundled name, or a ./ path)",
  required: true,
} as const;

export const extListArgs = { dir: dirArg } as const;

export const extAddArgs = {
  source: {
    type: "positional",
    description:
      "What to add: an npm package (name or name@version), a bundled feature (markdown-it-mark, …), a folder or plugin file path, a .zip or .css file, or an http(s) URL",
    required: true,
  },
  dir: dirArg,
  export: {
    type: "string",
    description: "Named module export to use as the plugin function (npm and path extensions only)",
    required: false,
  },
  look: {
    type: "boolean",
    description:
      "Treat SOURCE as a built-in look id (clean-book, zine, technical-doc): copy it into extensions/ and add it",
    required: false,
  },
} as const;

export const extRemoveArgs = { specifier: specifierArg, dir: dirArg } as const;
export const extEnableArgs = { specifier: specifierArg, dir: dirArg } as const;
export const extDisableArgs = { specifier: specifierArg, dir: dirArg } as const;

export const EXT_SUBCOMMANDS = ["list", "add", "remove", "enable", "disable"] as const;

const parentArgs = {} as const;

function rejectParentFlags(rawArgs: string[]): void {
  const first = rawArgs[0];
  if (first === undefined || (EXT_SUBCOMMANDS as readonly string[]).includes(first)) return;
  if (!first.startsWith("-")) return;
  try {
    rejectUnknownFlags(rawArgs, parentArgs, "ext");
  } catch (error) {
    exitForUsage(error);
  }
}

async function requireProjectDir(dir: unknown, verb: string): Promise<string> {
  const projectDir = resolveProjectDir(dir);
  let info;
  try {
    info = await stat(projectDir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new UsageError(`Project directory does not exist: ${projectDir}`);
    }
    throw error;
  }
  if (!info.isDirectory()) {
    throw new UsageError(`Project path is not a directory: ${projectDir}`);
  }
  return projectDir;
}

function carriesLabel(entry: ProjectExtensionEntry): string {
  const parts = (["markdown", "styles", "snippets", "components"] as const).filter(
    (k) => entry.carries[k],
  );
  return parts.length > 0 ? parts.join(", ") : "nothing declared";
}

function describeLine(entry: ProjectExtensionEntry): string {
  const state = entry.enabled ? "" : "  (disabled)";
  const label = entry.label !== entry.name ? `  ${entry.label}` : "";
  return `  ${entry.use}${state}  [${entry.kind}; ${carriesLabel(entry)}]${label}`;
}

function printAdded(entry: ProjectExtensionEntry, projectDir: string, warnings: string[] = []): void {
  if (entry.kind === "npm") {
    console.log(`Installed ${entry.use}`);
    console.log(`  project: ${projectDir}`);
    console.log("  vendored under: plugins/npm");
    console.log("  manifest: exact version pinned");
  } else if (entry.kind === "bundled") {
    console.log(`Enabled bundled feature ${entry.use}`);
    console.log(`  project: ${projectDir}`);
  } else {
    console.log(`Added ${entry.use}  (${carriesLabel(entry)})`);
    console.log(`  project: ${projectDir}`);
    console.log("  referenced in place — edit the folder and the book follows");
  }
  for (const warning of [...(entry.warnings ?? []), ...warnings]) console.warn(`Warning: ${warning}`);
}

function failPipeline(prefix: string, error: unknown): never {
  console.error(`${prefix}: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(EXIT_CODES.PIPELINE);
}

const list = defineCommand({
  meta: { name: "list", description: "List the project's extensions in load (= cascade) order" },
  args: extListArgs,
  async run({ args, rawArgs }) {
    let projectDir = "";
    try {
      rejectUnknownFlags(rawArgs, extListArgs, "ext list");
      rejectExtraPositionals(args._, 1, "ext list");
      projectDir = await requireProjectDir(args.dir, "list");
    } catch (error) {
      exitForUsage(error);
    }
    try {
      const entries = await listProjectExtensions(projectDir);
      if (entries.length === 0) {
        console.log("No extensions configured. Add one with: gutterpress ext add <source>");
        return;
      }
      console.log("Extensions (top loads first; a later entry's CSS wins ties):");
      for (const entry of entries) {
        console.log(describeLine(entry));
        for (const warning of entry.warnings ?? []) console.log(`      ! ${warning}`);
      }
    } catch (error) {
      failPipeline("Could not list extensions", error);
    }
  },
});

const add = defineCommand({
  meta: {
    name: "add",
    description:
      "Add an extension: an npm package, a bundled feature, a folder or plugin file, a .zip/.css file, or a URL",
  },
  args: extAddArgs,
  async run({ args, rawArgs }) {
    const source = String(args.source).trim();
    const isUrl = /^https?:\/\//i.test(source);
    // An existing path (relative to the shell's cwd, as typed) wins over an
    // npm name; `./` makes the intent explicit either way.
    const candidate = path.resolve(process.cwd(), source);
    const existing = isUrl ? null : await stat(candidate).catch(() => null);
    const isArchive = !!existing?.isFile() && /\.(zip|css)$/i.test(candidate);
    let projectDir = "";
    let exportName: string | undefined;
    try {
      rejectUnknownFlags(rawArgs, extAddArgs, "ext add");
      rejectExtraPositionals(args._, 2, "ext add");
      projectDir = await requireProjectDir(args.dir, "add");
      exportName = typeof args.export === "string" ? args.export.trim() : undefined;
      if (typeof args.export === "string" && !exportName) {
        throw new UsageError("gutterpress ext add: --export requires a non-empty name");
      }
      if (args.look && !(BUILT_IN_STYLE_SET_IDS as readonly string[]).includes(source)) {
        throw new UsageError(
          `gutterpress ext add --look: unknown built-in look "${source}" (one of: ${BUILT_IN_STYLE_SET_IDS.join(", ")})`,
        );
      }
      if (!args.look && !isUrl && !existing) {
        // A bundled/npm specifier — or a path that is not there: either way
        // a usage error, not a pipeline failure.
        try {
          if (path.isAbsolute(source) || isPathSpecifier(source)) {
            throw new Error(`source not found: ${candidate}`);
          }
          parseExtensionSpecifier(source);
        } catch (error) {
          throw new UsageError(
            `gutterpress ext add: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    } catch (error) {
      exitForUsage(error);
    }

    try {
      if (args.look) {
        const entry = await addBuiltInStyleSet(projectDir, source);
        printAdded(entry, projectDir);
        return;
      }
      if (isUrl) {
        const { entry, warnings } = await importExtensionFromUrl(projectDir, source);
        printAdded(entry, projectDir, warnings.map((w) => w.message));
        return;
      }
      if (isArchive) {
        const { entry, warnings } = await importExtensionFromFile(projectDir, candidate);
        printAdded(entry, projectDir, warnings.map((w) => w.message));
        return;
      }
      const entry = await addExtension(projectDir, existing ? candidate : source, { exportName });
      printAdded(entry, projectDir);
    } catch (error) {
      failPipeline("Could not add extension", error);
    }
  },
});

function specifierCommand(
  name: "remove" | "enable" | "disable",
  description: string,
  argsDef: typeof extRemoveArgs,
  act: (projectDir: string, specifier: string) => Promise<string>,
) {
  return defineCommand({
    meta: { name, description },
    args: argsDef,
    async run({ args, rawArgs }) {
      let projectDir = "";
      try {
        rejectUnknownFlags(rawArgs, argsDef, `ext ${name}`);
        rejectExtraPositionals(args._, 2, `ext ${name}`);
        projectDir = await requireProjectDir(args.dir, name);
      } catch (error) {
        exitForUsage(error);
      }
      try {
        console.log(await act(projectDir, String(args.specifier).trim()));
      } catch (error) {
        // "not in the manifest" and friends are the author's input, not a
        // pipeline failure — a clean usage error, exit 2.
        exitForUsage(
          new UsageError(
            `gutterpress ext ${name}: ${error instanceof Error ? error.message : String(error)}`,
          ),
        );
      }
    },
  });
}

const remove = specifierCommand(
  "remove",
  "Remove an extension from the manifest (an npm extension's vendored copy is deleted too)",
  extRemoveArgs,
  async (projectDir, specifier) => {
    await removeExtension(projectDir, specifier);
    return `Removed ${specifier}`;
  },
);

const enable = specifierCommand(
  "enable",
  "Turn a configured extension on",
  extEnableArgs,
  async (projectDir, specifier) => {
    await setExtensionEnabled(projectDir, specifier, true);
    return `Enabled ${specifier}`;
  },
);

const disable = specifierCommand(
  "disable",
  "Turn a configured extension off without removing it",
  extDisableArgs,
  async (projectDir, specifier) => {
    await setExtensionEnabled(projectDir, specifier, false);
    return `Disabled ${specifier}`;
  },
);

export default defineCommand({
  meta: {
    name: "ext",
    description: "List, add, remove, enable, or disable the project's extensions",
  },
  args: parentArgs,
  setup({ rawArgs }) {
    rejectParentFlags(rawArgs);
  },
  subCommands: { list, add, remove, enable, disable },
});

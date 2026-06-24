import { defineCommand } from "citty";
import { resolve } from "node:path";
import { scaffoldProject, BUILT_IN_TEMPLATE_IDS } from "../index.ts";
import type { CreateProjectError, ProjectTemplateId } from "../index.ts";

/**
 * `print-md new` — scaffold a new project from an embedded starter template.
 *
 * A thin front-end over the shared lib's `scaffoldProject` (#25): the same
 * function the viewer wizard calls. Works fully headless — no viewer required.
 *
 *   print-md new "My First Book" --author "Jane" --dir ~/Books [--no-git]
 */
export default defineCommand({
  meta: {
    name: "new",
    description: "Create a new print-md project from a starter template",
  },
  args: {
    name: {
      type: "positional",
      description: "Project name (becomes the title and folder name)",
      required: true,
    },
    author: {
      type: "string",
      description: "Author name to record in the project",
    },
    dir: {
      type: "string",
      description: "Parent directory to create the project in (default: current directory)",
    },
    folder: {
      type: "string",
      description: "Folder name to create (default: a slug of the project name)",
    },
    template: {
      type: "string",
      description: `Starter template: ${BUILT_IN_TEMPLATE_IDS.join(", ")} (default: book)`,
    },
    git: {
      type: "boolean",
      description: "Initialise local version history (default: true; use --no-git to skip)",
      default: true,
    },
  },
  async run({ args }) {
    const name = String(args.name);
    const parentDir = resolve(
      typeof args.dir === "string" && args.dir ? args.dir : process.cwd(),
    );

    let template: ProjectTemplateId | undefined;
    if (typeof args.template === "string" && args.template) {
      if (!(BUILT_IN_TEMPLATE_IDS as readonly string[]).includes(args.template)) {
        console.error(
          `Unknown template "${args.template}". Choose one of: ${BUILT_IN_TEMPLATE_IDS.join(", ")}.`,
        );
        process.exit(2);
      }
      template = args.template as ProjectTemplateId;
    }

    try {
      const result = await scaffoldProject({
        name,
        author: typeof args.author === "string" ? args.author : undefined,
        parentDir,
        folderName: typeof args.folder === "string" && args.folder ? args.folder : undefined,
        template,
        versionHistory: args.git === false ? "none" : "local-git",
      });

      console.log(`Created project: ${result.projectDir}`);
      console.log(`  manifest: ${result.manifestPath}`);
      console.log(`  start writing in: ${result.openFile}`);
      if (result.versionHistory === "local-git") {
        console.log("  version history: enabled (local snapshots)");
      } else if (result.versionHistoryError) {
        console.log(
          `  version history: not enabled (${result.versionHistoryError})`,
        );
      }
      console.log("");
      console.log(`Next: print-md preview "${result.projectDir}"`);
    } catch (e) {
      const err = e as CreateProjectError;
      const code = err && typeof err.code === "string" ? err.code : "scaffold-io";
      console.error(`Could not create project: ${err?.message ?? String(e)}`);
      // Distinct exit codes per failure class for scripting.
      process.exit(code === "target-exists" ? 3 : 2);
    }
  },
});

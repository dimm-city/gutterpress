/**
 * Project scaffolding (#25 — new-project wizard / starter template).
 *
 * The "create a project" logic lives HERE, in `@dimm-city/print-md`, so the
 * viewer wizard (`NewProjectWizard.svelte` → IPC pass-through) and the CLI
 * command (`print-md new`) are both thin front-ends over ONE implementation —
 * no duplication (issue #25 architecture clarification, 2026-06-06).
 *
 * Scaffolding model (per the issue):
 *   1. COPY an embedded template directory to the chosen location (a plain
 *      directory copy, using the existing embedded-asset pattern —
 *      `embedded-assets.ts`, `with { type: "file" }`).
 *   2. FILL IN the copied files (substitute title / author / output filename
 *      into `manifest.yaml`, the sample chapter, etc.).
 *   3. Optionally initialise local version history (a `local-git` repo) so a
 *      non-technical author gets undo/snapshots with no credentials and no
 *      remote — with an escape hatch to stay a plain `local-folder`.
 *
 * Pure Node (`fs/promises` + the embedded template), no subprocess. The Git
 * step delegates to the `SourceProvider` layer (`source-provider.ts`), which is
 * `isomorphic-git` only — never the system `git` binary (CLAUDE.md §7).
 *
 * NEVER deletes or overwrites an existing path: if the target already exists it
 * throws `CreateProjectError` with code `target-exists` (consistent with the
 * global never-delete-user-data rule).
 */
import { access, copyFile, cp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { constants as FS } from "node:fs";
import path from "node:path";

import { getAssetPath } from "./embedded-assets.ts";

/**
 * Which embedded starter template to scaffold from. Each id maps to a directory
 * under `assets/templates/<id>/` (a `manifest.yaml` + a `chapter-01.md`), baked
 * into the binary via `embedded-assets.ts`. `"book"` is the default; the others
 * give non-technical authors a head start for common formats (#29).
 */
export type ProjectTemplateId = "book" | "ttrpg" | "zine" | "technical";

/**
 * How (or whether) to put the new project under local version history.
 *
 * - `"local-git"` — default. Initialise a local Git repo with one initial
 *   "snapshot" commit, using a **Node-native, pure-JS** implementation
 *   (`isomorphic-git`) per CLAUDE.md §7. No remote, no credentials. Maps to a
 *   `local-git-folder` ProjectSource.
 * - `"none"` — the escape hatch. Leave the project a plain `local-folder` (no
 *   `.git`). Selected automatically if version-history init fails, or
 *   explicitly by an author who does not want it.
 */
export type ProjectVersionHistoryMode = "local-git" | "none";

/**
 * Inputs the wizard / CLI collect from the author. Writer-friendly: the only
 * required field is a human project name; everything else is derived or
 * defaulted.
 */
export interface CreateProjectOptions {
  /** Human-friendly project name (e.g. "My First Book"). Required. */
  name: string;
  /** Author display name. Becomes manifest `authors: [author]`. Optional. */
  author?: string;
  /** Absolute path to the PARENT directory chosen in the folder picker. */
  parentDir: string;
  /** Folder name under `parentDir`. Defaults to a slug of `name`. */
  folderName?: string;
  /** Which embedded template to scaffold from. Defaults to `"book"`. */
  template?: ProjectTemplateId;
  /**
   * Absolute path to a CUSTOM template directory to scaffold from (#29). When
   * set, the whole directory is copied (minus its metadata sidecar) instead of a
   * built-in template, and `template` is ignored. Used by the wizard when the
   * author picks a saved/imported template.
   */
  templateDir?: string;
  /** Version-history mode for the new project. Defaults to `"local-git"`. */
  versionHistory?: ProjectVersionHistoryMode;
}

/** The result of a successful scaffold. */
export interface CreateProjectResult {
  /** Absolute path of the created project directory. */
  projectDir: string;
  /** Absolute path of the generated `manifest.yaml`. */
  manifestPath: string;
  /**
   * Absolute path of the sample chapter the viewer should open first, so the
   * author immediately sees a rendered document (issue acceptance criterion).
   */
  openFile: string;
  /**
   * What actually happened with version history. May differ from the requested
   * mode: if `"local-git"` was requested but init failed (escape hatch fired),
   * this is `"none"` and `versionHistoryError` explains why.
   */
  versionHistory: ProjectVersionHistoryMode;
  /** Present only when `"local-git"` was requested but downgraded to `"none"`. */
  versionHistoryError?: string;
}

/**
 * Discriminated failure reasons so the wizard can show a writer-friendly
 * message and the CLI can choose an exit code. Scaffolding is fail-fast and
 * NEVER deletes or overwrites anything that already exists.
 */
export type CreateProjectErrorCode =
  | "parent-not-writable"
  | "target-exists"
  | "invalid-name"
  | "scaffold-io";

export interface CreateProjectError extends Error {
  code: CreateProjectErrorCode;
}

class CreateProjectErrorImpl extends Error implements CreateProjectError {
  code: CreateProjectErrorCode;
  constructor(code: CreateProjectErrorCode, message: string) {
    super(message);
    this.name = "CreateProjectError";
    this.code = code;
  }
}

/**
 * Slugify a human name into a safe folder / filename stem: lowercased,
 * non-alphanumerics collapsed to single hyphens, trimmed. Returns `""` for
 * input that contains no usable characters (caller treats that as invalid).
 */
export function slugifyProjectName(name: string): string {
  return name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // strip diacritics
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Escape a string for use as a double-quoted YAML scalar. We emit values inside
 * `"..."`, so only `\` and `"` need escaping. Keeps the generated manifest
 * human-readable while staying valid for any author name/title.
 */
export function escapeYamlScalar(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

const DEFAULT_AUTHOR = "Anonymous";

/**
 * Scaffold a new print-md project. Resolves with a {@link CreateProjectResult};
 * throws a {@link CreateProjectError} on any precondition failure.
 */
export async function scaffoldProject(
  options: CreateProjectOptions,
): Promise<CreateProjectResult> {
  const name = (options.name ?? "").trim();
  if (!name) {
    throw new CreateProjectErrorImpl(
      "invalid-name",
      "A project name is required.",
    );
  }

  const slug = slugifyProjectName(name);
  const folderName = (options.folderName ?? slug).trim();
  if (!folderName || folderName !== slugifyProjectName(folderName)) {
    // An empty slug, or a caller-supplied folderName that isn't a safe slug.
    throw new CreateProjectErrorImpl(
      "invalid-name",
      `Could not derive a valid folder name from "${name}".`,
    );
  }

  const parentDir = options.parentDir;
  if (!parentDir || !path.isAbsolute(parentDir)) {
    throw new CreateProjectErrorImpl(
      "parent-not-writable",
      "The save location must be an absolute path.",
    );
  }

  // Parent must exist and be writable. (We never create the parent — the user
  // picked it from a folder dialog, so it should already exist.)
  try {
    await access(parentDir, FS.W_OK);
  } catch {
    throw new CreateProjectErrorImpl(
      "parent-not-writable",
      `The chosen save location can't be written to: ${parentDir}`,
    );
  }

  const projectDir = path.join(parentDir, folderName);

  // Never overwrite. If anything already exists at the target, refuse.
  let targetExists = true;
  try {
    await access(projectDir, FS.F_OK);
  } catch {
    targetExists = false;
  }
  if (targetExists) {
    throw new CreateProjectErrorImpl(
      "target-exists",
      `A folder named "${folderName}" already exists here. Choose a different name or location.`,
    );
  }

  const template = options.template ?? "book";
  const customTemplateDir = options.templateDir;

  // 1. COPY the template files to the target.
  try {
    await mkdir(projectDir, { recursive: true });
    if (customTemplateDir) {
      // CUSTOM template: copy the whole directory tree (minus the metadata
      // sidecar). The author's saved files become the new project's files.
      const entries = await readdir(customTemplateDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".print-md-template.json") continue;
        await cp(
          path.join(customTemplateDir, entry.name),
          path.join(projectDir, entry.name),
          { recursive: true },
        );
      }
      // Ensure an assets/ dir exists even when the template didn't ship one.
      await mkdir(path.join(projectDir, "assets"), { recursive: true });
    } else {
      // BUILT-IN template: copy the two embedded files. The empty `assets/` dir
      // is created explicitly (an empty directory can't be an embedded asset).
      const tplManifest = await getAssetPath(`templates/${template}/manifest.yaml`);
      const tplChapter = await getAssetPath(`templates/${template}/chapter-01.md`);
      await mkdir(path.join(projectDir, "assets"), { recursive: true });
      await copyFile(tplManifest, path.join(projectDir, "manifest.yaml"));
      await copyFile(tplChapter, path.join(projectDir, "chapter-01.md"));
    }
  } catch (e) {
    throw new CreateProjectErrorImpl(
      "scaffold-io",
      `Could not create the project files: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2. FILL IN the copied files (placeholder substitution).
  const manifestPath = path.join(projectDir, "manifest.yaml");
  const author = (options.author ?? "").trim() || DEFAULT_AUTHOR;
  const outputPdf = `${slug}.pdf`;

  const substitutions: Record<string, string> = {
    "{{TITLE}}": escapeYamlScalar(name),
    "{{AUTHOR}}": escapeYamlScalar(author),
    "{{OUTPUT_PDF}}": escapeYamlScalar(outputPdf),
  };

  // Which file the viewer opens first: the manifest's first source file when we
  // can read it (custom templates may not have chapter-01.md), else chapter-01.
  let openFile = path.join(projectDir, "chapter-01.md");
  try {
    await fillTemplateFile(manifestPath, substitutions);
    const firstSource = await firstSourceFile(manifestPath);
    if (firstSource) openFile = path.join(projectDir, firstSource);
    // The opened chapter substitutes only {{TITLE}} (plain Markdown, no YAML
    // escaping needed — pass the raw name). Best-effort: a custom template's
    // chapter may have no placeholder at all.
    await fillTemplateFile(openFile, { "{{TITLE}}": name }).catch(() => {});
  } catch (e) {
    throw new CreateProjectErrorImpl(
      "scaffold-io",
      `Could not finalise the project files: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 3. Optionally initialise local version history (default: local-git).
  const requested = options.versionHistory ?? "local-git";
  let versionHistory: ProjectVersionHistoryMode = "none";
  let versionHistoryError: string | undefined;

  if (requested === "local-git") {
    try {
      const { providerFor } = await import("./source-provider.ts");
      const provider = providerFor({ type: "local-folder", path: projectDir });
      await provider.initVersionHistory({
        projectDir,
        authorName: options.author?.trim() || undefined,
        initialMessage: "Created project",
      });
      versionHistory = "local-git";
    } catch (e) {
      // Escape hatch: never fail the whole create just because Git init failed.
      versionHistory = "none";
      versionHistoryError = e instanceof Error ? e.message : String(e);
    }
  }

  const result: CreateProjectResult = {
    projectDir,
    manifestPath,
    openFile,
    versionHistory,
  };
  if (versionHistoryError !== undefined) {
    result.versionHistoryError = versionHistoryError;
  }
  return result;
}

/**
 * Best-effort: read the first `source.files` entry from a manifest so the wizard
 * can open it. A light regex (not a full YAML parse) keeps this dependency-free;
 * returns undefined when no list item is found.
 */
async function firstSourceFile(manifestPath: string): Promise<string | undefined> {
  let text: string;
  try {
    text = await readFile(manifestPath, "utf8");
  } catch {
    return undefined;
  }
  // Find the `files:` list and return its first `- value` entry.
  const filesIdx = text.search(/^\s*files:\s*$/m);
  if (filesIdx === -1) return undefined;
  const rest = text.slice(filesIdx);
  const m = rest.match(/^\s*-\s*"?([^"\n]+?)"?\s*$/m);
  return m ? m[1]!.trim() : undefined;
}

/** Read a copied template file, replace every placeholder, write it back. */
async function fillTemplateFile(
  filePath: string,
  substitutions: Record<string, string>,
): Promise<void> {
  let text = await readFile(filePath, "utf8");
  for (const [token, value] of Object.entries(substitutions)) {
    text = text.split(token).join(value);
  }
  await writeFile(filePath, text, "utf8");
}

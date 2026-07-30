/**
 * Project scaffolding (#25 — new-project wizard / starter template).
 *
 * The "create a project" logic lives HERE, in `gutterpress`, so the
 * desktop wizard (`NewProjectWizard.svelte` → IPC pass-through) and the CLI
 * command (`gutterpress new`) are both thin front-ends over ONE implementation —
 * no duplication (issue #25 architecture clarification, 2026-06-06).
 *
 * Scaffolding model (per the issue):
 *   1. COPY an embedded template directory to the chosen location (a plain
 *      directory copy, using the existing embedded-asset pattern —
 *      `embedded-assets.ts`, `with { type: "file" }`).
 *   2. FILL IN the copied files (substitute title / author into
 *      `manifest.yaml`, the sample chapter, etc.).
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
import { access, copyFile, cp, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { constants as FS, existsSync } from "node:fs";
import path from "node:path";

import { getAssetPath } from "./embedded-assets.ts";
import { MANIFEST_FILENAMES } from "./manifest.ts";
import { loadManifestDoc, writeManifestDoc } from "./manifest-doc.ts";
import { PRESET_IDS, type PresetId } from "./presets.ts";
import { slugify } from "./slug.ts";

/**
 * Which embedded starter template to scaffold from. Each id maps to a directory
 * under `assets/templates/<id>/` (a `manifest.yaml` + a `chapter-01.md`), baked
 * into the binary via `embedded-assets.ts`. `"book"` is the default; the others
 * give non-technical authors a head start for common formats (#29).
 */
export type ProjectTemplateId = "book" | "zine" | "technical";

/**
 * The bundled theme each built-in template scaffolds as its starter
 * `styles/book.css`. The theme.css files are complete, token-driven stylesheets
 * (a documented `:root` block + the rules that use it), so a fresh project opens
 * with a real look AND immediately-editable settings in the guided Design panel
 * — never an empty "no stylesheet" dead-end (UX audit P2#7).
 */
const STARTER_THEME_FOR_TEMPLATE: Record<ProjectTemplateId, string> = {
  book: "clean-book",
  zine: "zine",
  technical: "technical-doc",
};

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
  /**
   * Which vendor preset the new book is designed for (ADR 0008). REQUIRED
   * when scaffolding a built-in template — creation flows make the author
   * choose; the resolveConfig dtrpg fallback exists for hand-written
   * manifests, not for tooling. Written into the generated manifest as an
   * explicit `preset:` line. Ignored with `templateDir`: a saved template's
   * manifest carries its preset as part of the captured design.
   */
  preset?: PresetId;
  /**
   * Page geometry written into the generated manifest (points; 72pt = 1in).
   * REQUIRED when `preset` is `"custom"` (it has no built-in trim); allowed
   * with any preset to override its trim. These are the validation bounds
   * the built PDF is checked against — the actual trim comes from the
   * stylesheet's `@page` rule, and the two should match.
   */
  customPage?: CustomPageOptions;
  /** Version-history mode for the new project. Defaults to `"local-git"`. */
  versionHistory?: ProjectVersionHistoryMode;
}

/** Page bounds for {@link CreateProjectOptions.customPage}. */
export interface CustomPageOptions {
  /** Trim width in points (72pt = 1in). */
  width: number;
  /** Trim height in points (72pt = 1in). */
  height: number;
  /** Allowed deviation in points when validating a built PDF. Default 0.5. */
  tolerance?: number;
}

/** The result of a successful scaffold. */
export interface CreateProjectResult {
  /** Absolute path of the created project directory. */
  projectDir: string;
  /** Absolute path of the generated manifest. */
  manifestPath: string;
  /**
   * Absolute path of the sample chapter the desktop should open first, so the
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
  | "preset-required"
  | "custom-page-required"
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
  return slugify(name);
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

function isPositivePoints(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * Validate the preset + page inputs for a built-in-template scaffold
 * (ADR 0008). Returns the validated preset; throws `preset-required` /
 * `custom-page-required` with author-actionable messages.
 */
function requirePreset(
  preset: PresetId | undefined,
  customPage: CustomPageOptions | undefined,
): PresetId {
  if (!preset || !(PRESET_IDS as readonly string[]).includes(preset)) {
    const got = preset ? ` (got "${preset}")` : "";
    throw new CreateProjectErrorImpl(
      "preset-required",
      `A preset is required to create a book${got}. Choose one of: ${PRESET_IDS.join(", ")}.`,
    );
  }

  if (preset === "custom") {
    const missing: string[] = [];
    if (!customPage || !isPositivePoints(customPage.width)) missing.push("page width");
    if (!customPage || !isPositivePoints(customPage.height)) missing.push("page height");
    if (missing.length > 0) {
      throw new CreateProjectErrorImpl(
        "custom-page-required",
        `The custom preset needs a trim size: ${missing.join(" and ")} in points ` +
          `(72pt = 1in — e.g. US Letter is 612 x 792).`,
      );
    }
  } else if (customPage && (!isPositivePoints(customPage.width) || !isPositivePoints(customPage.height))) {
    // Optional per-preset override — but never write garbage into a manifest.
    throw new CreateProjectErrorImpl(
      "custom-page-required",
      "Page overrides need a positive width and height in points (72pt = 1in).",
    );
  }
  if (customPage?.tolerance !== undefined && !isPositivePoints(customPage.tolerance)) {
    throw new CreateProjectErrorImpl(
      "custom-page-required",
      "Page tolerance must be a positive number of points.",
    );
  }

  return preset;
}

/**
 * Scaffold a new gutterpress project. Resolves with a {@link CreateProjectResult};
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

  // ADR 0008: creating a book from a built-in template REQUIRES choosing a
  // preset (and a trim size when it's `custom`) — validated before anything
  // touches disk. A saved custom template is exempt: its manifest carries a
  // preset as part of the captured design.
  const preset = customTemplateDir
    ? undefined
    : requirePreset(options.preset, options.customPage);

  // 1. COPY the template files to the target.
  try {
    await mkdir(projectDir, { recursive: true });
    if (customTemplateDir) {
      // CUSTOM template: copy the whole directory tree (minus the metadata
      // sidecar). The author's saved files become the new project's files.
      const entries = await readdir(customTemplateDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === ".gutterpress-template.json") continue;
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
      await copyFile(tplManifest, path.join(projectDir, MANIFEST_FILENAMES[0]));
      await copyFile(tplChapter, path.join(projectDir, "chapter-01.md"));
      // Scaffold styles/book.css from the template's starter theme so the
      // project opens with a real, fully-editable stylesheet (the manifest
      // references styles/book.css). Never an empty Design panel (audit P2#7).
      const starterThemeId = STARTER_THEME_FOR_TEMPLATE[template] ?? "clean-book";
      const starterCss = await getAssetPath(`themes/${starterThemeId}/theme.css`);
      await mkdir(path.join(projectDir, "styles"), { recursive: true });
      await copyFile(starterCss, path.join(projectDir, "styles", "book.css"));
    }
  } catch (e) {
    throw new CreateProjectErrorImpl(
      "scaffold-io",
      `Could not create the project files: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 1b. Ensure `dist/` (the build output dir — lib/output-paths.ts) is
  // gitignored. See `ensureGitignoreHasDist`'s doc comment for why this is a
  // confirmed-bug fix, not a nicety: without it, auto-snapshot commits and
  // pushes every build's output by default.
  try {
    await ensureGitignoreHasDist(projectDir);
  } catch (e) {
    throw new CreateProjectErrorImpl(
      "scaffold-io",
      `Could not write .gitignore: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 2. FILL IN the copied files (placeholder substitution).
  const manifestPath =
    MANIFEST_FILENAMES.map((name) => path.join(projectDir, name)).find(existsSync) ??
    path.join(projectDir, MANIFEST_FILENAMES[0]);
  const author = (options.author ?? "").trim() || DEFAULT_AUTHOR;

  const substitutions: Record<string, string> = {
    "{{TITLE}}": escapeYamlScalar(name),
    "{{AUTHOR}}": escapeYamlScalar(author),
  };

  // Which file the desktop opens first: the manifest's first source file when we
  // can read it (custom templates may not have chapter-01.md), else chapter-01.
  let openFile = path.join(projectDir, "chapter-01.md");
  try {
    await fillTemplateFile(manifestPath, substitutions);
    if (preset) {
      // Overwrite the template's placeholder `preset:` with the author's
      // choice (and their trim, for `custom` or an explicit override) via the
      // comment-preserving YAML document helpers.
      const { doc, file } = await loadManifestDoc(projectDir);
      doc.set("preset", preset);
      if (options.customPage) {
        const page: Record<string, number> = {
          width: options.customPage.width,
          height: options.customPage.height,
        };
        if (options.customPage.tolerance !== undefined) {
          page.tolerance = options.customPage.tolerance;
        }
        doc.set("page", doc.createNode(page));
      }
      await writeManifestDoc(file, doc);
    }
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
      // The one expected case: the new book landed inside a folder that's
      // already part of an enclosing repo's version history (a multi-book
      // project). That's not a failure — the book already has history,
      // scoped at the repo root — so report it as such instead of the
      // provider's generic "won't create a separate history here" message.
      const { findEnclosingRepoDir } = await import("./project-source.ts");
      const enclosingRepoDir = await findEnclosingRepoDir(projectDir);
      versionHistoryError = enclosingRepoDir
        ? `This book was added to ${path.basename(enclosingRepoDir)}'s shared version history; save a snapshot to record it.`
        : e instanceof Error
          ? e.message
          : String(e);
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

/** Options for adopting an EXISTING folder as a gutterpress project (in place). */
export interface AdoptFolderOptions {
  /** Absolute path of the existing folder to set up as a book. */
  dir: string;
  /** Book title. Defaults to a prettified version of the folder name. */
  title?: string;
  /** Author display name. Optional. */
  author?: string;
  /** Template whose starter theme/chapter is used. Defaults to `"book"`. */
  template?: ProjectTemplateId;
  /** Version-history mode. Defaults to `"local-git"`. */
  versionHistory?: ProjectVersionHistoryMode;
}

/** "my-cool-book" / "my_cool_book" → "My Cool Book". */
function prettifyFolderName(base: string): string {
  const words = base.replace(/[-_]+/g, " ").trim();
  return words.replace(/\b\w/g, (c) => c.toUpperCase()) || "Untitled Book";
}

/**
 * Adopt an EXISTING folder as a gutterpress project, in place (no new subfolder).
 * Writes a `manifest.yaml` (using the folder's existing top-level `.md` files as
 * `source.files`, or scaffolding a `chapter-01.md` when there are none), copies
 * a starter `styles/book.css`, ensures `dist/` is gitignored (see
 * `ensureGitignoreHasDist`), and optionally initialises local version history.
 *
 * NON-DESTRUCTIVE (global never-overwrite rule): refuses if the folder is
 * already a project, and never overwrites an existing `manifest.yaml`,
 * `styles/book.css`, `.gitignore`, or any markdown file.
 */
export async function adoptFolder(options: AdoptFolderOptions): Promise<CreateProjectResult> {
  const dir = options.dir;
  if (typeof dir !== "string" || !path.isAbsolute(dir)) {
    throw new CreateProjectErrorImpl("scaffold-io", "An absolute folder path is required.");
  }
  let st;
  try {
    st = await stat(dir);
  } catch {
    throw new CreateProjectErrorImpl("scaffold-io", `Folder not found: ${dir}`);
  }
  if (!st.isDirectory()) {
    throw new CreateProjectErrorImpl("scaffold-io", `Not a folder: ${dir}`);
  }
  if (MANIFEST_FILENAMES.some((name) => existsSync(path.join(dir, name)))) {
    throw new CreateProjectErrorImpl(
      "target-exists",
      "This folder is already a Gutterpress project.",
    );
  }

  const template = options.template ?? "book";
  const title = (options.title ?? "").trim() || prettifyFolderName(path.basename(dir));
  const author = (options.author ?? "").trim() || DEFAULT_AUTHOR;

  let mdFiles: string[];
  try {
    // 1. Use existing top-level markdown as the source; scaffold one if none.
    const entries = await readdir(dir, { withFileTypes: true });
    mdFiles = entries
      .filter((e) => e.isFile() && /\.(md|markdown)$/i.test(e.name))
      .map((e) => e.name)
      .sort((a, b) => a.localeCompare(b));
    if (mdFiles.length === 0) {
      const tplChapter = await getAssetPath(`templates/${template}/chapter-01.md`);
      await copyFile(tplChapter, path.join(dir, "chapter-01.md"));
      await fillTemplateFile(path.join(dir, "chapter-01.md"), { "{{TITLE}}": title }).catch(() => {});
      mdFiles = ["chapter-01.md"];
    }

    // 2. Starter stylesheet (don't clobber an existing styles/book.css).
    const themeId = STARTER_THEME_FOR_TEMPLATE[template] ?? "clean-book";
    await mkdir(path.join(dir, "styles"), { recursive: true });
    const bookCssPath = path.join(dir, "styles", "book.css");
    if (!existsSync(bookCssPath)) {
      await copyFile(await getAssetPath(`themes/${themeId}/theme.css`), bookCssPath);
    }

    // 3. Write the manifest referencing the discovered files + book.css. No
    // `output:` block: output location is a convention (lib/output-paths.ts —
    // `dist/<title-slug>/`), and resolveConfig THROWS a UsageError if a
    // manifest still carries one.
    // An explicit `preset:` (ADR 0008): adoption is a one-click rescue
    // affordance, so it takes the product default — but written out, visible
    // and editable, never implicit.
    const filesYaml = mdFiles.map((f) => `    - "${escapeYamlScalar(f)}"`).join("\n");
    const manifest =
      `title: "${escapeYamlScalar(title)}"\n` +
      `authors:\n  - "${escapeYamlScalar(author)}"\n` +
      `preset: dtrpg\n` +
      `source:\n  files:\n${filesYaml}\n` +
      `styles:\n  - styles/book.css\n`;
    await writeFile(path.join(dir, MANIFEST_FILENAMES[0]), manifest, "utf8");
    await mkdir(path.join(dir, "assets"), { recursive: true });

    // 4. Ensure `dist/` is gitignored — same reasoning as scaffoldProject's
    // step 1b. An ADOPTED folder is even more likely to already be under
    // some other version control the author set up by hand, so this is
    // never-overwrite: it only creates or appends, never replaces.
    await ensureGitignoreHasDist(dir);
  } catch (e) {
    if (e instanceof CreateProjectErrorImpl) throw e;
    throw new CreateProjectErrorImpl(
      "scaffold-io",
      `Could not set up the folder: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // 5. Optional local version history (same escape-hatch as scaffoldProject).
  const requested = options.versionHistory ?? "local-git";
  let versionHistory: ProjectVersionHistoryMode = "none";
  let versionHistoryError: string | undefined;
  if (requested === "local-git") {
    try {
      const { providerFor } = await import("./source-provider.ts");
      const provider = providerFor({ type: "local-folder", path: dir });
      await provider.initVersionHistory({
        projectDir: dir,
        authorName: options.author?.trim() || undefined,
        initialMessage: "Set up as a gutterpress book",
      });
      versionHistory = "local-git";
    } catch (e) {
      versionHistory = "none";
      versionHistoryError = e instanceof Error ? e.message : String(e);
    }
  }

  const result: CreateProjectResult = {
    projectDir: dir,
    manifestPath: path.join(dir, MANIFEST_FILENAMES[0]),
    openFile: path.join(dir, mdFiles[0]!),
    versionHistory,
  };
  if (versionHistoryError !== undefined) result.versionHistoryError = versionHistoryError;
  return result;
}

/**
 * Ensure `<projectDir>/.gitignore` excludes the build output directory
 * (`dist/` — lib/output-paths.ts's `DIST_DIRNAME`).
 *
 * Confirmed bug this closes: no scaffolded project ever got a `.gitignore`,
 * and gutterpress's auto-snapshot feature is ON BY DEFAULT and auto-pushes.
 * Every `gutterpress build` writes a fresh, incompressible PDF (plus any copied
 * assets) into `dist/<title-slug>/`; without an ignore rule, the very next
 * snapshot commits and pushes it. That grows `.git` by a full PDF on every
 * build and, once a single artifact crosses GitHub's 100MB per-file limit,
 * the push is rejected outright — for a non-technical author with no way to
 * `git filter-repo` their way out.
 *
 * NEVER overwrites an existing `.gitignore` (global never-delete-user-data
 * rule): if the file already excludes `dist/` in some common spelling
 * (`dist`, `dist/`, `/dist/`, …) it is left untouched; otherwise the line is
 * APPENDED, not prepended or reformatted, so any content the author already
 * has stays exactly as they wrote it.
 */
async function ensureGitignoreHasDist(projectDir: string): Promise<void> {
  const gitignorePath = path.join(projectDir, ".gitignore");

  let existing: string | null = null;
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    // No .gitignore yet.
  }

  if (existing === null) {
    await writeFile(gitignorePath, "dist/\n", "utf8");
    return;
  }

  const alreadyIgnoresDist = existing
    .split("\n")
    .some((line) => /^\/?dist\/?$/.test(line.trim()));
  if (alreadyIgnoresDist) return;

  const needsLeadingNewline = existing.length > 0 && !existing.endsWith("\n");
  await writeFile(
    gitignorePath,
    existing + (needsLeadingNewline ? "\n" : "") + "dist/\n",
    "utf8",
  );
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

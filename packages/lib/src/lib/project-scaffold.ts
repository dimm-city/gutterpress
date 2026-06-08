/**
 * Project scaffolding contract (#25 — new-project wizard / starter template).
 *
 * The "create a project" logic lives HERE, in `@dimm-city/print-md-lib`, so the
 * viewer wizard (`NewProjectWizard.svelte` → IPC pass-through) and a new CLI
 * command (`print-md new`) are both thin front-ends over ONE implementation —
 * no duplication (issue #25 architecture clarification, 2026-06-06).
 *
 * Scaffolding model (per the issue):
 *   1. COPY an embedded template directory to the chosen location (a plain
 *      directory copy, using the existing embedded-asset pattern —
 *      `embedded-assets.ts`, `with { type: "file" }`).
 *   2. FILL IN the copied files (substitute title / author / output filename
 *      into `print-md.yaml`, the sample chapter, etc.).
 *   3. Optionally initialise local version history (a `local-git` repo) so a
 *      non-technical author gets undo/snapshots with no credentials and no
 *      remote — with an escape hatch to stay a plain `local-folder`.
 *
 * This module is **types only** in this pass (Phase 0). No implementation —
 * `scaffoldProject` is declared so callers and tests can be typed against it,
 * but it is not exported until the implementation lands. See
 * docs/design/issue-25-plan.md.
 */

/**
 * Which embedded starter template to scaffold from. Each value maps to one
 * embedded template directory baked into the lib (and therefore into both the
 * compiled CLI binary and the packaged viewer). `"book"` is the only template
 * shipped in v1 (a single sample chapter + assets/ + a minimal manifest); the
 * union exists so additional templates (e.g. `"ttrpg"`) slot in without a
 * signature change.
 */
export type ProjectTemplateId = "book";

/**
 * How (or whether) to put the new project under local version history.
 *
 * - `"local-git"` — default. Initialise a local Git repo with one initial
 *   "snapshot" commit, using a **Node-native, pure-JS** implementation
 *   (`isomorphic-git`) per CLAUDE.md §7 — NOT the system `git` binary, NOT the
 *   GitHub CLI, no expectation that the user has Git installed. No remote, no
 *   credentials. Maps to a `local-git-folder` ProjectSource (see
 *   `project-source.ts`).
 * - `"none"` — the escape hatch. Leave the project as a plain `local-folder`
 *   (no `.git`). Selected automatically if version-history init fails, or
 *   explicitly by an author who does not want it.
 */
export type ProjectVersionHistoryMode = "local-git" | "none";

/**
 * Inputs the wizard / CLI collect from the author. Writer-friendly: the only
 * required field is a human project name; everything else is derived or
 * defaulted. NO YAML/Markdown jargon is surfaced to the user — these are the
 * normalised inputs after the UI has collected them.
 */
export interface CreateProjectOptions {
  /**
   * Human-friendly project name (e.g. "My First Book"). Becomes the manifest
   * `title`, the default folder name (slugified), and the default output PDF
   * filename. Required.
   */
  name: string;

  /** Author display name. Becomes manifest `authors: [author]`. Optional. */
  author?: string;

  /**
   * Absolute path to the PARENT directory the author chose in the folder
   * picker. The project is created at `join(parentDir, folderName)`. Required.
   */
  parentDir: string;

  /**
   * Folder name to create under `parentDir`. Defaults to a slug of `name`.
   * Must not already exist (scaffolding refuses to overwrite an existing
   * directory — see `CreateProjectError`).
   */
  folderName?: string;

  /** Which embedded template to scaffold from. Defaults to `"book"`. */
  template?: ProjectTemplateId;

  /** Version-history mode for the new project. Defaults to `"local-git"`. */
  versionHistory?: ProjectVersionHistoryMode;
}

/**
 * The result of a successful scaffold. `projectDir` is the absolute path of the
 * created project (what the viewer then opens automatically, and what
 * `print-md new` prints). `manifestPath` and `openFile` let the caller open the
 * project straight into a real rendered document.
 */
export interface CreateProjectResult {
  /** Absolute path of the created project directory. */
  projectDir: string;
  /** Absolute path of the generated `print-md.yaml`. */
  manifestPath: string;
  /**
   * Absolute path of the sample chapter the viewer should open first, so the
   * author immediately sees a rendered document (issue acceptance criterion).
   */
  openFile: string;
  /**
   * What actually happened with version history. May differ from the requested
   * mode: if `"local-git"` was requested but init failed (and the escape hatch
   * fired), this is `"none"` and `versionHistoryError` explains why.
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
  /** `parentDir` does not exist or is not writable. */
  | "parent-not-writable"
  /** The target `join(parentDir, folderName)` already exists. */
  | "target-exists"
  /** The normalised `name`/`folderName` produced an empty/invalid slug. */
  | "invalid-name"
  /** Copying the embedded template or writing a filled file failed (I/O). */
  | "scaffold-io";

export interface CreateProjectError extends Error {
  code: CreateProjectErrorCode;
}

/**
 * Scaffold a new print-md project. Pure Node (`fs/promises` + the embedded
 * template), no subprocess. Resolves with a {@link CreateProjectResult}; throws
 * a {@link CreateProjectError} on any precondition failure.
 *
 * Declared here (Phase 0) for typing only — the implementation lands in a later
 * phase (see docs/design/issue-25-plan.md §Phased delivery). Intentionally NOT
 * re-exported from `index.ts` until then, so no caller can import a function
 * that has no body.
 */
export declare function scaffoldProject(
  options: CreateProjectOptions,
): Promise<CreateProjectResult>;

/**
 * SFE-P3c Lane B — Gutterpress project discovery (run spec deliverable 1 /
 * D9: "A Gutterpress manifest is found from the document's workspace
 * folder; absence is a supported, non-error state" / "The extension must
 * operate when no Gutterpress manifest is present").
 *
 * The DECISION logic in this file is `vscode`-free by design:
 * {@link findGutterpressProject} is a thin wrapper over the REAL, public
 * `hasProjectManifest` from the `gutterpress` package (AP-26: "reuse the
 * authoritative project-source resolver" — the exact function
 * `packages/desktop/src/routes/api/app/classify-project/+server.ts` already
 * uses for the identical "does this folder have a project" question, so a
 * plain folder with no manifest and an opened project agree everywhere),
 * and {@link resolveActiveProjectDir}/{@link resolveProjectForCommand} are
 * pure path arithmetic plus one string-shaped result. All three are
 * trivially unit-testable with plain strings/temp directories — no
 * `mock.module("vscode", ...)` needed for THEIR OWN suite.
 * {@link currentActiveProjectDirParams} is the ONE exception: it is the
 * thin, five-line "gather live vscode state into the pure functions' plain
 * params" glue the three commands (`../commands/**`) share, so they do not
 * each read `vscode.window.activeTextEditor`/`vscode.workspace.workspaceFolders`
 * their own way. `../provider.ts` (deliverable 2/3) does not use it — it
 * already has its own document's `vscode.workspace.getWorkspaceFolder`
 * result directly, a narrower and more precise read than "the active
 * editor," and calls {@link findGutterpressProject} with that instead.
 *
 * SINGLE-DIRECTORY CHECK, NOT A WALK-UP SEARCH: `findGutterpressProject`
 * checks exactly the directory it is given for `manifest.yaml` — it does not
 * walk parent directories looking for one. This matches the ONLY existing
 * "is this a Gutterpress project" call site in the tree (the desktop's
 * `classify-project` route, called with the folder the user picked directly)
 * and D9's own wording ("found from the document's workspace folder", not
 * "found by searching upward from the document"). A monorepo-style workspace
 * with a project nested below the opened folder is out of this run's scope
 * (P3e's ruling: the smallest real design, not speculative machinery for a
 * shape nothing here asks for).
 */
import * as vscode from "vscode";
import { hasProjectManifest } from "gutterpress";
import { isPathInsideFolder } from "./path-containment.ts";

/** A Gutterpress project found at a known directory. Intentionally minimal —
 *  callers that need the manifest's own contents (plugins, styles, ...) load
 *  it themselves via `../project/projection.ts` or the command modules;
 *  discovery only answers "is there one, and where." */
export interface GutterpressProjectInfo {
  readonly projectDir: string;
}

/**
 * `candidateDir` is checked directly for a recognized manifest file
 * (`gutterpress`'s `MANIFEST_FILENAMES`, via `hasProjectManifest`).
 * `undefined` in (no workspace folder to check) or out (no manifest there)
 * are both the same "no project" result — D9 requires this to be a
 * supported, silent non-error state, never a thrown exception.
 */
export function findGutterpressProject(candidateDir: string | undefined): GutterpressProjectInfo | undefined {
  if (!candidateDir) return undefined;
  if (!hasProjectManifest(candidateDir)) return undefined;
  return { projectDir: candidateDir };
}

export interface ActiveProjectDirParams {
  /** `vscode.window.activeTextEditor?.document.uri.fsPath` at the call site
   *  — the file the user is currently looking at, if any. */
  readonly activeDocumentPath: string | undefined;
  /** `vscode.workspace.workspaceFolders?.map((f) => f.uri.fsPath) ?? []` at
   *  the call site. */
  readonly workspaceFolderPaths: readonly string[];
}

/**
 * Resolves "which folder is a command about to act on" for the three
 * commands (deliverable 4), independent of any one open custom-editor
 * document (unlike `../provider.ts`'s per-document resolution, which already
 * knows its exact document and workspace folder). Pure path arithmetic —
 * no filesystem read, no `vscode` — so it is trivially testable and never
 * throws.
 *
 * Resolution order, smallest-real-design (no folder picker UI, no
 * multi-root disambiguation prompt — P3e's ruling):
 *   1. The active editor's own workspace folder, if there is an active
 *      editor and it is inside one of the open workspace folders.
 *   2. The sole open workspace folder, if there is exactly one.
 *   3. `undefined` — genuinely ambiguous (no active editor AND more than
 *      one folder open) or nothing open at all. Callers turn this into a
 *      specific, actionable diagnostic (D14) rather than guessing.
 */
export function resolveActiveProjectDir(params: ActiveProjectDirParams): string | undefined {
  const { activeDocumentPath, workspaceFolderPaths } = params;

  if (activeDocumentPath) {
    const owning = workspaceFolderPaths.find((folder) => isPathInsideFolder(activeDocumentPath, folder));
    if (owning) return owning;
  }

  if (workspaceFolderPaths.length === 1) return workspaceFolderPaths[0];

  return undefined;
}

/** Combines {@link resolveActiveProjectDir} and {@link findGutterpressProject}
 *  — the one function the three commands actually call. */
export function resolveActiveGutterpressProject(params: ActiveProjectDirParams): GutterpressProjectInfo | undefined {
  return findGutterpressProject(resolveActiveProjectDir(params));
}

/**
 * Why a command could not find a project to act on — D14: "fails with a
 * SPECIFIC diagnostic when its precondition is absent (no project -> say
 * so and what to do)." Each reason gets its own, actionable message at the
 * call site (`../commands/**`) rather than one generic "no project found."
 */
export type ProjectResolutionFailureReason = "no-workspace" | "ambiguous-workspace" | "no-manifest";

export type ProjectResolutionOutcome =
  | { readonly found: true; readonly project: GutterpressProjectInfo }
  | { readonly found: false; readonly reason: ProjectResolutionFailureReason };

/**
 * The one function the three commands call to answer "which project, if
 * any, is this invocation about" — {@link resolveActiveProjectDir} plus
 * {@link findGutterpressProject}, but keeping WHY a miss happened (no
 * workspace open at all, vs. an ambiguous multi-root workspace with no
 * matching active editor, vs. a real folder with no manifest) instead of
 * collapsing every miss into one `undefined`.
 */
export function resolveProjectForCommand(params: ActiveProjectDirParams): ProjectResolutionOutcome {
  const dir = resolveActiveProjectDir(params);
  if (dir === undefined) {
    const reason: ProjectResolutionFailureReason =
      params.workspaceFolderPaths.length === 0 ? "no-workspace" : "ambiguous-workspace";
    return { found: false, reason };
  }
  const project = findGutterpressProject(dir);
  if (!project) return { found: false, reason: "no-manifest" };
  return { found: true, project };
}

/**
 * Gathers `../commands/**`'s live `vscode` state into
 * {@link resolveProjectForCommand}'s plain-data params. The only
 * `vscode`-touching export in this file — see this file's own header.
 */
export function currentActiveProjectDirParams(): ActiveProjectDirParams {
  return {
    activeDocumentPath: vscode.window.activeTextEditor?.document.uri.fsPath,
    workspaceFolderPaths: (vscode.workspace.workspaceFolders ?? []).map((folder) => folder.uri.fsPath),
  };
}


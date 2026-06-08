/**
 * Source / version-history provider contract (#12/#13/#25, governed by
 * CLAUDE.md §7).
 *
 * `detectProjectSource` (`project-source.ts`) already CLASSIFIES an opened
 * folder. This module declares the OPERATIONS surface — init, snapshot, list
 * history, restore — that the new-project scaffold (#25) and the version-history
 * UI (#13) drive. It is the single abstraction both the CLI and the viewer call.
 *
 * NON-NEGOTIABLE (CLAUDE.md §7): every operation declared here MUST be backed by
 * a **Node-native, pure-JS** implementation (`isomorphic-git`) — NOT the system
 * `git` binary, NOT the GitHub CLI (`gh`), and with no expectation that the user
 * has Git installed (we do not bundle it). GitHub access (a later `managed-github`
 * provider, #15/#16) uses the REST API directly (`fetch` / `@octokit/rest`),
 * never a subprocess. This keeps the `bun build --compile` CLI binary and the
 * packaged viewer fully self-contained.
 *
 * This module is **types only** in this pass (Phase 0). The concrete
 * `LocalGitSourceProvider` (isomorphic-git) and `LocalFolderSourceProvider`
 * (no-op) land with the implementation — see docs/design/issue-25-plan.md and
 * #13. Nothing here is re-exported from `index.ts` until then.
 */
import type { ProjectCapabilities, ProjectSource } from "./project-source.ts";

/** One entry in a project's version history (a Git commit, abstracted). */
export interface SnapshotEntry {
  /** Opaque revision id (a commit SHA for the local-git provider). */
  id: string;
  /** Author-supplied or auto-generated snapshot message. */
  message: string;
  /** Epoch milliseconds the snapshot was taken. */
  timestamp: number;
  /** Display name recorded for the snapshot author, if any. */
  author?: string;
}

/** Inputs for initialising local version history on a folder (#25 default). */
export interface InitVersionHistoryOptions {
  /** Absolute path of the project to put under version history. */
  projectDir: string;
  /** Display name stamped on the initial snapshot commit. */
  authorName?: string;
  /** Message for the initial snapshot. Defaults to a friendly "Created project". */
  initialMessage?: string;
}

/** Inputs for taking a snapshot (commit) of the current working tree. */
export interface SnapshotOptions {
  projectDir: string;
  /** Author-facing snapshot description. */
  message: string;
  authorName?: string;
}

/** Inputs for restoring the working tree to a prior snapshot. */
export interface RestoreSnapshotOptions {
  projectDir: string;
  /** The {@link SnapshotEntry.id} to restore to. */
  id: string;
}

/**
 * The version-control operations a project source can perform. Implementations
 * are selected by `ProjectSource.type` (see `providerFor`, declared below):
 *
 * - `LocalFolderSourceProvider` — every method that needs version history
 *   rejects (a `local-folder` has none); `initVersionHistory` is the one that
 *   "upgrades" it to a `local-git-folder`.
 * - `LocalGitSourceProvider` — backed entirely by `isomorphic-git` against the
 *   project's `.git` directory (pure JS, no system git).
 * - `ManagedGithubSourceProvider` — #15/#16; REST API, no `gh`.
 *
 * Capability gating is still owned by `capabilitiesFor` (`project-source.ts`);
 * callers check the capability before invoking the matching method here.
 */
export interface SourceProvider {
  /** The classified source this provider operates on. */
  readonly source: ProjectSource;

  /** Capabilities for {@link source} — convenience mirror of `capabilitiesFor`. */
  readonly capabilities: ProjectCapabilities;

  /**
   * Initialise local version history (`git init` + initial snapshot) using
   * `isomorphic-git`. Valid only when `capabilities.canEnableVersionHistory`.
   * Resolves with the NEW {@link ProjectSource} (now `local-git-folder`).
   */
  initVersionHistory(options: InitVersionHistoryOptions): Promise<ProjectSource>;

  /** Take a snapshot (commit) of the working tree. Resolves with the new entry. */
  snapshot(options: SnapshotOptions): Promise<SnapshotEntry>;

  /** List the project's snapshots, newest first. */
  listHistory(projectDir: string): Promise<SnapshotEntry[]>;

  /** Restore the working tree to a prior snapshot. */
  restore(options: RestoreSnapshotOptions): Promise<void>;
}

/**
 * Select the {@link SourceProvider} implementation for a classified source.
 * Declared here (Phase 0) for typing only — the concrete factory lands with the
 * implementation. NOT re-exported from `index.ts` until then.
 */
export declare function providerFor(source: ProjectSource): SourceProvider;

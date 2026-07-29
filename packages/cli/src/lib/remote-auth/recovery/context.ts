/**
 * buildRecoveryContext — the ONE place a RecoveryContext is resolved from a
 * project directory. Both hosts consume it (the desktop's recovery bridge and
 * `gutterpress repair`); each supplies only its own ConfirmationGate (dialog vs
 * terminal prompt). Keeping the resolution here means repo-root, branch,
 * credential, and slug rules can never drift between hosts.
 *
 * Resolution rules (each learned the hard way — see the audit trail):
 *  - repoDir: the project's OWN repo root via detectProjectSource. NEVER
 *    findEnclosingRepoDir — it is ancestor-only (skips the project's own
 *    .git), so a project that IS its own repo root would resolve to a parent
 *    repo (e.g. ~/.git) and the backup step would zip the entire home
 *    directory.
 *  - branch: remote diagnosis first, then the locally detected branch
 *    (local-only repos on non-"main" branches), then "main".
 *  - credential: resolved from the token store by remote hostname; stays in
 *    the calling process — never serialized to a UI layer.
 *  - repoSlug: last path segment, sanitized for backup file naming.
 */

import path from "node:path";

import { detectProjectSource, type ProjectSource } from "../../project-source.ts";
import { diagnoseProjectRemote } from "../diagnose.ts";
import {
  credentialHostKey,
  extractUrlCredential,
  type HostCredential,
  type TokenStore,
} from "../token-store.ts";
import type { ConfirmationGate, RecoveryContext } from "./types.ts";

/** Strip any credential embedded in a classification's remote URL (D7). */
function sanitizeSource(source: ProjectSource | null): ProjectSource | null {
  if (!source || source.type !== "local-git-folder" || !source.remoteUrl) return source;
  return { ...source, remoteUrl: extractUrlCredential(source.remoteUrl).cleanUrl };
}

export interface BuildRecoveryContextOptions {
  /** The directory the user opened (may be a subfolder of its repo). */
  projectDir: string;
  /** Host-specific approval gate (dialog, terminal prompt, …). */
  confirmation: ConfirmationGate;
  /** Credential store for the remote host, when the host has one. */
  tokenStore?: TokenStore;
  /** Display name for snapshot commits created during recovery. */
  authorName?: string;
  /** Email for snapshot commits created during recovery. */
  authorEmail?: string;
  /** Operation-log file shared with the sync path. */
  logFile?: string;
  /**
   * Classification override (tests only — omit in production). Injected the
   * same way as RecoveryContext's `now`/`faults`: bun's mock.module leaks
   * across test files, so cross-cutting modules are never module-mocked.
   */
  classify?: typeof detectProjectSource;
  /** Diagnosis override (tests only — omit in production). See `classify`. */
  diagnose?: typeof diagnoseProjectRemote;
}

/** Resolve everything a recovery handler needs from a project directory. */
export async function buildRecoveryContext(
  options: BuildRecoveryContextOptions,
): Promise<RecoveryContext> {
  const { projectDir, confirmation, tokenStore, authorName, authorEmail, logFile } = options;
  const classify = options.classify ?? detectProjectSource;
  const diagnose = options.diagnose ?? diagnoseProjectRemote;

  // Classified ONCE here, then threaded into diagnoseProjectRemote below and
  // stored on the context for inspectRepo — the recovery path never re-walks
  // parent dirs to re-classify the same folder (#87).
  const source = await classify(projectDir).catch(() => null);
  const gitSource = source && source.type === "local-git-folder" ? source : null;
  const repoDir = gitSource ? gitSource.repoRoot || gitSource.path : projectDir;

  const diag = await diagnose(projectDir, {
    tokenStore,
    ...(source ? { source } : {}),
  }).catch(() => null);
  const branch = diag?.branch ?? gitSource?.branch ?? "main";
  const remoteUrl = diag?.remoteUrl;

  let credential: HostCredential | undefined;
  if (remoteUrl && tokenStore) {
    try {
      // Deep-analysis fix: use the CANONICAL host key (strips `www.`, keeps an
      // explicit port), the same derivation every credential writer/reader
      // shares. `new URL().hostname` dropped the port and kept `www.`, so a
      // `host:3000` or `www.`-prefixed remote found no credential and recovery
      // ran UNAUTHENTICATED — GitHub masks private repos as 404 for anonymous
      // requests, so the highest-stakes structural repairs failed with a
      // confusing auth/"history can't be restored" error for a connected user.
      const host = credentialHostKey(remoteUrl);
      credential = (host ? await tokenStore.get(host) : null) ?? undefined;
    } catch {
      // Malformed URL or missing credential — proceed without one.
    }
  }

  const repoSlug = path.basename(repoDir).replace(/[^a-zA-Z0-9_-]/g, "_") || "repo";

  return {
    projectDir,
    repoDir,
    // Stored SANITIZED (diagnose strips credentials embedded in the remote
    // URL — D7). If the defensive diagnose catch above fired, fall back to
    // the source classified at the top of this function (sanitized the same
    // way) — a diagnose failure must not force consumers (inspectRepo) to
    // re-walk parent dirs. null only when classification itself failed.
    source: diag?.classification ?? sanitizeSource(source),
    branch,
    remoteUrl,
    repoSlug,
    credential,
    tokenStore,
    authorName,
    authorEmail,
    confirmation,
    ...(logFile ? { logFile } : {}),
  };
}

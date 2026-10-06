/**
 * git-identity.ts — the ONE place the host turns the author's configured commit
 * identity (Settings → "Your name on saved versions") into the
 * `{ authorName, authorEmail }` arguments the lib's commit surface accepts.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every HOST-SCHEDULED commit — the auto-snapshot debounce, auto-sync (which
 * snapshots-first and can write merge commits), the pre-export sync gate, and
 * the recovery flows — must carry the same identity the manual "Save a
 * version" path does, or it silently commits as the built-in
 * "Gutterpress <noreply@Gutterpress.local>" default. Every commit path derives
 * its identity here, so there is exactly one trim/omit rule and one thing to
 * change.
 *
 * An empty (or whitespace-only) field is OMITTED rather than sent as "", so the
 * lib's own fallback chain — existing repo config, then the Gutterpress default —
 * still applies to a field the author has not filled in.
 *
 * Node/host-side ONLY — never imported by the renderer.
 */

/** Commit-identity arguments accepted by the lib's snapshot/sync/recovery APIs. */
export interface GitIdentityArgs {
  authorName?: string;
  authorEmail?: string;
}

/**
 * The `gitIdentity` slice of AppSettings this module reads. Declared
 * structurally (and fully optional) so host modules stay decoupled from the
 * renderer's full AppSettings shape and a partial/legacy settings file can't
 * throw here.
 */
export interface GitIdentitySettings {
  gitIdentity?: {
    authorName?: string;
    authorEmail?: string;
  };
}

/** Resolve the configured commit identity, omitting blank fields. */
export function gitIdentityFrom(
  settings: GitIdentitySettings | null | undefined,
): GitIdentityArgs {
  const authorName = settings?.gitIdentity?.authorName?.trim();
  const authorEmail = settings?.gitIdentity?.authorEmail?.trim();
  return {
    ...(authorName ? { authorName } : {}),
    ...(authorEmail ? { authorEmail } : {}),
  };
}

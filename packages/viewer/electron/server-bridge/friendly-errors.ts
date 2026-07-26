/**
 * Shared security/UX error filters for the version-history (vcs:*) and online
 * repository (remote:*) surfaces.
 *
 * These filters were previously copy-pasted across electron/main.ts,
 * routes/api/remote/_hooks.ts, and the four routes/api/vcs/*​/+server.ts
 * handlers. They live here so both the Electron main process and the SvelteKit
 * +server.ts routes (both host-side Node code) import one implementation.
 *
 * SECURITY / UX invariants preserved verbatim:
 *  - The lib's own author-friendly messages pass through to the renderer.
 *  - Any other (unexpected, internal) failure is logged in full here and
 *    replaced with a terse, author-safe message — no raw isomorphic-git
 *    internals, no full fs paths.
 *  - Credential-bearing URL userinfo ("https://user:token@host/…") is stripped
 *    from anything headed for the log.
 *
 * This module is host-only (uses console) but intentionally has NO
 * @sveltejs/kit dependency: friendlyVcsError returns a { status, message }
 * classification and the route handlers throw the SvelteKit `error()` with it,
 * so main.ts can import this module without pulling SvelteKit into its bundle.
 */

// ── Version history (vcs:*) ──────────────────────────────────────────────────

// The lib's own author-facing messages (and our argument-validation messages)
// pass through to the renderer verbatim. Anything else is an unexpected
// internal failure.
const VCS_FRIENDLY_ERROR =
  /no changes since the last snapshot|no version history yet|your work is safe|project files were not changed|requires an absolute project path|valid snapshot id|already inside a versioned project/i;

/**
 * Classify a version-history failure. Logs the full error under `logLabel`,
 * then returns the HTTP-shaped result: a lib author-friendly message becomes a
 * 422 passthrough; anything else becomes a terse 500 naming the operation.
 * Callers throw the SvelteKit `error(status, message)` with the return value.
 */
export function friendlyVcsError(
  e: unknown,
  op: string,
  logLabel: string,
): { status: number; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[${logLabel}] failed: ${msg}`);
  if (e instanceof Error && (e as Error & { stack?: string }).stack) {
    console.error((e as Error & { stack?: string }).stack);
  }
  if (VCS_FRIENDLY_ERROR.test(msg)) {
    return { status: 422, message: msg };
  }
  return {
    status: 500,
    message: `Version history could not complete the ${op} operation. See the app log for details.`,
  };
}

// ── Online repository (remote:*) ─────────────────────────────────────────────

// The lib's own author-friendly messages pass through verbatim; anything else
// is logged in full and replaced with a terse author-safe message. Token values
// never appear in lib messages by construction (remote-auth redaction
// invariant).
const REMOTE_FRIENDLY_ERROR =
  /couldn't reach github|reconnect github|connect github|sign-?in|declined|expired|canceled|already has files|valid web url|https|repository couldn't be found|couldn't be downloaded|try again|in progress|access token|web address|couldn't reach|didn't accept|wasn't found|certificate|git server/i;

/**
 * Strip credential-bearing URL userinfo ("https://user:token@host/…") from any
 * string headed for the log. Transport errors — and especially their raw
 * `.cause` — can echo the request URL verbatim, which may embed a token.
 */
export function redactUrlCredentials(text: string): string {
  return text.replace(/\/\/[^/\s:]+:[^@\s]+@/g, "//(redacted)@");
}

/**
 * Wrap a remote operation with the shared error-sanitization logic:
 * author-friendly lib messages pass through verbatim; anything else is logged
 * in full (with credentials redacted) and replaced with a terse safe message.
 */
export async function handleRemoteErrors<T>(
  channel: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${channel}] failed: ${redactUrlCredentials(msg)}`);
    if (e instanceof Error && e.stack) console.error(redactUrlCredentials(e.stack));
    if (e instanceof Error && (e as { cause?: unknown }).cause) {
      console.error(`  cause: ${redactUrlCredentials(String((e as { cause?: unknown }).cause))}`);
    }
    if (REMOTE_FRIENDLY_ERROR.test(msg)) throw new Error(msg);
    throw new Error(
      "The online repository operation could not be completed. See the app log for details.",
    );
  }
}

// ── Publishing (publish:*) ───────────────────────────────────────────────────

// The publish lib's author-facing guidance vocabulary (#35). Publishing has
// its own allowlist + fallback — reusing the remote-git regex would mask
// "Install the Azure SWA CLI…" style hints behind an "online repository"
// message from the wrong domain. Token values never appear in publish lib
// messages by construction (publish redaction invariant).
const PUBLISH_FRIENDLY_ERROR =
  /api key|access token|didn't accept|deployment token|connect (itch|azure|shopify)|butler|swa cli|myshopify|shopify|itch\.io|kdp|drivethrurpg|build (the|it)|print-md build|manifest|publish\.[a-z-]+|paste|couldn't reach|couldn't download|try again|not available in this version|needs no api key|book\.html|exit \d+|failed \(exit/i;

/**
 * Wrap a publish operation with the shared error-sanitization logic:
 * author-friendly lib messages pass through verbatim; anything else is logged
 * in full (with credentials redacted) and replaced with a terse safe message.
 */
export async function handlePublishErrors<T>(
  channel: string,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[${channel}] failed: ${redactUrlCredentials(msg)}`);
    if (e instanceof Error && e.stack) console.error(redactUrlCredentials(e.stack));
    if (PUBLISH_FRIENDLY_ERROR.test(msg)) throw new Error(msg);
    throw new Error(
      "Publishing could not be completed. See the app log for details.",
    );
  }
}

// ── Linux application-menu integration (#119) ────────────────────────────────

/**
 * Classify a desktop-integration failure for a NON-TECHNICAL author.
 *
 * Unlike the vcs/remote/publish filters above there is no lib message to pass
 * through: every realistic failure here is a raw `node:fs` error whose
 * `.message` is an author-hostile `EACCES: permission denied, copyfile
 * '/home/…' -> '/home/…'`. So this maps the `err.code` to one plain sentence
 * that says what to do, logs the original in full, and never leaks the raw
 * string or a full path to the UI.
 *
 * The service's own "not supported here" guards throw plain Errors with
 * already-friendly text ({@link unsupportedMessage}); those pass through, since
 * they carry no `code`.
 */
const APPIMAGE_FS_MESSAGE: Record<string, string> = {
  EACCES: "print-md doesn't have permission to write to your home folder, so it couldn't add the menu entry.",
  EPERM: "print-md doesn't have permission to write to your home folder, so it couldn't add the menu entry.",
  EROFS: "Your home folder is read-only, so print-md couldn't add the menu entry.",
  ENOSPC: "There isn't enough free disk space to copy the app, so the menu entry wasn't added.",
  EDQUOT: "You've reached your disk quota, so print-md couldn't copy the app.",
  ENOENT: "Part of the app is missing, so the menu entry couldn't be added. Try downloading the app again.",
  EBUSY: "The app file is in use right now, so print-md couldn't update the menu entry. Close any other copies and try again.",
  EMFILE: "print-md ran out of open files while updating the menu entry. Try again.",
};

/**
 * Classify a desktop-integration failure. Logs the full error under
 * `logLabel`, then returns the HTTP-shaped result the route throws with.
 */
export function friendlyAppImageError(
  e: unknown,
  logLabel: string,
): { status: number; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(`[${logLabel}] failed: ${msg}`);
  if (e instanceof Error && e.stack) console.error(e.stack);

  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && APPIMAGE_FS_MESSAGE[code]) {
    return { status: 500, message: APPIMAGE_FS_MESSAGE[code]! };
  }
  // The service's own environment guards — plain, already author-safe text
  // with no fs `code`. A 409 (not 500): the request was well-formed, the
  // environment just can't do it.
  if (!code && /only available/i.test(msg)) {
    return { status: 409, message: msg };
  }
  return {
    status: 500,
    message: "The application menu entry could not be updated. See the app log for details.",
  };
}

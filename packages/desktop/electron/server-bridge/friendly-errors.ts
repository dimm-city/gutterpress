/**
 * Shared security/UX error filters for the version-history (vcs:*) and online
 * repository (remote:*, publish:*) surfaces.
 *
 * These filters were previously copy-pasted across electron/main.ts,
 * `routes/api/remote/_hooks.ts`, and the four `routes/api/vcs/*​/+server.ts`
 * handlers — all deleted (SFE-P5c2 for vcs, SFE-P5c3 for remote/publish).
 * They live here so every IPC handler that needs this classification
 * (`electron/api/{remote,publish,vcs}.ts`) imports one implementation
 * instead of re-deriving it.
 *
 * SECURITY / UX invariants preserved verbatim:
 *  - The lib's own author-friendly messages pass through to the renderer.
 *  - Any other (unexpected, internal) failure is logged in full here and
 *    replaced with a terse, author-safe message — no raw isomorphic-git
 *    internals, no full fs paths.
 *  - Credential-bearing URL userinfo ("https://user:token@host/…") is
 *    stripped from anything headed for the log AND from the message
 *    `handleRemoteErrors`/`handlePublishErrors` rethrow to the caller (D12
 *    repair round 1 — see those functions below for why the rethrow copy
 *    needed the same redaction as the logged one).
 *
 * This module is host-only (uses console) but has no framework dependency:
 * `friendlyVcsError` returns a plain `{ status, message }` classification —
 * `status` is a legacy field from the deleted routes' HTTP shape that
 * `electron/api/vcs.ts` no longer reads (IPC has no status-code concept, see
 * `electron/api/validation.ts`'s header); every caller uses only `.message`
 * to build a plain `Error`.
 */
import { getAppHooks } from "./app-hooks";

/**
 * Log one failure line: to the console (the dev terminal) and, once main.ts
 * has registered the host services, to the app log the Logs tab shows — so
 * the "See the app log for details" every filter below promises is TRUE from
 * this module's SvelteKit-bundle copy too, not only main.ts's own. (The two
 * bundles share nothing but globalThis, which is how `getAppHooks` reaches
 * main's writer.) A packaged app never shows its stderr, so before this the
 * details the message pointed at existed nowhere an author could look — the
 * 0.10.5 Google Drive bring-up hit exactly that. Before registration (`bun
 * test`), console only.
 */
function logFailure(line: string): void {
  console.error(line);
  getAppHooks()?.logFailure?.(line);
}

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
 * `status` is the legacy HTTP-shaped field described above; callers
 * (`electron/api/vcs.ts`'s IPC handlers) throw a plain `Error(message)` with
 * the return value's `.message` — IPC has no status-code concept to carry it.
 */
export function friendlyVcsError(
  e: unknown,
  op: string,
  logLabel: string,
): { status: number; message: string } {
  const msg = e instanceof Error ? e.message : String(e);
  logFailure(`[${logLabel}] failed: ${msg}`);
  if (e instanceof Error && (e as Error & { stack?: string }).stack) {
    logFailure((e as Error & { stack?: string }).stack!);
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
    logFailure(`[${channel}] failed: ${redactUrlCredentials(msg)}`);
    if (e instanceof Error && e.stack) logFailure(redactUrlCredentials(e.stack));
    if (e instanceof Error && (e as { cause?: unknown }).cause) {
      logFailure(`  cause: ${redactUrlCredentials(String((e as { cause?: unknown }).cause))}`);
    }
    // Repair round 1 (D12): redact on the rethrow, not only the log. A
    // transport error matching the allowlist below can still carry a raw
    // request URL (see redactUrlCredentials's own doc comment) — this is the
    // only one of the two copies of `msg` that ever reaches the renderer.
    // `redactUrlCredentials` only rewrites `//user:pass@` userinfo, so this
    // is behaviour-preserving for every message without URL userinfo — which
    // is every fixed author-facing string the lib emits by construction.
    if (REMOTE_FRIENDLY_ERROR.test(msg)) throw new Error(redactUrlCredentials(msg));
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
// Google Drive (#221, docs/gdrive-publish-plan.md D10) adds its own
// vocabulary: `\bgoogle\b` covers every author-facing message
// google-auth.ts/google-drive.ts throw (not-configured, reconnect,
// sign-in declined/canceled/timed out/state-mismatch, HTTP failures) since
// each one names "Google" as a whole word — for the HTTP failures that is
// ENFORCED by the lib's google-errors.ts (`googleApiFailure`), after
// "Couldn't create the Drive folder …" once fell through to the generic
// fallback for want of the word. The boundary keeps it from
// matching unrelated RUN-TOGETHER identifiers like "googleapis.com" or
// "GoogleDriveProvider" (no non-word character sits between "google" and the
// text that follows, so \b never fires there). It is, however, wider than
// "hand-written author-facing copy mentioning Google": `.` also counts as a
// word boundary, so the pattern equally matches "google" wherever it appears
// as a DOTTED segment — e.g. inside "accounts.google.com" or
// "drive.google.com", which several of those same messages embed verbatim
// (an OAuth error can echo the request URL). That's harmless by construction:
// those URLs only ever carry the public client_id and PKCE challenge, never a
// token or secret (see the redaction invariant above) — but it's a wider
// match than "names Google as prose" implies, so don't read this as
// "only matches hand-authored sentences."
const PUBLISH_FRIENDLY_ERROR =
  /api key|access token|didn't accept|deployment token|connect (itch|azure|shopify)|butler|swa cli|myshopify|shopify|itch\.io|kdp|drivethrurpg|build (the|it)|Gutterpress build|manifest|publish\.[a-z-]+|paste|couldn't reach|couldn't download|try again|not available in this version|needs no api key|book\.html|exit \d+|failed \(exit|\bgoogle\b/i;

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
    logFailure(`[${channel}] failed: ${redactUrlCredentials(msg)}`);
    if (e instanceof Error && e.stack) logFailure(redactUrlCredentials(e.stack));
    // Repair round 1 (D12): redact on the rethrow, not only the log — see the
    // matching comment on handleRemoteErrors above.
    if (PUBLISH_FRIENDLY_ERROR.test(msg)) throw new Error(redactUrlCredentials(msg));
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
  EACCES: "Gutterpress doesn't have permission to write to your home folder, so it couldn't add the menu entry.",
  EPERM: "Gutterpress doesn't have permission to write to your home folder, so it couldn't add the menu entry.",
  EROFS: "Your home folder is read-only, so Gutterpress couldn't add the menu entry.",
  ENOSPC: "There isn't enough free disk space to copy the app, so the menu entry wasn't added.",
  EDQUOT: "You've reached your disk quota, so Gutterpress couldn't copy the app.",
  ENOENT: "Part of the app is missing, so the menu entry couldn't be added. Try downloading the app again.",
  EBUSY: "The app file is in use right now, so Gutterpress couldn't update the menu entry. Close any other copies and try again.",
  EMFILE: "Gutterpress ran out of open files while updating the menu entry. Try again.",
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
  logFailure(`[${logLabel}] failed: ${msg}`);
  if (e instanceof Error && e.stack) logFailure(e.stack);

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

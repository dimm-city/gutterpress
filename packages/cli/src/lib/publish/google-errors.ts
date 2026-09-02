/**
 * Google API failure decoding for the `gdrive` publish provider (#221) — the
 * ONE place a non-OK Drive response becomes an author-facing message.
 *
 * Google answers every failed API call with a JSON body of the shape
 *   { error: { code, message, status?, errors?: [{ reason, message, domain }] } }
 * and `reason` is the only field that says WHY. Reporting just "HTTP 403" —
 * as the first cut did — left an author with nothing to act on and a
 * maintainer reading the app log with nothing to diagnose. The 0.10.5
 * bring-up hit exactly that: a freshly registered OAuth client whose Cloud
 * project had the Drive API disabled, every call answering
 * `403 accessNotConfigured`, and the app saying only "HTTP 403". This module
 * keeps the reason and Google's own message (which, for that case, carries
 * the enable-it link with the project id) and maps the well-known reasons to
 * a sentence that says what to do.
 *
 * Invariant: every message produced here names "Google" as prose. The
 * desktop's publish error allowlist (electron/server-bridge/friendly-errors.ts,
 * `\bgoogle\b`) keys on that to pass a lib message through to the author
 * verbatim instead of masking it behind "See the app log for details" — which
 * is what happened to "Couldn't create the Drive folder …" before this module
 * existed.
 *
 * Token-free by construction: Google's error messages describe the API,
 * project, scope, or quota — never the bearer token — and a Drive error body
 * does not echo the request URL. `redactQueryCredentials` is belt-and-braces
 * for the one shape that could ever carry one.
 */
import { FriendlyHttpError } from "../fetch-timeout.ts";

export interface GoogleApiErrorInfo {
  status: number;
  /** Google's machine reason (`accessNotConfigured`, `insufficientPermissions`, …), when present. */
  reason?: string;
  /** Google's human-readable message, when present. */
  message?: string;
}

/** Strip the value of any `access_token=`/`key=` query parameter a message
 * might echo. Drive error bodies never carry one; this exists so the
 * invariant above doesn't rest on that staying true forever. */
function redactQueryCredentials(text: string): string {
  return text.replace(/([?&](?:access_token|key)=)[^&\s"']+/gi, "$1(redacted)");
}

/** Decode Google's standard error envelope. Tolerates any body shape — a
 * non-JSON or unexpected body just yields the bare status. */
export function parseGoogleApiError(status: number, body: unknown): GoogleApiErrorInfo {
  const err = (body as { error?: unknown } | null | undefined)?.error;
  if (!err || typeof err !== "object") return { status };
  const e = err as { message?: unknown; status?: unknown; errors?: unknown };
  const first = Array.isArray(e.errors) ? (e.errors[0] as { reason?: unknown } | undefined) : undefined;
  const reason =
    typeof first?.reason === "string" && first.reason
      ? first.reason
      : typeof e.status === "string" && e.status
        ? e.status
        : undefined;
  const message =
    typeof e.message === "string" && e.message.trim() ? redactQueryCredentials(e.message.trim()) : undefined;
  return { status, ...(reason ? { reason } : {}), ...(message ? { message } : {}) };
}

/** Read a non-OK response's body once and decode it. */
export async function readGoogleApiError(res: Response): Promise<GoogleApiErrorInfo> {
  const body: unknown = await res.json().catch(() => undefined);
  return parseGoogleApiError(res.status, body);
}

const RATE_LIMIT_REASONS = /^(dailyLimitExceeded|userRateLimitExceeded|rateLimitExceeded|quotaExceeded)$/i;
const PERMISSION_REASONS = /^(insufficientPermissions|insufficientFilePermissions|forbidden|PERMISSION_DENIED)$/i;

/** The what-to-do sentence for a reason we know, or nothing for one we don't
 * (Google's own message, appended by {@link googleApiFailure}, then has to
 * carry the explanation on its own). */
function hintFor(info: GoogleApiErrorInfo): string | undefined {
  const reason = info.reason ?? "";
  if (/^accessNotConfigured$/i.test(reason)) {
    return "Google Drive publishing isn't fully set up on this build: the Google Drive API isn't enabled for the app's Google Cloud project, so a maintainer needs to enable it (the link is in Google's message).";
  }
  if (/^storageQuotaExceeded$/i.test(reason)) {
    return "Your Google Drive is full — free up space (or choose a different folder) and try again.";
  }
  if (RATE_LIMIT_REASONS.test(reason)) {
    return "Google Drive is rate-limiting requests right now. Wait a minute and try again.";
  }
  if (PERMISSION_REASONS.test(reason) || info.status === 401) {
    return "This Google Drive connection doesn't have permission for that — disconnect and connect Google Drive again to re-approve access.";
  }
  return undefined;
}

/**
 * Build the author-facing error for a failed Google API call: `what` is the
 * caller's "Couldn't …" phrase; the status and Google's reason follow in
 * parentheses, then the what-to-do hint for a known reason, then Google's own
 * message. Always a {@link FriendlyHttpError} (passes through
 * `withFetchTimeout` unwrapped, like every other Drive failure).
 */
export function googleApiFailure(what: string, info: GoogleApiErrorInfo): FriendlyHttpError {
  const parts = [`${what} (HTTP ${info.status}${info.reason ? `, ${info.reason}` : ""}).`];
  const hint = hintFor(info);
  if (hint) parts.push(hint);
  if (info.message) parts.push(`Google said: "${info.message}"`);
  let text = parts.join(" ");
  // The allowlist invariant, enforced rather than hoped for: a caller's
  // `what` that forgets to name Google still yields a message that does.
  if (!/\bgoogle\b/i.test(text)) text = `Google Drive: ${text}`;
  return new FriendlyHttpError(text);
}

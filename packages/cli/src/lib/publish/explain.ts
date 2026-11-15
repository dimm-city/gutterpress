/**
 * Plain words for what went wrong (ADR 0012 §5). Both views show these: a
 * stable `code` to act on, a sentence to show at once, and the original text
 * as `detail` for a "Show details" disclosure. Neither view reads an error's
 * message to decide what it means; the lib that produced it says so here.
 */
export type FailureCode =
  | "CANCELED"
  | "NO_MANIFEST"
  | "NO_TARGETS"
  | "UNKNOWN_TARGET"
  | "UNFINISHED_SWITCH"
  | "TOO_WIDE"
  | "TOOL_MISSING"
  | "DISK_FULL"
  | "PERMISSION"
  | "SOURCE_PROBLEMS"
  | "BUILD_FAILED"
  | "CHECKS_FAILED"
  | "CHECKS_COULD_NOT_RUN"
  | "NOT_CONNECTED"
  | "SETUP_INCOMPLETE"
  | "ACCOUNT_EXPIRED"
  | "STORAGE_FULL"
  | "OFFLINE"
  | "SEND_FAILED";

export interface Failure {
  code: FailureCode;
  /** Safe to show at once. Empty for a cancel the person asked for. */
  message: string;
  /** The original text, when the message does not already show all of it. */
  detail?: string;
}

/** A thrown value's own code (BuildError, a tagged Error, a Node errno). */
function codeOf(e: unknown): string {
  const code = (e as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : "";
}

function textOf(e: unknown): string {
  return (e instanceof Error ? e.message : String(e ?? "")).trim();
}

/** The error as raised, kept as the detail unless the message already shows it. */
function failure(code: FailureCode, message: string, raw: string): Failure {
  return raw && !message.includes(raw) ? { code, message, detail: raw } : { code, message };
}

/**
 * Why making a file failed. `what` names the file ("PDF", "PDF/X",
 * "website") for the sentences that need it.
 */
export function explainBuildFailure(e: unknown, what = "PDF"): Failure {
  const code = codeOf(e);
  const raw = textOf(e);
  if (code === "CANCELED" || code === "EXPORT_CANCELED" || (e as Error | null)?.name === "AbortError") {
    return { code: "CANCELED", message: "" };
  }
  if (code === "UNFINISHED_SWITCH") {
    return failure(
      "UNFINISHED_SWITCH",
      "Gutterpress can't make the book while it is part-way through switching drafts. " +
        "Go to Book setup → Online → Drafts to put it right.",
      raw,
    );
  }
  if (code === "TOO_WIDE") {
    const { offenders = [], scale = null } = e as { offenders?: string[]; scale?: number | null };
    const named = offenders.slice(0, 3).join(", ");
    const rest = offenders.length - 3;
    const which = named ? `${named}${rest > 0 ? ` and ${rest} more` : ""}` : "something on the page";
    const cost =
      typeof scale === "number"
        ? `scales the whole book to about ${scale.toFixed(2)}× its declared size`
        : "lets Chromium scale the whole book down to fit";
    return failure(
      "TOO_WIDE",
      `Too wide for the page: ${which}. Give each one a width that fits, or build anyway, which ${cost}. ` +
        "The page size and page count do not change, so the shrink is invisible in the PDF.",
      raw,
    );
  }
  if (code === "TOOL_MISSING") {
    return failure(
      "TOOL_MISSING",
      `Making the ${what} needs a program that is not installed on this computer. ` +
        "The details say which, and how to install it.",
      raw,
    );
  }
  if (code === "DISK_FULL") {
    return failure("DISK_FULL", raw.split("\n")[0] ?? raw, raw);
  }
  if (code === "ENOENT" && (e as { syscall?: string }).syscall?.startsWith("spawn")) {
    const tool = (e as { path?: string }).path ?? "a required program";
    return failure("TOOL_MISSING", `Making the ${what} needs "${tool}", which is not installed on this computer.`, raw);
  }
  if (code === "EACCES" || code === "EPERM") {
    return failure("PERMISSION", `Gutterpress was not allowed to write the ${what} there.`, raw);
  }
  const first = raw.split("\n")[0]?.trim() ?? "";
  if (!first) return { code: "BUILD_FAILED", message: `Making the ${what} failed.` };
  return failure("BUILD_FAILED", `Making the ${what} failed: ${first}`, raw);
}

/** Why sending to a target failed. `label` names the target. */
export function explainSendFailure(e: unknown, label: string): Failure {
  const raw = textOf(e);
  if (!raw) return { code: "SEND_FAILED", message: `Sending to ${label} failed for an unknown reason.` };
  // The providers' own failure shapes (providers/*.ts).
  if (/^butler push failed \(exit \d+\)/i.test(raw)) {
    return failure("SEND_FAILED", "Uploading to itch.io failed. The details say what butler reported.", raw);
  }
  if (/^swa deploy failed \(exit \d+\)/i.test(raw)) {
    return failure("SEND_FAILED", "Deploying to Azure Static Web Apps failed. The details say what the SWA CLI reported.", raw);
  }
  if (/^shopify api request failed \(http \d+\)/i.test(raw)) {
    return failure("SEND_FAILED", "Shopify's server had a problem answering. Try again in a moment.", raw);
  }
  if (/^shopify api error:/i.test(raw) || /^shopify couldn't (create|update) the product/i.test(raw)) {
    return failure("SEND_FAILED", "Shopify turned the upload down.", raw);
  }
  if (/invalid_grant/i.test(raw)) {
    return failure("ACCOUNT_EXPIRED", `Your ${label} sign-in expired or was withdrawn. Sign in again.`, raw);
  }
  if (/your google drive is full/i.test(raw)) return failure("STORAGE_FULL", raw, raw);
  if (/storageQuotaExceeded/i.test(raw)) {
    return failure("STORAGE_FULL", "Your Google Drive is full. Free some space, or choose another folder, and try again.", raw);
  }
  if (/failed to fetch|networkerror|econnrefused|enotfound|fetch failed|ETIMEDOUT/i.test(raw)) {
    return failure("OFFLINE", `Couldn't reach ${label}. Check your internet connection and try again.`, raw);
  }
  // Everything else the providers already wrote in plain words.
  return { code: "SEND_FAILED", message: raw };
}

/** True for a failure the person caused by stopping the run. */
export function isCanceled(e: unknown): boolean {
  return explainBuildFailure(e).code === "CANCELED";
}

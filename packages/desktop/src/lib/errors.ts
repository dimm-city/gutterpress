/**
 * Shared, PWA-clean error helpers.
 *
 * Pure string operations — NO `node:*` imports (importing them as a value would
 * drag node code into the SPA and break the renderer/host split, §8 / ADR 0004).
 */

/**
 * Scrub Electron's IPC plumbing prefix off a host error message so the UI shows
 * the underlying cause, not the transport. Electron wraps `ipcMain.handle`
 * rejections as `Error invoking remote method '<ns:op>': <cause>` (sometimes with
 * a further `Error: ` prefix on the cause). This is the single source of truth
 * for that scrub (shared by `LeftPanel` and other error surfaces).
 */
export function friendlyHostError(msg: string): string {
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

function isMissingManifestError(msg: string): boolean {
  return (
    /\bNo [^\n]*manifest[^\n]* found(?:\s+in\b|[.!]?\s*$)/i.test(msg) ||
    /manifest not found:/i.test(msg)
  );
}

/**
 * Map a raw folder-open error message to plain-language guidance for the welcome
 * screen. Pure string classification — no host coupling.
 */
export function friendlyFolderError(msg: string): string {
  const yamlPosition = msg.match(
    /Invalid YAML in [^\n]+ at line (\d+), column (\d+)/i,
  );
  if (yamlPosition) {
    return `The project manifest has invalid YAML at line ${yamlPosition[1]}, column ${yamlPosition[2]}. Fix that entry and try again.`;
  }
  if (/Invalid YAML in /i.test(msg)) {
    return "The project manifest has invalid YAML. Fix it and try again.";
  }
  if (/ENOENT|No such file|not found/i.test(msg)) {
    return "The folder couldn't be read. Check that it exists and you have permission to open it.";
  }
  if (/permission|EACCES/i.test(msg)) {
    return "Permission denied. Check that you have access to this folder.";
  }
  return "Something went wrong opening this folder. Try again, or choose a different folder.";
}

export interface FriendlyPreviewError {
  title: string;
  message: string;
  details: string;
}

/** Explain a preview-generation failure without treating the folder as closed. */
export function friendlyPreviewError(raw: string): FriendlyPreviewError {
  const details = friendlyHostError(raw)
    .replace(/^Preview server failed to start:\s*/i, "")
    .trim();
  const yamlPosition = details.match(/Invalid YAML in [^\n]+ at line (\d+), column (\d+)/i);
  if (yamlPosition) {
    return {
      title: "The project manifest has invalid YAML.",
      message: `Fix the entry at line ${yamlPosition[1]}, column ${yamlPosition[2]}, then try the preview again.`,
      details,
    };
  }
  if (/`source\.assets`|source\.assets/i.test(details)) {
    return {
      title: "This book uses an outdated manifest setting.",
      message:
        "Remove the source.assets block from manifest.yaml, then try again. Assets are now discovered automatically.",
      details,
    };
  }
  if (/Missing (?:stylesheet|font file|asset):/i.test(details)) {
    return {
      title: "A file needed by the preview is missing.",
      message: "Open the Files panel, correct the missing path, then try the preview again.",
      details,
    };
  }
  if (/No markdown files found/i.test(details)) {
    return {
      title: "No Markdown chapters were found.",
      message: "Add a chapter or correct the source.files entries in manifest.yaml, then try again.",
      details,
    };
  }
  if (/Could not parse CSS|CSS (?:parse|syntax) error/i.test(details)) {
    return {
      title: "A stylesheet could not be read.",
      message: "Open the stylesheet, fix the reported CSS error, then try the preview again.",
      details,
    };
  }
  return {
    title: "The folder is open, but its preview could not be built.",
    message: "You can keep editing the files. Review the details below, then try the preview again.",
    details,
  };
}

/**
 * Recognize the engine's over-wide-content build failure and restate it for a
 * non-technical author (#163).
 *
 * The engine hard-errors when something is wider than the page content box,
 * because Chromium would otherwise scale the WHOLE document down silently.
 * Its message ends with "pass allowShrink to build anyway" — an instruction
 * with no desktop equivalent, so the author is told about an escape hatch they
 * cannot reach. This parser is what lets the export offer the hatch in place:
 * it names the offending elements and states, in the author's own units, what
 * accepting the shrink costs.
 *
 * Returns `null` for every other failure — the caller's normal error mapping
 * still applies.
 *
 * COUNTERPART:
 * `packages/cli/src/engine/compiler/build.over-wide-message.test.ts`. Scraping
 * prose is forced, not preferred — Electron IPC flattens an `Error` to its
 * message string, so there is no structured channel to read instead (see
 * `tests/platform/renderer-utils.test.ts`). That makes the engine's wording a
 * wire contract, and it is pinned in the package that emits it: that test runs
 * a REAL build and asserts a verbatim mirror of the three patterns below still
 * captures what this function needs. Change either side and change both — an
 * unmatched reword returns `null` here, silently degrading the export back to
 * the generic error #163 removed.
 */
const OFFENDER_LINE = /^\s+(\S[^\n]*?)\s+—\s+\d+px\s*>\s*\d+px content box/gm;

export function overWideExportMessage(e: unknown): string | null {
  const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  if (!/content (?:wider than|outside) the page content box/.test(raw)) return null;
  const offenders = [...raw.matchAll(OFFENDER_LINE)].map((m) => m[1]!.trim());
  const named = offenders.slice(0, 3).join(", ");
  const rest = offenders.length - 3;
  const which = named
    ? `${named}${rest > 0 ? ` and ${rest} more` : ""}`
    : "something on the page";
  // The engine states the measured scale when it has one (it cannot for a
  // box pulled off the LEFT edge, which clips rather than shrinks).
  const scale = raw.match(/to about ([\d.]+)x its declared size \(([^)]*)\)/);
  const cost = scale
    ? `scales the whole book to about ${scale[1]}× its declared size (${scale[2]})`
    : "lets Chromium scale the whole book down to fit";
  return (
    `Too wide for the page: ${which}. Give each one an explicit width that fits — ` +
    `or build anyway, which ${cost}. The page size and page count do not change, ` +
    `so the shrink is invisible in the PDF.`
  );
}

/**
 * Map a raw PDF-export error to plain-language guidance for a toast. Reads the
 * host error `code` when present and falls back to message pattern-matching.
 * Returns "" for a user-initiated cancel (EXPORT_CANCELED) so the caller can
 * suppress the toast entirely.
 */
export function friendlyPdfError(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code === "EXPORT_CANCELED") {
    return "";
  }
  if (isMissingManifestError(msg)) {
    return 'PDF export needs manifest.yaml. Choose "Set up as a book" first, then try again.';
  }
  // Sync-conflict export blocks throw a deliberately author-friendly message
  // from the host (electron/export/controller.ts) — pass it through (scrubbed
  // of IPC plumbing, see below) rather than overwriting it with the generic
  // fallback below. `code` alone isn't reliable: `ipcRenderer.invoke` does not
  // preserve custom Error properties across the IPC boundary, so also match
  // the host's known conflict copy in the message text (both conflict
  // messages share "two places" — see electron/export/controller.ts and
  // other error surfaces).
  if (code === "SYNC_CONFLICT" || /two places/i.test(msg)) {
    // `api:build` goes through ipcMain.handle with no re-serialization, so the
    // renderer sees Electron's own `Error invoking remote method '<ns:op>':
    // Error: <cause>` wrapper around the host's sentence. Scrub that transport
    // prefix (shared helper, defined above) before showing it to the author.
    return friendlyHostError(msg);
  }
  // Render-timeout export blocks (electron/pdf-export.ts's waitForEngineRendered,
  // ARCH review #27) throw a typed BuildError whose message is already an
  // author-friendly sentence. Like SYNC_CONFLICT above, `code` alone isn't
  // reliable across `api:build`'s ipcMain.handle/ipcRenderer.invoke boundary —
  // Electron strips custom Error properties there — so match by the message's
  // stable, distinctive phrase instead. Keep this phrase in sync with the exact
  // string thrown in waitForEngineRendered.
  if (/did not finish/i.test(msg)) {
    return friendlyHostError(msg);
  }
  // Over-wide content (#163) — the engine's own message ends in advice only a
  // CLI user can take ("pass allowShrink"). Say what the author can act on
  // instead; the "Build anyway" offer that goes with it lives in
  // ExportController.savePdf.
  const overWide = overWideExportMessage(e);
  if (overWide) return overWide;
  if (code === "BUILD_ERROR") {
    const firstLine = msg.split("\n")[0]?.trim() ?? msg;
    return `PDF generation failed: ${firstLine}. Open Help (?) for setup details.`;
  }
  if (code === "TOOL_MISSING") {
    const match = msg.match(/Required system tool not found: ([^\n]+)/);
    const tool = match?.[1]?.trim() ?? "a required tool";
    return `PDF export needs "${tool}" installed. Open Help (?) > System tools to see how to install it.`;
  }
  if (/chrome|chromium|browser/i.test(msg)) {
    return "PDF export needs a browser (Chrome or Edge) installed. Open Help (?) for setup details.";
  }
  if (/ENOENT|not found/i.test(msg)) {
    return "Could not find a required program. Open Help (?) > System tools to check what needs to be installed.";
  }
  if (/permission|EACCES/i.test(msg)) {
    return "Permission denied saving the PDF. Try saving to a different folder (like your Desktop).";
  }
  return "PDF export failed. Open Help (?) > System tools to check for issues.";
}

/**
 * A publish error mapped for display: `summary` is always safe to show by
 * default; `details` (present only when there's something worth hiding) is
 * the original raw text, meant to sit behind a "Show details" disclosure
 * rather than disappear — publish failures (a butler/swa exit code, a
 * provider's raw HTTP/GraphQL response) are exactly the kind of thing a
 * technical author wants to see, just not as the FIRST thing they see.
 */
export interface FriendlyPublishError {
  summary: string;
  details?: string;
}

/**
 * Map a raw publish error (from a publish IPC handler's rejected message, or
 * a `PublishRunResult.error` string) to plain-language guidance, mirroring
 * `friendlyPdfError`'s approach: recognized technical shapes get a short
 * author-facing summary with the raw text preserved as `details`; messages
 * the host/lib already wrote in plain language (see `PUBLISH_FRIENDLY_ERROR`
 * in electron/server-bridge/friendly-errors.ts — e.g. "No itch.io API key
 * found…", "Install the Azure SWA CLI first…", manifest-key guidance) pass
 * through unchanged with no details to hide.
 *
 * Through SFE-P5c3, this also unwrapped a `{"message": "…"}` JSON envelope
 * SvelteKit's `error(status, message)` produced (`$lib/api.ts`'s `post`/`get`
 * threw the raw response body verbatim). SFE-P5c4 deleted the last publish
 * route, `$lib/api.ts`, and the JSON-serializing route handler together —
 * `publish-capability.ts`'s `call()` now throws a plain, already-unwrapped
 * `Error`, so no producer of that envelope remains on any live path. The
 * unwrap step (`unwrapPublishErrorEnvelope`) was removed in the round-1
 * repair that caught it surviving past its own deletion phase (AP-32).
 */
export function friendlyPublishError(e: unknown): FriendlyPublishError {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const msg = raw.trim();
  if (!msg) {
    return { summary: "Publishing failed for an unknown reason." };
  }

  // butler (itch.io's upload CLI) failures append its own stderr tail
  // (packages/cli/src/lib/publish/providers/itch.ts) — useful to a
  // technical author, noise to everyone else.
  if (/^butler push failed \(exit \d+\)/i.test(msg)) {
    return {
      summary: "Uploading to itch.io failed. See the details for what butler reported.",
      details: msg,
    };
  }

  // The Azure SWA CLI's own failure + stdout/stderr tail
  // (packages/cli/src/lib/publish/providers/azure-swa.ts).
  if (/^swa deploy failed \(exit \d+\)/i.test(msg)) {
    return {
      summary:
        "Deploying to Azure Static Web Apps failed. See the details for what the SWA CLI reported.",
      details: msg,
    };
  }

  // Shopify's raw HTTP/GraphQL failures (packages/cli/src/lib/publish/providers/shopify.ts).
  if (/^shopify api request failed \(http \d+\)/i.test(msg)) {
    return {
      summary: "Shopify's server had a problem answering the request. Try again in a moment.",
      details: msg,
    };
  }
  if (
    /^shopify api error:/i.test(msg) ||
    /^shopify couldn't (create|update) the product/i.test(msg)
  ) {
    return { summary: "Shopify rejected the publish request.", details: msg };
  }

  // Google Drive (#221): the OAuth connection expired or was revoked.
  // google-auth.ts's RECONNECT_MESSAGE / google-drive.ts's invalid_grant
  // mapping already write this exact author-facing sentence before it ever
  // reaches here — matched explicitly (not left to the generic passthrough
  // below) so a bare `invalid_grant` from any path that bypasses that lib
  // mapping still gets the same friendly copy instead of raw OAuth-error text.
  if (/invalid_grant/i.test(msg)) {
    return {
      summary: "Your Google Drive connection expired or was revoked. Connect Google Drive again.",
    };
  }

  // Google Drive (#221): out of storage. providers/gdrive.ts's upload()
  // already fails fast with a specific "needs X but only Y is free" sentence
  // before any bytes move — passed through as-is. Also catches the raw
  // Drive API's `storageQuotaExceeded` reason in case it ever reaches here
  // unmapped (e.g. a future call site that skips the provider's own check).
  if (/your google drive is full/i.test(msg)) {
    return { summary: msg };
  }
  if (/storageQuotaExceeded/i.test(msg)) {
    return {
      summary: "Your Google Drive is full — free up space (or choose a different folder) and try again.",
      details: msg,
    };
  }

  // Google Drive (#221): the configured folder was moved to trash or
  // deleted. providers/gdrive.ts's D5 folderId resolution already writes a
  // specific, friendly "pick the folder again" sentence — passed through.
  if (/drive folder.*can.?t be found/i.test(msg)) {
    return { summary: msg };
  }

  // A request that never reached (or never returned from) the publish route
  // at all — the renderer's own `fetch()` failing, not a host response.
  if (/failed to fetch|networkerror|econnrefused|enotfound|fetch failed/i.test(msg)) {
    return {
      summary: "Couldn't reach the publishing service. Check your internet connection and try again.",
      details: msg,
    };
  }

  // Everything else is either the host's own curated author-plain-language
  // message (an unfulfilled key, a missing manifest field, install guidance —
  // see PUBLISH_FRIENDLY_ERROR) or its terse safe fallback ("Publishing could
  // not be completed. See the app log for details.") — show as-is.
  return { summary: msg };
}

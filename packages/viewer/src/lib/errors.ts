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
 * for that scrub, shared by `LeftPanel` and `ConflictChoicesDialog`.
 */
export function friendlyHostError(msg: string): string {
  return msg.replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, "");
}

/**
 * Map a raw folder-open error message to plain-language guidance for the welcome
 * screen. Pure string classification — no host coupling.
 */
export function friendlyFolderError(msg: string): string {
  if (/manifest|print-md\.yaml|No such file/i.test(msg)) {
    return "This doesn't look like a print-md project — we couldn't find a manifest.yaml file. Make sure you're opening the right folder.";
  }
  if (/ENOENT|not found/i.test(msg)) {
    return "The folder couldn't be read. Check that it exists and you have permission to open it.";
  }
  if (/permission|EACCES/i.test(msg)) {
    return "Permission denied. Check that you have access to this folder.";
  }
  return "Something went wrong opening this folder. Try again, or choose a different folder.";
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
  // Sync-conflict export blocks throw a deliberately author-friendly message
  // from the host (electron/export/controller.ts) — pass it through (scrubbed
  // of IPC plumbing, see below) rather than overwriting it with the generic
  // fallback below. `code` alone isn't reliable: `ipcRenderer.invoke` does not
  // preserve custom Error properties across the IPC boundary, so also match
  // the host's known conflict copy in the message text (both conflict
  // messages share "two places" — see electron/export/controller.ts and
  // ConflictChoicesDialog).
  if (code === "SYNC_CONFLICT" || /two places/i.test(msg)) {
    // `api:build` goes through ipcMain.handle with no re-serialization, so the
    // renderer sees Electron's own `Error invoking remote method '<ns:op>':
    // Error: <cause>` wrapper around the host's sentence. Scrub that transport
    // prefix (shared helper, defined above) before showing it to the author.
    return friendlyHostError(msg);
  }
  // Render-timeout export blocks (electron/pdf-export.ts's waitForPagedRendered,
  // ARCH review #27) throw a typed BuildError whose message is already an
  // author-friendly sentence. Like SYNC_CONFLICT above, `code` alone isn't
  // reliable across `api:build`'s ipcMain.handle/ipcRenderer.invoke boundary —
  // Electron strips custom Error properties there — so match by the message's
  // stable, distinctive phrase instead. Keep this phrase in sync with the exact
  // string thrown in waitForPagedRendered.
  if (/did not finish/i.test(msg)) {
    return friendlyHostError(msg);
  }
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
 * SvelteKit's `error(status, message)` serializes a thrown route error as
 * `{"message": "…"}` JSON (see routes/api/_lib/handler.ts's `jsonRoute`).
 * `$lib/api.ts`'s `post`/`get` helpers read a non-OK response body with
 * `r.text()` and throw `new Error(text)` verbatim — they never JSON.parse
 * it — so every publish `catch (e)` in ProjectConfigPanel sees this raw
 * `{"message": "…"}` envelope as `e.message` instead of the message itself.
 * Peel it back before classifying so neither the summary nor the "Show
 * details" text ever shows an author a bare JSON blob.
 */
function unwrapPublishErrorEnvelope(text: string): string {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return text;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    const message = (parsed as { message?: unknown } | null)?.message;
    if (typeof message === "string" && message) return message;
  } catch {
    // Not JSON (or not the expected shape) — treat the original text as the message.
  }
  return text;
}

/**
 * Map a raw publish error (from a publish route's thrown/rejected message, or
 * a `PublishRunResult.error` string) to plain-language guidance, mirroring
 * `friendlyPdfError`'s approach: recognized technical shapes get a short
 * author-facing summary with the raw text preserved as `details`; messages
 * the host/lib already wrote in plain language (see `PUBLISH_FRIENDLY_ERROR`
 * in electron/server-bridge/friendly-errors.ts — e.g. "No itch.io API key
 * found…", "Install the Azure SWA CLI first…", manifest-key guidance) pass
 * through unchanged with no details to hide.
 */
export function friendlyPublishError(e: unknown): FriendlyPublishError {
  const raw = e instanceof Error ? e.message : String(e ?? "");
  const msg = unwrapPublishErrorEnvelope(raw).trim();
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

/**
 * Shared, PWA-clean error helpers.
 *
 * Pure string operations — NO `node:*` imports (importing them as a value would
 * drag node code into the SPA and break the renderer/host split, §8).
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
  if (/has two takes of a setting/i.test(msg)) {
    return "Getting the latest changes left two takes of a setting in this book's manifest.yaml. Open the file, keep the one you want and delete the marker lines, then try again.";
  }
  const yamlPosition = msg.match(
    /Invalid YAML in [^\n]+ at line (\d+), column (\d+)/i,
  );
  if (yamlPosition) {
    return `This book's manifest has invalid YAML at line ${yamlPosition[1]}, column ${yamlPosition[2]}. Fix that entry and try again.`;
  }
  if (/Invalid YAML in /i.test(msg)) {
    return "This book's manifest has invalid YAML. Fix it and try again.";
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
  if (/has two takes of a setting/i.test(details)) {
    return {
      title: "This book's settings have two takes.",
      message:
        "Getting the latest changes found a setting changed both here and in the online copy, and kept both in manifest.yaml. Open the Files panel, open manifest.yaml, and choose which take to keep.",
      details,
    };
  }
  const yamlPosition = details.match(/Invalid YAML in [^\n]+ at line (\d+), column (\d+)/i);
  if (yamlPosition) {
    return {
      title: "This book's manifest has invalid YAML.",
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
      message: "Add a chapter or correct the chapters list in manifest.yaml, then try again.",
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

/** A failed export, for display: one line to show, and the original text when there is more to it. */
export interface PdfErrorExplanation {
  /** Safe to show at once. Empty for a cancel the author asked for: nothing to show. */
  summary: string;
  /** The error as the build reported it, for a "Show details" disclosure. */
  details?: string;
}

/**
 * Explain a failed PDF export in plain language without losing the reason.
 * Failures the app knows get their own sentence; any other says what the
 * build itself said. The original text is kept as `details` whenever the
 * summary doesn't already show all of it. `what` names the thing being made
 * when it isn't a PDF ("Website export").
 */
export function explainPdfError(e: unknown, what = "PDF export"): PdfErrorExplanation {
  const code = (e as { code?: string } | null)?.code ?? "";
  if (code === "EXPORT_CANCELED") return { summary: "" };
  // The build crosses to the renderer as data (platform/ipc-result.ts), so it
  // arrives unwrapped; scrub Electron's prefix for any error that still came
  // through a plain rejected `ipcMain.handle`.
  const msg = friendlyHostError(e instanceof Error ? e.message : String(e ?? "")).trim();
  const reworded = (summary: string): PdfErrorExplanation => (msg ? { summary, details: msg } : { summary });

  // The engine's stable wording as well as the code (source-provider
  // unfinishedSwitchMessage; pinned by repair-copies.test.ts).
  if (code === "UNFINISHED_SWITCH" || /part-way through switching/.test(msg)) {
    return reworded(
      "Gutterpress can't export while the book is part-way through switching drafts. Go to Book setup → Online → Drafts to put it right.",
    );
  }
  if (isMissingManifestError(msg)) {
    return reworded('PDF export needs manifest.yaml. Choose "Set up as a book" first, then try again.');
  }
  // Over-wide content (#163) — the engine's own message ends in advice only a
  // CLI user can take ("pass allowShrink"). Say what the author can act on
  // instead; the "Build anyway" offer that goes with it lives in
  // ExportController.savePdf.
  const overWide = overWideExportMessage(e);
  if (overWide) return reworded(overWide);
  if (code === "TOOL_MISSING") {
    const match = msg.match(/Required system tool not found: ([^\n]+)/);
    const tool = match?.[1]?.trim() ?? "a required tool";
    return reworded(`PDF export needs "${tool}" installed. Open Help (?) > System tools to see how to install it.`);
  }
  if (/chrome|chromium|browser/i.test(msg)) {
    return reworded("PDF export needs a browser (Chrome or Edge) installed. Open Help (?) for setup details.");
  }
  if (/ENOENT|not found/i.test(msg)) {
    return reworded("Could not find a required program. Open Help (?) > System tools to check what needs to be installed.");
  }
  if (/permission|EACCES/i.test(msg)) {
    return reworded("Permission denied saving the PDF. Try saving to a different folder (like your Desktop).");
  }
  // No words of the app's own for this one: say what the build said.
  const reason = msg.split("\n")[0]?.trim() ?? "";
  if (!reason) return { summary: `${what} failed. Open Help (?) > System tools to check for issues.` };
  return { summary: `${what} failed: ${reason}`, ...(reason === msg ? {} : { details: msg }) };
}

/**
 * SvelteKit's `error(status, message)` serializes a thrown route error as
 * `{"message": "…"}` JSON (see routes/api/_lib/handler.ts's `jsonRoute`).
 * `#lib/api.ts`'s `post`/`get` helpers read a non-OK response body with
 * `r.text()` and throw `new Error(text)` verbatim — they never JSON.parse
 * it — so a `catch (e)` on any `api.*` call sees this raw `{"message": "…"}`
 * envelope as `e.message` instead of the message itself. Peel it back before
 * showing it (the Publish view; Book setup → Online copy) so an author is
 * never shown a bare JSON blob.
 */
export function unwrapRouteError(text: string): string {
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

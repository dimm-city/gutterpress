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

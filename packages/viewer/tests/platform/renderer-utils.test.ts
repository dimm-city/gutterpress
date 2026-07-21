import { test, expect } from "bun:test";
import { friendlyHostError, friendlyPdfError } from "../../src/lib/errors";
import { relativeTime } from "../../src/lib/format";

// friendlyHostError is the single shared scrub of Electron's IPC error prefix
// (`Error invoking remote method '<ns:op>': ...`), used by LeftPanel and the
// ConflictChoicesDialog so a host error surfaces the underlying message, not the
// IPC plumbing. Pure string op — no node imports (§8).
test("friendlyHostError strips the IPC remote-method prefix", () => {
  expect(
    friendlyHostError("Error invoking remote method 'app:openFolder': boom"),
  ).toBe("boom");
});

test("friendlyHostError also strips a nested 'Error:' after the prefix", () => {
  expect(
    friendlyHostError(
      "Error invoking remote method 'git:commit': Error: nothing to commit",
    ),
  ).toBe("nothing to commit");
});

test("friendlyHostError leaves a plain message untouched", () => {
  expect(friendlyHostError("nothing to commit")).toBe("nothing to commit");
  expect(friendlyHostError("")).toBe("");
});

// friendlyPdfError(SYNC_CONFLICT) — the host (electron/export/controller.ts)
// throws a deliberately author-friendly message for a blocked export; the
// renderer must pass it through verbatim instead of overwriting it with the
// generic "check System tools" fallback (M4).
test("friendlyPdfError passes through a SYNC_CONFLICT error's own message", () => {
  const err = new Error(
    "Changes happened in two places. Resolve the conflict first, then save the PDF.",
  );
  (err as Error & { code?: string }).code = "SYNC_CONFLICT";
  expect(friendlyPdfError(err)).toBe(
    "Changes happened in two places. Resolve the conflict first, then save the PDF.",
  );
});

// `ipcRenderer.invoke` does not preserve custom Error properties like `code`
// across the IPC boundary, so the passthrough must also work by matching the
// host's known conflict copy in the message text alone.
test("friendlyPdfError passes through a sync-conflict message even without a surviving code", () => {
  const err = new Error(
    "Cannot save a PDF while there are unresolved changes from two places. Resolve the conflict first, then try again.",
  );
  expect(friendlyPdfError(err)).toBe(
    "Cannot save a PDF while there are unresolved changes from two places. Resolve the conflict first, then try again.",
  );
});

// `api:build` is invoked via secureHandle → ipcMain.handle with no
// re-serialization, so the renderer's e.message for a blocked export is
// actually `Error invoking remote method 'api:build': Error: <host message>`.
// The passthrough must scrub that IPC transport prefix (via friendlyHostError)
// so the author sees the host's plain sentence, not the plumbing wrapper.
test("friendlyPdfError scrubs the IPC remote-method prefix off a SYNC_CONFLICT message", () => {
  const err = new Error(
    "Error invoking remote method 'api:build': Error: Changes happened in two places. Resolve the conflict first, then save the PDF.",
  );
  expect(friendlyPdfError(err)).toBe(
    "Changes happened in two places. Resolve the conflict first, then save the PDF.",
  );
});

test("friendlyPdfError still falls back to the generic message for unrelated errors", () => {
  expect(friendlyPdfError(new Error("spawn ENOENT"))).toBe(
    "Could not find a required program. Open Help (?) > System tools to check what needs to be installed.",
  );
});

// ARCH #27 fix-round gap: `electron/pdf-export.ts`'s waitForPagedRendered
// throws a typed BuildError on deadline ("Rendering did not finish after N
// minutes — the export was stopped to avoid an incomplete PDF"). That error
// crosses the `api:build` ipcMain.handle/ipcRenderer.invoke boundary, which
// (like the SYNC_CONFLICT case above) strips the `code` and re-wraps the
// message. friendlyPdfError must therefore recognize the timeout by message
// text alone, or the author sees the generic "check System tools" fallback
// instead of the reason their render was stopped.
test("friendlyPdfError passes through a render-timeout message even without a surviving code", () => {
  const err = new Error(
    "Rendering did not finish after 60 minutes — the export was stopped to avoid an incomplete PDF",
  );
  expect(friendlyPdfError(err)).toBe(
    "Rendering did not finish after 60 minutes — the export was stopped to avoid an incomplete PDF",
  );
});

// Same, but through the real IPC shape the renderer actually receives (the
// `api:build` handler wraps + Electron re-wraps again, dropping `code`).
test("friendlyPdfError scrubs the IPC remote-method prefix off a render-timeout message with no surviving code", () => {
  const err = new Error(
    "Error invoking remote method 'api:build': Error: Rendering did not finish after 60 minutes — the export was stopped to avoid an incomplete PDF",
  );
  expect(friendlyPdfError(err)).toBe(
    "Rendering did not finish after 60 minutes — the export was stopped to avoid an incomplete PDF",
  );
});

// relativeTime renders a coarse "time ago" string for snapshot timestamps.
test("relativeTime returns 'just now' under a minute", () => {
  expect(relativeTime(Date.now())).toBe("just now");
  expect(relativeTime(Date.now() - 20_000)).toBe("just now");
});

test("relativeTime pluralizes minutes and hours", () => {
  expect(relativeTime(Date.now() - 60_000)).toBe("1 min ago");
  expect(relativeTime(Date.now() - 5 * 60_000)).toBe("5 mins ago");
  expect(relativeTime(Date.now() - 60 * 60_000)).toBe("1 hr ago");
  expect(relativeTime(Date.now() - 3 * 60 * 60_000)).toBe("3 hrs ago");
});

test("relativeTime pluralizes days up to two weeks", () => {
  expect(relativeTime(Date.now() - 24 * 60 * 60_000)).toBe("1 day ago");
  expect(relativeTime(Date.now() - 3 * 24 * 60 * 60_000)).toBe("3 days ago");
});

test("relativeTime falls back to a locale date past two weeks", () => {
  const ms = Date.now() - 30 * 24 * 60 * 60_000;
  expect(relativeTime(ms)).toBe(new Date(ms).toLocaleDateString());
});

import { test, expect } from "bun:test";
import {
  friendlyFolderError,
  friendlyHostError,
  friendlyPdfError,
  friendlyPreviewError,
  overWideExportMessage,
} from "../../src/lib/errors";
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

test("friendlyFolderError gives repair guidance for malformed manifest.yaml", () => {
  expect(
    friendlyFolderError(
      'Preview server failed to start: Invalid YAML in "/books/example/manifest.yaml" at line 3, column 1: Tabs are not allowed as indentation',
    ),
  ).toBe(
    "This book's manifest has invalid YAML at line 3, column 1. Fix that entry and try again.",
  );
});

test("friendlyPreviewError explains obsolete manifest fields without closing the folder", () => {
  expect(
    friendlyPreviewError(
      "Error invoking remote method 'api:preview': Error: Preview server failed to start: Manifest field(s) `source.assets` are no longer supported - remove them.",
    ),
  ).toMatchObject({
    title: "This book uses an outdated manifest setting.",
    message: expect.stringContaining("Remove the source.assets block"),
  });
});

test("friendlyPreviewError preserves missing-file details for the repair view", () => {
  const result = friendlyPreviewError(
    "Missing stylesheet: /books/example/css/missing.css\nCheck the path.",
  );
  expect(result.title).toBe("A file needed by the preview is missing.");
  expect(result.details).toContain("/books/example/css/missing.css");
});

test("friendlyPdfError still falls back to the generic message for unrelated errors", () => {
  expect(friendlyPdfError(new Error("spawn ENOENT"))).toBe(
    "Could not find a required program. Open Help (?) > System tools to check what needs to be installed.",
  );
});

test("friendlyPdfError directs a loose preview folder to the existing setup action", () => {
  expect(
    friendlyPdfError(
      new Error("No manifest.yaml found in /books/example."),
    ),
  ).toBe(
    'PDF export needs manifest.yaml. Choose "Set up as a book" first, then try again.',
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

// ─────────────────────────────────────────────────────────────────────────────
// overWideExportMessage (#163) — the engine's over-wide-content error tells the
// author to "pass allowShrink", which no desktop author can do. This is the
// parser behind the in-place "Build anyway" offer: it recognizes that one
// failure, names the offenders, and states the whole-document consequence.
// The fixture is a REAL message, verbatim from a failing 208-page build,
// wrapped exactly as the desktop receives it (engine prefix + Electron's IPC
// prefix, `code` stripped by the ipcMain boundary).
//
// But it is a COPY, and a copy cannot notice the engine rewording itself. The
// producer-side counterpart that can is
// `packages/cli/src/engine/compiler/build.over-wide-message.test.ts`: it runs a
// real build and asserts a mirror of this parser's patterns still matches. The
// tests below own the sentence assembled from the captures; that one owns the
// captures still being there.
// ─────────────────────────────────────────────────────────────────────────────

const OVER_WIDE_MESSAGE =
  "Error invoking remote method 'api:build': Error: PDF build failed: " +
  "content wider than the page content box: Chromium print shrink-to-fit scales " +
  "the WHOLE document — every page, every measurement — to about 0.69x its " +
  "declared size (12pt type prints at 8.3pt). The page size and page count do " +
  "not change, so the shrink is invisible in the PDF:\n" +
  "  div.dc-sidebar.inset — 842px > 828px content box (give it an explicit width)\n" +
  "  h1.dc-chevron — 850px > 828px content box (give it an explicit width)\n" +
  "Fix the offending widths, or pass allowShrink to build anyway.";

test("overWideExportMessage names the offenders and the whole-document scale", () => {
  const msg = overWideExportMessage(
    Object.assign(new Error(OVER_WIDE_MESSAGE), { code: "BUILD_ERROR" }),
  );
  expect(msg).not.toBeNull();
  expect(msg).toContain("div.dc-sidebar.inset");
  expect(msg).toContain("h1.dc-chevron");
  // The consequence the author is agreeing to, in their units.
  expect(msg).toContain("whole book");
  expect(msg).toContain("0.69");
  expect(msg).toContain("12pt type prints at 8.3pt");
  expect(msg).toContain("page size and page count");
  // Never the unreachable advice.
  expect(msg).not.toContain("allowShrink");
});

test("overWideExportMessage lists at most three offenders and counts the rest", () => {
  const many = OVER_WIDE_MESSAGE.replace(
    "Fix the offending widths",
    "  div.a — 900px > 828px content box (give it an explicit width)\n" +
      "  div.b — 900px > 828px content box (give it an explicit width)\n" +
      "Fix the offending widths",
  );
  const msg = overWideExportMessage(new Error(many))!;
  expect(msg).toContain("div.dc-sidebar.inset, h1.dc-chevron, div.a");
  expect(msg).toContain("1 more");
  expect(msg).not.toContain("div.b —");
});

test("overWideExportMessage returns null for every other export failure", () => {
  expect(overWideExportMessage(new Error("disk full"))).toBeNull();
  expect(overWideExportMessage(new Error("spawn ENOENT"))).toBeNull();
  expect(overWideExportMessage(null)).toBeNull();
});

test("friendlyPdfError stops telling desktop authors to pass allowShrink", () => {
  const shown = friendlyPdfError(
    Object.assign(new Error(OVER_WIDE_MESSAGE), { code: "BUILD_ERROR" }),
  );
  expect(shown).not.toContain("allowShrink");
  expect(shown).toContain("div.dc-sidebar.inset");
});

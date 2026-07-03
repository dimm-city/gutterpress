import { test, expect } from "bun:test";
import { friendlyHostError } from "../../src/lib/errors";
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

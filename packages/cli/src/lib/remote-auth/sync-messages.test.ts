import { describe, expect, test } from "bun:test";

import { bannedTermsIn } from "../../test-helpers/vocabulary.ts";
import * as messages from "./sync-messages.ts";
import { SYNC_LATE_EDIT_MESSAGE, SYNC_SNAPSHOT_MESSAGE } from "./sync-messages.ts";

/**
 * Everything in sync-messages.ts is shown to the writer: the MSG_* strings
 * verbatim in toasts, the two history messages raw on github.com and
 * (classified) in the desktop's Version history timeline. None of it may use
 * version-control vocabulary (the SSH hint's `git@…` address is the one thing
 * a writer is told to look at).
 */
const AUTHOR_COPY = Object.entries(messages as Record<string, unknown>).filter(
  (entry): entry is [string, string] => typeof entry[1] === "string",
);

describe("sync messages are writer copy", () => {
  test("there is copy to check", () => {
    expect(AUTHOR_COPY.length).toBeGreaterThanOrEqual(13);
  });

  test("no version-control jargon in anything a writer reads", () => {
    const offenders = AUTHOR_COPY.filter(([, text]) => bannedTermsIn(text.replace(/git@…/g, "")).length > 0).map(
      ([name]) => name,
    );
    expect(offenders).toEqual([]);
  });

  test("the two messages stay distinct so the mid-backup-edit race stays legible", () => {
    expect(SYNC_SNAPSHOT_MESSAGE).not.toBe(SYNC_LATE_EDIT_MESSAGE);
  });
});

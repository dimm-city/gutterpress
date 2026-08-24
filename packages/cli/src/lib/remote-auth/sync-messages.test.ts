import { describe, expect, test } from "bun:test";
import { SYNC_LATE_EDIT_MESSAGE, SYNC_SNAPSHOT_MESSAGE } from "./sync-messages.ts";

/**
 * The two sync HISTORY messages are recorded verbatim as commit messages, so
 * a writer sees them raw on github.com and (classified) in the desktop's
 * Previous versions timeline. Unlike the MSG_* status strings, they must read
 * as author copy with zero version-control vocabulary.
 */
describe("sync history messages are writer copy", () => {
  test("no version-control jargon in what lands in the writer's history", () => {
    for (const message of [SYNC_SNAPSHOT_MESSAGE, SYNC_LATE_EDIT_MESSAGE]) {
      expect(message.toLowerCase()).not.toMatch(/snapshot|commit|\bgit\b|merge|repo/);
    }
  });

  test("the two messages stay distinct so the mid-sync-edit race stays legible", () => {
    expect(SYNC_SNAPSHOT_MESSAGE).not.toBe(SYNC_LATE_EDIT_MESSAGE);
  });
});

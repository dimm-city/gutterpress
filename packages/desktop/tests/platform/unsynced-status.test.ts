/**
 * Not-syncing state derivation (2026-07 git-subsystem review):
 * unsyncedStateFor is the ONE rule mapping a not-syncable diagnosis to the
 * ambient state ("connect" for an HTTPS remote Gutterpress isn't connected
 * to; "local" only when no usable remote exists).
 */
import { expect, test, describe } from "bun:test";
import { unsyncedStateFor } from "../../electron/auto-sync/unsynced-status";

describe("unsyncedStateFor — the one connect-vs-local rule", () => {
  test("HTTPS remote without a credential → connect (one step from syncing)", () => {
    expect(
      unsyncedStateFor({ canSync: false, remoteProtocol: "https", credentialPresent: false }),
    ).toBe("connect");
  });
  test("SSH remote → local (not connectable in-app)", () => {
    expect(
      unsyncedStateFor({ canSync: false, remoteProtocol: "ssh", credentialPresent: false }),
    ).toBe("local");
  });
  test("no remote at all → local", () => {
    expect(
      unsyncedStateFor({ canSync: false, remoteProtocol: "none", credentialPresent: false }),
    ).toBe("local");
  });
});


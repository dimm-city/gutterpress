/**
 * Not-syncing state derivation + the host wiring that keeps the sync state
 * machine's inputs honest (2026-07 git-subsystem review).
 *
 * Unit half: unsyncedStateFor is the ONE rule mapping a not-syncable
 * diagnosis to the ambient state ("connect" for an HTTPS remote print-md
 * isn't connected to; "local" only when no usable remote exists).
 *
 * Wiring half (source-text, per the repo convention for main.ts wiring —
 * see ProjectActivityView.test.ts): the two fixes that made sync work
 * without reopening the app —
 *   1. fs:watchFolder arms the periodic safety-sync interval AFTER the
 *      watcher is live (the open-time arm always failed its watched-dir
 *      guard, so view-only sessions never pulled teammate changes), and
 *   2. credential set/delete re-diagnoses the open project and either kicks
 *      a sync (connect) or re-emits the honest not-syncing state
 *      (disconnect) — the state machine's inputs must not change behind
 *      its back.
 */
import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { unsyncedStateFor } from "../../electron/auto-sync/unsynced-status";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

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

describe("main.ts wiring — the sync state machine reacts to its inputs", () => {
  const main = read("electron/main.ts");

  test("fs:watchFolder arms the periodic interval once the watcher is live", () => {
    // The arm must happen INSIDE the watchFolder handler, after
    // startFolderWatch — the open-time arm (preview controller) always lost
    // its watched-dir race and cancelAll() wiped any survivor.
    const handlerStart = main.indexOf('secureHandle("fs:watchFolder"');
    expect(handlerStart).toBeGreaterThan(-1);
    const handler = main.slice(handlerStart, main.indexOf("});", handlerStart) + 3);
    expect(handler).toContain("startFolderWatch(dirPath)");
    expect(handler).toContain("autoSync.armInterval(");
    expect(handler.indexOf("startFolderWatch(dirPath)")).toBeLessThan(
      handler.indexOf("autoSync.armInterval("),
    );
  });

  test("credential changes re-diagnose the open project and emit/kick sync", () => {
    expect(main).toContain("onCredentialChange(");
    const hookStart = main.indexOf("onCredentialChange(");
    const hook = main.slice(hookStart, hookStart + 2200);
    // Re-diagnoses with the real store, scoped to the project's own remote…
    expect(hook).toContain("diagnoseProjectRemote");
    expect(hook).toContain("diag.remoteHost");
    // …kicks an immediate sync when it became syncable…
    expect(hook).toContain("autoSync.run(dir)");
    // …and re-emits the honest not-syncing state when it didn't.
    expect(hook).toContain("unsyncedStateFor(diag)");
  });

  test("emitSyncStatus retains the last payload for the sync:getStatus query", () => {
    expect(main).toContain("lastSyncStatusByDir.set(path.resolve(payload.projectDir), payload)");
    expect(main).toContain("getStatus: async (projectDir)");
  });
});

describe("credential store — decrypt failures are honest", () => {
  const store = read("electron/credential-store.ts");
  test("status() decrypt-verifies instead of reporting 'connected' from plaintext", () => {
    // The settings panel used to say "Connected" (plaintext entry exists)
    // while get() — what sync actually uses — returned null on an
    // undecryptable cipher, so a keyring change silently stopped sync.
    expect(store).toContain("needsReconnect: true");
    expect(store).toContain("function entryDecrypts(");
  });
  test("set/delete notify the credential-change channel", () => {
    expect(store).toContain("export function onCredentialChange(");
    expect(store).toContain(".then(() => notifyCredentialChange(normalizeHost(host)))");
  });
});

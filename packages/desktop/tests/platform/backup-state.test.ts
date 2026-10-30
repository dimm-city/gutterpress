import { describe, expect, test } from "bun:test";
import { backupState, onlineCopyName, readyView } from "../../src/lib/backup-state";
import type { ProjectRemoteDiagnosis } from "../../src/lib/platform/contract";

type Diag = Pick<ProjectRemoteDiagnosis, "classification" | "guidance" | "remoteUrl">;
const git = { type: "local-git-folder", path: "/b", repoRoot: "/b", subPath: "", hasRemote: true } as const;

describe("backupState", () => {
  test("a plain folder has no versions, whatever else is true", () => {
    const d: Diag = { classification: { type: "local-folder", path: "/b" }, guidance: "local-only" };
    expect(backupState(d)).toBe("no-versions");
  });

  test("versions with no online copy is the set-up state", () => {
    expect(backupState({ classification: { ...git, hasRemote: false }, guidance: "local-only" })).toBe("local-only");
  });

  test("each remote guidance maps to its state", () => {
    const at = (guidance: Diag["guidance"]) =>
      backupState({ classification: git, guidance, remoteUrl: "https://example.com/a/b.git" });
    expect(at("connect-github-to-sync")).toBe("connect-github");
    expect(at("https-connect-server")).toBe("connect-server");
    expect(at("ready-to-sync")).toBe("ready");
    expect(at("ssh-use-own-tools")).toBe("own-tools");
  });

  test("a remote that is neither https nor SSH is never offered a new online copy", () => {
    expect(backupState({ classification: git, guidance: "local-only", remoteUrl: "/srv/git/book.git" })).toBe("own-tools");
  });
});

describe("onlineCopyName", () => {
  test("drops the scheme and the .git suffix", () => {
    expect(onlineCopyName("https://github.com/ada/harbor-lights.git")).toBe("github.com/ada/harbor-lights");
    expect(onlineCopyName("https://git.example.com/team/book/")).toBe("git.example.com/team/book");
  });

  test("drops a user name in the address", () => {
    expect(onlineCopyName("https://ada@dev.azure.com/org/proj/_git/book")).toBe("dev.azure.com/org/proj/_git/book");
  });
});

describe("readyView: never claims a backup without evidence", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const copy = "git.example.com/team/book";

  test("nothing known: names the online copy, with no check mark", () => {
    const on = readyView(copy, null, true, now);
    expect(on).toEqual({ headline: `Online copy: ${copy}`, detail: "Gutterpress backs it up while you work.", ok: false, action: null });
    expect(on.headline).not.toMatch(/backed up/i);
    for (const state of ["idle", "connect", "local"] as const) {
      expect(readyView(copy, { state, lastSyncAt: null }, true, now).headline).toBe(`Online copy: ${copy}`);
    }
  });

  test("automatic backup off: says so and offers Sync now", () => {
    const off = readyView(copy, null, false, now);
    expect(off.detail).toBe("Backing up automatically is off, so this book gets the latest changes and backs up yours only when you ask.");
    expect(off.action).toBe("back-up");
  });

  test("a finished backup is named with its time", () => {
    const v = readyView(copy, { state: "synced", lastSyncAt: "2026-10-28T11:58:00Z" }, true, now);
    expect(v).toMatchObject({ headline: "Backed up · 2 mins ago", ok: true, action: null });
    expect(v.detail).toContain(copy);
    // "synced" with no time is not evidence.
    expect(readyView(copy, { state: "synced", lastSyncAt: null }, true, now).ok).toBe(false);
  });

  test("a pass that left work unsent says so, and offers Sync now when it is up to the author", () => {
    expect(readyView(copy, { state: "unsent", lastSyncAt: "2026-10-28T11:58:00Z" }, false, now)).toMatchObject({
      headline: "Not backed up yet",
      ok: false,
      action: "back-up",
    });
    expect(readyView(copy, { state: "unsent", lastSyncAt: null }, true, now).action).toBeNull();
  });

  test("a failure says why and offers the way on", () => {
    expect(readyView(copy, { state: "offline", lastSyncAt: null }, true, now)).toMatchObject({
      headline: `Couldn't reach ${copy}.`,
      action: "try-again",
    });
    expect(readyView(copy, { state: "auth", lastSyncAt: null }, true, now).action).toBe("sign-in");
    const err = readyView(copy, { state: "error", lastSyncAt: null, message: "The server said no." }, false, now);
    expect(err).toMatchObject({ headline: `Couldn't back up to ${copy}.`, detail: "The server said no.", ok: false, action: "try-again" });
  });

  test("a backup in progress offers nothing to click", () => {
    expect(readyView(copy, { state: "syncing", lastSyncAt: null }, false, now)).toMatchObject({ headline: `Backing up to ${copy}…`, action: null });
  });
});

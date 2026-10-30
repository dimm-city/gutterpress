import { describe, expect, test } from "bun:test";
import { backupState, onlineCopyName, readyView, type LastBackup } from "../../src/lib/backup-state";
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
    expect(on).toEqual({ headline: `Online copy: ${copy}`, detail: "Gutterpress backs it up while you work.", ok: false, action: "back-up" });
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
    expect(v).toMatchObject({ headline: "Backed up · 2 mins ago", ok: true, action: "back-up" });
    expect(v.detail).toContain(copy);
    // "synced" with no time is not evidence.
    expect(readyView(copy, { state: "synced", lastSyncAt: null }, true, now).ok).toBe(false);
  });

  test("a pass that left work unsent says so, and offers to back it up now", () => {
    expect(readyView(copy, { state: "unsent", lastSyncAt: "2026-10-28T11:58:00Z" }, false, now)).toMatchObject({
      headline: "Not backed up yet",
      ok: false,
      action: "back-up",
    });
    expect(readyView(copy, { state: "unsent", lastSyncAt: null }, true, now).action).toBe("back-up");
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

// 0.11.22 offered Back up now (and Get latest beside it) whenever the book could back
// up, with automatic backing up on or off; 0.11.23's betas offered nothing with it on.
describe("readyView: Back up now whenever the book can back up (#485)", () => {
  const now = Date.parse("2026-10-28T12:00:00Z");
  const copy = "github.com/ada/harbor-lights";
  const at = (state: LastBackup["state"] | null, autoSync: boolean) =>
    readyView(copy, state ? { state, lastSyncAt: "2026-10-28T11:58:00Z" } : null, autoSync, now).action;

  test("automatic backing up on: Back up now when idle, backed up or not backed up yet", () => {
    for (const state of [null, "idle", "synced", "unsent"] as const) expect(at(state, true)).toBe("back-up");
  });

  test("automatic backing up off: the same pass (Online copy names it Sync now)", () => {
    for (const state of [null, "idle", "synced", "unsent"] as const) expect(at(state, false)).toBe("back-up");
  });

  test("offline or failed: Try again, the same pass, on or off", () => {
    for (const autoSync of [true, false]) {
      expect(at("offline", autoSync)).toBe("try-again");
      expect(at("error", autoSync)).toBe("try-again");
    }
  });

  test("nothing to press while a pass runs, and a rejected sign-in signs in first", () => {
    for (const autoSync of [true, false]) {
      expect(at("syncing", autoSync)).toBeNull();
      expect(at("auth", autoSync)).toBe("sign-in");
    }
  });
});

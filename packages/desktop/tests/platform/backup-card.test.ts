import { describe, expect, test } from "bun:test";
import { backupCard, checkedAgo, type CardInput } from "../../src/lib/routes/backup-card";
import { versionSubtitle, versionTitle } from "../../src/lib/routes/version-timeline";

const NOW = Date.parse("2026-11-07T12:00:00Z");
const base: CardInput = { situation: "ready", backup: null, checking: false, where: "GitHub · ada/harbor", github: true, autoBackup: true, now: NOW };
const card = (o: Partial<CardInput>) => backupCard({ ...base, ...o });
const synced = (extra = {}) => ({ state: "synced", lastSyncAt: new Date(NOW - 3 * 60_000).toISOString(), ...extra });

describe("backupCard", () => {
  test("plain folder and no online copy", () => {
    expect(card({ situation: "no-versions" })).toMatchObject({ title: "Version history is off", action: "turn-on-versions" });
    expect(card({ situation: "local-only" })).toMatchObject({ title: "Not online yet", action: "set-up-backup" });
  });
  test("checking, with the last known time when there is one", () => {
    expect(card({ backup: null, checking: true })).toMatchObject({ title: "Checking your online copy…", action: null });
    // Not checking and nothing heard yet: what is known, and the one action.
    expect(card({ backup: null, checking: false })).toMatchObject({ title: "Your online copy is set up", action: "back-up" });
    // A status that is not a backup (idle, local, connect) never earns "safe".
    expect(card({ backup: { state: "idle", lastSyncAt: null } }).title).toBe("Your online copy is set up");
    const c = card({ backup: { state: "unsent", lastSyncAt: new Date(NOW - 2 * 3600_000).toISOString() }, checking: true });
    expect(c.title).toBe("Checking your online copy…");
    expect(c.detail).toContain("2 hours ago");
  });
  test("safe names the place once and the time", () => {
    const c = card({ backup: synced() });
    expect(c).toMatchObject({ title: "Your book is safe online", tone: "ok", action: "back-up" });
    expect(c.detail).toBe("Last sent 3 minutes ago to GitHub · ada/harbor. Gutterpress sends your changes as you work.");
    expect(c.detail.match(/ada\/harbor/g)?.length).toBe(1);
  });
  test("ahead, behind, both", () => {
    expect(card({ backup: synced({ ahead: 3 }) })).toMatchObject({ title: "3 changes aren't online yet", action: "back-up" });
    expect(card({ backup: synced({ ahead: 1 }) }).title).toBe("1 change isn't online yet");
    expect(card({ backup: synced({ behind: true }) })).toMatchObject({ title: "New changes are online", action: "get-changes" });
    expect(card({ backup: synced({ behind: true, ahead: 2 }) })).toMatchObject({ title: "Changes here and online", action: "update" });
  });
  test("decide beats everything else", () => {
    expect(card({ backup: synced({ decide: 2, behind: true }) })).toMatchObject({ title: "2 passages need your decision", action: "review-decisions" });
  });
  test("offline, sign-in lost, can't find, paused", () => {
    expect(card({ backup: { state: "offline", lastSyncAt: null } })).toMatchObject({ title: "You're offline", action: "try-again" });
    expect(card({ backup: { state: "auth", lastSyncAt: null } })).toMatchObject({ title: "Your saved sign-in no longer works", action: "sign-in" });
    expect(card({ backup: { state: "not-found", lastSyncAt: null } })).toMatchObject({ title: "Can't find the online copy", action: "check-address", secondary: "sign-in" });
    expect(card({ backup: { state: "error", lastSyncAt: null, message: "Disk is full." } })).toMatchObject({ title: "Sending paused", action: "try-again" });
  });
  test("sign-in never shows a token word", () => {
    const c = card({ situation: "connect-server", where: "git.example.com" });
    expect(c.title).toBe("Sign in to send");
    expect(JSON.stringify(c)).not.toMatch(/token/i);
  });
});

describe("drafts and reassurance", () => {
  test("a book is only safe when the open draft is online; others only here get a muted note", () => {
    const c = card({ backup: synced(), drafts: { currentBackedUp: false, othersOnlyHere: 0 } });
    expect(c).toMatchObject({ title: "This draft isn't online yet", tone: "warn", action: "back-up" });
    const s = card({ backup: synced(), drafts: { currentBackedUp: true, othersOnlyHere: 1 } });
    expect(s).toMatchObject({ title: "Your book is safe online", tone: "ok" });
    expect(s.note).toBe("1 other draft is only on this computer.");
    expect(card({ backup: synced(), drafts: { currentBackedUp: true, othersOnlyHere: 2 } }).note).toBe("2 other drafts are only on this computer.");
  });
  test("the checked time shows only for safe, ahead and behind", () => {
    expect(card({ backup: synced() }).showChecked).toBe(true);
    expect(card({ backup: synced({ ahead: 1 }) }).showChecked).toBe(true);
    expect(card({ backup: synced({ behind: true }) }).showChecked).toBe(true);
    expect(card({ backup: { state: "offline", lastSyncAt: null } }).showChecked).toBeUndefined();
  });
  test("warning cards tell the author their work is safe", () => {
    for (const c of [
      card({ backup: { state: "auth", lastSyncAt: null } }),
      card({ backup: { state: "not-found", lastSyncAt: null } }),
      card({ backup: synced({ decide: 1 }) }),
      card({ backup: { state: "error", lastSyncAt: null, message: "ENOENT: /x/y/z at a.js:1:2" } }),
      card({ situation: "connect-server", where: "git.example.com" }),
    ]) expect(c.detail).toContain("safe on this computer");
  });
  test("a technical paused message becomes a plain sentence", () => {
    expect(card({ backup: { state: "error", lastSyncAt: null, message: "ENOENT: /x/y/z at a.js:1:2" } }).detail).toBe("Gutterpress couldn't send just now. Your work is safe on this computer.");
  });
});

describe("checkedAgo", () => {
  test("seconds then minutes", () => {
    expect(checkedAgo(NOW - 2000, NOW)).toBe("just now");
    expect(checkedAgo(NOW - 20_000, NOW)).toBe("20 seconds ago");
    expect(checkedAgo(NOW - 5 * 60_000, NOW)).toBe("5 minutes ago");
  });
});

describe("version row copy", () => {
  test("the author's note is the title, the label the subtitle", () => {
    expect(versionTitle("Sent to printer")).toBe("Sent to printer");
    expect(versionSubtitle("Sent to printer")).toBeNull();
    expect(versionTitle("Automatic version")).toBe("Automatic version");
    expect(versionSubtitle("Automatic version")).toBeNull();
    expect(versionTitle("Saved a version")).toBe("Version saved by you");
  });
});

import { repairSetAsideText } from "../../src/lib/routes/backup-card";
describe("repairSetAsideText", () => {
  test("names the drafts and versions that exist only here, and points to the repair copies", () => {
    const t = repairSetAsideText({ revisions: ["Second-edition"], versions: 3 });
    expect(t).toContain('1 draft ("Second edition") and 3 versions');
    expect(t).toContain("only on this computer");
    expect(t).toContain("safety folder outside your book");
    expect(t).not.toContain("Saved copies");
  });
  test("says nothing is lost when everything is online, and stays generic without a preview", () => {
    expect(repairSetAsideText({ revisions: [], versions: 0 })).toContain("nothing would be lost");
    const g = repairSetAsideText(null);
    expect(g).toContain("Anything that exists only on this computer");
    expect(g).toContain("safety folder");
  });
  test("one version reads in the singular", () => {
    expect(repairSetAsideText({ revisions: [], versions: 1 })).toContain("1 version that is only");
  });
});

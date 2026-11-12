import { describe, expect, test } from "bun:test";
import { backupCard, checkedAgo, type CardInput } from "../../src/lib/routes/backup-card";
import { versionTitle } from "../../src/lib/routes/version-timeline";

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
  test("safe says when it was last sent; where it is kept is the card's own line", () => {
    const c = card({ backup: synced() });
    expect(c).toMatchObject({ title: "Your book is safe online", tone: "ok", action: "back-up", showChecked: true });
    expect(c.detail).toBe("Last sent 3 minutes ago.");
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
  test("where it is kept and the checked time show while the online copy answers, never on a problem card", () => {
    for (const b of [synced(), synced({ ahead: 1 }), synced({ behind: true }), synced({ behind: true, ahead: 1 }), { state: "unsent", lastSyncAt: null }, null]) {
      expect(card({ backup: b }).showChecked).toBe(true);
    }
    for (const b of [{ state: "offline", lastSyncAt: null }, { state: "auth", lastSyncAt: null }, { state: "error", lastSyncAt: null }, { state: "syncing", lastSyncAt: null }, synced({ decide: 1 })]) {
      expect(card({ backup: b }).showChecked).toBeUndefined();
    }
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
  test("the author's note is the title, else the plain label", () => {
    expect(versionTitle("Sent to printer")).toBe("Sent to printer");
    expect(versionTitle("Automatic version")).toBe("Automatic version");
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

describe("the counts the Waiting card lists", () => {
  test("versions going up and coming down are the title, with who sent them when it is one person", () => {
    expect(card({ backup: synced(), waiting: { up: 7, down: 2, from: "Grace" } })).toMatchObject({ title: "7 versions aren't online yet · 2 new from Grace", tone: "warn", icon: "cloud-upload", action: "back-up" });
    expect(card({ backup: synced(), waiting: { up: 1, down: 0 } }).title).toBe("1 version isn't online yet");
    expect(card({ backup: synced({ behind: true }), waiting: { up: 0, down: 2 } })).toMatchObject({ title: "2 new versions online", tone: "pending", action: "get-changes" });
    expect(card({ backup: synced(), waiting: { up: 100, upAtLeast: true, down: 0 } }).title).toBe("100+ versions aren't online yet");
  });
  test("edits not in a version yet are not counted as versions, but are not 'everything'", () => {
    expect(card({ backup: synced(), waiting: { up: 0, edits: true, down: 0 } }).title).toBe("Your latest edits aren't online yet");
    expect(card({ backup: synced(), waiting: { up: 3, edits: true, down: 0 } }).title).toBe("3 versions aren't online yet");
  });
  test("nothing waiting on a safe book is 'Everything is online'; other states keep their own title", () => {
    expect(card({ backup: synced(), waiting: { up: 0, down: 0 } })).toMatchObject({ title: "Everything is online", tone: "ok" });
    expect(card({ backup: null, waiting: { up: 0, down: 0 } }).title).toBe("Your online copy is set up");
    expect(card({ backup: synced({ ahead: 2 }), waiting: { up: 0, down: 0 } }).title).toBe("2 changes aren't online yet");
  });
  test("a problem outranks the counts", () => {
    expect(card({ backup: { state: "offline", lastSyncAt: null }, waiting: { up: 4, down: 1 } }).title).toBe("You're offline");
    expect(card({ backup: { state: "auth", lastSyncAt: null }, waiting: { up: 4, down: 1 } }).title).toBe("Your saved sign-in no longer works");
    expect(card({ backup: synced({ decide: 1 }), waiting: { up: 4, down: 1 } }).title).toBe("1 passage needs your decision");
    expect(card({ backup: synced(), drafts: { currentBackedUp: false, othersOnlyHere: 0 }, waiting: { up: 0, down: 0 } }).title).toBe("This draft isn't online yet");
  });
});
